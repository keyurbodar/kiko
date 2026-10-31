use std::collections::HashMap;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use atspi::proxy::accessible::AccessibleProxy;
use atspi::proxy::proxy_ext::ProxyExt;
use atspi::zbus::Connection;
use atspi::{CoordType, State as A11yState, StateSet};
use atspi_connection::AccessibilityConnection;
use kiko_driver::{
    ActParams, ActResult, Action, DriverError, Grant, Image, Look, LookParams, Mode, Native,
    OpenParams, PermissionKind, Permissions, Ref, Result, Route, Status, Window, WindowId,
};

use crate::a11y::{self, Target};
use crate::act;
use crate::capture;
use crate::error::{background_unavailable, failed, not_found, stale, timeout, unsupported};
use crate::open;
use crate::tree::{self, RefAllocator};
use crate::wayland::Wayland;
use crate::x11::{Snapshot, X11};

const LIST_DEADLINE: Duration = Duration::from_secs(5);
const X11_UNAVAILABLE: &str = "the X11 display is unavailable";
const X11_UNMATCHED: &str = "could not match that window to an X11 window; list windows again";

pub(crate) struct State {
    a11y: Option<AccessibilityConnection>,
    advertised: bool,
    next_ref: Ref,
    refs: HashMap<WindowId, HashMap<Ref, Target>>,
    x11: Option<X11>,
    wayland: bool,
    portal: Option<Wayland>,
}

struct Listed {
    window: Window,
    xid: Option<u32>,
}

