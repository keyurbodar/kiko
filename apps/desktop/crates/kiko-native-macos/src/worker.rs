use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

use kiko_driver::{
    ActParams, ActResult, Action, DriverError, ErrorCode, Look, LookParams, Mode, OpenParams,
    OpenTarget, Point, Route, Window,
};
use objc2_application_services::{AXError, AXValue, AXValueType};
use objc2_core_foundation::CFRange;

use crate::{act, apps, ax, capture, input, look, menu, window};

const ORDER_SETTLE: Duration = Duration::from_millis(400);
const ORDER_POLL: Duration = Duration::from_millis(40);

pub type Reply<T> = Sender<kiko_driver::Result<T>>;

pub enum Job {
    Windows(Reply<Vec<Window>>),
    Look(LookParams, Reply<Look>),
    Act(ActParams, Reply<ActResult>),
    Open(OpenParams, Reply<()>),
}

pub struct Worker {
    refs: HashMap<String, look::Refs>,
}

impl Worker {
    pub fn new() -> Self {
        Self {
            refs: HashMap::new(),
        }
    }

    pub fn run(mut self, jobs: Receiver<Job>) {
        while let Ok(job) = jobs.recv() {
            match job {
                Job::Windows(reply) => {
                    let _ = reply.send(self.windows());
                }
                Job::Look(params, reply) => {
                    let _ = reply.send(self.look(&params));
                }
                Job::Act(params, reply) => {
                    let _ = reply.send(self.act(&params));
                }
                Job::Open(params, reply) => {
                    let _ = reply.send(open(&params));
                }
            }
        }
    }

    fn windows(&mut self) -> kiko_driver::Result<Vec<Window>> {
        Ok(window::list())
    }

    fn look(&mut self, params: &LookParams) -> kiko_driver::Result<Look> {
        if !ax::trusted() {
            return Err(DriverError::new(
                ErrorCode::Denied,
                "kiko needs Accessibility permission to read a window",
            ));
        }
        let window = resolve(&params.window)?;
        let id = window_id(&window)?;
        let mut nodes = Vec::new();
        if params.tree {
            let application =
                look::enable(window.pid as i32, window.bundle.as_deref(), &window.app);
            let element = window::ax_element_for(id, window.pid as i32).ok_or_else(|| {
                DriverError::new(ErrorCode::NotFound, "this window has no accessibility tree")
            })?;
            ax::timeout(&element, ax::MESSAGING_TIMEOUT);
            let menus = look::open_menus(&application);
            let walk = look::walk(&element, window.frame, &menus);
            nodes = walk.nodes;
            self.refs.insert(window.id.clone(), walk.refs);
        }
        let image = match params.image {
            true => Some(capture::screenshot(id, window.frame, params.max_width)?),
            false => None,
        };
        let outline = kiko_driver::outline(&nodes);
        Ok(Look {
            window,
            image,
            nodes,
            outline,
        })
    }

    fn act(&mut self, params: &ActParams) -> kiko_driver::Result<ActResult> {
        let window = resolve(&params.window)?;
        let front = background_front(params);
        let result = self.act_on(&window, params);
        if let Some(front) = front {
            restore_order(&window, params.action, front);
        }
        result
    }

    fn act_on(&mut self, window: &Window, params: &ActParams) -> kiko_driver::Result<ActResult> {
        let id = window_id(window)?;
        let pid = window.pid as i32;
        let foreground = params.mode == Mode::Foreground;

        if let Some(point) = params.point {
            if foreground {
                bring_forward(pid, id);
            }
            let screen = Point {
                x: window.frame.x + point.x,
                y: window.frame.y + point.y,
            };
            let route = input::click(pid, id, screen, point, foreground)?;
            return Ok(ActResult { route });
        }

        match params.action {
            Action::Key => {
                let keys = params.keys.as_deref().ok_or_else(|| {
                    DriverError::new(ErrorCode::Unsupported, "no keys were named")
                })?;
                if foreground {
                    bring_forward(pid, id);
                } else {
                    make_key_window(pid, id);
                    if let Some(result) = shortcut_route(pid, keys, window) {
                        return result.map(|route| ActResult { route });
                    }
                }
                let route = input::keys(pid, keys, foreground)?;
                Ok(ActResult { route })
            }
            Action::Raise => {
                if !foreground {
                    return Err(DriverError::new(
                        ErrorCode::BackgroundUnavailable,
                        "raising a window needs the screen; use foreground mode",
                    ));
                }
                bring_forward(pid, id);
                Ok(ActResult {
                    route: Route::Foreground,
                })
            }
            action => {
                let reference = params.reference.ok_or_else(|| {
                    DriverError::new(ErrorCode::Unsupported, "this action needs a ref or a point")
                })?;
                let element = self
                    .refs
                    .get(&window.id)
                    .and_then(|refs| refs.get(reference))
                    .ok_or_else(|| {
                        DriverError::new(ErrorCode::Stale, "that ref is gone; call look again")
                    })?
                    .clone();
                if foreground {
                    bring_forward(pid, id);
                }
                let result = match act::apply(
                    &element,
                    action,
                    params.text.as_deref(),
                    params.dx,
                    params.dy,
                ) {
                    Ok(route) => Ok(route),
                    Err(error) if foreground || action != Action::Press => Err(error),
                    Err(error) => press_by_click(pid, id, &element, window).map_err(|_| error),
                };
                let route = result?;
                Ok(ActResult {
                    route: if foreground { Route::Foreground } else { route },
                })
            }
        }
    }
}

