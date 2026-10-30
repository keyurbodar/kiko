use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

use fd_lock::RwLock;

pub struct Instance {
    _lock: &'static mut RwLock<File>,
}

pub fn acquire(path: &Path) -> io::Result<Option<Instance>> {
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    let lock: &'static mut RwLock<File> = Box::leak(Box::new(RwLock::new(file)));
    match lock.try_write() {
        Ok(guard) => std::mem::forget(guard),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
        Err(error) => return Err(error),
    }
    Ok(Some(Instance { _lock: lock }))
}
