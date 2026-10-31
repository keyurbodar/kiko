use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

use kiko_driver::{
    ActParams, ActResult, Action, DriverError, ErrorCode, Look, LookParams, Mode, OpenParams,
    OpenTarget, Point, Ref, Route, Window,
};
use objc2_application_services::{AXError, AXUIElement, AXValue, AXValueType};
use objc2_core_foundation::CFRange;

use crate::{act, apps, ax, capture, input, look, menu, window};

const ORDER_SETTLE: Duration = Duration::from_millis(400);
const ORDER_POLL: Duration = Duration::from_millis(40);
const ACTIVATE_WAIT: Duration = Duration::from_millis(1_500);
const ACTIVATE_POLL: Duration = Duration::from_millis(50);
const FOCUS_SETTLE: Duration = Duration::from_millis(250);
const FOCUS_WAIT: Duration = Duration::from_millis(1_500);
const MAX_REF_WINDOWS: usize = 16;
const MAX_REF_ELEMENTS: usize = MAX_REF_WINDOWS * kiko_driver::MAX_NODES;

pub type Reply<T> = Sender<kiko_driver::Result<T>>;

#[derive(Clone, Default)]
pub struct Ticket(Arc<AtomicBool>);

impl Ticket {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct Job {
    ticket: Ticket,
    call: Call,
}

pub enum Call {
    Windows(Reply<Vec<Window>>),
    Look(LookParams, Reply<Look>),
    Act(ActParams, Reply<ActResult>),
    Open(OpenParams, Reply<()>),
}

impl Job {
    pub fn new(ticket: Ticket, call: Call) -> Self {
        Self { ticket, call }
    }
}

pub struct Worker {
    refs: RefTables<look::Refs>,
    pages: look::WebPages,
}

impl Worker {
    pub fn new() -> Self {
        Self {
            refs: RefTables::default(),
            pages: look::WebPages::default(),
        }
    }

    pub fn run(mut self, jobs: Receiver<Job>) {
        serve(jobs, |job| self.handle(job));
    }

