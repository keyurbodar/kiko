use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender};

use kiko_driver::{
    ActParams, ActResult, Action, DriverError, ErrorCode, Look, LookParams, Mode, OpenParams,
    OpenTarget, Point, Route, Window,
};

use crate::{act, apps, ax, capture, input, look, window};

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
            let element = window::ax_element_for(id, window.pid as i32).ok_or_else(|| {
                DriverError::new(ErrorCode::NotFound, "this window has no accessibility tree")
            })?;
            ax::timeout(&element, ax::MESSAGING_TIMEOUT);
            look::enable(window.pid as i32, window.bundle.as_deref());
            let walk = look::walk(&element, window.frame);
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
        let id = window_id(&window)?;
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
                let route = act::apply(
                    &element,
                    action,
                    params.text.as_deref(),
                    params.dx,
                    params.dy,
                )?;
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
