use std::sync::mpsc::{self, Receiver};
use std::thread;

use ksni::blocking::TrayMethods;
use ksni::menu::{CheckmarkItem, MenuItem as Item, StandardItem, SubMenu};

use super::{Action, Handler};
use crate::control::Command;
use crate::driver::SharedDriver;
use crate::icons;
use crate::log;
use crate::menu::{self, Model};
use crate::state::{self, Shared};

struct Tray {
    model: Model,
    handler: Handler,
    icons: Vec<ksni::Icon>,
}

impl ksni::Tray for Tray {
    fn id(&self) -> String {
        "kiko".into()
    }

    fn title(&self) -> String {
        "kiko".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        self.icons.clone()
    }

    fn menu(&self) -> Vec<Item<Self>> {
        items(&self.model, &self.handler)
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        (self.handler)(Action::Open);
    }
}

pub fn run(
    shared: Shared,
    driver: SharedDriver,
    handler: Handler,
    commands: Receiver<Command>,
) -> ! {
    let first = menu::model(&state::lock(&shared));
    let tray = Tray {
        model: first,
        handler: handler.clone(),
        icons: icons::pixmap(icons::TRAY_COLOR),
    };
    let (models, incoming) = mpsc::channel();
    match tray.spawn() {
        Ok(handle) => {
            thread::spawn(move || {
                for model in incoming {
                    handle.update(|tray| tray.model = model);
                }
            });
        }
        Err(error) => {
            log::line(format!("status notifier unavailable: {error}"));
            thread::spawn(move || incoming.into_iter().for_each(drop));
        }
    }
    state::watch(shared, driver, models);

    for command in commands {
        match command {
            Command::Show => log::line("menu requested; the status notifier cannot open itself"),
            Command::Quit => handler(Action::Quit),
        }
    }
    loop {
        thread::park();
    }
}

fn items(model: &Model, handler: &Handler) -> Vec<Item<Tray>> {
    let mut menu = vec![
        disabled(model.status.clone()),
        disabled(model.agent.clone()),
        Item::Separator,
        pause(model.paused, handler),
        submenu(model, handler),
    ];
    menu.push(open(model.can_open, handler));
    menu.push(login(model.login, handler));
    menu.push(Item::Separator);
    menu.push(standard("Quit kiko", true, handler.clone(), Action::Quit));
    menu
}

fn disabled(label: String) -> Item<Tray> {
    StandardItem {
        label,
        enabled: false,
        ..Default::default()
    }
    .into()
}

fn standard(label: &str, enabled: bool, handler: Handler, action: Action) -> Item<Tray> {
    StandardItem {
        label: label.into(),
        enabled,
        activate: Box::new(move |_| handler(action)),
        ..Default::default()
    }
    .into()
}

fn pause(checked: bool, handler: &Handler) -> Item<Tray> {
    let handler = handler.clone();
    CheckmarkItem {
        label: "Pause the agent".into(),
        checked,
        activate: Box::new(move |_| handler(Action::Pause)),
        ..Default::default()
    }
    .into()
}

fn login(checked: bool, handler: &Handler) -> Item<Tray> {
    let handler = handler.clone();
    CheckmarkItem {
        label: "Start at login".into(),
        checked,
        activate: Box::new(move |_| handler(Action::Login)),
        ..Default::default()
    }
    .into()
}

fn open(enabled: bool, handler: &Handler) -> Item<Tray> {
    standard("Open kiko", enabled, handler.clone(), Action::Open)
}

fn submenu(model: &Model, handler: &Handler) -> Item<Tray> {
    let rows = model.permissions.iter().map(|row| {
        let kind = menu::permission_kind(&row.id);
        match kind {
            Some(kind) => standard(&row.label, true, handler.clone(), Action::Permission(kind)),
            None => disabled(row.label.clone()),
        }
    });
    SubMenu {
        label: "Permissions…".into(),
        submenu: rows.collect(),
        ..Default::default()
    }
    .into()
}