    fn handle(&mut self, job: Job) {
        match job.call {
            Call::Windows(reply) => {
                let _ = reply.send(self.windows());
            }
            Call::Look(params, reply) => {
                let _ = reply.send(self.look(&params));
            }
            Call::Act(params, reply) => {
                let _ = reply.send(self.act(&params));
            }
            Call::Open(params, reply) => {
                let _ = reply.send(open(&params));
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
        let mut page = None;
        if params.tree {
            let (application, state) =
                self.pages
                    .enable(window.pid as i32, window.bundle.as_deref(), &window.app);
            page = Some(state);
            let element = window::ax_element_for(id, window.pid as i32).ok_or_else(|| {
                DriverError::new(ErrorCode::NotFound, "this window has no accessibility tree")
            })?;
            let menus = look::open_menus(&application);
            let walk = look::walk(&element, window.frame, &menus);
            nodes = walk.nodes;
            self.refs
                .put(window.id.clone(), window.pid as i32, walk.refs);
        }
        let image = match params.image {
            true => Some(capture::screenshot(id, window.frame, params.max_width)?),
            false => None,
        };
        let mut outline = String::new();
        if page == Some(look::WebPage::Hidden)
            && look::chromium(window.bundle.as_deref())
            && !nodes.iter().any(|node| node.role == "webarea")
        {
            outline.push_str(look::PAGE_HIDDEN);
        }
        outline.push_str(&kiko_driver::outline(&nodes));
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
                bring_forward(pid, id)?;
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
                    bring_forward(pid, id)?;
                } else {
                    make_key_window(pid, id)?;
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
                bring_forward(pid, id)?;
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
                    .get(&window.id, pid, reference)
                    .cloned()
                    .ok_or_else(|| {
                        DriverError::new(ErrorCode::Stale, "that ref is gone; call look again")
                    })?;
                if foreground {
                    bring_forward(pid, id)?;
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

fn serve(jobs: Receiver<Job>, mut handle: impl FnMut(Job)) {
    while let Ok(job) = jobs.recv() {
        if job.ticket.cancelled() {
            continue;
        }
        handle(job);
    }
}

fn bring_forward(pid: i32, id: u32) -> kiko_driver::Result<()> {
    apps::activate(pid);
    if wait_until(ACTIVATE_WAIT, || {
        (window::front_pid() == Some(pid)).then_some(())
    })
    .is_none()
    {
        return Err(DriverError::new(
            ErrorCode::BackgroundUnavailable,
            "macOS did not bring the app to the front, so the screen would not receive the input",
        ));
    }
    let element = window::ax_element_for(id, pid).ok_or_else(|| {
        DriverError::new(
            ErrorCode::NotFound,
            "this window has no accessibility element",
        )
    })?;
    ax::perform(&element, "AXRaise");
    Ok(())
}

pub(crate) fn make_key_window(pid: i32, id: u32) -> kiko_driver::Result<()> {
    let element = window::ax_element_for(id, pid).ok_or_else(|| {
        DriverError::new(
            ErrorCode::NotFound,
            "this window has no accessibility element",
        )
    })?;
    let application = ax::application(pid);
    ax::set(&application, ax::FOCUSED_WINDOW, &element);
    if wait_until(FOCUS_SETTLE, || {
        is_focused_window(&application, &element).then_some(())
    })
    .is_none()
    {
        ax::perform(&element, "AXRaise");
        ax::set_flag(&element, ax::MAIN, true);
        ax::set_flag(&element, ax::FOCUSED, true);
    }
    if wait_until(FOCUS_WAIT, || {
        is_focused_window(&application, &element).then_some(())
    })
    .is_some()
    {
        return Ok(());
    }
    Err(DriverError::new(
        ErrorCode::BackgroundUnavailable,
        "this window would not take the keyboard in the background; use foreground mode",
    ))
}

fn is_focused_window(application: &AXUIElement, element: &AXUIElement) -> bool {
    ax::focused_window(application).is_some_and(|focused| &*focused == element)
}

fn wait_until<T>(budget: Duration, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + budget;
    loop {
        if let Some(value) = probe() {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(ACTIVATE_POLL);
    }
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

trait Stored {
    type Element;

    fn len(&self) -> usize;
    fn get(&self, reference: Ref) -> Option<&Self::Element>;
}

impl Stored for look::Refs {
    type Element = ax::Element;

    fn len(&self) -> usize {
        look::Refs::count(self)
    }

    fn get(&self, reference: Ref) -> Option<&ax::Element> {
        look::Refs::get(self, reference)
    }
}

struct Entry<T> {
    pid: i32,
    used: u64,
    refs: T,
}

#[derive(Default)]
struct RefTables<T> {
    tables: HashMap<String, Entry<T>>,
    clock: u64,
    total: usize,
}

impl<T: Stored> RefTables<T> {
    fn put(&mut self, id: String, pid: i32, refs: T) {
        self.clock += 1;
        if let Some(old) = self.tables.remove(&id) {
            self.total -= old.refs.len();
        }
        self.total += refs.len();
        self.tables.insert(
            id,
            Entry {
                pid,
                used: self.clock,
                refs,
            },
        );
        self.trim();
    }

    fn get(&mut self, id: &str, pid: i32, reference: Ref) -> Option<&T::Element> {
        self.clock += 1;
        let clock = self.clock;
        let entry = self.tables.get_mut(id)?;
        if entry.pid != pid {
            return None;
        }
        entry.used = clock;
        entry.refs.get(reference)
    }

    fn trim(&mut self) {
        while self.tables.len() > 1
            && (self.tables.len() > MAX_REF_WINDOWS || self.total > MAX_REF_ELEMENTS)
        {
            let Some(oldest) = self
                .tables
                .iter()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            if let Some(entry) = self.tables.remove(&oldest) {
                self.total -= entry.refs.len();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[derive(Default)]
    struct Fake(Vec<u32>);

    impl Stored for Fake {
        type Element = u32;

        fn len(&self) -> usize {
            self.0.len()
        }

        fn get(&self, reference: Ref) -> Option<&u32> {
            self.0.get(reference.checked_sub(1)? as usize)
        }
    }

    fn fake(count: u32) -> Fake {
        Fake((0..count).collect())
    }

    #[test]
    fn a_ref_from_a_window_id_reused_by_another_process_is_stale() {
        let mut tables = RefTables::default();
        tables.put("7".to_string(), 10, fake(3));
        assert_eq!(tables.get("7", 10, 1), Some(&0));
        assert_eq!(tables.get("7", 11, 1), None);
        assert_eq!(tables.get("8", 10, 1), None);
    }

    #[test]
    fn a_new_look_replaces_the_refs_for_its_window() {
        let mut tables = RefTables::default();
        tables.put("7".to_string(), 10, fake(4));
        tables.put("7".to_string(), 10, fake(2));
        assert_eq!(tables.get("7", 10, 2), Some(&1));
        assert_eq!(tables.get("7", 10, 3), None);
        assert_eq!(tables.total, 2);
    }

    #[test]
    fn closed_windows_do_not_pile_up() {
        let mut tables = RefTables::default();
        for id in 0..(MAX_REF_WINDOWS as u32 * 3) {
            tables.put(id.to_string(), 10, fake(2));
        }
        assert!(tables.tables.len() <= MAX_REF_WINDOWS);
    }

    #[test]
    fn retained_elements_stay_bounded() {
        let mut tables = RefTables::default();
        for id in 0..(MAX_REF_WINDOWS as u32 + 4) {
            tables.put(id.to_string(), 10, fake(kiko_driver::MAX_NODES as u32));
        }
        assert!(tables.total <= MAX_REF_ELEMENTS);
    }

    #[test]
    fn a_job_whose_caller_gave_up_never_runs() {
        let (sender, receiver) = mpsc::channel();
        let (reply, _answer) = mpsc::channel();
        let ticket = Ticket::new();
        ticket.cancel();
        sender
            .send(Job::new(ticket, Call::Windows(reply)))
            .expect("queue the job");
        drop(sender);
        let mut ran = 0;
        serve(receiver, |_| ran += 1);
        assert_eq!(ran, 0);
    }

    #[test]
    fn a_job_whose_caller_is_still_waiting_runs() {
        let (sender, receiver) = mpsc::channel();
        let (reply, _answer) = mpsc::channel();
        sender
            .send(Job::new(Ticket::new(), Call::Windows(reply)))
            .expect("queue the job");
        drop(sender);
        let mut ran = 0;
        serve(receiver, |_| ran += 1);
        assert_eq!(ran, 1);
    }

    #[test]
    fn a_wait_that_is_already_true_returns_at_once() {
        assert_eq!(wait_until(Duration::ZERO, || Some(7)), Some(7));
    }

    #[test]
    fn a_wait_that_never_becomes_true_gives_up_without_sleeping() {
        assert_eq!(wait_until(Duration::ZERO, || None::<u8>), None);
    }
}
