use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use vdl_core::Manager;
use vdl_core::model::{DownloadRequest, ItemError};

static MANAGER: OnceLock<Manager> = OnceLock::new();

type EventCallback = ThreadsafeFunction<String, (), String, Status, false, true>;

fn manager() -> Result<&'static Manager> {
    MANAGER.get().ok_or_else(|| Error::from_reason("not initialized"))
}

fn reason<E: std::fmt::Display>(e: E) -> Error {
    Error::from_reason(e.to_string())
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(reason)
}

fn item_err(e: ItemError) -> Error {
    reason(e)
}

#[napi(ts_args_type = "dataDir: string, resourcesDir: string, downloadDir: string, onEvent: (event: string) => void")]
pub fn init(data_dir: String, resources_dir: String, download_dir: String, on_event: EventCallback) -> Result<()> {
    if MANAGER.get().is_some() {
        return Ok(());
    }
    let sink = Arc::new(move |event: String| {
        on_event.call(event, ThreadsafeFunctionCallMode::NonBlocking);
    });
    let m = Manager::new(Path::new(&data_dir), Path::new(&resources_dir), &download_dir, sink)
        .map_err(reason)?;
    let _ = MANAGER.set(m);
    Ok(())
}

#[napi]
pub async fn probe(url: String) -> Result<String> {
    let info = manager()?.probe(url).await.map_err(item_err)?;
    to_json(&info)
}

#[napi]
pub async fn preview(url: String) -> Result<Option<String>> {
    match manager()?.preview(url).await.map_err(item_err)? {
        Some(info) => to_json(&info).map(Some),
        None => Ok(None),
    }
}

#[napi]
pub fn enqueue(requests: String) -> Result<Vec<String>> {
    let requests: Vec<DownloadRequest> = serde_json::from_str(&requests).map_err(reason)?;
    Ok(manager()?.enqueue(requests))
}

#[napi]
pub fn pause(id: String) -> Result<()> {
    manager()?.pause(&id);
    Ok(())
}

#[napi]
pub fn resume(id: String) -> Result<()> {
    manager()?.resume(&id);
    Ok(())
}

#[napi]
pub fn retry(id: String) -> Result<()> {
    manager()?.retry(&id);
    Ok(())
}

#[napi]
pub fn cancel(id: String) -> Result<()> {
    manager()?.cancel(&id);
    Ok(())
}

#[napi]
pub fn remove(id: String, delete_file: bool) -> Result<()> {
    manager()?.remove(&id, delete_file);
    Ok(())
}

#[napi]
pub fn clear_finished() -> Result<()> {
    manager()?.clear_finished();
    Ok(())
}

#[napi]
pub fn list_items() -> Result<String> {
    to_json(&manager()?.list_items())
}

#[napi]
pub fn get_settings() -> Result<String> {
    to_json(&manager()?.settings())
}

#[napi]
pub fn set_settings(patch: String) -> Result<String> {
    let patch: serde_json::Value = serde_json::from_str(&patch).map_err(reason)?;
    to_json(&manager()?.set_settings(patch).map_err(reason)?)
}

#[napi]
pub async fn binary_status() -> Result<String> {
    to_json(&manager()?.binary_status().await.map_err(item_err)?)
}

#[napi]
pub async fn update_ytdlp() -> Result<String> {
    manager()?.update_ytdlp().await.map_err(item_err)
}

#[napi]
pub fn set_cookies_file(path: Option<String>) -> Result<()> {
    manager()?.set_cookies(path.map(PathBuf::from));
    Ok(())
}

#[napi]
pub fn shutdown() -> Result<()> {
    if let Some(m) = MANAGER.get() {
        m.shutdown();
    }
    Ok(())
}
