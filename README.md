# Video Downloader

Electron + Rust (napi-rs) + yt-dlp.

## Gereksinimler

- Node.js 24+, npm
- Rust (MSVC toolchain) ve Visual Studio Build Tools

## Kurulum

```bash
npm install
npm run fetch:bin
npm run build:native:debug
```

`fetch:bin` yt-dlp, ffmpeg/ffprobe, Deno ve `bgutil-pot`'u `resources/bin`, PO token eklentisini `resources/plugins` altına indirir (SHA-256 doğrulamalı).

`bgutil-pot` + eklenti, YouTube'un "bot değilim" kontrolünü hesap girişi olmadan geçmek için PO token üretir. yt-dlp'ye `--plugin-dirs` ve `--extractor-args youtubepot-bgutilcli:cli_path=...` ile verilir.

## Geliştirme

```bash
npm run dev
```

Rust kodu değişince `npm run build:native:debug` tekrar çalıştırılır.

## Paketleme

```bash
npm run dist
```

Çıktı: `dist/` altında NSIS kurulum dosyası.

## Yapı

| Klasör | İçerik |
|---|---|
| `native/core` | Kuyruk, yt-dlp süreç yönetimi, ilerleme ayrıştırma, hata sınıflandırma, SQLite, yt-dlp güncelleme |
| `native/node` | napi-rs köprüsü (`build/native/vdl.node`) |
| `src/main` | Electron main: pencere, IPC, giriş penceresi ve çerez export |
| `src/preload` | `window.api` |
| `src/renderer` | React arayüz |
| `src/shared` | Ortak tipler |
| `scripts/fetch-binaries.mjs` | Harici binary'leri indirir |

## Çalışma zamanı dosyaları

`%APPDATA%\Video Downloader\`:

- `vdl.db` — indirme listesi ve ayarlar
- `bin\yt-dlp-<sürüm>\` — güncellenmiş yt-dlp, onedir sürümü (paketlenmiş olandan önceliklidir)
- `cookies.txt` — sadece giriş yapıldıysa

Binary arama sırası: `%APPDATA%\Video Downloader\bin` → `resources\bin` → `PATH`.
