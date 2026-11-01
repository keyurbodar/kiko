use std::sync::mpsc::{self, Receiver};
use std::thread;

use tao::event::Event;
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder};
use tray_icon::TrayIcon;
use tray_icon::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
};

use super::{Action, Handler};
use crate::control::Command;
use crate::driver::SharedDriver;
use crate::icons;
use crate::log;
use crate::menu::{self, Model};
use crate::state::{self, Shared};

enum UserEvent {
    Menu(String),
    Model(Model),
    Show,
}

pub fn run(
    shared: Shared,
    driver: SharedDriver,
    handler: Handler,
    commands: Receiver<Command>,
) -> ! {
    let event_loop = event_loop();

    let first = menu::model(&state::lock(&shared));
    let tray = build(&first);

    let menu_proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let _ = menu_proxy.send_event(UserEvent::Menu(event.id().0.clone()));
    }));

    let (models, incoming) = mpsc::channel();
    let model_proxy = event_loop.create_proxy();
    thread::spawn(move || {
        for model in incoming {
            if model_proxy.send_event(UserEvent::Model(model)).is_err() {
                break;
            }
        }
    });
    state::watch(shared, driver, models);

    let show_proxy = event_loop.create_proxy();
    thread::spawn(move || {
        for command in commands {
            match command {
                Command::Show => {
                    let _ = show_proxy.send_event(UserEvent::Show);
                }
                Command::Quit => {
                    let _ = show_proxy.send_event(UserEvent::Menu(menu::QUIT.into()));
                }
            }
        }
    });

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Menu(id)) => {
                let Some(action) = super::action(&id) else {
                    return;
                };
                if action == Action::Quit {
                    *control_flow = ControlFlow::Exit;
                }
                handler(action);
            }
            Event::UserEvent(UserEvent::Model(model)) => {
                if let Some(tray) = &tray {
                    tray.set_menu(Some(Box::new(menu_bar(&model))));
                    let _ = tray.set_tooltip(Some(model.status.clone()));
                }
            }
            Event::UserEvent(UserEvent::Show) => {
                if let Some(tray) = &tray {
                    tray.show_menu();
                }
            }
            _ => {}
        }
    })
}

#[cfg(target_os = "macos")]
fn event_loop() -> EventLoop<UserEvent> {
    use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
    event_loop
}

#[cfg(not(target_os = "macos"))]
fn event_loop() -> EventLoop<UserEvent> {
    EventLoopBuilder::<UserEvent>::with_user_event().build()
}

fn build(model: &Model) -> Option<TrayIcon> {
    let template = cfg!(target_os = "macos");
    let source = if template {
        icons::TRAY_TEMPLATE
    } else {
        icons::TRAY_COLOR
    };
    let (rgba, width, height) = icons::rgba(source)?;
    let icon = tray_icon::Icon::from_rgba(rgba, width, height).ok()?;
    let builder = tray_icon::TrayIconBuilder::new()
        .with_id("kiko")
        .with_tooltip("kiko")
        .with_menu(Box::new(menu_bar(model)))
        .with_menu_on_left_click(true);
    #[cfg(target_os = "macos")]
    let builder = builder.with_icon_templated(icon);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.with_icon(icon);
    match builder.build() {
        Ok(tray) => Some(tray),
        Err(error) => {
            log::line(format!("tray icon unavailable: {error}"));
            None
        }
    }
}

fn menu_bar(model: &Model) -> Menu {
    let status = MenuItem::with_id(menu::STATUS, &model.status, false, None);
    let agent = MenuItem::with_id(menu::AGENT, &model.agent, false, None);
    let pause = CheckMenuItem::with_id(menu::PAUSE, "Pause the agent", true, model.paused, None);
    let permissions = Submenu::with_id("permissions", "Permissions…", true);
    for row in &model.permissions {
        let item = MenuItem::with_id(row.id.clone(), &row.label, true, None);
        let _ = permissions.append(&item);
    }
    let open = MenuItem::with_id(menu::OPEN, "Open kiko", model.can_open, None);
    let login = CheckMenuItem::with_id(menu::LOGIN, "Start at login", true, model.login, None);
    let quit = MenuItem::with_id(menu::QUIT, "Quit kiko", true, None);
    let separator = PredefinedMenuItem::separator();
    let items: [&dyn IsMenuItem; 8] = [
        &status,
        &agent,
        &separator,
        &pause,
        &permissions,
        &open,
        &login,
        &quit,
    ];
    match Menu::with_items(&items) {
        Ok(menu) => menu,
        Err(error) => {
            log::line(format!("could not build the menu: {error}"));
            Menu::new()
        }
    }
}
