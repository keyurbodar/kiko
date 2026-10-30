mod action;
mod walk;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use kiko_driver::api::{Action, Mode, Node, Point, Route};
use kiko_driver::{DriverError, ErrorCode, Result};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement};

pub use action::Outcome;

const CALL_TIMEOUT: Duration = Duration::from_secs(3);

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
}

impl Default for Table {
    fn default() -> Self {
        Self {
            elements: HashMap::new(),
            next: 1,
        }
    }
}

pub struct Uia {
    generation: Arc<AtomicU64>,
    slot: Mutex<Option<Sender<Job>>>,
}

impl Uia {
    pub fn new() -> Result<Self> {
        let uia = Self {
            generation: Arc::new(AtomicU64::new(0)),
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
        sender.send(build(reply)).map_err(|_| {
            self.restart();
            DriverError::new(ErrorCode::Failed, "the accessibility worker stopped")
        })?;
        match answers.recv_timeout(CALL_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.restart();
                Err(DriverError::new(
                    ErrorCode::Timeout,
                    "the window's accessibility provider did not answer within 3 seconds",
                ))
            }
            Err(RecvTimeoutError::Disconnected) => {
                self.restart();
                Err(DriverError::new(
                    ErrorCode::Failed,
                    "the accessibility worker stopped",
                ))
            }
        }
    }

    fn sender(&self) -> Result<Sender<Job>> {
        let mut slot = self.lock();
        if slot.is_none() {
            *slot = Some(self.spawn()?);
        }
        slot.clone().ok_or_else(|| {
            DriverError::new(ErrorCode::Failed, "the accessibility worker is unavailable")
        })
    }

    fn spawn(&self) -> Result<Sender<Job>> {
        let generation = self.generation.load(Ordering::Acquire);
        let (sender, jobs) = mpsc::channel();
        let current = Arc::clone(&self.generation);
        thread::Builder::new()
            .name("kiko-uia".into())
            .spawn(move || run(jobs, generation, current))
            .map_err(|error| {
                DriverError::new(
                    ErrorCode::Failed,
                    format!("could not start the accessibility worker: {error}"),
                )
            })?;
        Ok(sender)
    }

    fn restart(&self) {
        let mut slot = self.lock();
        *slot = None;
        self.generation.fetch_add(1, Ordering::AcqRel);
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

fn run(jobs: Receiver<Job>, generation: u64, current: Arc<AtomicU64>) {
    let _com = ComGuard::init();
    let automation = match unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) } {
        Ok(automation) => automation,
        Err(error) => {
            fail(jobs, &error);
            return;
        }
    };
    let mut tables: HashMap<isize, Table> = HashMap::new();
    while let Ok(job) = jobs.recv() {
        if current.load(Ordering::Acquire) != generation {
            break;
        }
        handle(&automation, &mut tables, job);
        if current.load(Ordering::Acquire) != generation {
            break;
        }
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

fn handle(automation: &IUIAutomation, tables: &mut HashMap<isize, Table>, job: Job) {
    match job {
        Job::Look {
            window,
            frame,
            reply,
        } => {
            let _ = reply.send(walk::look(automation, window, frame, tables));
        }
        Job::Act { request, reply } => {
            let _ = reply.send(action::perform(tables, &request));
        }
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

fn native_handle(element: &IUIAutomationElement, window: isize) -> isize {
    unsafe { element.CachedNativeWindowHandle() }
        .ok()
        .map(|handle| handle.0 as isize)
        .filter(|handle| *handle != 0)
        .unwrap_or(window)
}

fn center(element: &IUIAutomationElement) -> Option<Point> {
    let rect = unsafe { element.CachedBoundingRectangle() }.ok()?;
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
    Ok(Outcome::Pointer {
        hwnd: native_handle(element, window),
        screen,
    })
}

fn route(route: Route) -> Result<Outcome> {
    Ok(Outcome::Route(route))
}
