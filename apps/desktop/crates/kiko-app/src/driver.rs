use std::sync::Arc;

use kiko_agent_browser::Engine;
use kiko_cua::Cua;
use kiko_driver::{Browser, Desktop};

use crate::config;

pub type SharedDriver = std::sync::Arc<std::sync::Mutex<Driver>>;

pub struct Driver {
    pub desktop: Box<dyn Desktop>,
    pub browser: Box<dyn Browser>,
}

impl Driver {
    pub fn build() -> Self {
        let log: Arc<dyn Fn(String) + Send + Sync> =
            Arc::new(|line: String| crate::log::line(line));
        Self {
            desktop: desktop(Arc::clone(&log)),
            browser: browser(log),
        }
    }
}

fn desktop(log: Arc<dyn Fn(String) + Send + Sync>) -> Box<dyn Desktop> {
    Box::new(Cua::start(
        config::cua_path(),
        config::cua_socket(),
        Vec::new(),
        log,
    ))
}

fn browser(log: Arc<dyn Fn(String) + Send + Sync>) -> Box<dyn Browser> {
    Box::new(Engine::start(
        config::agent_browser_path(),
        config::browser_env(),
        config::browser_shot(),
        log,
    ))
}
