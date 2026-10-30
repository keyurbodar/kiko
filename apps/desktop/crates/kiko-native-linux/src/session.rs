use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use atspi::proxy::accessible::AccessibleProxy;
use atspi::proxy::proxy_ext::ProxyExt;
use atspi::zbus::Connection;
use atspi::{CoordType, State as A11yState, StateSet};
use atspi_connection::AccessibilityConnection;
use kiko_driver::{
    ActParams, ActResult, Grant, Image, Look, LookParams, Mode, Native, OpenParams, PermissionKind,
    Permissions, Ref, Result, Route, Status, Window, WindowId,
};

use crate::a11y::{self, Target};
use crate::act;
use crate::capture;
use crate::error::{background_unavailable, failed, not_found, stale, unsupported};
use crate::open;
use crate::tree::{self, RefAllocator};
use crate::x11::{Snapshot, X11};

pub(crate) struct State {
    a11y: Option<AccessibilityConnection>,
    advertised: bool,
    next_ref: Ref,
    refs: HashMap<WindowId, HashMap<Ref, Target>>,
    x11: Option<X11>,
    wayland: bool,
}

struct Listed {
    window: Window,
    xid: Option<u32>,
}

impl State {
    fn new() -> Self {
        let wayland =
            std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("DISPLAY").is_none();
        Self {
            a11y: None,
            advertised: false,
            next_ref: 1,
            refs: HashMap::new(),
            x11: None,
            wayland,
        }
    }

    async fn bus(&mut self) -> Result<Connection> {
        if !self.advertised {
            self.advertised = true;
            let _ = a11y::enable().await;
        }
        if self.a11y.is_none() {
            self.a11y = Some(a11y::connect().await?);
        }
        self.a11y
            .as_ref()
            .map(|connection| connection.connection().clone())
            .ok_or_else(|| failed("the accessibility bus is unavailable"))
    }

    fn x11(&mut self) -> Option<&mut X11> {
        if self.x11.is_none() && !self.wayland {
            self.x11 = X11::connect().ok();
        }
        self.x11.as_mut()
    }

    fn screen_granted(&mut self) -> bool {
        self.x11().is_some()
    }

    async fn reachable(&mut self) -> bool {
        matches!(
            tokio::time::timeout(Duration::from_secs(3), self.bus()).await,
            Ok(Ok(_))
        )
    }

    async fn request_permission(&mut self, kind: PermissionKind) -> Result<()> {
        match kind {
            PermissionKind::Accessibility => {
                self.advertised = true;
                a11y::enable().await
            }
            PermissionKind::Screen if self.screen_granted() => Ok(()),
            PermissionKind::Screen => Err(unsupported(
                "screen capture on Wayland needs the ScreenCast portal, which is not implemented yet",
            )),
            PermissionKind::Automation => Ok(()),
            PermissionKind::Browser => Err(unsupported("no browser permission is needed on Linux")),
        }
    }

    async fn listed(&mut self) -> Result<Vec<Listed>> {
        let snapshot = self.x11().map(|x11| x11.snapshot());
        let bus = self.bus().await?;
        let root = a11y::root(&bus).await?;
        let applications = a11y::within(a11y::CALL, root.get_children())
            .await
            .unwrap_or_default();
        let dbus = zbus::fdo::DBusProxy::new(&bus).await.ok();
        let mut listed = Vec::new();
        for application in applications {
            let Some(app_target) = Target::from_ref(&application) else {
                continue;
            };
            let pid = match &dbus {
                Some(dbus) => a11y::pid_of(dbus, &app_target.bus).await,
                None => None,
            };
            let Ok(app) = a11y::accessible(&bus, &app_target).await else {
                continue;
            };
            let app_name = a11y::within(a11y::CALL, app.name())
                .await
                .unwrap_or_default();
            let frames = a11y::within(a11y::CALL, app.get_children())
                .await
                .unwrap_or_default();
            for frame in frames {
                let Some(frame_target) = Target::from_ref(&frame) else {
                    continue;
                };
                if let Some(entry) =
                    frame_entry(&bus, &frame_target, pid, &app_name, snapshot.as_ref()).await
                {
                    listed.push(entry);
                }
            }
        }
        Ok(listed)
    }

    async fn look(&mut self, params: &LookParams) -> Result<Look> {
        let target = Target::parse(&params.window).ok_or_else(|| not_found("unknown window id"))?;
        let listed = self.listed().await?;
        let entry = listed
            .into_iter()
            .find(|entry| entry.window.id == params.window)
            .ok_or_else(|| not_found("that window is gone; list windows again"))?;
        let bus = self.bus().await?;
        let mut allocator = RefAllocator::new(self.next_ref);
        let nodes = if params.tree {
            tree::build(&bus, &target, entry.window.frame, &mut allocator).await
        } else {
            Vec::new()
        };
        self.next_ref = allocator.next_ref();
        self.refs
            .insert(params.window.clone(), allocator.into_table());
        let image = if params.image {
            self.capture(entry.xid, params.max_width.unwrap_or(1280))
        } else {
            None
        };
        Ok(Look {
            window: entry.window,
            image,
            outline: kiko_driver::outline(&nodes),
            nodes,
        })
    }

