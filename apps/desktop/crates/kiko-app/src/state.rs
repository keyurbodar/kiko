use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use kiko_driver::{BrowserStatus, Grant, Permissions};

use crate::config;
use crate::driver::Driver;
use crate::login;
use crate::menu::{self, Model};

pub const REFRESH: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Default)]
pub struct DaemonState {
    pub connected: Option<bool>,
    pub name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct State {
    pub running: bool,
    pub daemon: DaemonState,
    pub paused: bool,
    pub login: bool,
    pub agent: Option<String>,
    pub permissions: Permissions,
    pub browsers: Vec<BrowserStatus>,
    pub url: Option<String>,
    pub name: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            running: false,
            daemon: DaemonState::default(),
            paused: false,
            login: false,
            agent: None,
            permissions: Permissions {
                accessibility: Grant::Unknown,
                screen: Grant::Unknown,
                automation: Grant::Unknown,
            },
            browsers: Vec::new(),
            url: None,
            name: None,
        }
    }
}

pub type Shared = Arc<Mutex<State>>;

pub fn shared() -> Shared {
    Arc::new(Mutex::new(State::default()))
}

pub fn lock(shared: &Shared) -> MutexGuard<'_, State> {
    shared.lock().unwrap_or_else(|error| error.into_inner())
}

pub fn refresh(shared: &Shared, driver: &Mutex<Driver>) {
    let paused = config::pause_file().exists();
    let login = login::enabled();
    let agent = config::agent().map(|agent| agent.app);
    let daemon = config::daemon_state();
    let account = config::daemon_config();

    let snapshot = driver
        .try_lock()
        .ok()
        .map(|mut driver| (driver.native.permissions(), driver.browser.status()));

    let mut state = lock(shared);
    state.paused = paused;
    state.login = login;
    state.agent = agent;
    if let Some(daemon) = daemon {
        state.daemon = DaemonState {
            connected: Some(daemon.connected),
            name: daemon.name,
        };
    }
    if let Some(account) = account {
        state.url = Some(account.url);
        state.name = account.name;
    }
    if let Some((permissions, browsers)) = snapshot {
        state.permissions = permissions;
        state.browsers = browsers;
    }
}

pub fn watch(shared: Shared, driver: Arc<Mutex<Driver>>, models: Sender<Model>) {
    thread::spawn(move || {
        let mut last = None;
        loop {
            refresh(&shared, &driver);
            let model = menu::model(&lock(&shared));
            if last.as_ref() != Some(&model) {
                if models.send(model.clone()).is_err() {
                    break;
                }
                last = Some(model);
            }
            thread::sleep(REFRESH);
        }
    });
}
