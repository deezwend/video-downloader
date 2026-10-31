use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::model::{DownloadItem, Settings};

pub struct Db(Connection);

type Result<T> = rusqlite::Result<T>;

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS items (
                 id TEXT PRIMARY KEY,
                 created_at INTEGER NOT NULL,
                 status TEXT NOT NULL,
                 data TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS kv (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;
        Ok(Self(conn))
    }

    pub fn load_items(&self) -> Result<Vec<DownloadItem>> {
        let mut stmt = self.0.prepare("SELECT data FROM items ORDER BY created_at")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|data| serde_json::from_str(&data).ok())
            .collect())
    }

    pub fn save_item(&self, item: &DownloadItem) -> Result<()> {
        let data = serde_json::to_string(item).unwrap_or_default();
        let status = serde_json::to_value(item.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        self.0.execute(
            "INSERT INTO items (id, created_at, status, data) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data",
            params![item.id, item.created_at, status, data],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        self.0.execute("DELETE FROM items WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        self.0
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()
    }

    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.0.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> Option<Settings> {
        self.get("settings").ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        self.set("settings", &serde_json::to_string(settings).unwrap_or_default())
    }
}
