mod action;
mod walk;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use kiko_driver::api::{Action, Mode, Node, Point, Rect, Route};
use kiko_driver::{DriverError, ErrorCode, Result};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationElement,
};
use windows::core::Interface;

pub use action::Outcome;

const CALL_TIMEOUT: Duration = Duration::from_secs(3);
const PROVIDER_TIMEOUT_MS: u32 = 3000;
const MAX_TABLES: usize = 32;

pub struct ActRequest<'a> {
    pub window: isize,
    pub reference: u32,
    pub action: Action,
    pub text: Option<&'a str>,
    pub dx: f64,
    pub dy: f64,
    pub mode: Mode,
}

struct OwnedAct {
    window: isize,
    reference: u32,
    action: Action,
    text: Option<String>,
    dx: f64,
    dy: f64,
    mode: Mode,
}

impl From<&ActRequest<'_>> for OwnedAct {
    fn from(request: &ActRequest<'_>) -> Self {
        Self {
            window: request.window,
            reference: request.reference,
            action: request.action,
            text: request.text.map(str::to_string),
            dx: request.dx,
            dy: request.dy,
            mode: request.mode,
        }
    }
}

enum Job {
    Look {
        window: isize,
        frame: kiko_driver::api::Rect,
        reply: Sender<Result<Vec<Node>>>,
    },
    Act {
        request: OwnedAct,
        reply: Sender<Result<Outcome>>,
    },
}

struct Table {
    elements: HashMap<u32, IUIAutomationElement>,
    next: u32,
    used: u64,
}

impl Default for Table {
    fn default() -> Self {
        Self {
            elements: HashMap::new(),
            next: 1,
            used: 0,
        }
    }
}

pub struct Uia {
    alive: Arc<AtomicBool>,
    slot: Mutex<Option<Sender<Job>>>,
}

impl Uia {
    pub fn new() -> Result<Self> {
        let uia = Self {
            alive: Arc::new(AtomicBool::new(false)),
            slot: Mutex::new(None),
        };
        uia.sender()?;
        Ok(uia)
    }

    pub fn look(&self, window: isize, frame: kiko_driver::api::Rect) -> Result<Vec<Node>> {
        self.call(move |reply| Job::Look {
            window,
            frame,
            reply,
        })
    }

    pub fn act(&self, request: ActRequest<'_>) -> Result<Outcome> {
        let owned = OwnedAct::from(&request);
        self.call(move |reply| Job::Act {
            request: owned,
            reply,
        })
    }

    fn call<T, F>(&self, build: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(Sender<Result<T>>) -> Job,
    {
        let sender = self.sender()?;
        let (reply, answers) = mpsc::channel();
        if sender.send(build(reply)).is_err() {
            self.mark_dead();
            return Err(DriverError::new(
                ErrorCode::Failed,
                "the accessibility worker stopped",
            ));
        }
        match answers.recv_timeout(CALL_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err(DriverError::new(
                ErrorCode::Timeout,
                "the window's accessibility provider did not answer within 3 seconds; run look again",
            )),
            Err(RecvTimeoutError::Disconnected) => {
                self.mark_dead();
                Err(DriverError::new(
                    ErrorCode::Failed,
                    "the accessibility worker stopped",
                ))
            }
        }
    }

    fn sender(&self) -> Result<Sender<Job>> {
        let mut slot = self.lock();
        let dead = !self.alive.load(Ordering::Acquire);
        if slot.is_none() || dead {
            *slot = Some(self.spawn()?);
        }
        slot.clone().ok_or_else(|| {
            DriverError::new(ErrorCode::Failed, "the accessibility worker is unavailable")
        })
    }

    fn spawn(&self) -> Result<Sender<Job>> {
        let (sender, jobs) = mpsc::channel();
        let alive = Arc::clone(&self.alive);
        alive.store(true, Ordering::Release);
        thread::Builder::new()
            .name("kiko-uia".into())
            .spawn(move || run(jobs, alive))
            .map_err(|error| {
                DriverError::new(
                    ErrorCode::Failed,
                    format!("could not start the accessibility worker: {error}"),
                )
            })?;
        Ok(sender)
    }

    fn mark_dead(&self) {
        let mut slot = self.lock();
        *slot = None;
        self.alive.store(false, Ordering::Release);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Sender<Job>>> {
        self.slot.lock().unwrap_or_else(|error| error.into_inner())
    }
}

pub(crate) struct ComGuard {
    uninitialize: bool,
}

impl ComGuard {
    pub(crate) fn init() -> Self {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            uninitialize: result.is_ok(),
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}

struct Alive(Arc<AtomicBool>);

impl Drop for Alive {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn run(jobs: Receiver<Job>, alive: Arc<AtomicBool>) {
    let _alive = Alive(alive);
    let _com = ComGuard::init();
    let automation: IUIAutomation =
        match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) } {
            Ok(automation) => automation,
            Err(error) => {
                fail(jobs, &error);
                return;
            }
        };
    if let Ok(automation2) = automation.cast::<IUIAutomation2>() {
        unsafe {
            let _ = automation2.SetConnectionTimeout(PROVIDER_TIMEOUT_MS);
            let _ = automation2.SetTransactionTimeout(PROVIDER_TIMEOUT_MS);
        }
    }
    let mut tables: HashMap<isize, Table> = HashMap::new();
    let mut clock: u64 = 0;
    while let Ok(job) = jobs.recv() {
        handle(&automation, &mut tables, &mut clock, job);
    }
}

fn fail(jobs: Receiver<Job>, error: &windows::core::Error) {
    let message = format!("UI Automation is unavailable: {error}");
    for job in jobs {
        match job {
            Job::Look { reply, .. } => {
                let _ = reply.send(Err(DriverError::new(ErrorCode::Failed, message.clone())));
            }
            Job::Act { reply, .. } => {
                let _ = reply.send(Err(DriverError::new(ErrorCode::Failed, message.clone())));
            }
        }
    }
}

fn handle(
    automation: &IUIAutomation,
    tables: &mut HashMap<isize, Table>,
    clock: &mut u64,
    job: Job,
) {
    match job {
        Job::Look {
            window,
            frame,
            reply,
        } => {
            *clock += 1;
            prune(tables, window, *clock, crate::hwnd::exists);
            let _ = reply.send(walk::look(automation, window, frame, tables));
        }
        Job::Act { request, reply } => {
            let _ = reply.send(action::perform(tables, &request));
        }
    }
}

fn prune(
    tables: &mut HashMap<isize, Table>,
    keep: isize,
    now: u64,
    exists: impl Fn(isize) -> bool,
) {
    tables.retain(|window, _| *window == keep || exists(*window));
    tables.entry(keep).or_default().used = now;
    while tables.len() > MAX_TABLES {
        let oldest = tables
            .iter()
            .filter(|(window, _)| **window != keep)
            .min_by_key(|(_, table)| table.used)
            .map(|(window, _)| *window);
        let Some(oldest) = oldest else { break };
        tables.remove(&oldest);
    }
}

fn stale(reference: u32) -> DriverError {
    DriverError::new(
        ErrorCode::Stale,
        format!("ref {reference} is no longer valid; run look again"),
    )
}

fn unavailable(message: &str) -> DriverError {
    DriverError::new(ErrorCode::BackgroundUnavailable, message)
}

fn unsupported(message: &str) -> DriverError {
    DriverError::new(ErrorCode::Unsupported, message)
}

fn failed(action: &str, error: windows::core::Error) -> DriverError {
    DriverError::new(ErrorCode::Failed, format!("{action} failed: {error}"))
}

fn native_handle(element: &IUIAutomationElement) -> Option<isize> {
    unsafe { element.CachedNativeWindowHandle() }
        .ok()
        .map(|handle| handle.0 as isize)
        .filter(|handle| *handle != 0)
}

fn center(element: &IUIAutomationElement) -> Option<Point> {
    let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    (rect.right > rect.left && rect.bottom > rect.top).then(|| Point {
        x: f64::from(rect.left + rect.right) / 2.0,
        y: f64::from(rect.top + rect.bottom) / 2.0,
    })
}

fn target<'a>(
    tables: &'a HashMap<isize, Table>,
    request: &OwnedAct,
) -> Result<&'a IUIAutomationElement> {
    let table = tables
        .get(&request.window)
        .ok_or_else(|| stale(request.reference))?;
    table
        .elements
        .get(&request.reference)
        .ok_or_else(|| stale(request.reference))
}

