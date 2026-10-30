use std::io::{self, BufRead, BufReader, Cursor, Write};
use std::sync::Arc;
use std::thread;

use interprocess::local_socket::{ListenerOptions, prelude::*};
#[cfg(unix)]
use interprocess::os::unix::local_socket::ListenerOptionsExt;
use kiko_driver::Status;

use crate::driver::{Driver, SharedDriver};
use crate::log;

fn name(path: &str) -> io::Result<interprocess::local_socket::Name<'_>> {
    #[cfg(windows)]
    {
        path.to_ns_name::<interprocess::local_socket::GenericNamespaced>()
    }
    #[cfg(unix)]
    {
        path.to_fs_name::<interprocess::local_socket::GenericFilePath>()
    }
}

pub fn bind(path: &str) -> io::Result<LocalSocketListener> {
    #[cfg(unix)]
    let listener = ListenerOptions::new()
        .name(name(path)?)
        .mode(0o600)
        .create_sync()?;
    #[cfg(windows)]
    let listener = ListenerOptions::new().name(name(path)?).create_sync()?;
    Ok(listener)
}

pub fn run(listener: LocalSocketListener, driver: SharedDriver, status: Status) {
    thread::spawn(move || {
        for incoming in listener.incoming() {
            match incoming {
                Ok(stream) => {
                    let driver = Arc::clone(&driver);
                    let status = status.clone();
                    thread::spawn(move || {
                        if let Err(error) = connection(&driver, &status, stream) {
                            log::line(format!("driver connection ended: {error}"));
                        }
                    });
                }
                Err(error) => log::line(format!("driver accept failed: {error}")),
            }
        }
    });
}

fn connection(driver: &SharedDriver, status: &Status, stream: LocalSocketStream) -> io::Result<()> {
    let input = BufReader::new(&stream);
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let mut answer = Vec::new();
        {
            let mut guard = driver
                .lock()
                .map_err(|_| io::Error::other("driver lock poisoned"))?;
            let Driver { native, browser } = &mut *guard;
            kiko_driver::serve(
                &mut **native,
                &mut **browser,
                status,
                Cursor::new(line.as_str()),
                &mut answer,
            )?;
        }
        (&stream).write_all(&answer)?;
        (&stream).flush()?;
    }
    Ok(())
}

pub fn connect(path: &str) -> io::Result<LocalSocketStream> {
    LocalSocketStream::connect(name(path)?)
}
