use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static SINK: OnceLock<Mutex<File>> = OnceLock::new();

pub fn init(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    let _ = SINK.set(Mutex::new(file));
    Ok(())
}

pub fn line(message: impl AsRef<str>) {
    if let Some(sink) = SINK.get()
        && let Ok(mut file) = sink.lock()
    {
        let _ = writeln!(file, "{} {}", stamp(), message.as_ref());
        let _ = file.flush();
    }
}

fn stamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}
