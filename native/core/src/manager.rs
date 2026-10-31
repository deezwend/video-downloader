use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};
use serde_json::{Value, json};
use tokio::runtime::{Handle, Runtime};
use tokio::sync::watch;

use crate::binaries::{self, Binaries};
use crate::db::Db;
use crate::model::*;
use crate::process::{self, Job, Line};
use crate::ytdlp::{self, Event, ProgressTracker, Tools};

pub type EventSink = Arc<dyn Fn(String) + Send + Sync>;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);
const PROBE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const UPDATE_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const NETWORK_RETRIES: u32 = 2;
/// YouTube's bot check is often transient; wait and retry before giving up.
const BOT_RETRY_DELAYS: [Duration; 2] = [Duration::from_secs(5), Duration::from_secs(15)];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stop {
    None,
    Pause,
    Cancel,
    Remove { delete_file: bool },
}

enum Outcome {
    Completed(Option<String>),
    Stopped(Stop),
    Failed(ItemError),
}

struct Running {
    stop: watch::Sender<Stop>,
    job: Option<Arc<Job>>,
}

type ProbeCell = Arc<tokio::sync::OnceCell<Result<MediaInfo, ItemError>>>;

struct State {
    items: HashMap<String, DownloadItem>,
    running: HashMap<String, Running>,
    settings: Settings,
}

struct Inner {
    state: Mutex<State>,
    db: Mutex<Db>,
    sink: EventSink,
    handle: Handle,
    data_bin: PathBuf,
    res_bin: PathBuf,
    bins: RwLock<Binaries>,
    cookies: RwLock<Option<PathBuf>>,
    updating: tokio::sync::Mutex<()>,
    /// Successful and in-flight probes by URL, so a repeated paste resolves instantly.
    probes: Mutex<HashMap<String, (Instant, ProbeCell)>>,
}

pub struct Manager {
    rt: Runtime,
    inner: Arc<Inner>,
}

impl Manager {
    pub fn new(
        data_dir: &Path,
        resources_dir: &Path,
        default_download_dir: &str,
        sink: EventSink,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let db = Db::open(&data_dir.join("vdl.db")).map_err(|e| e.to_string())?;

        let mut settings = db.load_settings().unwrap_or_default();
        if settings.download_dir.is_empty() {
            settings.download_dir = default_download_dir.to_string();
        }
        settings.sanitize();

        let mut items = HashMap::new();
        for mut item in db.load_items().map_err(|e| e.to_string())? {
            if matches!(item.status, Status::Queued | Status::Downloading | Status::Processing) {
                item.status = Status::Paused;
                item.progress.speed = None;
                item.progress.eta = None;
                let _ = db.save_item(&item);
            }
            items.insert(item.id.clone(), item);
        }

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("vdl")
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;

        let data_bin = data_dir.join("bin");
        let res_bin = resources_dir.join("bin");
        let auto_update = settings.auto_update;
        let inner = Arc::new(Inner {
            state: Mutex::new(State { items, running: HashMap::new(), settings }),
            db: Mutex::new(db),
            sink,
            handle: rt.handle().clone(),
            bins: RwLock::new(Binaries::resolve(&data_bin, &res_bin)),
            data_bin,
            res_bin,
            cookies: RwLock::new(None),
            updating: tokio::sync::Mutex::new(()),
            probes: Mutex::new(HashMap::new()),
        });

        if auto_update {
            rt.spawn(inner.clone().auto_update());
        }
        Ok(Self { rt, inner })
    }

    fn spawn<F, T>(&self, fut: F) -> impl Future<Output = Result<T, ItemError>> + use<F, T>
    where
        F: Future<Output = Result<T, ItemError>> + Send + 'static,
        T: Send + 'static,
    {
        let handle = self.rt.spawn(fut);
        async move { handle.await.map_err(|e| ItemError::unknown(e.to_string()))? }
    }

