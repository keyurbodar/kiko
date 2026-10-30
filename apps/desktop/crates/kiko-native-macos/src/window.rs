use kiko_driver::{Rect, Window};
use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFType};
use objc2_core_graphics::{CGWindowListCopyWindowInfo, CGWindowListOption};

use crate::{apps, ax, cf};

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
    all_entries(option)
        .into_iter()
        .filter(|entry| entry.layer == 0)
        .collect()
}

fn all_entries(option: CGWindowListOption) -> Vec<Entry> {
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
            parse(dictionary)
        })
        .collect()
}

#[cfg(test)]
pub fn debug_entries(app: &str) -> Vec<(u32, i32, String)> {
    all_entries(CGWindowListOption::OptionAll)
        .into_iter()
        .filter(|entry| entry.app == app)
        .map(|entry| (entry.id, entry.layer, entry.title))
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

pub fn front_window_above(front: i32, target: i32) -> bool {
    let order = on_screen();
    let front_index = order.iter().position(|entry| entry.pid == front);
    let target_index = order.iter().position(|entry| entry.pid == target);
    match (front_index, target_index) {
        (Some(front), Some(target)) => front < target,
        _ => true,
    }
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

pub fn front_pid() -> Option<i32> {
    on_screen().first().map(|entry| entry.pid)
}

pub fn list() -> Vec<Window> {
    let focused = front_pid().and_then(focused_window_id);
    let entries = every();
    let shown: Vec<&Entry> = entries
        .iter()
        .filter(|entry| entry.on_screen || !entry.title.is_empty())
        .collect();
    let mut seen = std::collections::HashSet::new();
    let mut windows: Vec<Window> = shown
        .iter()
        .filter(|entry| seen.insert(entry.id))
        .map(|entry| build(entry, focused))
        .collect();

    for pid in shown.iter().map(|entry| entry.pid).collect::<Vec<_>>() {
        for window in ax_windows(pid) {
            let Some(id) = window.id else { continue };
            if !seen.insert(id) {
                continue;
            }
            let entry = entries
                .iter()
                .find(|entry| entry.id == id)
                .cloned()
                .unwrap_or(Entry {
                    id,
                    pid,
                    app: String::new(),
                    title: window.title.clone(),
                    frame: window.frame.unwrap_or_default(),
                    on_screen: false,
                    layer: 0,
                });
            let mut built = build(&entry, focused);
            built.minimized = window.minimized;
            if built.title.is_empty() {
                built.title = window.title.clone();
            }
            windows.push(built);
        }
    }

    windows
}

fn build(entry: &Entry, focused: Option<u32>) -> Window {
    let app = apps::with_pid(entry.pid);
    Window {
        id: entry.id.to_string(),
        pid: entry.pid as u32,
        app: app
            .as_ref()
            .map(|app| app.name.clone())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| entry.app.clone()),
        bundle: app.and_then(|app| app.bundle),
        title: entry.title.clone(),
        frame: entry.frame,
        focused: focused == Some(entry.id),
        minimized: false,
        on_screen: entry.on_screen,
    }
}

pub fn resolve(id: &str) -> Option<Window> {
    let id: u32 = id.parse().ok()?;
    let focused = front_pid().and_then(focused_window_id);
    if let Some(entry) = find(id) {
        let mut window = build(&entry, focused);
        window.minimized = ax_windows(entry.pid)
            .into_iter()
            .find(|window| window.id == Some(id))
            .is_some_and(|window| window.minimized);
        return Some(window);
    }
    for pid in every().iter().map(|entry| entry.pid) {
        if let Some(window) = ax_windows(pid)
            .into_iter()
            .find(|window| window.id == Some(id))
        {
            let app = apps::with_pid(pid);
            return Some(Window {
                id: id.to_string(),
                pid: pid as u32,
                app: app.as_ref().map(|app| app.name.clone()).unwrap_or_default(),
                bundle: app.and_then(|app| app.bundle),
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
