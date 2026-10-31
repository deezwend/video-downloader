use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::binaries::Binaries;
use crate::model::{
    DownloadItem, ErrorKind, ItemError, MediaInfo, MediaKind, PlaylistEntry, Progress,
    QualityOption, Settings,
};

const TAG_PROGRESS: &str = "[VDL]";
const TAG_PP: &str = "[VDL_PP]";
const TAG_INFO: &str = "[VDL_INFO]";
const TAG_FILE: &str = "[VDL_FILE]";

pub struct Tools<'a> {
    pub bins: &'a Binaries,
    pub cookies: Option<&'a Path>,
}

fn common_args(args: &mut Vec<OsString>, tools: &Tools) {
    args.push("--ignore-config".into());
    args.push("--no-playlist".into());
    // Otherwise yt-dlp writes in the console code page (e.g. cp1254).
    args.push("--encoding".into());
    args.push("utf-8".into());
    if let Some(deno) = &tools.bins.deno {
        let mut v = OsString::from("deno:");
        v.push(deno.as_os_str());
        args.push("--js-runtimes".into());
        args.push(v);
    }
    // PO token provider: lets YouTube pass its bot check without an account.
    if let (Some(plugins), Some(pot)) = (&tools.bins.plugins, &tools.bins.pot) {
        args.push("--plugin-dirs".into());
        args.push(plugins.as_os_str().into());
        let mut v = OsString::from("youtubepot-bgutilcli:cli_path=");
        v.push(pot.as_os_str());
        args.push("--extractor-args".into());
        args.push(v);
    }
    if let Some(cookies) = tools.cookies {
        args.push("--cookies".into());
        args.push(cookies.as_os_str().into());
    }
}

pub fn probe_args(url: &str, tools: &Tools) -> Vec<OsString> {
    let mut args = Vec::new();
    common_args(&mut args, tools);
    for a in ["-J", "--flat-playlist", "--no-warnings"] {
        args.push(a.into());
    }
    args.push("--".into());
    args.push(url.into());
    args
}

pub fn download_args(item: &DownloadItem, settings: &Settings, tools: &Tools) -> Vec<OsString> {
    let mut args: Vec<OsString> = Vec::new();
    common_args(&mut args, tools);

    let mut push = |a: &str| args.push(a.into());
    push("--newline");
    push("--no-colors");
    push("--progress");
    push("--no-simulate");
    push("--progress-template");
    push(&format!("download:{TAG_PROGRESS}%(progress)j"));
    push("--progress-template");
    push(&format!("postprocess:{TAG_PP}%(progress.postprocessor)s"));
    push("--print");
    push(&format!("video:{TAG_INFO}%(.{{title,thumbnail,duration,uploader}})j"));
    push("--print");
    push(&format!("after_move:{TAG_FILE}%(filepath)s"));
    push("--continue");
    push("--no-mtime");
    push("--embed-metadata");
    push("-o");
    push("%(title).150B [%(id)s].%(ext)s");

    match item.kind {
        MediaKind::Video => {
            let mut sort = Vec::new();
            if let Some(h) = item.height {
                sort.push(format!("res:{h}"));
            }
            if item.container == "mp4" {
                sort.push("ext:mp4:m4a".into());
            }
            push("-f");
            push("bv*+ba/b");
            if !sort.is_empty() {
                push("-S");
                push(&sort.join(","));
            }
            push("--merge-output-format");
            push(&item.container);
            push("--remux-video");
            push(&item.container);
        }
        MediaKind::Audio => {
            push("-f");
            push("ba/b");
            push("-x");
            push("--audio-format");
            push(&item.container);
            push("--audio-quality");
            push("0");
        }
    }

    if item.throttle {
        for a in ["--sleep-requests", "1", "--sleep-interval", "2"] {
            push(a);
        }
    }
    if !settings.rate_limit.is_empty() {
        push("-r");
        push(&settings.rate_limit);
    }

    args.push("-P".into());
    args.push(item.output_dir.clone().into());
    if let Some(ffmpeg) = &tools.bins.ffmpeg {
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.as_os_str().into());
    }
    args.push("--".into());
    args.push(item.url.clone().into());
    args
}