fn resolve(id: &str) -> kiko_driver::Result<Window> {
    window::resolve(id)
        .ok_or_else(|| DriverError::new(ErrorCode::NotFound, "no window with that id"))
}

fn window_id(window: &Window) -> kiko_driver::Result<u32> {
    window
        .id
        .parse()
        .map_err(|_| DriverError::new(ErrorCode::NotFound, "no window with that id"))
}

fn bring_forward(pid: i32, id: u32) {
    apps::activate(pid);
    if let Some(element) = window::ax_element_for(id, pid) {
        ax::perform(&element, "AXRaise");
    }
}

fn make_key_window(pid: i32, id: u32) {
    let Some(element) = window::ax_element_for(id, pid) else {
        return;
    };
    let application = ax::application(pid);
    ax::set(&application, ax::FOCUSED_WINDOW, &element);
}

fn background_front(params: &ActParams) -> Option<i32> {
    (params.mode == Mode::Background)
        .then(window::front_pid)
        .flatten()
}

fn menu_route(pid: i32, keys: &str, window: &Window) -> Option<kiko_driver::Result<Route>> {
    if look::web_app(window.bundle.as_deref(), &window.app) {
        return None;
    }
    let (key, modifiers) = input::split(keys).ok()?;
    let combo = menu::Combo::parse(key, &modifiers)?;
    menu::invoke(pid, &combo)
}

fn shortcut_route(pid: i32, keys: &str, window: &Window) -> Option<kiko_driver::Result<Route>> {
    match menu_route(pid, keys, window) {
        Some(Ok(route)) => Some(Ok(route)),
        other => select_all_route(pid, keys).map(Ok).or(other),
    }
}

fn select_all_route(pid: i32, keys: &str) -> Option<Route> {
    let (key, modifiers) = input::split(keys).ok()?;
    let command = modifiers.len() == 1
        && matches!(modifiers[0].as_str(), "cmd" | "command" | "meta" | "super");
    if !key.eq_ignore_ascii_case("a") || !command {
        return None;
    }
    select_all(pid).then_some(Route::Accessibility)
}

fn select_all(pid: i32) -> bool {
    let application = ax::application(pid);
    let Some(element) = ax::element_attribute(&application, ax::FOCUSED_ELEMENT) else {
        return false;
    };
    let Some(text) = ax::text(&ax::attribute(&element, ax::VALUE)) else {
        return false;
    };
    let mut range = CFRange {
        location: 0,
        length: text.encode_utf16().count() as isize,
    };
    let Some(value) =
        (unsafe { AXValue::new(AXValueType::CFRange, NonNull::from(&mut range).cast()) })
    else {
        return false;
    };
    ax::set(&element, ax::SELECTED_TEXT_RANGE, &value) == AXError::Success
}

fn restore_order(window: &Window, action: Action, front: i32) {
    let target = window.pid as i32;
    let settle = if action == Action::ShowMenu {
        ORDER_SETTLE
    } else {
        Duration::ZERO
    };
    let deadline = Instant::now() + settle;
    loop {
        if !window::front_window_above(front, target) {
            raise_focused(front);
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(ORDER_POLL);
    }
}

fn raise_focused(pid: i32) {
    let Some(id) = window::focused_window_id(pid) else {
        return;
    };
    let Some(element) = window::ax_element_for(id, pid) else {
        return;
    };
    ax::perform(&element, "AXRaise");
}

fn press_by_click(
    pid: i32,
    id: u32,
    element: &objc2_application_services::AXUIElement,
    window: &Window,
) -> kiko_driver::Result<Route> {
    let frame = ax::frame(element).ok_or_else(|| {
        DriverError::new(
            ErrorCode::BackgroundUnavailable,
            "this element has no frame to click in the background",
        )
    })?;
    let center = Point {
        x: frame.x + frame.w / 2.0,
        y: frame.y + frame.h / 2.0,
    };
    let local = Point {
        x: center.x - window.frame.x,
        y: center.y - window.frame.y,
    };
    input::click(pid, id, center, local, false)
}

fn open(params: &OpenParams) -> kiko_driver::Result<()> {
    let mut command = std::process::Command::new("open");
    if params.mode == Mode::Background {
        command.arg("-g");
    }
    match &params.target {
        OpenTarget::App(app) => {
            command.arg("-a").arg(app);
        }
        OpenTarget::Url(target) | OpenTarget::Path(target) => {
            command.arg(target);
        }
    }
    let output = command.output().map_err(|error| {
        DriverError::new(ErrorCode::Failed, format!("could not run open: {error}"))
    })?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(DriverError::new(
        ErrorCode::Failed,
        format!("open failed: {message}"),
    ))
}
