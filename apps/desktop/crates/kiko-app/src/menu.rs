use kiko_driver::{BrowserState, BrowserStatus, Grant, PermissionKind};

use crate::state::State;

pub const STATUS: &str = "status";
pub const AGENT: &str = "agent";
pub const PAUSE: &str = "pause";
pub const OPEN: &str = "open";
pub const LOGIN: &str = "login";
pub const QUIT: &str = "quit";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Model {
    pub status: String,
    pub agent: String,
    pub paused: bool,
    pub login: bool,
    pub can_open: bool,
    pub permissions: Vec<Row>,
}

pub fn model(state: &State) -> Model {
    Model {
        status: status_line(state),
        agent: agent_line(state),
        paused: state.paused,
        login: state.login,
        can_open: state.url.is_some(),
        permissions: permission_rows(state),
    }
}

fn status_line(state: &State) -> String {
    if let Some(connected) = state.daemon.connected {
        return if connected {
            format!(
                "Connected to {}",
                state
                    .daemon
                    .name
                    .clone()
                    .or_else(|| state.name.clone())
                    .unwrap_or_else(|| "kiko".into())
            )
        } else {
            "Not connected".into()
        };
    }
    if state.running {
        "Running".into()
    } else {
        "Not connected".into()
    }
}

fn agent_line(state: &State) -> String {
    match &state.agent {
        Some(app) => format!("Agent is working in {app}"),
        None => "Agent is idle".into(),
    }
}

fn permission_rows(state: &State) -> Vec<Row> {
    vec![
        row(
            PermissionKind::Accessibility,
            "Accessibility",
            grant(state.permissions.accessibility),
        ),
        row(
            PermissionKind::Screen,
            "Screen Recording",
            grant(state.permissions.screen),
        ),
        row(PermissionKind::Browser, "Browser", browser(&state.browsers)),
    ]
}

fn row(kind: PermissionKind, label: &str, state: &str) -> Row {
    Row {
        id: permission_id(kind),
        label: format!("{label}: {state}"),
    }
}

fn grant(value: Grant) -> &'static str {
    match value {
        Grant::Granted => "Granted",
        Grant::Denied => "Denied",
        Grant::Unknown => "Unknown",
        Grant::NotNeeded => "Not needed",
    }
}

fn browser(browsers: &[BrowserStatus]) -> &'static str {
    match browsers.first().map(|status| status.state) {
        Some(BrowserState::Connected) => "Connected",
        Some(BrowserState::NeedsConsent) => "Needs permission",
        Some(BrowserState::NotRunning) => "Not running",
        Some(BrowserState::Unsupported) | None => "Unavailable",
    }
}

pub fn permission_id(kind: PermissionKind) -> String {
    let name = match kind {
        PermissionKind::Accessibility => "accessibility",
        PermissionKind::Screen => "screen",
        PermissionKind::Automation => "automation",
        PermissionKind::Browser => "browser",
    };
    format!("permission.{name}")
}

pub fn permission_kind(id: &str) -> Option<PermissionKind> {
    match id {
        "permission.accessibility" => Some(PermissionKind::Accessibility),
        "permission.screen" => Some(PermissionKind::Screen),
        "permission.automation" => Some(PermissionKind::Automation),
        "permission.browser" => Some(PermissionKind::Browser),
        _ => None,
    }
}
