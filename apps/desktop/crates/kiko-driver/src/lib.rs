pub mod api;
mod outline;
mod serve;

pub use api::*;
pub use outline::{MAX_NODES, outline};
pub use serve::{dispatch, serve};

pub type Result<T> = std::result::Result<T, DriverError>;

pub trait Desktop: Send {
    fn info(&self) -> DesktopInfo;
    fn call(&mut self, name: &str, args: serde_json::Value) -> Result<serde_json::Value>;
    fn permissions(&self) -> Permissions;
    fn screens(&self) -> Vec<Display>;
    fn refresh(&mut self) {}
}

pub trait Browser: Send {
    fn status(&mut self) -> Vec<BrowserStatus>;
    fn tabs(&mut self) -> Result<Vec<Tab>>;
    fn open(&mut self, params: &BrowserOpenParams) -> Result<Tab>;
    fn close(&mut self, params: &TabParams) -> Result<()>;
    fn show(&mut self, params: &TabParams) -> Result<()>;
    fn read(&mut self, params: &BrowserReadParams) -> Result<Page>;
    fn act(&mut self, params: &BrowserActParams) -> Result<ActResult>;
    fn eval(&mut self, params: &BrowserEvalParams) -> Result<serde_json::Value>;
    fn stream(&mut self, params: &TabParams) -> Result<String>;
}

pub struct Unavailable;

impl Browser for Unavailable {
    fn status(&mut self) -> Vec<BrowserStatus> {
        Vec::new()
    }
    fn tabs(&mut self) -> Result<Vec<Tab>> {
        Err(unsupported())
    }
    fn open(&mut self, _: &BrowserOpenParams) -> Result<Tab> {
        Err(unsupported())
    }
    fn close(&mut self, _: &TabParams) -> Result<()> {
        Err(unsupported())
    }
    fn show(&mut self, _: &TabParams) -> Result<()> {
        Err(unsupported())
    }
    fn read(&mut self, _: &BrowserReadParams) -> Result<Page> {
        Err(unsupported())
    }
    fn act(&mut self, _: &BrowserActParams) -> Result<ActResult> {
        Err(unsupported())
    }
    fn eval(&mut self, _: &BrowserEvalParams) -> Result<serde_json::Value> {
        Err(unsupported())
    }
    fn stream(&mut self, _: &TabParams) -> Result<String> {
        Err(unsupported())
    }
}

fn unsupported() -> DriverError {
    DriverError::new(ErrorCode::Unsupported, "no browser driver on this computer")
}
