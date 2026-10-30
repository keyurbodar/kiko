use std::env;
use std::path::PathBuf;

use serde::Deserialize;

const DRIVER_SOCKET: &str = "driver.sock";
const CONTROL_SOCKET: &str = "control.sock";
const DRIVER_PIPE: &str = "kiko-driver";
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

pub fn socket_name() -> String {
    if cfg!(windows) {
        DRIVER_PIPE.to_string()
    } else {
        path_name(DRIVER_SOCKET)
    }
}

pub fn control_name() -> String {
    if cfg!(windows) {
        CONTROL_PIPE.to_string()
    } else {
        path_name(CONTROL_SOCKET)
    }
}

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
