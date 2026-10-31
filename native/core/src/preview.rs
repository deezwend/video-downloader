//! Instant title/thumbnail via oEmbed while yt-dlp resolves formats.

use std::sync::LazyLock;
use std::time::Duration;

use reqwest::Url;
use serde_json::Value;

use crate::model::MediaInfo;

static CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("video-downloader/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(4))
        .build()
        .ok()
});

fn host_is(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// oEmbed endpoint for single-video URLs of known sites; playlists and channels are left to yt-dlp.
fn endpoint(url: &Url) -> Option<&'static str> {
    let host = url.host_str()?.to_ascii_lowercase();
    let path = url.path();
    if host_is(&host, "youtube.com") {
        let video = (path == "/watch" && url.query_pairs().any(|(k, _)| k == "v"))
            || path.starts_with("/shorts/")
            || path.starts_with("/live/");
        return video.then_some("https://www.youtube.com/oembed");
    }
    if host == "youtu.be" {
        return (path.len() > 1).then_some("https://www.youtube.com/oembed");
    }
    if host_is(&host, "vimeo.com") {
        return path[1..].starts_with(|c: char| c.is_ascii_digit())
            .then_some("https://vimeo.com/api/oembed.json");
    }
    if host_is(&host, "tiktok.com") {
        return path.contains("/video/").then_some("https://www.tiktok.com/oembed");
    }
    if host_is(&host, "dailymotion.com") || host == "dai.ly" {
        return (host == "dai.ly" || path.starts_with("/video/"))
            .then_some("https://www.dailymotion.com/services/oembed");
    }
    None
}

fn string(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

pub async fn fetch(url: &str) -> Option<MediaInfo> {
    let parsed = Url::parse(url).ok()?;
    let api = Url::parse_with_params(endpoint(&parsed)?, &[("format", "json"), ("url", url)]).ok()?;
    let body = CLIENT.as_ref()?.get(api).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    let v: Value = serde_json::from_slice(&body).ok()?;
    Some(MediaInfo {
        is_playlist: false,
        url: url.to_string(),
        id: None,
        title: Some(string(&v, "title")?),
        uploader: string(&v, "author_name"),
        thumbnail: string(&v, "thumbnail_url"),
        duration: v.get("duration").and_then(Value::as_f64).filter(|d| *d > 0.0),
        has_video: true,
        qualities: Vec::new(),
        audio_size: None,
        entries: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(url: &str) -> Option<&'static str> {
        endpoint(&Url::parse(url).unwrap())
    }

    #[test]
    fn matches_single_videos_only() {
        assert!(ep("https://www.youtube.com/watch?v=jNQXAC9IVRw").is_some());
        assert!(ep("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1").is_some());
        assert!(ep("https://youtu.be/jNQXAC9IVRw").is_some());
        assert!(ep("https://m.youtube.com/shorts/abc").is_some());
        assert!(ep("https://vimeo.com/76979871").is_some());
        assert!(ep("https://www.tiktok.com/@a/video/123").is_some());
        assert!(ep("https://www.youtube.com/playlist?list=PL1").is_none());
        assert!(ep("https://www.youtube.com/@channel").is_none());
        assert!(ep("https://vimeo.com/channels/staffpicks").is_none());
        assert!(ep("https://notyoutube.com/watch?v=x").is_none());
        assert!(ep("https://example.com/video.mp4").is_none());
    }
}