#[derive(Debug)]
pub enum Event {
    Progress(Value),
    PostProcess(String),
    Info(Value),
    File(String),
}

pub fn parse_line(line: &str) -> Option<Event> {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix(TAG_PROGRESS) {
        return serde_json::from_str(rest).ok().map(Event::Progress);
    }
    if let Some(rest) = line.strip_prefix(TAG_PP) {
        return Some(Event::PostProcess(rest.to_string()));
    }
    if let Some(rest) = line.strip_prefix(TAG_INFO) {
        return serde_json::from_str(rest).ok().map(Event::Info);
    }
    if let Some(rest) = line.strip_prefix(TAG_FILE) {
        return Some(Event::File(rest.to_string()));
    }
    None
}

fn num(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn string(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Turns per-stream yt-dlp progress (video stream, then audio stream) into one
/// monotonic overall progress.
#[derive(Default)]
pub struct ProgressTracker {
    done_bytes: u64,
    current: Option<String>,
    current_total: u64,
    percent: f64,
}

impl ProgressTracker {
    /// Returns the updated progress and the temp/target filenames seen.
    pub fn update(&mut self, v: &Value) -> (Progress, Vec<String>) {
        let filename = string(v, "filename");
        let mut files = Vec::new();
        if let Some(f) = &filename {
            files.push(f.clone());
        }
        if let Some(t) = string(v, "tmpfilename") {
            files.push(t);
        }

        if filename.is_some() && filename != self.current {
            if self.current.is_some() {
                self.done_bytes += self.current_total;
            }
            self.current = filename;
            self.current_total = 0;
        }

        let downloaded = num(v, "downloaded_bytes").map(|n| n as u64);
        let total = num(v, "total_bytes")
            .or_else(|| num(v, "total_bytes_estimate"))
            .map(|n| n as u64);
        if let Some(t) = total {
            self.current_total = t;
        } else if let Some(d) = downloaded {
            self.current_total = self.current_total.max(d);
        }

        let mut percent = match (downloaded, total) {
            (Some(d), Some(t)) if t > 0 => {
                (self.done_bytes + d) as f64 / (self.done_bytes + t) as f64 * 100.0
            }
            _ => match (num(v, "fragment_index"), num(v, "fragment_count")) {
                (Some(i), Some(c)) if c > 0.0 => i / c * 100.0,
                _ => self.percent,
            },
        };
        if v.get("status").and_then(Value::as_str) == Some("finished") && self.current_total == 0 {
            percent = self.percent;
        }
        self.percent = percent.clamp(0.0, 100.0).max(self.percent);

        let progress = Progress {
            percent: self.percent,
            speed: num(v, "speed"),
            eta: num(v, "eta"),
            downloaded: downloaded.map(|d| self.done_bytes + d),
            total: total.map(|t| self.done_bytes + t),
        };
        (progress, files)
    }
}

static RE_BOT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)not a bot|confirm you.re not a bot").unwrap());
static RE_AUTH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)sign in to confirm your age|confirm your age|age.restricted|inappropriate for some users|private video|members.only|join this channel|login required|requires authentication|use --cookies|cookies-from-browser|account authentication").unwrap()
});
static RE_GEO: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)not available in your country|geo.?restrict|available in your country").unwrap()
});
static RE_UNAVAILABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)video unavailable|this video is unavailable|has been removed|does not exist|unsupported url|is not a valid url|no video formats found|http error 404|requested format is not available").unwrap()
});
static RE_NETWORK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)timed out|timeout|connection reset|connection refused|connection aborted|name resolution|getaddrinfo|unable to download webpage|http error 5\d\d|ssl|remote end closed|network is unreachable|incomplete read|giving up after").unwrap()
});
static RE_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(ERROR:\s*)?(\[[^\]]+\]\s*)?([\w-]+:\s+)?").unwrap());

