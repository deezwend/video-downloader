use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::model::{BinaryInfo, BinaryStatus, ItemError};
use crate::process;

const YTDLP_REPO: &str = "https://github.com/yt-dlp/yt-dlp";
const USER_AGENT: &str = concat!("video-downloader/", env!("CARGO_PKG_VERSION"));

#[derive(Clone, Debug, Default)]
pub struct Binaries {
    pub ytdlp: Option<PathBuf>,
    pub ffmpeg: Option<PathBuf>,
    pub deno: Option<PathBuf>,
    pub pot: Option<PathBuf>,
    pub plugins: Option<PathBuf>,
}

pub fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn find(name: &str, dirs: &[&Path]) -> Option<PathBuf> {
    let file = exe(name);
    dirs.iter()
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
        .or_else(|| {
            std::env::var_os("PATH").and_then(|paths| {
                std::env::split_paths(&paths).map(|d| d.join(&file)).find(|p| p.is_file())
            })
        })
}

/// Newest `yt-dlp-<tag>` onedir install in `dir`.
#[cfg(windows)]
fn latest_onedir(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("yt-dlp-"))
        .map(|e| e.path().join("yt-dlp.exe"))
        .filter(|p| p.is_file())
        .max()
}

/// Onedir builds start ~1 s faster than the self-extracting single exe, so they win.
#[cfg(windows)]
fn find_ytdlp(data_bin: &Path, res_bin: &Path) -> Option<PathBuf> {
    latest_onedir(data_bin)
        .or_else(|| Some(res_bin.join("yt-dlp").join("yt-dlp.exe")).filter(|p| p.is_file()))
        .or_else(|| find("yt-dlp", &[data_bin, res_bin]))
}

#[cfg(not(windows))]
fn find_ytdlp(data_bin: &Path, res_bin: &Path) -> Option<PathBuf> {
    find("yt-dlp", &[data_bin, res_bin])
}

/// Whether `path` is a fast-starting yt-dlp build (always true off Windows).
pub fn is_onedir(path: &Path) -> bool {
    !cfg!(windows) || path.parent().is_some_and(|d| d.join("_internal").is_dir())
}

impl Binaries {
    /// User-writable dir first (updated yt-dlp), then bundled resources, then PATH.
    pub fn resolve(data_bin: &Path, res_bin: &Path) -> Self {
        let dirs = [data_bin, res_bin];
        Self {
            ytdlp: find_ytdlp(data_bin, res_bin),
            ffmpeg: find("ffmpeg", &dirs),
            deno: find("deno", &dirs),
            pot: find("bgutil-pot", &dirs),
            plugins: res_bin
                .parent()
                .map(|r| r.join("plugins"))
                .filter(|p| p.join("bgutil-ytdlp-pot-provider").is_dir()),
        }
    }

    pub async fn status(&self) -> BinaryStatus {
        let (ytdlp, ffmpeg, deno) = tokio::join!(
            info(&self.ytdlp, "--version", |s| s.lines().next().map(str::to_string)),
            info(&self.ffmpeg, "-version", |s| {
                s.split_whitespace().nth(2).map(str::to_string)
            }),
            info(&self.deno, "--version", |s| {
                s.split_whitespace().nth(1).map(str::to_string)
            }),
        );
        BinaryStatus { ytdlp, ffmpeg, deno }
    }
}

async fn run_version(path: &Path, arg: &str) -> Option<String> {
    let out = tokio::time::timeout(
        Duration::from_secs(20),
        process::command(path, [arg]).output(),
    )
    .await
    .ok()?
    .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn info(path: &Option<PathBuf>, arg: &str, parse: fn(&str) -> Option<String>) -> BinaryInfo {
    let Some(p) = path else { return BinaryInfo::default() };
    BinaryInfo {
        path: Some(p.to_string_lossy().into_owned()),
        version: run_version(p, arg).await.as_deref().and_then(parse),
    }
}

pub async fn ytdlp_version(path: &Path) -> Option<String> {
    run_version(path, "--version").await.and_then(|s| s.lines().next().map(str::to_string))
}

fn client() -> Result<reqwest::Client, ItemError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| ItemError::unknown(e.to_string()))
}

fn net_err(e: reqwest::Error) -> ItemError {
    ItemError::new(crate::model::ErrorKind::Network, e.to_string())
}

