use std::io::{self, BufRead, BufReader, Write};
use std::thread;

use interprocess::local_socket::prelude::*;

use crate::log;
use crate::serve::name;

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

pub fn bind(path: &str) -> io::Result<LocalSocketListener> {
    crate::serve::bind(path)
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