    fn capture(&mut self, xid: Option<u32>, max_width: u32) -> Option<Image> {
        let xid = xid?;
        let x11 = self.x11()?;
        capture::capture(x11, xid, max_width).ok()
    }

    async fn act(&mut self, params: &ActParams) -> Result<ActResult> {
        let window = Target::parse(&params.window).ok_or_else(|| not_found("unknown window id"))?;
        let target = match params.reference {
            Some(reference) => self
                .refs
                .get(&params.window)
                .and_then(|table| table.get(&reference))
                .cloned()
                .ok_or_else(stale)?,
            None => window.clone(),
        };
        match params.mode {
            Mode::Background => {
                let bus = self.bus().await?;
                act::background(&bus, &target, params).await
            }
            Mode::Foreground => self.foreground(params, &window, &target).await,
        }
    }

    async fn foreground(
        &mut self,
        params: &ActParams,
        window: &Target,
        target: &Target,
    ) -> Result<ActResult> {
        let listed = self.listed().await?;
        let entry = listed
            .iter()
            .find(|entry| entry.window.id == window.id())
            .ok_or_else(|| not_found("that window is gone; list windows again"))?;
        let frame = entry.window.frame;
        let xid = entry.xid.ok_or_else(|| background_unavailable("foreground input needs X11; on Wayland it needs the RemoteDesktop portal, which is not implemented yet"))?;
        let bus = self.bus().await?;
        if matches!(params.action, kiko_driver::Action::Key) {
            let keys = params
                .keys
                .as_deref()
                .ok_or_else(|| failed("key needs keys"))?;
            let x11 = self
                .x11()
                .ok_or_else(|| background_unavailable("foreground input needs X11"))?;
            x11.activate(xid).map_err(failed)?;
            x11.type_keys(keys).map_err(failed)?;
            return Ok(ActResult {
                route: Route::Foreground,
            });
        }
        if matches!(
            params.action,
            kiko_driver::Action::Press | kiko_driver::Action::Toggle
        ) && let Some((x, y)) = click_point(&bus, params, target, frame).await
        {
            let x11 = self
                .x11()
                .ok_or_else(|| background_unavailable("foreground input needs X11"))?;
            x11.activate(xid).map_err(failed)?;
            x11.click(x, y).map_err(failed)?;
            return Ok(ActResult {
                route: Route::Foreground,
            });
        }
        if matches!(
            params.action,
            kiko_driver::Action::Focus | kiko_driver::Action::Raise
        ) {
            let x11 = self
                .x11()
                .ok_or_else(|| background_unavailable("foreground input needs X11"))?;
            x11.activate(xid).map_err(failed)?;
            if params.action == kiko_driver::Action::Focus {
                act::focus(&bus, target).await?;
            }
            return Ok(ActResult {
                route: Route::Foreground,
            });
        }
        act::background(&bus, target, params).await
    }
}

async fn click_point(
    bus: &Connection,
    params: &ActParams,
    target: &Target,
    frame: kiko_driver::Rect,
) -> Option<(f64, f64)> {
    if let Some(point) = params.point {
        return Some((frame.x + point.x, frame.y + point.y));
    }
    let rect = act::node_rect(bus, target).await?;
    Some((
        frame.x + rect.x + rect.w / 2.0,
        frame.y + rect.y + rect.h / 2.0,
    ))
}

async fn frame_entry(
    bus: &Connection,
    target: &Target,
    pid: Option<u32>,
    app_name: &str,
    snapshot: Option<&Snapshot>,
) -> Option<Listed> {
    let frame = a11y::accessible(bus, target).await.ok()?;
    let role = a11y::within(a11y::CALL, frame.get_role()).await?;
    if !tree::is_window_role(role) {
        return None;
    }
    let title = a11y::within(a11y::CALL, frame.name())
        .await
        .unwrap_or_default();
    let states = a11y::within(a11y::CALL, frame.get_state())
        .await
        .unwrap_or_else(StateSet::empty);
    let extents = frame_rect(&frame).await;
    let matched = snapshot.and_then(|snapshot| snapshot.matched(pid, &title, extents));
    let window = Window {
        id: target.id(),
        pid: pid.unwrap_or(0),
        app: app_label(app_name, pid),
        bundle: None,
        title,
        frame: matched
            .map(|window| window.rect)
            .or(extents)
            .unwrap_or_default(),
        focused: matched
            .map(|window| snapshot.is_some_and(|snapshot| snapshot.active == Some(window.xid)))
            .unwrap_or_else(|| states.contains(A11yState::Focused)),
        minimized: matched
            .map(|window| window.hidden)
            .unwrap_or_else(|| states.contains(A11yState::Iconified)),
        on_screen: matched
            .map(|window| !window.hidden)
            .unwrap_or_else(|| extents.is_some()),
    };
    Some(Listed {
        window,
        xid: matched.map(|window| window.xid),
    })
}

