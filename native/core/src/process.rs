use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn command<I, S>(exe: &Path, args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Debug)]
pub enum Line {
    Out(String),
    Err(String),
}

/// Streams stdout and stderr of `child` line by line (lossy UTF-8) into one channel.
pub fn stream_lines(child: &mut Child) -> mpsc::UnboundedReceiver<Line> {
    let (tx, rx) = mpsc::unbounded_channel();
    if let Some(out) = child.stdout.take() {
        spawn_reader(out, tx.clone(), Line::Out);
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(err, tx, Line::Err);
    }
    rx
}

fn spawn_reader<R>(reader: R, tx: mpsc::UnboundedSender<Line>, wrap: fn(String) -> Line)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader);
        let mut buf = Vec::with_capacity(512);
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf);
                    let line = line.trim_end_matches(['\r', '\n']);
                    // yt-dlp may emit several \r-separated updates in one line.
                    for part in line.split('\r').filter(|p| !p.is_empty()) {
                        if tx.send(wrap(part.to_string())).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });
}

/// Groups a process and all of its children (e.g. ffmpeg spawned by yt-dlp)
/// so they can be terminated together. Children die when the job is dropped.
pub struct Job {
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(not(windows))]
    pid: Option<u32>,
}

unsafe impl Send for Job {}
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    pub fn attach(child: &Child) -> std::io::Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;

        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let job = Job { handle };

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }

            let Some(process) = child.raw_handle() else {
                return Err(std::io::Error::other("process already exited"));
            };
            if AssignProcessToJobObject(handle, process as _) == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(job)
        }
    }

    pub fn terminate(&self) {
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(not(windows))]
impl Job {
    pub fn attach(child: &Child) -> std::io::Result<Self> {
        Ok(Job { pid: child.id() })
    }

    pub fn terminate(&self) {
        if let Some(pid) = self.pid {
            let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).status();
        }
    }
}