    pub fn list_items(&self) -> Vec<DownloadItem> {
        let mut items: Vec<_> = self.inner.state.lock().items.values().cloned().collect();
        items.sort_by_key(|i| i.created_at);
        items
    }

    pub fn settings(&self) -> Settings {
        self.inner.state.lock().settings.clone()
    }

    pub fn set_settings(&self, patch: Value) -> Result<Settings, String> {
        let settings = {
            let mut st = self.inner.state.lock();
            let mut current = serde_json::to_value(&st.settings).map_err(|e| e.to_string())?;
            if let (Some(obj), Some(patch)) = (current.as_object_mut(), patch.as_object()) {
                for (k, v) in patch {
                    obj.insert(k.clone(), v.clone());
                }
            }
            let mut next: Settings = serde_json::from_value(current).map_err(|e| e.to_string())?;
            next.sanitize();
            st.settings = next.clone();
            next
        };
        let _ = self.inner.db.lock().save_settings(&settings);
        self.inner.schedule();
        Ok(settings)
    }

    pub fn enqueue(&self, requests: Vec<DownloadRequest>) -> Vec<String> {
        let mut ids = Vec::with_capacity(requests.len());
        let created = now_ms();
        let items: Vec<DownloadItem> = {
            let mut st = self.inner.state.lock();
            let default_dir = st.settings.download_dir.clone();
            requests
                .into_iter()
                .enumerate()
                .map(|(n, r)| {
                    let item = DownloadItem {
                        id: uuid::Uuid::new_v4().to_string(),
                        url: r.url,
                        title: r.title,
                        thumbnail: r.thumbnail,
                        duration: r.duration,
                        uploader: r.uploader,
                        playlist_title: r.playlist_title,
                        kind: r.kind,
                        height: r.height,
                        container: r.container,
                        output_dir: r.output_dir.filter(|d| !d.is_empty()).unwrap_or_else(|| default_dir.clone()),
                        throttle: r.throttle,
                        use_cookies: false,
                        status: Status::Pending,
                        progress: Progress::default(),
                        file_path: None,
                        error: None,
                        created_at: created + n as i64,
                        finished_at: None,
                        temp_files: Vec::new(),
                    };
                    ids.push(item.id.clone());
                    st.items.insert(item.id.clone(), item.clone());
                    item
                })
                .collect()
        };
        for item in &items {
            self.inner.persist_emit(item);
        }
        self.inner.schedule();
        ids
    }

    fn signal(&self, id: &str, stop: Stop) -> bool {
        let st = self.inner.state.lock();
        match st.running.get(id) {
            Some(r) => {
                let _ = r.stop.send(stop);
                true
            }
            None => false,
        }
    }

    pub fn pause(&self, id: &str) {
        if !self.signal(id, Stop::Pause) {
            self.inner.update(id, |i| {
                if i.status == Status::Queued {
                    i.status = Status::Paused;
                }
            });
        }
    }

    pub fn resume(&self, id: &str) {
        self.inner.update(id, |i| {
            if matches!(i.status, Status::Pending | Status::Paused) {
                i.status = Status::Queued;
            }
        });
        self.inner.schedule();
    }

    pub fn retry(&self, id: &str) {
        self.inner.update(id, |i| {
            if matches!(i.status, Status::Failed | Status::Canceled | Status::Paused) {
                if i.status == Status::Canceled {
                    i.progress = Progress::default();
                }
                i.status = Status::Queued;
                i.error = None;
            }
        });
        self.inner.schedule();
    }

    pub fn cancel(&self, id: &str) {
        if self.signal(id, Stop::Cancel) {
            return;
        }
        let mut temps = Vec::new();
        self.inner.update(id, |i| {
            if matches!(i.status, Status::Queued | Status::Paused) {
                i.status = Status::Canceled;
                i.progress = Progress::default();
                temps = std::mem::take(&mut i.temp_files);
            }
        });
        delete_files(&temps);
    }

