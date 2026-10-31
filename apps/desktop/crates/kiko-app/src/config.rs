use std::env;
use std::path::PathBuf;

use serde::Deserialize;

#[cfg(not(windows))]
const DRIVER_SOCKET: &str = "driver.sock";
#[cfg(not(windows))]
const CONTROL_SOCKET: &str = "control.sock";
#[cfg(windows)]
const DRIVER_PIPE: &str = "kiko-driver";
#[cfg(windows)]
const CONTROL_PIPE: &str = "kiko-control";

#[derive(Debug, Clone, Deserialize)]
pub struct DaemonConfig {
    pub url: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DaemonState {
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub name: Option<String>,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn app_dir() -> PathBuf {
    if let Some(dir) = env::var_os("KIKO_APP_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(target_os = "macos") {
        return home()
            .join("Library")
            .join("Application Support")
            .join("kiko");
    }
    if cfg!(windows) {
        let base = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Roaming"));
        return base.join("kiko");
    }
    config_home().join("kiko")
}

fn config_home() -> PathBuf {
    env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"))
}

pub fn daemon_dir() -> PathBuf {
    if let Some(dir) = env::var_os("KIKO_COMPUTER_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(target_os = "macos") {
        return home()
            .join("Library")
            .join("Application Support")
            .join("kiko-computer");
    }
    if cfg!(windows) {
        let base = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Roaming"));
        return base.join("kiko-computer");
    }
    config_home().join("kiko-computer")
}

pub fn daemon_config() -> Option<DaemonConfig> {
    let body = std::fs::read_to_string(daemon_dir().join("config.json")).ok()?;
    serde_json::from_str(&body).ok()
}

pub fn daemon_state() -> Option<DaemonState> {
    let body = std::fs::read_to_string(daemon_dir().join("state.json")).ok()?;
    serde_json::from_str(&body).ok()
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentState {
    pub app: String,
}

pub fn agent() -> Option<AgentState> {
    let body = std::fs::read_to_string(agent_file()).ok()?;
    serde_json::from_str(&body).ok()
}

#[cfg(windows)]
pub fn socket_name() -> String {
    pipe_name(DRIVER_PIPE)
}

#[cfg(not(windows))]
pub fn socket_name() -> String {
    path_name(DRIVER_SOCKET)
}

#[cfg(windows)]
pub fn control_name() -> String {
    pipe_name(CONTROL_PIPE)
}

#[cfg(not(windows))]
pub fn control_name() -> String {
    path_name(CONTROL_SOCKET)
}

#[cfg(windows)]
fn pipe_name(base: &str) -> String {
    format!("{base}-{}", user_tag())
}

#[cfg(windows)]
fn user_tag() -> String {
    sid().unwrap_or_else(|| format!("{:016x}", fnv(&app_dir().to_string_lossy())))
}

#[cfg(windows)]
fn sid() -> Option<String> {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buffer = vec![0u8; needed as usize];
        let read = needed > 0
            && GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr() as *mut c_void,
                needed,
                &mut needed,
            ) != 0;
        let _ = CloseHandle(token);
        if !read {
            return None;
        }
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut wide = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut wide) == 0 {
            return None;
        }
        let mut length = 0usize;
        while *wide.add(length) != 0 {
            length += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(wide, length));
        let _ = LocalFree(wide as *mut c_void);
        Some(text)
    }
}

#[cfg(windows)]
fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(not(windows))]
fn path_name(file: &str) -> String {
    app_dir().join(file).to_string_lossy().into_owned()
}

pub fn pause_file() -> PathBuf {
    app_dir().join("paused")
}

pub fn agent_file() -> PathBuf {
    app_dir().join("agent.json")
}

pub fn log_file() -> PathBuf {
    app_dir().join("kiko.log")
}

pub fn lock_file() -> PathBuf {
    app_dir().join("kiko.lock")
}

pub fn core_path() -> PathBuf {
    if let Some(path) = env::var_os("KIKO_CORE") {
        return PathBuf::from(path);
    }
    let name = if cfg!(windows) {
        "kiko-core.exe"
    } else {
        "kiko-core"
    };
    sibling(name)
}

pub fn sibling(name: &str) -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)))
        .unwrap_or_else(|| PathBuf::from(name))
}

pub fn ensure_dir() -> std::io::Result<()> {
    let dir = app_dir();
    std::fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn the_user_tag_is_the_sid_of_the_running_user() {
        let tag = user_tag();
        assert!(tag.starts_with("S-1-5-"), "{tag}");
        assert_eq!(tag, user_tag());
    }

    #[test]
    fn the_pipe_names_carry_the_user_tag() {
        assert_eq!(socket_name(), format!("kiko-driver-{}", user_tag()));
        assert_eq!(control_name(), format!("kiko-control-{}", user_tag()));
        assert_ne!(socket_name(), "kiko-driver");
    }
}
