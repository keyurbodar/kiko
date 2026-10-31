use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Background,
    Foreground,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Grant {
    Granted,
    Denied,
    Unknown,
    NotNeeded,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Permissions {
    pub accessibility: Grant,
    pub screen: Grant,
    pub automation: Grant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserState {
    Connected,
    NeedsConsent,
    NotRunning,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserStatus {
    pub name: String,
    pub state: BrowserState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Display {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Status {
    pub version: String,
    pub os: String,
    pub session: String,
    pub permissions: Permissions,
    pub browsers: Vec<BrowserStatus>,
    pub displays: Vec<Display>,
}

pub type Ref = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Press,
    Focus,
    SetValue,
    Type,
    Key,
    Scroll,
    ShowMenu,
    Select,
    Toggle,
    Expand,
    Collapse,
    Raise,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    #[serde(rename = "ref")]
    pub reference: Ref,
    pub role: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<Rect>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub states: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<Action>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Ref>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Image {
    pub mime: String,
    pub data: String,
    pub width: u32,
    pub height: u32,
    pub covers: Rect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopInfo {
    pub version: String,
    pub tools: Vec<DesktopTool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopCallParams {
    pub name: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

pub type TabId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tab {
    pub id: TabId,
    pub browser: String,
    pub window_id: u32,
    pub index: u32,
    pub active: bool,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabParams {
    pub tab: TabId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserOpenParams {
    pub url: String,
    #[serde(default)]
    pub mode: Mode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserReadParams {
    pub tab: TabId,
    #[serde(default)]
    pub image: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Page {
    pub tab: Tab,
    pub nodes: Vec<Node>,
    pub outline: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<Image>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageAction {
    Click,
    Type,
    SetValue,
    Select,
    PressKey,
    Scroll,
    Focus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserActParams {
    pub tab: TabId,
    #[serde(rename = "ref")]
    pub reference: Ref,
    pub action: PageAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default)]
    pub mode: Mode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserEvalParams {
    pub tab: TabId,
    pub expression: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    Accessibility,
    WindowEvent,
    Private,
    Dom,
    Trusted,
    Foreground,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActResult {
    pub route: Route,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum Call {
    Status,
    #[serde(rename = "desktop.tools")]
    DesktopTools,
    #[serde(rename = "desktop.call")]
    DesktopCall(DesktopCallParams),
    #[serde(rename = "browser.tabs")]
    BrowserTabs,
    #[serde(rename = "browser.open")]
    BrowserOpen(BrowserOpenParams),
    #[serde(rename = "browser.close")]
    BrowserClose(TabParams),
    #[serde(rename = "browser.show")]
    BrowserShow(TabParams),
    #[serde(rename = "browser.read")]
    BrowserRead(BrowserReadParams),
    #[serde(rename = "browser.act")]
    BrowserAct(BrowserActParams),
    #[serde(rename = "browser.eval")]
    BrowserEval(BrowserEvalParams),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub call: Call,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Denied,
    BackgroundUnavailable,
    Stale,
    NotFound,
    Timeout,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct DriverError {
    pub code: ErrorCode,
    pub message: String,
}

impl DriverError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Response {
    Ok {
        id: u64,
        ok: True,
        value: serde_json::Value,
    },
    Err {
        id: u64,
        ok: False,
        error: DriverError,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "bool", into = "bool")]
pub struct True;

impl TryFrom<bool> for True {
    type Error = &'static str;
    fn try_from(value: bool) -> Result<Self, Self::Error> {
        if value {
            Ok(True)
        } else {
            Err("expected true")
        }
    }
}

impl From<True> for bool {
    fn from(_: True) -> bool {
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "bool", into = "bool")]
pub struct False;

impl TryFrom<bool> for False {
    type Error = &'static str;
    fn try_from(value: bool) -> Result<Self, Self::Error> {
        if value {
            Err("expected false")
        } else {
            Ok(False)
        }
    }
}

impl From<False> for bool {
    fn from(_: False) -> bool {
        false
    }
}
