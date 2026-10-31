use std::io;
use std::process::{Command, Stdio};

use crate::menu::Permission;

pub fn url(url: &str) -> io::Result<()> {
    spawn(launcher(url))
}

#[cfg(target_os = "macos")]
pub fn settings(kind: Permission) -> io::Result<()> {
    let anchor = match kind {
        Permission::Accessibility => "Privacy_Accessibility",
        Permission::Screen => "Privacy_ScreenCapture",
        Permission::Automation => "Privacy_Automation",
        _ => return Ok(()),
    };
    let mut command = Command::new("open");
    command.arg(format!(
        "x-apple.systempreferences:com.apple.preference.security?{anchor}"
    ));
    spawn(command)
}

#[cfg(not(target_os = "macos"))]
pub fn settings(_: Permission) -> io::Result<()> {
    Ok(())
}

fn spawn(mut command: Command) -> io::Result<()> {
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
