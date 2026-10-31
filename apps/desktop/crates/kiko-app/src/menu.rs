use kiko_driver::{BrowserState, BrowserStatus, Grant};

use crate::state::State;

pub const STATUS: &str = "status";
pub const AGENT: &str = "agent";
pub const PAUSE: &str = "pause";
pub const OPEN: &str = "open";
pub const LOGIN: &str = "login";
pub const QUIT: &str = "quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    Accessibility,
    Screen,
    Automation,
    Browser,
}

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
    let mut rows = vec![
        row(
            Permission::Accessibility,
            "Accessibility",
            grant(state.permissions.accessibility),
        ),
        row(
            Permission::Screen,
            "Screen Recording",
            grant(state.permissions.screen),
        ),
    ];
    if state.permissions.automation != Grant::NotNeeded {
        rows.push(row(
            Permission::Automation,
            "Remote Control",
            grant(state.permissions.automation),
        ));
    }
    rows.push(row(
        Permission::Browser,
        "Browser",
        browser(&state.browsers),
    ));
    rows
}

fn row(kind: Permission, label: &str, state: &str) -> Row {
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

pub fn permission_id(kind: Permission) -> String {
    let name = match kind {
        Permission::Accessibility => "accessibility",
        Permission::Screen => "screen",
        Permission::Automation => "automation",
        Permission::Browser => "browser",
    };
    format!("permission.{name}")
}

pub fn permission_kind(id: &str) -> Option<Permission> {
    match id {
        "permission.accessibility" => Some(Permission::Accessibility),
        "permission.screen" => Some(Permission::Screen),
        "permission.automation" => Some(Permission::Automation),
        "permission.browser" => Some(Permission::Browser),
        _ => None,
    }
}
