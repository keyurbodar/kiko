use std::sync::Arc;
use std::sync::mpsc::Receiver;

use crate::menu::Permission;

use crate::control::Command;
use crate::driver::SharedDriver;
use crate::menu;
use crate::state::Shared;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Pause,
    Login,
    Open,
    Quit,
    Permission(Permission),
}

pub type Handler = Arc<dyn Fn(Action) + Send + Sync>;

pub fn action(id: &str) -> Option<Action> {
    match id {
        menu::PAUSE => Some(Action::Pause),
        menu::LOGIN => Some(Action::Login),
        menu::OPEN => Some(Action::Open),
        menu::QUIT => Some(Action::Quit),
        other => menu::permission_kind(other).map(Action::Permission),
    }
}

pub fn id(action: Action) -> String {
    match action {
        Action::Pause => menu::PAUSE.into(),
        Action::Login => menu::LOGIN.into(),
        Action::Open => menu::OPEN.into(),
        Action::Quit => menu::QUIT.into(),
        Action::Permission(kind) => menu::permission_id(kind),
    }
}

#[cfg(target_os = "macos")]
mod desktop;

#[cfg(target_os = "linux")]
mod linux;

pub fn run(
    shared: Shared,
    driver: SharedDriver,
    handler: Handler,
    commands: Receiver<Command>,
) -> ! {
    #[cfg(target_os = "macos")]
    {
        desktop::run(shared, driver, handler, commands)
    }
    #[cfg(target_os = "linux")]
    {
        linux::run(shared, driver, handler, commands)
    }
}