fn pointer(element: &IUIAutomationElement, window: isize) -> Result<Outcome> {
    let screen = center(element).ok_or_else(|| {
        unsupported("the element has no position on screen; scroll it into view first")
    })?;
    let frame = crate::hwnd::frame(window).ok_or_else(stale_outside)?;
    if !inside(frame, screen) {
        return Err(stale_outside());
    }
    Ok(Outcome::Pointer { screen })
}

fn stale_outside() -> DriverError {
    DriverError::new(
        ErrorCode::Stale,
        "the control moved out of the window; run look again",
    )
}

fn inside(frame: Rect, point: Point) -> bool {
    point.x >= frame.x
        && point.x <= frame.x + frame.w
        && point.y >= frame.y
        && point.y <= frame.y + frame.h
}

fn route(route: Route) -> Result<Outcome> {
    Ok(Outcome::Route(route))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tables(windows: &[(isize, u64)]) -> HashMap<isize, Table> {
        windows
            .iter()
            .map(|(window, used)| {
                (
                    *window,
                    Table {
                        used: *used,
                        ..Default::default()
                    },
                )
            })
            .collect()
    }

    #[test]
    fn prune_drops_dead_windows() {
        let mut tables = tables(&[(1, 1), (2, 2), (9, 3)]);
        prune(&mut tables, 9, 4, |window| window == 2);
        assert!(!tables.contains_key(&1));
        assert!(tables.contains_key(&2));
        assert!(tables.contains_key(&9));
    }

    #[test]
    fn prune_keeps_the_looked_at_window_even_when_it_is_gone() {
        let mut tables = tables(&[(9, 1)]);
        prune(&mut tables, 9, 2, |_| false);
        assert!(tables.contains_key(&9));
        assert_eq!(tables[&9].used, 2);
    }

    #[test]
    fn prune_evicts_the_least_recently_used_over_the_cap() {
        let windows: Vec<(isize, u64)> = (1..=MAX_TABLES as isize + 1)
            .map(|window| (window, window as u64))
            .collect();
        let mut tables = tables(&windows);
        prune(&mut tables, 100, 1000, |_| true);
        assert_eq!(tables.len(), MAX_TABLES);
        assert!(!tables.contains_key(&1));
        assert!(!tables.contains_key(&2));
        assert!(tables.contains_key(&100));
    }

    #[test]
    fn inside_checks_the_live_frame() {
        let frame = Rect {
            x: 10.0,
            y: 20.0,
            w: 100.0,
            h: 50.0,
        };
        assert!(inside(frame, Point { x: 60.0, y: 45.0 }));
        assert!(inside(frame, Point { x: 10.0, y: 20.0 }));
        assert!(!inside(frame, Point { x: 9.0, y: 45.0 }));
        assert!(!inside(frame, Point { x: 60.0, y: 71.0 }));
    }
}