impl State {
    fn new() -> Self {
        Self {
            a11y: None,
            advertised: false,
            next_ref: 1,
            refs: HashMap::new(),
            x11: None,
            wayland: wayland_session(),
            portal: None,
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

    fn forget_bus(&mut self, error: DriverError) -> DriverError {
        self.a11y = None;
        error
    }

    fn x11(&mut self) -> Option<&mut X11> {
        if self.x11.is_none() && std::env::var_os("DISPLAY").is_some() {
            self.x11 = X11::connect().ok();
        }
        self.x11.as_mut()
    }

    fn screen_granted(&mut self) -> bool {
        if self.wayland {
            self.portal().screen_granted()
        } else {
            self.x11().is_some()
        }
    }

    async fn reachable(&mut self) -> bool {
        matches!(
            tokio::time::timeout(Duration::from_secs(3), self.applications()).await,
            Ok(Ok(_))
        )
    }

    async fn request_permission(&mut self, kind: PermissionKind) -> Result<()> {
        match kind {
            PermissionKind::Accessibility => {
                self.advertised = true;
                a11y::enable().await
            }
            PermissionKind::Screen if self.wayland => self.portal().request_screen().await,
            PermissionKind::Screen if self.x11().is_some() => Ok(()),
            PermissionKind::Screen => Err(unsupported(
                "screen capture needs an X11 display or the Wayland ScreenCast portal",
            )),
            PermissionKind::Automation if self.wayland => self.portal().request_input().await,
            PermissionKind::Automation => Ok(()),
            PermissionKind::Browser => Err(unsupported("no browser permission is needed on Linux")),
        }
    }

    async fn listed(&mut self) -> Result<Vec<Listed>> {
        let frames = self.frames().await?;
        let wayland = self.wayland;
        let snapshot = self.x11().map(|x11| x11.snapshot());
        Ok(frames
            .into_iter()
            .filter_map(|frame| frame.into_listed(snapshot.as_ref(), wayland))
            .collect())
    }

    async fn frames(&mut self) -> Result<Vec<Frame>> {
        let applications = self.applications().await?;
        let bus = self.bus().await?;
        Ok(frames_of(&bus, applications, Instant::now() + LIST_DEADLINE).await)
    }

    async fn applications(&mut self) -> Result<Vec<Target>> {
        let bus = self.bus().await?;
        let root = match a11y::root(&bus).await {
            Ok(root) => root,
            Err(error) => return Err(self.forget_bus(error)),
        };
        let children = match tokio::time::timeout(a11y::CALL, root.get_children()).await {
            Ok(Ok(children)) => children,
            Ok(Err(error)) => {
                return Err(
                    self.forget_bus(failed(format!("could not list applications: {error}")))
                );
            }
            Err(_) => {
                return Err(
                    self.forget_bus(timeout("the accessibility bus did not answer in time"))
                );
            }
        };
        Ok(children.iter().filter_map(Target::from_ref).collect())
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
        let (image, note) = if params.image {
            image_outcome(
                self.image(&entry, params.max_width.unwrap_or(1280)).await,
                params.tree,
            )?
        } else {
            (None, None)
        };
        Ok(Look {
            window: entry.window,
            image,
            outline: kiko_driver::outline(&nodes),
            nodes,
            note,
        })
    }

    async fn image(&mut self, entry: &Listed, max_width: u32) -> Result<Image> {
        if let Some(xid) = entry.xid {
            let x11 = self.x11().ok_or_else(|| failed(X11_UNAVAILABLE))?;
            return capture::capture(x11, xid, max_width);
        }
        if !self.wayland {
            return Err(not_found(X11_UNMATCHED));
        }
        self.portal().capture(entry.window.frame, max_width).await
    }

    fn portal(&mut self) -> &mut Wayland {
        self.portal.get_or_insert_with(Wayland::new)
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
        match entry.xid {
            Some(xid) => self.foreground_x11(params, target, frame, xid).await,
            None if self.wayland => self.foreground_wayland(params, target, entry).await,
            None => Err(not_found(X11_UNMATCHED)),
        }
    }

    async fn foreground_x11(
        &mut self,
        params: &ActParams,
        target: &Target,
        frame: kiko_driver::Rect,
        xid: u32,
    ) -> Result<ActResult> {
        match params.action {
            Action::Key => self.foreground_key(params, xid),
            Action::Press | Action::Toggle => {
                let point = self.foreground_point(params, target, frame).await;
                let x11 = self
                    .x11()
                    .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
                x11.activate(xid).map_err(failed)?;
                x11.click(point.0, point.1).map_err(failed)?;
                Ok(foreground())
            }
            Action::Type => self.foreground_type(params, target, frame, xid).await,
            Action::Scroll => {
                let point = self.foreground_point(params, target, frame).await;
                let x11 = self
                    .x11()
                    .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
                x11.activate(xid).map_err(failed)?;
                x11.scroll(point.0, point.1, params.dx, params.dy)
                    .map_err(failed)?;
                Ok(foreground())
            }
            Action::Focus | Action::Raise => {
                let x11 = self
                    .x11()
                    .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
                x11.activate(xid).map_err(failed)?;
                if params.action == Action::Focus {
                    act::focus(&self.bus().await?, target).await?;
                }
                Ok(foreground())
            }
            _ => act::background(&self.bus().await?, target, params).await,
        }
    }

    async fn foreground_wayland(
        &mut self,
        params: &ActParams,
        target: &Target,
        entry: &Listed,
    ) -> Result<ActResult> {
        let frame = entry.window.frame;
        match params.action {
            Action::Type => {
                require_focused(entry)?;
                let text = params.text.as_deref().unwrap_or_default().to_string();
                self.wayland_focus(params, target).await;
                self.portal().type_text(&text).await?;
            }
            Action::Key => {
                require_focused(entry)?;
                let keys = params
                    .keys
                    .as_deref()
                    .ok_or_else(|| failed("key needs keys"))?
                    .to_string();
                self.portal().type_keys(&keys).await?;
            }
            Action::Press | Action::Toggle => {
                require_focused(entry)?;
                let point = self.foreground_point(params, target, frame).await;
                require_inside(frame, point)?;
                let portal = self.portal();
                portal.motion(point.0 - frame.x, point.1 - frame.y).await?;
                portal.button(true).await?;
                portal.button(false).await?;
            }
            Action::Scroll => {
                require_focused(entry)?;
                let point = self.foreground_point(params, target, frame).await;
                require_inside(frame, point)?;
                let portal = self.portal();
                portal.motion(point.0 - frame.x, point.1 - frame.y).await?;
                portal.scroll(params.dx, params.dy).await?;
            }
            Action::Focus | Action::Raise => {
                return Err(background_unavailable(
                    "Wayland lets an app move the pointer and type, but not raise or focus another window; ask the owner to focus it",
                ));
            }
            _ => return act::background(&self.bus().await?, target, params).await,
        }
        Ok(foreground())
    }

    async fn wayland_focus(&mut self, params: &ActParams, target: &Target) {
        if params.reference.is_none() {
            return;
        }
        if let Ok(bus) = self.bus().await {
            let _ = act::focus(&bus, target).await;
        }
    }

    fn foreground_key(&mut self, params: &ActParams, xid: u32) -> Result<ActResult> {
        let keys = params
            .keys
            .as_deref()
            .ok_or_else(|| failed("key needs keys"))?;
        let x11 = self
            .x11()
            .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
        x11.activate(xid).map_err(failed)?;
        x11.type_keys(keys).map_err(failed)?;
        Ok(foreground())
    }

    async fn foreground_type(
        &mut self,
        params: &ActParams,
        target: &Target,
        frame: kiko_driver::Rect,
        xid: u32,
    ) -> Result<ActResult> {
        let text = params.text.as_deref().unwrap_or_default();
        let x11 = self
            .x11()
            .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
        x11.activate(xid).map_err(failed)?;
        let focused = match params.reference {
            Some(_) => {
                let bus = self.bus().await?;
                act::focus(&bus, target).await.is_ok()
            }
            None => false,
        };
        let click = if focused || params.reference.is_none() {
            None
        } else {
            Some(self.foreground_point(params, target, frame).await)
        };
        let x11 = self
            .x11()
            .ok_or_else(|| background_unavailable(X11_UNAVAILABLE))?;
        if let Some((x, y)) = click {
            x11.click(x, y).map_err(failed)?;
        }
        x11.type_text(text).map_err(failed)?;
        Ok(foreground())
    }

    async fn foreground_point(
        &mut self,
        params: &ActParams,
        target: &Target,
        frame: kiko_driver::Rect,
    ) -> (f64, f64) {
        if let Some(point) = params.point {
            return (frame.x + point.x, frame.y + point.y);
        }
        if params.reference.is_some()
            && let Ok(bus) = self.bus().await
            && let Some(rect) = act::node_rect(&bus, target).await
        {
            return (
                frame.x + rect.x + rect.w / 2.0,
                frame.y + rect.y + rect.h / 2.0,
            );
        }
        (frame.x + frame.w / 2.0, frame.y + frame.h / 2.0)
    }
}

fn foreground() -> ActResult {
    ActResult {
        route: Route::Foreground,
    }
}

fn image_outcome(result: Result<Image>, tree: bool) -> Result<(Option<Image>, Option<String>)> {
    match result {
        Ok(image) => Ok((Some(image), None)),
        Err(error) if tree => {
            let reason = error.message.lines().next().unwrap_or_default().trim();
            Ok((None, (!reason.is_empty()).then(|| reason.to_string())))
        }
        Err(error) => Err(error),
    }
}

fn require_focused(entry: &Listed) -> Result<()> {
    if entry.window.focused {
        return Ok(());
    }
    Err(background_unavailable(
        "on Wayland kiko cannot focus another window; ask the owner to click the window first, then retry",
    ))
}

fn require_inside(frame: kiko_driver::Rect, point: (f64, f64)) -> Result<()> {
    let inside = point.0 >= frame.x
        && point.0 < frame.x + frame.w
        && point.1 >= frame.y
        && point.1 < frame.y + frame.h;
    if inside {
        return Ok(());
    }
    Err(background_unavailable(
        "that point is outside the target window; ask the owner to move the window or pass a ref",
    ))
}

struct Frame {
    target: Target,
    pid: Option<u32>,
    app: String,
    title: String,
    states: atspi::StateSet,
    extents: Option<kiko_driver::Rect>,
}

impl Frame {
    fn into_listed(self, snapshot: Option<&Snapshot>, wayland: bool) -> Option<Listed> {
        let matched = snapshot.and_then(|snapshot| {
            let window = snapshot.matched(self.pid, &self.title, self.extents)?;
            let same_process = self.pid.is_some_and(|pid| window.pid == Some(pid));
            (!wayland || same_process).then_some(window)
        });
        let window = Window {
            id: self.target.id(),
            pid: self.pid.unwrap_or(0),
            app: app_label(&self.app, self.pid),
            bundle: None,
            title: self.title,
            frame: matched
                .map(|window| window.rect)
                .or(self.extents)
                .unwrap_or_default(),
            focused: matched
                .map(|window| snapshot.is_some_and(|snapshot| snapshot.active == Some(window.xid)))
                .unwrap_or_else(|| self.states.contains(A11yState::Focused)),
            minimized: matched
                .map(|window| window.hidden)
                .unwrap_or_else(|| self.states.contains(A11yState::Iconified)),
            on_screen: matched
                .map(|window| !window.hidden)
                .unwrap_or_else(|| self.extents.is_some()),
        };
        Some(Listed {
            window,
            xid: matched.map(|window| window.xid),
        })
    }
}

async fn frames_of(bus: &Connection, applications: Vec<Target>, deadline: Instant) -> Vec<Frame> {
    let dbus = zbus::fdo::DBusProxy::new(bus).await.ok();
    let mut frames = Vec::new();
    for application in applications {
        if remaining(deadline).is_zero() {
            break;
        }
        let pid = match &dbus {
            Some(dbus) => a11y::pid_of(dbus, &application.bus, remaining(deadline)).await,
            None => None,
        };
        let Ok(app) = a11y::accessible(bus, &application).await else {
            continue;
        };
        let app_name = a11y::within(remaining(deadline), app.name())
            .await
            .unwrap_or_default();
        let children = a11y::within(remaining(deadline), app.get_children())
            .await
            .unwrap_or_default();
        for frame in children {
            if remaining(deadline).is_zero() {
                return frames;
            }
            let Some(frame_target) = Target::from_ref(&frame) else {
                continue;
            };
            let entry = frame_entry(bus, &frame_target, pid, &app_name, remaining(deadline)).await;
            if let Some(entry) = entry {
                frames.push(entry);
            }
        }
    }
    frames
}

fn remaining(deadline: Instant) -> Duration {
    deadline
        .saturating_duration_since(Instant::now())
        .min(a11y::CALL)
}

async fn frame_entry(
    bus: &Connection,
    target: &Target,
    pid: Option<u32>,
    app_name: &str,
    budget: Duration,
) -> Option<Frame> {
    let frame = a11y::accessible(bus, target).await.ok()?;
    let role = a11y::within(budget, frame.get_role()).await?;
    if !tree::is_window_role(role) {
        return None;
    }
    let title = a11y::within(budget, frame.name()).await.unwrap_or_default();
    let states = a11y::within(budget, frame.get_state())
        .await
        .unwrap_or_else(StateSet::empty);
    let extents = frame_rect(&frame, budget).await;
    Some(Frame {
        target: target.clone(),
        pid,
        app: app_name.to_string(),
        title,
        states,
        extents,
    })
}

async fn frame_rect(frame: &AccessibleProxy<'_>, budget: Duration) -> Option<kiko_driver::Rect> {
    let proxies = a11y::within(budget, frame.proxies()).await?;
    let component = proxies.component().await.ok()?;
    let (x, y, w, h) = a11y::within(budget, component.get_extents(CoordType::Screen)).await?;
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
        let automation = if !state.wayland {
            Grant::NotNeeded
        } else if state.portal().input_granted() {
            Grant::Granted
        } else {
            Grant::Unknown
        };
        Permissions {
            accessibility,
            screen,
            automation,
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
            automation: Grant::Unknown,
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
            automation: Grant::Unknown,
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

fn wayland_session() -> bool {
    wayland_from(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
    )
}

fn wayland_from(session_type: Option<&str>, wayland_display: bool) -> bool {
    match session_type {
        Some(kind) => kind.eq_ignore_ascii_case("wayland"),
        None => wayland_display,
    }
}

fn session_name() -> String {
    if wayland_session() {
        "wayland".to_string()
    } else if std::env::var_os("DISPLAY").is_some() {
        "x11".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use atspi::{Role, StateSet};

    use super::{Frame, State, frames_of, image_outcome, wayland_from};
    use crate::a11y::{self, Target};
    use crate::fake::{self, Hangs};
    use crate::x11::{Snapshot, XWindow};

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("the test runtime")
    }

    fn error(code: kiko_driver::ErrorCode, message: &str) -> kiko_driver::DriverError {
        kiko_driver::DriverError::new(code, message)
    }

    fn frame(pid: u32, title: &str) -> Frame {
        Frame {
            target: Target {
                bus: ":1.2".to_string(),
                path: "/org/a11y/atspi/accessible/2".to_string(),
            },
            pid: Some(pid),
            app: "Kiko".to_string(),
            title: title.to_string(),
            states: StateSet::empty(),
            extents: None,
        }
    }

    fn snapshot(pid: u32, title: &str) -> Snapshot {
        Snapshot {
            windows: vec![XWindow {
                xid: 1,
                pid: Some(pid),
                title: title.to_string(),
                rect: kiko_driver::Rect::default(),
                hidden: false,
            }],
            active: None,
        }
    }

    #[test]
    fn a_wayland_session_is_detected_even_when_display_is_set() {
        assert!(wayland_from(Some("wayland"), true));
        assert!(wayland_from(Some("wayland"), false));
        assert!(!wayland_from(Some("x11"), true));
        assert!(!wayland_from(Some("tty"), false));
        assert!(wayland_from(None, true));
        assert!(!wayland_from(None, false));
    }

    #[test]
    fn a_tree_look_keeps_the_tree_when_the_picture_fails() {
        let error = error(
            kiko_driver::ErrorCode::Timeout,
            "the shared window has not sent a picture yet",
        );
        let (image, note) = image_outcome(Err(error), true).expect("a tree look failed with it");
        assert!(image.is_none());
        assert_eq!(
            note.as_deref(),
            Some("the shared window has not sent a picture yet")
        );
    }

    #[test]
    fn a_picture_only_look_fails_when_the_picture_fails() {
        let error = error(kiko_driver::ErrorCode::Denied, "no screen capture grant");
        assert!(image_outcome(Err(error), false).is_err());
    }

    #[test]
    fn a_picture_that_arrived_needs_no_note() {
        let picture = kiko_driver::Image {
            mime: "image/jpeg".to_string(),
            data: String::new(),
            width: 1,
            height: 1,
            covers: kiko_driver::Rect::default(),
        };
        let (image, note) = image_outcome(Ok(picture), true).expect("a good picture failed");
        assert!(image.is_some());
        assert!(note.is_none());
    }

    #[test]
    fn a_native_window_does_not_take_a_related_xwayland_window() {
        let snapshot = snapshot(100, "Kiko Target X11");
        let listed = frame(200, "Kiko Target")
            .into_listed(Some(&snapshot), true)
            .expect("the native window vanished");
        assert!(listed.xid.is_none());
    }

    #[test]
    fn an_xwayland_window_keeps_its_x11_window() {
        let snapshot = snapshot(100, "Kiko Target");
        let listed = frame(100, "Kiko Target")
            .into_listed(Some(&snapshot), true)
            .expect("the Xwayland window vanished");
        assert_eq!(listed.xid, Some(1));
    }

    #[test]
    #[ignore]
    fn a_closed_accessibility_bus_is_dropped_and_reconnected() {
        let runtime = runtime();
        let mut state = State::new();
        let bus = runtime
            .block_on(state.bus())
            .expect("the accessibility bus is missing");
        runtime
            .block_on(bus.clone().close())
            .expect("could not close the accessibility bus");
        assert!(
            !runtime.block_on(state.reachable()),
            "a closed accessibility bus still reported the desktop as reachable"
        );
        assert!(
            state.a11y.is_none(),
            "the closed accessibility bus was kept for the next call"
        );
        runtime
            .block_on(state.frames())
            .expect("the accessibility bus did not reconnect");
    }

    #[test]
    #[ignore]
    fn listing_windows_gives_up_on_a_frozen_app_and_keeps_the_healthy_ones() {
        let healthy = fake::serve_app(Hangs::Never, Role::Frame as u32, "Kiko Healthy");
        let frozen = fake::serve_app(Hangs::GetName, Role::Frame as u32, "Kiko Frozen");
        let frozen_again = fake::serve_app(Hangs::GetName, Role::Frame as u32, "Kiko Frozen");
        let runtime = runtime();
        let connection = runtime
            .block_on(a11y::connect())
            .expect("the accessibility bus is missing");
        let started = Instant::now();
        let frames = runtime.block_on(frames_of(
            connection.connection(),
            vec![healthy, frozen, frozen_again],
            Instant::now() + Duration::from_secs(2),
        ));
        let titles: Vec<String> = frames.iter().map(|frame| frame.title.clone()).collect();
        assert_eq!(
            frames.first().map(|frame| frame.title.as_str()),
            Some("Kiko Healthy"),
            "the healthy window before the frozen app is missing from {titles:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "listing windows took {:?} for a two second deadline",
            started.elapsed()
        );
    }

    #[test]
    #[ignore]
    fn listing_windows_skips_apps_once_the_deadline_is_spent() {
        let healthy = fake::serve_app(Hangs::Never, Role::Frame as u32, "Kiko Healthy");
        let runtime = runtime();
        let connection = runtime
            .block_on(a11y::connect())
            .expect("the accessibility bus is missing");
        let frames = runtime.block_on(frames_of(
            connection.connection(),
            vec![healthy],
            Instant::now(),
        ));
        assert!(
            frames.is_empty(),
            "a spent deadline still listed {} windows",
            frames.len()
        );
    }
}
