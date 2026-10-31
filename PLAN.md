# Video Downloader — Plan

Electron (arayüz) + Rust (çekirdek, napi-rs ile native modül) + yt-dlp / ffmpeg / Deno (sidecar binary'ler).

## Kararlar

| Konu | Seçim | Neden |
|---|---|---|
| Rust ↔ Electron | **napi-rs** native modül (`.node`) | Aynı süreç, tipli API, event'ler `ThreadsafeFunction` ile |
| Arayüz | **React + TypeScript + Vite** (`electron-vite`) | Hızlı geliştirme, HMR |
| Stil | Düz CSS + CSS değişkenleri | Ek bağımlılık yok, tema kontrolü tam |
| Veritabanı | **SQLite** (`rusqlite`, bundled) | Geçmiş, kuyruk, ayarlar |
| Paketleme | **electron-builder**, önce Windows (NSIS) | macOS/Linux sonra |
| Paket yöneticisi | npm | Sistemde kurulu |

## Arayüz kuralları

- Gradient yok.
- Mor/menekşe/indigo yok. Nötr gri yüzeyler + tek vurgu rengi (mavi `#2563EB`, değiştirilebilir).
- Açıklama metni yok. Kısa etiketler ve ikonlar.
- Açık/koyu tema, sistem temasını takip eder.

## Klasör yapısı

```
video-downloader/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/            # Electron main: pencere, IPC, giriş penceresi, çerez export
│  ├─ preload/         # contextBridge ile güvenli API
│  └─ renderer/        # React arayüz
├─ native/             # Cargo workspace
│  ├─ core/            # Saf Rust: binary yönetimi, yt-dlp runner, kuyruk, DB
│  └─ node/            # napi-rs binding (core'u JS'e açar)
└─ resources/bin/      # Paketlenen yt-dlp.exe, ffmpeg.exe, ffprobe.exe, deno.exe
```

`core` Electron'dan bağımsız tutulur ve ayrı test edilir. `node` sadece ince bir köprüdür.

## Rust API (JS'e açılan)

```ts
init(opts: { dataDir: string; resourcesDir: string }): void
onEvent(cb: (e: DownloadEvent) => void): void

probe(url: string): Promise<MediaInfo>            // yt-dlp -J --flat-playlist
enqueue(req: DownloadRequest): string             // id döner
pause(id: string): void
resume(id: string): void
cancel(id: string): void
remove(id: string, deleteFile: boolean): void
listItems(): DownloadItem[]

getSettings(): Settings
setSettings(s: Partial<Settings>): void

binaryStatus(): BinaryStatus                      // sürümler, eksikler
updateYtDlp(): Promise<string>                    // yeni sürüm
setCookiesFile(path: string | null): void
```

`DownloadEvent` türleri: `queued`, `started`, `progress { percent, speed, eta, downloaded, total }`, `postprocessing`, `completed { filePath }`, `failed { kind, message }`, `paused`, `canceled`.

`failed.kind`: `auth_required` · `unavailable` · `geo_blocked` · `network` · `binary_missing` · `unknown`.

## Fazlar

### Faz 0 — İskelet
- `electron-vite` ile React + TS projesi.
- Cargo workspace (`native/core`, `native/node`), napi-rs build'i npm script'lerine bağlı.
- Renderer → preload → main → Rust: `ping()` çağrısı uçtan uca çalışıyor.
- ESLint + Prettier, `cargo fmt` + `clippy`.

**Bitti sayılır:** `npm run dev` pencereyi açar, Rust'tan dönen değer ekranda görünür.

### Faz 1 — Binary yönetimi
- Arama sırası: `userData/bin` → `resources/bin`. Güncellenen yt-dlp `userData/bin`'e yazılır.
- `yt-dlp --version`, `ffmpeg -version`, `deno --version` ile durum kontrolü.
- yt-dlp güncelleme: GitHub releases API → `yt-dlp.exe` indir → SHA256 doğrula (`SHA2-256SUMS`) → atomik değiştir.
- Açılışta günde en fazla bir kez otomatik kontrol.
- Tüm süreçler `CREATE_NO_WINDOW` ile başlatılır (konsol penceresi açılmaz).
- `scripts/fetch-binaries.mjs`: geliştirme ve paketleme için binary'leri `resources/bin`'e indirir.

### Faz 2 — Probe (bilgi çekme)
- `yt-dlp -J --flat-playlist --no-warnings <url>` → JSON → `MediaInfo`.
- Tekil video: başlık, kanal, süre, thumbnail, formatlar.
- Formatları sadeleştirme: `2160p / 1440p / 1080p / 720p / 480p / 360p` + `Sadece ses (m4a / mp3 / opus)`.
- Playlist: giriş listesi (id, başlık, süre), tek tek seçilebilir.
- Zaman aşımı ve iptal desteği.

### Faz 3 — İndirme motoru
- Komut şablonu:
  ```
  yt-dlp <url>
    -f "bv*[height<=H]+ba/b[height<=H]"   (ses için: -x --audio-format X)
    --merge-output-format mp4|mkv
    -o "<dir>/%(title)s [%(id)s].%(ext)s"
    --ffmpeg-location <ffmpeg>
    --js-runtimes deno:<deno>
    --newline --no-colors
    --progress-template "download:[VDL]%(progress)j"
    --print "after_move:[VDL_FILE]%(filepath)s"
    --continue --no-part=false
    [--cookies <file>]
  ```
- stdout satır satır okunur; `[VDL]` ile başlayanlar JSON olarak parse edilir, ilerleme event'leri 250 ms'de bir yayınlanır (throttle).
- Kuyruk: `tokio` + semaphore, eşzamanlılık ayarlanabilir (varsayılan 3).
- **Süreç ağacı:** Her indirme bir Windows **Job Object**'e atanır; iptalde yt-dlp ve alt süreci ffmpeg birlikte kapanır.
- **Duraklat:** Windows'ta süreç dondurulamaz → süreç kapatılır, `.part` dosyası kalır, devamda `--continue` ile kaldığı yerden sürer.
- **Hata sınıflandırma:** stderr regex'leri → `failed.kind`:
  - `Sign in to confirm|age-restricted|Private video|members-only|cookies` → `auth_required`
  - `not available in your country` → `geo_blocked`
  - `Video unavailable|removed` → `unavailable`
  - `timed out|Connection reset|HTTP Error 5\d\d` → `network` (otomatik 2 tekrar)
- Aynı dosya adı varsa ` (1)` eki.

### Faz 4 — Kalıcılık
- SQLite tabloları: `items` (id, url, title, thumb, format, status, path, size, created_at, finished_at, error), `settings` (key, value).
- Açılışta yarım kalan indirmeler `paused` olarak geri yüklenir.
- Ayarlar: indirme klasörü, eşzamanlılık, varsayılan kalite, varsayılan konteyner, yt-dlp otomatik güncelleme, hız limiti (`-r`), playlist bekleme süresi.

### Faz 5 — Arayüz
- **Ana ekran:** Üstte URL girişi (yapıştırınca otomatik probe), altta indirme listesi.
- **Liste satırı:** thumbnail · başlık · kalite · ilerleme çubuğu · hız / kalan süre · durum ikonları (duraklat, devam, iptal, klasörde göster).
- **Format penceresi:** Kalite seçimi, video/ses, konteyner, hedef klasör. Playlist ise seçim listesi.
- **Ayarlar:** Tek sayfa, gruplanmış.
- Panodan URL algılama (pencere odaklanınca, isteğe bağlı).
- Sürükle-bırak ile URL ekleme.
- Klavye: `Ctrl+V` direkt ekle, `Delete` kaldır.

### Faz 6 — Giriş / çerezler
- Sadece `auth_required` hatasında satırda "Giriş yap" butonu çıkar.
- Ayrı `persist:yt-login` partition'lı `BrowserWindow` → kullanıcı giriş yapar → pencere kapanınca çerezler Netscape formatında `userData/cookies.txt`'e yazılır → Rust'a `setCookiesFile`.
- Başarısız öğe otomatik yeniden denenir.
- Ayarlarda "Oturumu kapat": partition temizlenir, dosya silinir.
- Çerez dosyası sadece gerektiğinde kullanılır, varsayılan indirmeler çerezsiz.

### Faz 7 — Playlist ve toplu indirme
- Playlist öğeleri tek tek kuyruğa eklenir (ayrı ilerleme, ayrı hata).
- `--sleep-requests 1 --sleep-interval 2` playlist'lerde varsayılan.
- Çoklu URL yapıştırma (satır satır).

### Faz 8 — Paketleme
- `electron-builder` NSIS kurulum.
- `.node` dosyası `asarUnpack`, binary'ler `extraResources` ile `resources/bin`.
- Uygulama ikonu, sürüm, otomatik uygulama güncellemesi (`electron-updater`) — isteğe bağlı.
- ffmpeg: ayrı executable olarak dağıtılır; lisans dosyaları `resources/licenses/` altında.

### Faz 9 — Test
- `core`: format seçici, progress parser, hata sınıflandırıcı, Netscape çerez yazıcı için birim testler (örnek yt-dlp çıktılarıyla).
- Entegrasyon: gerçek yt-dlp ile kısa, herkese açık bir video indirme (manuel/opsiyonel CI).
- Arayüz: Playwright ile Electron smoke test (aç, URL ekle, listede görün).

## Sıra

Faz 0 → 1 → 2 → 3 → 5 (temel arayüz) → 4 → 6 → 7 → 8 → 9.
Faz 3 bittiğinde ilk kullanılabilir sürüm: URL yapıştır, kalite seç, indir.