    pub fn remove(&self, id: &str, delete_file: bool) {
        if !self.signal(id, Stop::Remove { delete_file }) {
            self.inner.remove_item(id, delete_file);
        }
    }

    pub fn clear_finished(&self) {
        let ids: Vec<String> = self
            .inner
            .state
            .lock()
            .items
            .values()
            .filter(|i| matches!(i.status, Status::Completed | Status::Canceled))
            .map(|i| i.id.clone())
            .collect();
        for id in ids {
            self.inner.remove_item(&id, false);
        }
    }

    pub fn set_cookies(&self, path: Option<PathBuf>) {
        *self.inner.cookies.write() = path.filter(|p| p.is_file());
        self.inner.probes.lock().clear();
    }

    pub fn binary_status(&self) -> impl Future<Output = Result<BinaryStatus, ItemError>> + use<> {
        let bins = self.inner.bins.read().clone();
        self.spawn(async move { Ok(bins.status().await) })
    }

    pub fn update_ytdlp(&self) -> impl Future<Output = Result<String, ItemError>> + use<> {
        let inner = self.inner.clone();
        self.spawn(async move { inner.update_ytdlp().await })
    }

    pub fn probe(&self, url: String) -> impl Future<Output = Result<MediaInfo, ItemError>> + use<> {
        let inner = self.inner.clone();
        self.spawn(async move { inner.probe(&url).await })
    }

    /// Title and thumbnail only, typically in a few hundred ms; `None` for unsupported sites.
    pub fn preview(&self, url: String) -> impl Future<Output = Result<Option<MediaInfo>, ItemError>> + use<> {
        self.spawn(async move { Ok(crate::preview::fetch(&url).await) })
    }

    /// Stops all running downloads so they can be resumed on next launch.
    pub fn shutdown(&self) {
        let paused: Vec<DownloadItem> = {
            let mut st = self.inner.state.lock();
            let ids: Vec<String> = st.running.keys().cloned().collect();
            for r in st.running.values() {
                let _ = r.stop.send(Stop::Pause);
                if let Some(job) = &r.job {
                    job.terminate();
                }
            }
            ids.iter()
                .filter_map(|id| {
                    let item = st.items.get_mut(id)?;
                    item.status = Status::Paused;
                    item.progress.speed = None;
                    item.progress.eta = None;
                    Some(item.clone())
                })
                .collect()
        };
        let db = self.inner.db.lock();
        for item in &paused {
            let _ = db.save_item(item);
        }
    }
}

fn delete_files(paths: &[String]) {
    for p in paths {
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(format!("{p}.ytdl"));
    }
}

impl Inner {
    fn emit(&self, value: Value) {
        (self.sink)(value.to_string());
    }

    fn persist_emit(&self, item: &DownloadItem) {
        let _ = self.db.lock().save_item(item);
        self.emit(json!({ "type": "item", "item": item }));
    }

