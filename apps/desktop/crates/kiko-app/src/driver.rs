use std::sync::Arc;

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
        Self {
            desktop: desktop(),
            browser: browser(),
        }
    }
}

fn desktop() -> Box<dyn Desktop> {
    let log = Arc::new(|line: String| crate::log::line(line));
    Box::new(Cua::start(
        config::cua_path(),
        config::cua_socket(),
        Vec::new(),
        log,
    ))
}

fn browser() -> Box<dyn Browser> {
    kiko_browser::browser()
}