async fn frame_rect(frame: &AccessibleProxy<'_>) -> Option<kiko_driver::Rect> {
    let proxies = a11y::within(a11y::CALL, frame.proxies()).await?;
    let component = proxies.component().await.ok()?;
    let (x, y, w, h) = a11y::within(a11y::CALL, component.get_extents(CoordType::Screen)).await?;
    (w > 0 && h > 0).then(|| kiko_driver::Rect {
        x: f64::from(x),
        y: f64::from(y),
        w: f64::from(w),
        h: f64::from(h),
    })
}

fn app_label(name: &str, pid: Option<u32>) -> String {
    if !name.is_empty() {
        return name.to_string();
    }
    pid.and_then(process_name).unwrap_or_else(|| {
        pid.map(|pid| format!("pid {pid}"))
            .unwrap_or_else(|| "unknown".to_string())
    })
}

fn process_name(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

type Job = Box<dyn FnOnce(&mut Session) + Send>;

pub struct Driver {
    tx: Sender<Job>,
    _thread: JoinHandle<()>,
}

struct Session {
    runtime: tokio::runtime::Runtime,
    state: State,
}

impl Driver {
    fn start() -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let (tx, jobs) = mpsc::channel::<Job>();
        let thread = thread::Builder::new()
            .name("kiko-native-linux".to_string())
            .spawn(move || {
                let mut session = Session {
                    runtime,
                    state: State::new(),
                };
                for job in jobs {
                    job(&mut session);
                }
            })?;
        Ok(Self {
            tx,
            _thread: thread,
        })
    }

    fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Session) -> T + Send + 'static,
    ) -> Result<T> {
        let (done, wait) = mpsc::sync_channel(1);
        let job: Job = Box::new(move |session| {
            let _ = done.send(work(session));
        });
        self.tx
            .send(job)
            .map_err(|_| failed("the linux driver thread stopped"))?;
        wait.recv()
            .map_err(|_| failed("the linux driver thread stopped"))
    }
}

impl Session {
    fn permissions(&mut self) -> Permissions {
        let Session { runtime, state } = self;
        let accessibility = if runtime.block_on(state.reachable()) {
            Grant::Granted
        } else {
            Grant::Denied
        };
        let screen = if state.screen_granted() {
            Grant::Granted
        } else if state.wayland {
            Grant::Unknown
        } else {
            Grant::Denied
        };
        Permissions {
            accessibility,
            screen,
            automation: Grant::NotNeeded,
        }
    }

    fn request_permission(&mut self, kind: PermissionKind) -> Result<()> {
        let Session { runtime, state } = self;
        runtime.block_on(state.request_permission(kind))
    }

    fn windows(&mut self) -> Result<Vec<Window>> {
        let Session { runtime, state } = self;
        let listed = runtime.block_on(state.listed())?;
        Ok(listed.into_iter().map(|entry| entry.window).collect())
    }

    fn look(&mut self, params: &LookParams) -> Result<Look> {
        let Session { runtime, state } = self;
        runtime.block_on(state.look(params))
    }

    fn act(&mut self, params: &ActParams) -> Result<ActResult> {
        let Session { runtime, state } = self;
        runtime.block_on(state.act(params))
    }
}

impl Native for Driver {
    fn permissions(&self) -> Permissions {
        self.run(Session::permissions).unwrap_or(Permissions {
            accessibility: Grant::Unknown,
            screen: Grant::Unknown,
            automation: Grant::NotNeeded,
        })
    }

    fn request_permission(&mut self, kind: PermissionKind) -> Result<()> {
        self.run(move |session| session.request_permission(kind))?
    }

    fn windows(&mut self) -> Result<Vec<Window>> {
        self.run(Session::windows)?
    }

    fn look(&mut self, params: &LookParams) -> Result<Look> {
        let params = params.clone();
        self.run(move |session| session.look(&params))?
    }

    fn act(&mut self, params: &ActParams) -> Result<ActResult> {
        let params = params.clone();
        self.run(move |session| session.act(&params))?
    }

    fn open(&mut self, params: &OpenParams) -> Result<()> {
        open::open(params)
    }
}

pub fn driver() -> Result<Box<dyn Native>> {
    Driver::start()
        .map(|driver| Box::new(driver) as Box<dyn Native>)
        .map_err(|error| failed(format!("could not start the linux driver: {error}")))
}

pub fn status() -> Status {
    let permissions = match Driver::start() {
        Ok(driver) => driver.permissions(),
        Err(_) => Permissions {
            accessibility: Grant::Unknown,
            screen: Grant::Unknown,
            automation: Grant::NotNeeded,
        },
    };
    Status {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: "linux".to_string(),
        session: session_name(),
        permissions,
        browsers: Vec::new(),
    }
}

fn session_name() -> String {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("DISPLAY").is_none() {
        "wayland".to_string()
    } else if std::env::var_os("DISPLAY").is_some() {
        "x11".to_string()
    } else {
        "unknown".to_string()
    }
}