    fn get(&self, id: &str) -> Option<DownloadItem> {
        self.state.lock().items.get(id).cloned()
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut DownloadItem)) -> Option<DownloadItem> {
        let item = {
            let mut st = self.state.lock();
            let item = st.items.get_mut(id)?;
            f(item);
            item.clone()
        };
        self.persist_emit(&item);
        Some(item)
    }

    fn remove_item(&self, id: &str, delete_file: bool) {
        let Some(item) = self.state.lock().items.remove(id) else { return };
        let _ = self.db.lock().delete_item(id);
        if item.status != Status::Completed {
            delete_files(&item.temp_files);
        }
        if delete_file {
            if let Some(p) = &item.file_path {
                let _ = std::fs::remove_file(p);
            }
        }
        self.emit(json!({ "type": "removed", "id": id }));
    }

    fn schedule(self: &Arc<Self>) {
        let mut started = Vec::new();
        {
            let mut st = self.state.lock();
            let free = (st.settings.concurrency as usize).saturating_sub(st.running.len());
            let mut queued: Vec<(i64, String)> = st
                .items
                .values()
                .filter(|i| i.status == Status::Queued && !st.running.contains_key(&i.id))
                .map(|i| (i.created_at, i.id.clone()))
                .collect();
            queued.sort();
            for (_, id) in queued.into_iter().take(free) {
                let (tx, rx) = watch::channel(Stop::None);
                st.running.insert(id.clone(), Running { stop: tx, job: None });
                if let Some(item) = st.items.get_mut(&id) {
                    item.status = Status::Downloading;
                    item.error = None;
                    item.finished_at = None;
                    started.push((item.clone(), rx));
                }
            }
        }
        for (item, rx) in started {
            self.persist_emit(&item);
            self.handle.spawn(self.clone().run(item.id, rx));
        }
    }

    async fn run(self: Arc<Self>, id: String, mut stop: watch::Receiver<Stop>) {
        let mut retries = 0;
        let mut bot_retries = 0;
        let outcome = loop {
            let Some(item) = self.get(&id) else { break Outcome::Stopped(Stop::Remove { delete_file: false }) };
            let settings = self.state.lock().settings.clone();
            let bins = self.bins.read().clone();
            let cookies = if item.use_cookies { self.cookies.read().clone() } else { None };
            let Some(ytdlp) = bins.ytdlp.clone() else {
                break Outcome::Failed(ItemError::new(ErrorKind::BinaryMissing, "yt-dlp"));
            };

            match self.execute(&item, &settings, &ytdlp, &bins, cookies.as_deref(), &mut stop).await {
                Outcome::Failed(e)
                    if e.kind == ErrorKind::BotCheck && bot_retries < BOT_RETRY_DELAYS.len() =>
                {
                    let delay = BOT_RETRY_DELAYS[bot_retries];
                    bot_retries += 1;
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = stop.changed() => break Outcome::Stopped(*stop.borrow()),
                    }
                }
                Outcome::Failed(e)
                    if matches!(e.kind, ErrorKind::AuthRequired | ErrorKind::BotCheck)
                        && !item.use_cookies
                        && self.cookies.read().is_some() =>
                {
                    self.update(&id, |i| i.use_cookies = true);
                }
                Outcome::Failed(e) if e.kind == ErrorKind::Network && retries < NETWORK_RETRIES => {
                    retries += 1;
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(3)) => {}
                        _ = stop.changed() => break Outcome::Stopped(*stop.borrow()),
                    }
                }
                other => break other,
            }
        };
        self.finish(&id, outcome);
        self.schedule();
    }

    async fn execute(
        &self,
        item: &DownloadItem,
        settings: &Settings,
        ytdlp: &Path,
        bins: &Binaries,
        cookies: Option<&Path>,
        stop: &mut watch::Receiver<Stop>,
    ) -> Outcome {
        let pending = *stop.borrow();
        if pending != Stop::None {
            return Outcome::Stopped(pending);
        }
        let _ = tokio::fs::create_dir_all(&item.output_dir).await;

        let tools = Tools { bins, cookies };
        let args = ytdlp::download_args(item, settings, &tools);
        let mut child = match process::command(ytdlp, &args).spawn() {
            Ok(c) => c,
            Err(e) => return Outcome::Failed(ItemError::new(ErrorKind::BinaryMissing, e.to_string())),
        };
        let job = Job::attach(&child).ok().map(Arc::new);
        if let Some(r) = self.state.lock().running.get_mut(&item.id) {
            r.job = job.clone();
        }

        let mut lines = process::stream_lines(&mut child);
        let mut tracker = ProgressTracker::default();
        let mut tail: VecDeque<String> = VecDeque::with_capacity(40);
        let mut final_path = None;
        let mut last_emit = Instant::now() - PROGRESS_INTERVAL;

        let stopped = loop {
            tokio::select! {
                line = lines.recv() => {
                    let Some(line) = line else { break None };
                    let (text, is_err) = match line {
                        Line::Out(t) => (t, false),
                        Line::Err(t) => (t, true),
                    };
                    match ytdlp::parse_line(&text) {
                        Some(Event::Progress(v)) => {
                            let (progress, files) = tracker.update(&v);
                            self.on_progress(&item.id, progress, files, &mut last_emit);
                        }
                        Some(Event::PostProcess(_)) => {
                            self.update(&item.id, |i| {
                                if i.status == Status::Downloading {
                                    i.status = Status::Processing;
                                    i.progress.speed = None;
                                    i.progress.eta = None;
                                }
                            });
                        }
                        Some(Event::Info(v)) => self.on_info(&item.id, &v),
                        Some(Event::File(f)) => final_path = Some(f),
                        None if is_err || text.starts_with("ERROR:") => {
                            if tail.len() == 40 {
                                tail.pop_front();
                            }
                            tail.push_back(text);
                        }
                        None => {}
                    }
                }
                changed = stop.changed() => {
                    let s = if changed.is_err() { Stop::Pause } else { *stop.borrow() };
                    if s != Stop::None {
                        break Some(s);
                    }
                }
            }
        };

        if let Some(s) = stopped {
            match &job {
                Some(j) => j.terminate(),
                None => {
                    let _ = child.start_kill();
                }
            }
            let _ = child.wait().await;
            return Outcome::Stopped(s);
        }

        match child.wait().await {
            Ok(status) if status.success() => Outcome::Completed(final_path),
            _ => Outcome::Failed(ytdlp::classify(tail.make_contiguous())),
        }
    }

    fn on_progress(&self, id: &str, progress: Progress, files: Vec<String>, last_emit: &mut Instant) {
        let mut status_changed = None;
        let mut new_files = false;
        {
            let mut st = self.state.lock();
            let Some(item) = st.items.get_mut(id) else { return };
            for f in files {
                if !item.temp_files.contains(&f) {
                    item.temp_files.push(f);
                    new_files = true;
                }
            }
            item.progress = progress.clone();
            if item.status == Status::Processing {
                item.status = Status::Downloading;
                status_changed = Some(item.clone());
            } else if new_files {
                status_changed = Some(item.clone());
            }
        }
        if let Some(item) = status_changed {
            self.persist_emit(&item);
        }
        if last_emit.elapsed() >= PROGRESS_INTERVAL || progress.percent >= 100.0 {
            *last_emit = Instant::now();
            self.emit(json!({ "type": "progress", "id": id, "progress": progress }));
        }
    }

    fn on_info(&self, id: &str, v: &Value) {
        let s = |k: &str| v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
        self.update(id, |i| {
            i.title = i.title.take().or_else(|| s("title"));
            i.thumbnail = i.thumbnail.take().or_else(|| s("thumbnail"));
            i.uploader = i.uploader.take().or_else(|| s("uploader"));
            i.duration = i.duration.or_else(|| v.get("duration").and_then(Value::as_f64));
        });
    }

    fn finish(&self, id: &str, outcome: Outcome) {
        let mut to_delete = Vec::new();
        let item = {
            let mut st = self.state.lock();
            st.running.remove(id);
            if let Outcome::Stopped(Stop::Remove { delete_file }) = outcome {
                drop(st);
                self.remove_item(id, delete_file);
                return;
            }
            let Some(item) = st.items.get_mut(id) else { return };
            item.progress.speed = None;
            item.progress.eta = None;
            match outcome {
                Outcome::Completed(path) => {
                    item.status = Status::Completed;
                    item.file_path = path.or(item.file_path.take());
                    item.progress.percent = 100.0;
                    item.finished_at = Some(now_ms());
                    item.error = None;
                    item.temp_files.clear();
                }
                Outcome::Failed(e) => {
                    item.status = Status::Failed;
                    item.error = Some(e);
                }
                Outcome::Stopped(Stop::Cancel) => {
                    item.status = Status::Canceled;
                    item.progress = Progress::default();
                    to_delete = std::mem::take(&mut item.temp_files);
                }
                Outcome::Stopped(_) => item.status = Status::Paused,
            }
            item.clone()
        };
        delete_files(&to_delete);
        self.persist_emit(&item);
    }

    async fn probe(&self, url: &str) -> Result<MediaInfo, ItemError> {
        let cell = {
            let mut probes = self.probes.lock();
            probes.retain(|_, (at, _)| at.elapsed() < PROBE_CACHE_TTL);
            probes.entry(url.to_string()).or_insert_with(|| (Instant::now(), ProbeCell::default())).1.clone()
        };
        let result = cell.get_or_init(|| self.run_probe(url)).await.clone();
        if result.is_err() {
            let mut probes = self.probes.lock();
            if probes.get(url).is_some_and(|(_, c)| Arc::ptr_eq(c, &cell)) {
                probes.remove(url);
            }
        }
        result
    }

    async fn run_probe(&self, url: &str) -> Result<MediaInfo, ItemError> {
        let bins = self.bins.read().clone();
        let ytdlp = bins
            .ytdlp
            .clone()
            .ok_or_else(|| ItemError::new(ErrorKind::BinaryMissing, "yt-dlp"))?;
        let cookies = self.cookies.read().clone();

        let run = |cookies: Option<PathBuf>| {
            let tools = Tools { bins: &bins, cookies: cookies.as_deref() };
            let args = ytdlp::probe_args(url, &tools);
            let fut = process::command(&ytdlp, args).output();
            async move {
                let out = tokio::time::timeout(PROBE_TIMEOUT, fut)
                    .await
                    .map_err(|_| ItemError::new(ErrorKind::Network, "timeout"))?
                    .map_err(|e| ItemError::new(ErrorKind::BinaryMissing, e.to_string()))?;
                if out.status.success() {
                    ytdlp::parse_probe(&String::from_utf8_lossy(&out.stdout), url)
                } else {
                    let stderr: Vec<String> =
                        String::from_utf8_lossy(&out.stderr).lines().map(str::to_string).collect();
                    Err(ytdlp::classify(&stderr))
                }
            }
        };

        let mut result = run(None).await;
        for delay in [Duration::from_secs(3), Duration::from_secs(8)] {
            match &result {
                Err(e) if e.kind == ErrorKind::BotCheck => {
                    tokio::time::sleep(delay).await;
                    result = run(None).await;
                }
                _ => break,
            }
        }
        match result {
            Err(e)
                if matches!(e.kind, ErrorKind::AuthRequired | ErrorKind::BotCheck)
                    && cookies.is_some() =>
            {
                run(cookies).await
            }
            other => other,
        }
    }

    async fn update_ytdlp(&self) -> Result<String, ItemError> {
        let _guard = self.updating.lock().await;
        let tag = binaries::latest_ytdlp_tag().await?;
        let current = self.bins.read().ytdlp.clone();
        if let Some(path) = current {
            if binaries::is_onedir(&path)
                && binaries::ytdlp_version(&path).await.as_deref() == Some(tag.as_str())
            {
                return Ok(tag);
            }
        }
        binaries::install_ytdlp(&self.data_bin, &tag).await?;
        let bins = Binaries::resolve(&self.data_bin, &self.res_bin);
        *self.bins.write() = bins.clone();
        self.emit(json!({ "type": "binaries", "status": bins.status().await }));
        Ok(tag)
    }

    async fn auto_update(self: Arc<Self>) {
        let now = now_ms();
        let last = self
            .db
            .lock()
            .get("last_update_check")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        if now - last < UPDATE_INTERVAL_MS {
            return;
        }
        if self.update_ytdlp().await.is_ok() {
            let _ = self.db.lock().set("last_update_check", &now.to_string());
        }
    }
}
