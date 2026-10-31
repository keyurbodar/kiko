#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

fn main() -> ExitCode {
    #[cfg(windows)]
    attach_console();

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("run")
        && let Some(log) = std::env::var_os("KIKO_CORE_STUB_LOG")
    {
        return stub_core(PathBuf::from(log));
    }
    ExitCode::from(kiko_app::app::run(&args) as u8)
}

fn stub_core(log: PathBuf) -> ExitCode {
    let driver = std::env::var("KIKO_DRIVER").unwrap_or_default();
    let mut file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
    {
        Ok(file) => file,
        Err(error) => {
            eprintln!("kiko-core stub: {error}");
            return ExitCode::FAILURE;
        }
    };
    let line = format!("{} {driver}\n", std::process::id());
    if file.write_all(line.as_bytes()).is_err() {
        return ExitCode::FAILURE;
    }
    std::thread::sleep(Duration::from_millis(300));
    ExitCode::SUCCESS
}

#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
    let asked = std::env::args()
        .any(|arg| arg == "--version" || arg == "-V" || arg == "--help" || arg == "-h");
    if asked {
        unsafe {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}
