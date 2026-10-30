use std::collections::HashMap;

use kiko_driver::{Rect, Window};
use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFType};
use objc2_core_graphics::{CGWindowListCopyWindowInfo, CGWindowListOption};

use crate::apps::{self, App};
use crate::{ax, cf};

pub const NULL_WINDOW: u32 = 0;

#[derive(Debug, Clone)]
pub struct Entry {
    pub id: u32,
    pub pid: i32,
    pub app: String,
    pub title: String,
    pub frame: Rect,
    pub on_screen: bool,
    pub layer: i32,
}

fn number(dictionary: &CFDictionary<CFType, CFType>, key: &str) -> Option<f64> {
    let name = cf::string(key);
    let value = dictionary.get(name.as_ref())?;
    let value = value.downcast_ref::<CFNumber>()?;
    value.as_f64().or_else(|| value.as_i64().map(|n| n as f64))
}

fn string(dictionary: &CFDictionary<CFType, CFType>, key: &str) -> String {
    let name = cf::string(key);
    dictionary
        .get(name.as_ref())
        .and_then(|value| {
            value
                .downcast_ref::<objc2_core_foundation::CFString>()
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}

fn flag(dictionary: &CFDictionary<CFType, CFType>, key: &str) -> bool {
    let name = cf::string(key);
    dictionary
        .get(name.as_ref())
        .and_then(|value| cf::flag(&value))
        .unwrap_or(false)
}

fn bounds(dictionary: &CFDictionary<CFType, CFType>) -> Rect {
    let name = cf::string("kCGWindowBounds");
    let Some(value) = dictionary.get(name.as_ref()) else {
        return Rect::default();
    };
    let Some(bounds) = value.downcast_ref::<CFDictionary>() else {
        return Rect::default();
    };
    let bounds: &CFDictionary<CFType, CFType> = unsafe { bounds.cast_unchecked() };
    Rect {
        x: number(bounds, "X").unwrap_or(0.0),
        y: number(bounds, "Y").unwrap_or(0.0),
        w: number(bounds, "Width").unwrap_or(0.0),
        h: number(bounds, "Height").unwrap_or(0.0),
    }
}

fn parse(dictionary: &CFDictionary<CFType, CFType>) -> Option<Entry> {
    let id = number(dictionary, "kCGWindowNumber")? as u32;
    if id == NULL_WINDOW {
        return None;
    }
    Some(Entry {
        id,
        pid: number(dictionary, "kCGWindowOwnerPID").unwrap_or(0.0) as i32,
        app: string(dictionary, "kCGWindowOwnerName"),
        title: string(dictionary, "kCGWindowName"),
        frame: bounds(dictionary),
        on_screen: flag(dictionary, "kCGWindowIsOnscreen"),
        layer: number(dictionary, "kCGWindowLayer").unwrap_or(0.0) as i32,
    })
}

pub fn entries(option: CGWindowListOption) -> Vec<Entry> {
    let Some(list) = CGWindowListCopyWindowInfo(
        option | CGWindowListOption::ExcludeDesktopElements,
        NULL_WINDOW,
    ) else {
        return Vec::new();
    };
    let list: &CFArray = &list;
    cf::typed(list)
        .to_vec()
        .iter()
        .filter_map(|item| {
            let dictionary = item.downcast_ref::<CFDictionary>()?;
            let dictionary: &CFDictionary<CFType, CFType> = unsafe { dictionary.cast_unchecked() };
            let entry = parse(dictionary)?;
            (entry.layer == 0).then_some(entry)
        })
        .collect()
}

pub fn on_screen() -> Vec<Entry> {
    entries(CGWindowListOption::OptionOnScreenOnly)
}

pub fn every() -> Vec<Entry> {
    entries(CGWindowListOption::OptionAll)
}

pub fn find(id: u32) -> Option<Entry> {
    every().into_iter().find(|entry| entry.id == id)
}

pub struct AxWindow {
    pub id: Option<u32>,
    pub element: ax::Element,
    pub title: String,
    pub frame: Option<Rect>,
    pub minimized: bool,
}

pub fn ax_windows(pid: i32) -> Vec<AxWindow> {
    let application = ax::application(pid);
    ax::windows(&application)
        .into_iter()
        .map(|element| {
            let values = ax::attributes(&element, &[ax::TITLE, ax::MINIMIZED]);
            AxWindow {
                id: ax::window_id(&element),
                title: ax::text(&values[0]).unwrap_or_default(),
                frame: ax::frame(&element),
                minimized: ax::flag(&values[1]).unwrap_or(false),
                element,
            }
        })
        .collect()
}

pub fn focused_window_id(pid: i32) -> Option<u32> {
    let application = ax::application(pid);
    let window = ax::focused_window(&application)?;
    ax::window_id(&window)
}

pub fn ax_element_for(id: u32, pid: i32) -> Option<ax::Element> {
    let windows = ax_windows(pid);
    if let Some(found) = windows.iter().find(|window| window.id == Some(id)) {
        return Some(found.element.clone());
    }
    let entry = find(id)?;
    windows
        .into_iter()
        .filter(|window| window.id.is_none())
        .min_by(|left, right| {
            distance(&left.frame, &entry.frame).total_cmp(&distance(&right.frame, &entry.frame))
        })
        .map(|window| window.element)
}

fn distance(frame: &Option<Rect>, target: &Rect) -> f64 {
    match frame {
        Some(frame) => {
            (frame.x - target.x).abs()
                + (frame.y - target.y).abs()
                + (frame.w - target.w).abs()
                + (frame.h - target.h).abs()
        }
        None => f64::MAX,
    }
}

pub fn list() -> Vec<Window> {
    let apps = apps::running();
    let names: HashMap<i32, App> = apps.iter().map(|app| (app.pid, app.clone())).collect();
    let focused = apps::frontmost().and_then(|app| focused_window_id(app.pid));
    let entries: HashMap<u32, Entry> = every().into_iter().map(|entry| (entry.id, entry)).collect();

    let mut seen = std::collections::HashSet::new();
    let mut windows: Vec<Window> = on_screen()
        .into_iter()
        .filter(|entry| names.contains_key(&entry.pid))
        .map(|entry| {
            seen.insert(entry.id);
            build(&entry, &names, focused)
        })
        .collect();

    for app in &apps {
        for window in ax_windows(app.pid) {
            let Some(id) = window.id else { continue };
            if !seen.insert(id) {
                continue;
            }
            let entry = entries.get(&id).cloned().unwrap_or(Entry {
                id,
                pid: app.pid,
                app: app.name.clone(),
                title: window.title.clone(),
                frame: window.frame.unwrap_or_default(),
                on_screen: false,
                layer: 0,
            });
            let mut built = build(&entry, &names, focused);
            built.minimized = window.minimized;
            if built.title.is_empty() {
                built.title = window.title.clone();
            }
            windows.push(built);
        }
    }

    windows
}

fn build(entry: &Entry, names: &HashMap<i32, App>, focused: Option<u32>) -> Window {
    let app = names.get(&entry.pid);
    Window {
        id: entry.id.to_string(),
        pid: entry.pid as u32,
        app: app
            .map(|app| app.name.clone())
            .unwrap_or_else(|| entry.app.clone()),
        bundle: app.and_then(|app| app.bundle.clone()),
        title: entry.title.clone(),
        frame: entry.frame,
        focused: focused == Some(entry.id),
        minimized: false,
        on_screen: entry.on_screen,
    }
}

pub fn resolve(id: &str) -> Option<Window> {
    let id: u32 = id.parse().ok()?;
    let focused = apps::frontmost().and_then(|app| focused_window_id(app.pid));
    if let Some(entry) = find(id) {
        let app = apps::with_pid(entry.pid);
        let minimized = ax_windows(entry.pid)
            .into_iter()
            .find(|window| window.id == Some(id))
            .is_some_and(|window| window.minimized);
        let mut window = build(&entry, &HashMap::new(), focused);
        if let Some(app) = app {
            window.app = app.name;
            window.bundle = app.bundle;
        }
        window.minimized = minimized;
        return Some(window);
    }
    for app in apps::running() {
        if let Some(window) = ax_windows(app.pid)
            .into_iter()
            .find(|window| window.id == Some(id))
        {
            return Some(Window {
                id: id.to_string(),
                pid: app.pid as u32,
                app: app.name.clone(),
                bundle: app.bundle.clone(),
                title: window.title.clone(),
                frame: window.frame.unwrap_or_default(),
                focused: focused == Some(id),
                minimized: window.minimized,
                on_screen: false,
            });
        }
    }
    None
}
