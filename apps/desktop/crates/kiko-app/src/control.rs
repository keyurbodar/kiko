use std::io::{self, BufRead, BufReader, Write};
use std::thread;

use interprocess::local_socket::{ListenerOptions, prelude::*};
#[cfg(unix)]
use interprocess::os::unix::local_socket::ListenerOptionsExt;

use crate::log;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Show,
    Quit,
}

impl Command {
    fn text(self) -> &'static str {
        match self {
            Command::Show => "show",
            Command::Quit => "quit",
        }
    }

    pub fn parse(line: &str) -> Option<Self> {
        match line.trim() {
            "show" => Some(Command::Show),
            "quit" => Some(Command::Quit),
            _ => None,
        }
    }
}

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

pub fn send(path: &str, command: Command) -> io::Result<()> {
    let mut stream = LocalSocketStream::connect(name(path)?)?;
    stream.write_all(command.text().as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()
}

pub fn listen(path: &str, on: impl Fn(Command) + Send + 'static) -> io::Result<()> {
    let listener = bind(path)?;
    thread::spawn(move || {
        for incoming in listener.incoming() {
            match incoming {
                Ok(stream) => {
                    let line = BufReader::new(&stream).lines().next();
                    let command = line
                        .and_then(|line| line.ok())
                        .and_then(|line| Command::parse(&line));
                    if let Some(command) = command {
                        on(command);
                    }
                }
                Err(error) => log::line(format!("control accept failed: {error}")),
            }
        }
    });
    Ok(())
}
