use std::io;
use std::process::{Command, Stdio};

pub fn url(url: &str) -> io::Result<()> {
    let mut command = launcher(url);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn launcher(url: &str) -> Command {
    let mut command = Command::new("open");
    command.arg(url);
    command
}

#[cfg(windows)]
fn launcher(url: &str) -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", "start", ""]).arg(url);
    command
}

#[cfg(target_os = "linux")]
fn launcher(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}
