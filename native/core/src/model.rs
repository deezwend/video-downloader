use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Added to the list; waits until the user starts it.
    Pending,
    Queued,
    Downloading,
    Processing,
    Paused,
    Completed,
    Failed,
    Canceled,
}

impl Status {
    pub fn is_running(self) -> bool {
        matches!(self, Status::Downloading | Status::Processing)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    BotCheck,
    AuthRequired,
    Unavailable,
    GeoBlocked,
    Network,
    BinaryMissing,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemError {
    pub kind: ErrorKind,
    pub message: String,
}

impl ItemError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Unknown, message)
    }
}

impl std::fmt::Display for ItemError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&serde_json::to_string(self).unwrap_or_else(|_| self.message.clone()))
    }
}

impl std::error::Error for ItemError {}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub percent: f64,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub kind: MediaKind,
    #[serde(default)]
    pub height: Option<u32>,
    pub container: String,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub uploader: Option<String>,
    #[serde(default)]
    pub playlist_title: Option<String>,
    #[serde(default)]
    pub throttle: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub playlist_title: Option<String>,
    pub kind: MediaKind,
    pub height: Option<u32>,
    pub container: String,
    pub output_dir: String,
    pub throttle: bool,
    #[serde(default)]
    pub use_cookies: bool,
    pub status: Status,
    #[serde(default)]
    pub progress: Progress,
    pub file_path: Option<String>,
    pub error: Option<ItemError>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temp_files: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: String,
    pub concurrency: u32,
    pub default_kind: MediaKind,
    pub default_height: Option<u32>,
    pub video_container: String,
    pub audio_format: String,
    pub auto_update: bool,
    pub rate_limit: String,
    pub clipboard_watch: bool,
    pub playlist_throttle: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            concurrency: 3,
            default_kind: MediaKind::Video,
            default_height: Some(1080),
            video_container: "mp4".into(),
            audio_format: "m4a".into(),
            auto_update: true,
            rate_limit: String::new(),
            clipboard_watch: false,
            playlist_throttle: true,
        }
    }
}

impl Settings {
    pub fn sanitize(&mut self) {
        self.concurrency = self.concurrency.clamp(1, 5);
        if !matches!(self.video_container.as_str(), "mp4" | "mkv") {
            self.video_container = "mp4".into();
        }
        if !matches!(self.audio_format.as_str(), "m4a" | "mp3" | "opus") {
            self.audio_format = "m4a".into();
        }
        self.rate_limit = self.rate_limit.trim().to_string();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityOption {
    pub height: u32,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub url: String,
    pub id: Option<String>,
    pub title: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub is_playlist: bool,
    pub url: String,
    pub id: Option<String>,
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub has_video: bool,
    pub qualities: Vec<QualityOption>,
    pub audio_size: Option<u64>,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInfo {
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub ytdlp: BinaryInfo,
    pub ffmpeg: BinaryInfo,
    pub deno: BinaryInfo,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