pub fn classify(stderr: &[String]) -> ItemError {
    let text = stderr.join("\n");
    let kind = if RE_BOT.is_match(&text) {
        ErrorKind::BotCheck
    } else if RE_AUTH.is_match(&text) {
        ErrorKind::AuthRequired
    } else if RE_GEO.is_match(&text) {
        ErrorKind::GeoBlocked
    } else if RE_UNAVAILABLE.is_match(&text) {
        ErrorKind::Unavailable
    } else if RE_NETWORK.is_match(&text) {
        ErrorKind::Network
    } else {
        ErrorKind::Unknown
    };

    let line = stderr
        .iter()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| stderr.iter().rev().find(|l| !l.trim().is_empty()))
        .map(String::as_str)
        .unwrap_or("yt-dlp failed");
    let mut message = RE_PREFIX.replace(line.trim(), "").trim().to_string();
    if message.is_empty() {
        message = line.trim().to_string();
    }
    if message.chars().count() > 300 {
        message = message.chars().take(300).collect::<String>() + "…";
    }
    ItemError::new(kind, message)
}

fn thumbnail(v: &Value) -> Option<String> {
    string(v, "thumbnail").or_else(|| {
        v.get("thumbnails")?
            .as_array()?
            .iter()
            .rev()
            .find_map(|t| string(t, "url"))
    })
}

fn size(f: &Value) -> Option<u64> {
    num(f, "filesize").or_else(|| num(f, "filesize_approx")).map(|n| n as u64)
}

fn has_codec(f: &Value, key: &str) -> bool {
    matches!(f.get(key).and_then(Value::as_str), Some(c) if c != "none")
}

pub fn parse_probe(json: &str, url: &str) -> Result<MediaInfo, ItemError> {
    let v: Value = serde_json::from_str(json).map_err(|e| ItemError::unknown(e.to_string()))?;
    let is_playlist = matches!(
        v.get("_type").and_then(Value::as_str),
        Some("playlist") | Some("multi_video")
    );

    let mut info = MediaInfo {
        is_playlist,
        url: string(&v, "webpage_url").unwrap_or_else(|| url.to_string()),
        id: string(&v, "id"),
        title: string(&v, "title"),
        uploader: string(&v, "uploader").or_else(|| string(&v, "channel")),
        thumbnail: thumbnail(&v),
        duration: num(&v, "duration"),
        has_video: false,
        qualities: Vec::new(),
        audio_size: None,
        entries: Vec::new(),
    };

    if is_playlist {
        for e in v.get("entries").and_then(Value::as_array).into_iter().flatten() {
            let Some(entry_url) = string(e, "url").or_else(|| string(e, "webpage_url")) else {
                continue;
            };
            info.entries.push(PlaylistEntry {
                url: entry_url,
                id: string(e, "id"),
                title: string(e, "title"),
                duration: num(e, "duration"),
                thumbnail: thumbnail(e),
            });
        }
        info.has_video = true;
        info.qualities = [2160, 1440, 1080, 720, 480, 360]
            .into_iter()
            .map(|height| QualityOption { height, size: None })
            .collect();
        return Ok(info);
    }

    let mut by_res: BTreeMap<u32, Option<u64>> = BTreeMap::new();
    for f in v.get("formats").and_then(Value::as_array).into_iter().flatten() {
        let video = has_codec(f, "vcodec");
        let audio = has_codec(f, "acodec");
        if video {
            let (w, h) = (num(f, "width"), num(f, "height"));
            let res = match (w, h) {
                (Some(w), Some(h)) => w.min(h),
                (None, Some(h)) => h,
                _ => continue,
            } as u32;
            if res == 0 {
                continue;
            }
            let entry = by_res.entry(res).or_default();
            if let Some(s) = size(f) {
                *entry = Some(entry.map_or(s, |e| e.max(s)));
            }
        } else if audio {
            if let Some(s) = size(f) {
                info.audio_size = Some(info.audio_size.map_or(s, |a| a.max(s)));
            }
        }
    }
    if by_res.is_empty() && v.get("formats").is_none() && has_codec(&v, "vcodec") {
        if let Some(h) = num(&v, "height") {
            by_res.insert(h as u32, size(&v));
        }
    }

    info.has_video = !by_res.is_empty();
    info.qualities = by_res
        .into_iter()
        .rev()
        .map(|(height, size)| QualityOption {
            height,
            size: size.map(|s| s + info.audio_size.unwrap_or(0)),
        })
        .collect();
    Ok(info)
}