pub async fn latest_ytdlp_tag() -> Result<String, ItemError> {
    // The /latest redirect avoids GitHub API rate limits.
    let resp = client()?
        .get(format!("{YTDLP_REPO}/releases/latest"))
        .send()
        .await
        .map_err(net_err)?;
    resp.url()
        .path_segments()
        .and_then(|mut s| s.next_back())
        .filter(|t| !t.is_empty() && *t != "latest")
        .map(str::to_string)
        .ok_or_else(|| ItemError::unknown("latest yt-dlp release not found"))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(windows)]
const YTDLP_ASSET: &str = "yt-dlp_win.zip";
#[cfg(not(windows))]
const YTDLP_ASSET: &str = "yt-dlp";

fn io_err(e: std::io::Error) -> ItemError {
    ItemError::unknown(e.to_string())
}

/// Downloads `tag` of yt-dlp into `data_bin`, verifying its SHA-256.
pub async fn install_ytdlp(data_bin: &Path, tag: &str) -> Result<PathBuf, ItemError> {
    let base = format!("{YTDLP_REPO}/releases/download/{tag}");
    let client = client()?;

    let sums = client
        .get(format!("{base}/SHA2-256SUMS"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(net_err)?
        .text()
        .await
        .map_err(net_err)?;
    let expected = sums
        .lines()
        .find_map(|l| {
            let (hash, name) = l.split_once(char::is_whitespace)?;
            (name.trim().trim_start_matches('*') == YTDLP_ASSET).then(|| hash.to_lowercase())
        })
        .ok_or_else(|| ItemError::unknown("checksum not found"))?;

    let bytes = client
        .get(format!("{base}/{YTDLP_ASSET}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(net_err)?
        .bytes()
        .await
        .map_err(net_err)?;
    if hex(&Sha256::digest(&bytes)) != expected {
        return Err(ItemError::unknown("checksum mismatch"));
    }

    tokio::fs::create_dir_all(data_bin).await.map_err(io_err)?;
    place_ytdlp(data_bin, tag, &bytes).await
}

/// Extracts the onedir zip into `yt-dlp-<tag>`. Older installs may still be running,
/// so they are only removed when possible and retried on the next update.
#[cfg(windows)]
async fn place_ytdlp(data_bin: &Path, tag: &str, zip: &[u8]) -> Result<PathBuf, ItemError> {
    let name = format!("yt-dlp-{tag}");
    let target = data_bin.join(&name);
    let exe = target.join("yt-dlp.exe");
    if !exe.is_file() {
        let archive = data_bin.join(format!(".{name}.zip"));
        let tmp = data_bin.join(format!(".{name}"));
        tokio::fs::write(&archive, zip).await.map_err(io_err)?;
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.map_err(io_err)?;
        let tar = std::env::var_os("SystemRoot")
            .map(|r| PathBuf::from(r).join("System32").join("tar.exe"))
            .unwrap_or_else(|| PathBuf::from("tar.exe"));
        let out = process::command(&tar, [
            std::ffi::OsStr::new("-xf"),
            archive.as_os_str(),
            std::ffi::OsStr::new("-C"),
            tmp.as_os_str(),
        ])
        .output()
        .await
        .map_err(io_err);
        let _ = tokio::fs::remove_file(&archive).await;
        let out = out?;
        if !out.status.success() || !tmp.join("yt-dlp.exe").is_file() {
            let _ = tokio::fs::remove_dir_all(&tmp).await;
            return Err(ItemError::unknown(format!(
                "extract failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        let _ = tokio::fs::remove_dir_all(&target).await;
        tokio::fs::rename(&tmp, &target).await.map_err(io_err)?;
    }

    let _ = tokio::fs::remove_file(data_bin.join("yt-dlp.exe")).await;
    if let Ok(entries) = std::fs::read_dir(data_bin) {
        for e in entries.filter_map(|e| e.ok()) {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with("yt-dlp-") && n != name {
                let _ = tokio::fs::remove_dir_all(e.path()).await;
            }
        }
    }
    Ok(exe)
}

#[cfg(not(windows))]
async fn place_ytdlp(data_bin: &Path, _tag: &str, bytes: &[u8]) -> Result<PathBuf, ItemError> {
    use std::os::unix::fs::PermissionsExt;

    let target = data_bin.join("yt-dlp");
    let tmp = data_bin.join("yt-dlp.new");
    tokio::fs::write(&tmp, bytes).await.map_err(io_err)?;
    tokio::fs::rename(&tmp, &target).await.map_err(io_err)?;
    let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    Ok(target)
}
