use std::collections::HashMap;

use kiko_driver::Rect;
use x11rb::connection::{Connection, RequestConnection as _};
use x11rb::protocol::composite::{ConnectionExt as _, Redirect};
use x11rb::protocol::xproto::{
    Atom, AtomEnum, ClientMessageData, ClientMessageEvent, ConnectionExt as _, EventMask, MapState,
    Window,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

use crate::keys;

#[derive(Clone, Debug)]
pub(crate) struct XWindow {
    pub xid: Window,
    pub pid: Option<u32>,
    pub title: String,
    pub rect: Rect,
    pub hidden: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Snapshot {
    pub windows: Vec<XWindow>,
    pub active: Option<Window>,
}

impl Snapshot {
    pub fn matched(
        &self,
        pid: Option<u32>,
        title: &str,
        extents: Option<Rect>,
    ) -> Option<&XWindow> {
        let title = title.trim().to_lowercase();
        let pool: Vec<&XWindow> = if self.windows.iter().any(|window| same_pid(window, pid)) {
            self.windows
                .iter()
                .filter(|window| same_pid(window, pid))
                .collect()
        } else {
            self.windows.iter().collect()
        };
        let mut best: Option<(&XWindow, f64)> = None;
        for window in pool {
            let score = score(window, pid, &title, extents);
            if best.is_none_or(|(_, current)| score > current) {
                best = Some((window, score));
            }
        }
        best.filter(|(_, score)| *score > 0.0)
            .map(|(window, _)| window)
    }
}

fn score(window: &XWindow, pid: Option<u32>, title: &str, extents: Option<Rect>) -> f64 {
    let mut score = 0.0;
    let candidate = window.title.trim().to_lowercase();
    if !title.is_empty() && !candidate.is_empty() && !related(&candidate, title) {
        return 0.0;
    }
    if !title.is_empty() && candidate == title {
        score += 1000.0;
    } else if !title.is_empty() && !candidate.is_empty() && related(&candidate, title) {
        score += 400.0;
    }
    if pid.is_some() && window.pid == pid {
        score += 50.0;
    }
    if let Some(extents) = extents {
        score += overlap(&window.rect, &extents) * 300.0;
    }
    score
}

fn related(candidate: &str, title: &str) -> bool {
    candidate.contains(title) || title.contains(candidate)
}

fn overlap(a: &Rect, b: &Rect) -> f64 {
    let width = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let height = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if width <= 0.0 || height <= 0.0 {
        return 0.0;
    }
    let intersection = width * height;
    let area = (a.w * a.h).max(b.w * b.h).max(1.0);
    intersection / area
}

pub(crate) struct X11 {
    conn: RustConnection,
    root: Window,
    atoms: Atoms,
    redirected: bool,
    keymap: Option<Keymap>,
}

struct Keymap {
    keysyms: HashMap<u32, (u8, bool)>,
    spare: Option<u8>,
    width: u8,
}

const REMAP_SETTLE: std::time::Duration = std::time::Duration::from_millis(12);
const WHEEL_STEP: f64 = 50.0;
const MAX_WHEEL_CLICKS: f64 = 20.0;

struct Atoms {
    client_list: Atom,
    wm_pid: Atom,
    wm_name: Atom,
    wm_state: Atom,
    wm_state_hidden: Atom,
    active_window: Atom,
}

impl X11 {
    pub fn connect() -> Result<Self, String> {
        let (conn, screen) =
            x11rb::connect(None).map_err(|error| format!("no X11 display: {error}"))?;
        let root = conn.setup().roots[screen].root;
        let atoms = Atoms {
            client_list: intern(&conn, "_NET_CLIENT_LIST")?,
            wm_pid: intern(&conn, "_NET_WM_PID")?,
            wm_name: intern(&conn, "_NET_WM_NAME")?,
            wm_state: intern(&conn, "_NET_WM_STATE")?,
            wm_state_hidden: intern(&conn, "_NET_WM_STATE_HIDDEN")?,
            active_window: intern(&conn, "_NET_ACTIVE_WINDOW")?,
        };
        Ok(Self {
            conn,
            root,
            atoms,
            redirected: false,
            keymap: None,
        })
    }

    pub fn connection(&self) -> &RustConnection {
        &self.conn
    }

    pub fn ensure_composite(&mut self) -> Result<(), String> {
        if self.redirected {
            return Ok(());
        }
        let present = self
            .conn
            .extension_information(x11rb::protocol::composite::X11_EXTENSION_NAME)
            .map_err(|error| format!("could not query the Composite extension: {error}"))?
            .is_some();
        if !present {
            return Err("this X server has no Composite extension, so a covered window's pixels cannot be read".to_string());
        }
        self.conn
            .composite_redirect_subwindows(self.root, Redirect::AUTOMATIC)
            .map_err(|error| format!("could not redirect windows for capture: {error}"))?
            .check()
            .map_err(|error| format!("could not redirect windows for capture: {error}"))?;
        self.redirected = true;
        Ok(())
    }

    pub fn pixmap_format(&self, depth: u8) -> Option<(u8, u8)> {
        self.conn
            .setup()
            .pixmap_formats
            .iter()
            .find(|format| format.depth == depth)
            .map(|format| (format.bits_per_pixel, format.scanline_pad))
    }

    pub fn top_ancestor(&self, xid: Window) -> Option<(Window, i16, i16)> {
        let mut window = xid;
        loop {
            let parent = self.conn.query_tree(window).ok()?.reply().ok()?.parent;
            if parent == self.root || parent == 0 {
                break;
            }
            window = parent;
        }
        let offset = self
            .conn
            .translate_coordinates(xid, window, 0, 0)
            .ok()?
            .reply()
            .ok()?;
        Some((window, offset.dst_x, offset.dst_y))
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            windows: self.windows(),
            active: self.window_property(self.root, self.atoms.active_window),
        }
    }

    pub fn active_window(&self) -> Option<Window> {
        self.window_property(self.root, self.atoms.active_window)
    }

    pub fn rect(&self, xid: Window) -> Option<Rect> {
        let geometry = self.conn.get_geometry(xid).ok()?.reply().ok()?;
        let translated = self
            .conn
            .translate_coordinates(xid, self.root, 0, 0)
            .ok()?
            .reply()
            .ok()?;
        Some(Rect {
            x: f64::from(translated.dst_x),
            y: f64::from(translated.dst_y),
            w: f64::from(geometry.width),
            h: f64::from(geometry.height),
        })
    }

    fn windows(&self) -> Vec<XWindow> {
        let mut clients = self.windows_property(self.root, self.atoms.client_list);
        if clients.is_empty() {
            clients = self
                .conn
                .query_tree(self.root)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
                .map(|reply| reply.children)
                .unwrap_or_default()
                .into_iter()
                .filter(|xid| self.viewable(*xid))
                .collect();
        }
        clients
            .into_iter()
            .filter_map(|xid| self.window(xid))
            .collect()
    }

    fn viewable(&self, xid: Window) -> bool {
        self.conn
            .get_window_attributes(xid)
            .ok()
            .and_then(|cookie| cookie.reply().ok())
            .is_some_and(|attributes| attributes.map_state == MapState::VIEWABLE)
    }

    fn window(&self, xid: Window) -> Option<XWindow> {
        let rect = self.rect(xid)?;
        if rect.w <= 0.0 || rect.h <= 0.0 {
            return None;
        }
        Some(XWindow {
            xid,
            pid: self.window_property(xid, self.atoms.wm_pid),
            title: self
                .window_text(xid, self.atoms.wm_name)
                .or_else(|| self.window_text(xid, AtomEnum::WM_NAME.into()))
                .unwrap_or_default(),
            rect,
            hidden: self
                .window_atoms(xid, self.atoms.wm_state)
                .contains(&self.atoms.wm_state_hidden),
        })
    }

    fn window_property(&self, window: Window, property: Atom) -> Option<u32> {
        self.property(window, property, AtomEnum::ANY)
            .and_then(|value| value.into_iter().next())
    }

    fn windows_property(&self, window: Window, property: Atom) -> Vec<u32> {
        self.property(window, property, AtomEnum::WINDOW)
            .unwrap_or_default()
    }

    fn window_atoms(&self, window: Window, property: Atom) -> Vec<Atom> {
        self.property(window, property, AtomEnum::ATOM)
            .unwrap_or_default()
    }

    fn property(&self, window: Window, property: Atom, kind: AtomEnum) -> Option<Vec<u32>> {
        let reply = self
            .conn
            .get_property(false, window, property, kind, 0, 4096)
            .ok()?
            .reply()
            .ok()?;
        Some(reply.value32()?.collect())
    }

    fn window_text(&self, window: Window, property: Atom) -> Option<String> {
        let reply = self
            .conn
            .get_property(false, window, property, AtomEnum::ANY, 0, 4096)
            .ok()?
            .reply()
            .ok()?;
        let text = String::from_utf8_lossy(&reply.value)
            .trim_end_matches('\0')
            .trim()
            .to_string();
        (!text.is_empty()).then_some(text)
    }

    pub fn activate(&mut self, xid: Window) -> Result<(), String> {
        let event = ClientMessageEvent {
            response_type: x11rb::protocol::xproto::CLIENT_MESSAGE_EVENT,
            format: 32,
            sequence: 0,
            window: xid,
            type_: self.atoms.active_window,
            data: ClientMessageData::from([2, x11rb::CURRENT_TIME, 0, 0, 0]),
        };
        self.conn
            .send_event(
                false,
                self.root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            )
            .map_err(|error| {
                format!("could not ask the window manager to activate the window: {error}")
            })?;
        self.conn
            .flush()
            .map_err(|error| format!("could not flush X11: {error}"))?;
        for _ in 0..100 {
            if self.active_window() == Some(xid) && self.focused(xid) {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        Err("the window manager did not activate and focus the window".to_string())
    }

    fn focused(&self, xid: Window) -> bool {
        let Some(mut window) = self.input_focus() else {
            return false;
        };
        for _ in 0..16 {
            if window == xid {
                return true;
            }
            let Some(parent) = self
                .conn
                .query_tree(window)
                .ok()
                .and_then(|cookie| cookie.reply().ok())
                .map(|reply| reply.parent)
            else {
                return false;
            };
            if parent == 0 || parent == self.root {
                return false;
            }
            window = parent;
        }
        false
    }

    fn input_focus(&self) -> Option<Window> {
        self.conn
            .get_input_focus()
            .ok()?
            .reply()
            .ok()
            .map(|reply| reply.focus)
    }

    pub fn click(&self, x: f64, y: f64) -> Result<(), String> {
        self.move_pointer(x, y)?;
        self.fake_input(x11rb::protocol::xproto::BUTTON_PRESS_EVENT, 1, 0, 0)?;
        self.fake_input(x11rb::protocol::xproto::BUTTON_RELEASE_EVENT, 1, 0, 0)
    }

    pub fn scroll(&self, x: f64, y: f64, dx: f64, dy: f64) -> Result<(), String> {
        self.move_pointer(x, y)?;
        let (button, distance) = wheel(dx, dy);
        for _ in 0..wheel_clicks(distance) {
            self.fake_input(x11rb::protocol::xproto::BUTTON_PRESS_EVENT, button, 0, 0)?;
            self.fake_input(x11rb::protocol::xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?;
        }
        Ok(())
    }

    pub fn move_pointer(&self, x: f64, y: f64) -> Result<(), String> {
        let (x, y) = (
            x.round().clamp(0.0, 32767.0) as i16,
            y.round().clamp(0.0, 32767.0) as i16,
        );
        self.fake_input(x11rb::protocol::xproto::MOTION_NOTIFY_EVENT, 0, x, y)
    }

    fn fake_input(&self, kind: u8, detail: u8, x: i16, y: i16) -> Result<(), String> {
        self.conn
            .xtest_fake_input(kind, detail, x11rb::CURRENT_TIME, self.root, x, y, 0)
            .map_err(|error| format!("XTEST is unavailable: {error}"))?
            .check()
            .map_err(|error| format!("XTEST input failed: {error}"))
    }

    pub fn type_keys(&mut self, spec: &str) -> Result<(), String> {
        let strokes = self.strokes(spec)?;
        for stroke in &strokes {
            for keycode in &stroke.modifiers {
                self.fake_input(x11rb::protocol::xproto::KEY_PRESS_EVENT, *keycode, 0, 0)?;
            }
            self.fake_input(x11rb::protocol::xproto::KEY_PRESS_EVENT, stroke.key, 0, 0)?;
            self.fake_input(x11rb::protocol::xproto::KEY_RELEASE_EVENT, stroke.key, 0, 0)?;
            for keycode in stroke.modifiers.iter().rev() {
                self.fake_input(x11rb::protocol::xproto::KEY_RELEASE_EVENT, *keycode, 0, 0)?;
            }
        }
        Ok(())
    }

    pub fn type_text(&mut self, text: &str) -> Result<(), String> {
        let shift = self
            .keymap()?
            .keysyms
            .get(&keys::SHIFT)
            .map(|(keycode, _)| *keycode);
        let mut remapped: Vec<u8> = Vec::new();
        let mut outcome = Ok(());
        for character in text.chars() {
            match self.key_for(keys::character(character), &mut remapped) {
                Ok((keycode, shifted, remapped_key)) => {
                    let shift = shift.filter(|_| shifted);
                    if let Err(error) = self.tap(keycode, shift) {
                        outcome = Err(error);
                        break;
                    }
                    if remapped_key {
                        std::thread::sleep(REMAP_SETTLE);
                    }
                }
                Err(error) => {
                    outcome = Err(error);
                    break;
                }
            }
        }
        if !remapped.is_empty() {
            std::thread::sleep(REMAP_SETTLE);
        }
        let restored = self.restore(&remapped);
        outcome.and(restored)
    }

    fn tap(&self, keycode: u8, shift: Option<u8>) -> Result<(), String> {
        if let Some(shift) = shift {
            self.fake_input(x11rb::protocol::xproto::KEY_PRESS_EVENT, shift, 0, 0)?;
        }
        self.fake_input(x11rb::protocol::xproto::KEY_PRESS_EVENT, keycode, 0, 0)?;
        self.fake_input(x11rb::protocol::xproto::KEY_RELEASE_EVENT, keycode, 0, 0)?;
        if let Some(shift) = shift {
            self.fake_input(x11rb::protocol::xproto::KEY_RELEASE_EVENT, shift, 0, 0)?;
        }
        Ok(())
    }

    fn key_for(&mut self, keysym: u32, remapped: &mut Vec<u8>) -> Result<(u8, bool, bool), String> {
        if let Some((keycode, shifted)) = self.keymap()?.keysyms.get(&keysym).copied() {
            return Ok((keycode, shifted, false));
        }
        let keycode = self
            .keymap()?
            .spare
            .ok_or_else(|| "the keyboard has no spare keycode for this character".to_string())?;
        self.remap(keycode, &[keysym])?;
        std::thread::sleep(REMAP_SETTLE);
        remapped.push(keycode);
        Ok((keycode, false, true))
    }

    fn remap(&mut self, keycode: u8, keysyms: &[u32]) -> Result<(), String> {
        let width = usize::from(self.keymap()?.width).max(1);
        let mut values = vec![0u32; width];
        for (slot, keysym) in values.iter_mut().zip(keysyms) {
            *slot = *keysym;
        }
        self.conn
            .change_keyboard_mapping(1, keycode, u8::try_from(width).unwrap_or(u8::MAX), &values)
            .map_err(|error| format!("could not remap a key: {error}"))?
            .check()
            .map_err(|error| format!("could not remap a key: {error}"))?;
        self.conn
            .sync()
            .map_err(|error| format!("could not flush the keyboard map: {error}"))
    }

    fn restore(&mut self, keycodes: &[u8]) -> Result<(), String> {
        let mut outcome = Ok(());
        for keycode in keycodes {
            if let Err(error) = self.remap(*keycode, &[]) {
                outcome = Err(error);
            }
        }
        if !keycodes.is_empty() {
            let _ = self.conn.sync();
        }
        outcome
    }

    fn strokes(&mut self, spec: &str) -> Result<Vec<Stroke>, String> {
        let map = &self.keymap()?.keysyms;
        let shift = lookup(map, keys::SHIFT).map(|(keycode, _)| keycode);
        let mut strokes = Vec::new();
        for combo in spec.split_whitespace() {
            let mut modifiers = Vec::new();
            let mut key = None;
            for token in combo.split('+').filter(|token| !token.is_empty()) {
                match keys::modifier(token) {
                    Some(keysym) => {
                        let (keycode, _) = lookup(map, keysym)
                            .ok_or_else(|| format!("the keyboard has no {token} key"))?;
                        modifiers.push(keycode);
                    }
                    None => key = Some(lookup_key(map, token)?),
                }
            }
            let (keycode, shifted) = key.ok_or_else(|| format!("{combo:?} names no key"))?;
            if shifted
                && let Some(shift) = shift
                && !modifiers.contains(&shift)
            {
                modifiers.push(shift);
            }
            strokes.push(Stroke {
                modifiers,
                key: keycode,
            });
        }
        if strokes.is_empty() {
            return Err("no keys were given".to_string());
        }
        Ok(strokes)
    }

    fn keymap(&mut self) -> Result<&Keymap, String> {
        if self.keymap.is_none() {
            self.keymap = Some(self.build_keymap()?);
        }
        self.keymap
            .as_ref()
            .ok_or_else(|| "keyboard map is unavailable".to_string())
    }

    fn build_keymap(&self) -> Result<Keymap, String> {
        let setup = self.conn.setup();
        let first = setup.min_keycode;
        let count = setup.max_keycode.saturating_sub(first).saturating_add(1);
        let reply = self
            .conn
            .get_keyboard_mapping(first, count)
            .map_err(|error| format!("could not read the keyboard map: {error}"))?
            .reply()
            .map_err(|error| format!("could not read the keyboard map: {error}"))?;
        let width = usize::from(reply.keysyms_per_keycode).max(1);
        let mut keysyms = HashMap::new();
        let mut spare = None;
        for (index, row) in reply.keysyms.chunks(width).enumerate() {
            let keycode = first.saturating_add(index as u8);
            let mut used = false;
            for (level, keysym) in row.iter().enumerate() {
                if *keysym != 0 {
                    used = true;
                    keysyms.entry(*keysym).or_insert((keycode, level % 2 == 1));
                }
            }
            if !used && spare.is_none() {
                spare = Some(keycode);
            }
        }
        Ok(Keymap {
            keysyms,
            spare,
            width: u8::try_from(width).unwrap_or(u8::MAX),
        })
    }
}

fn wheel(dx: f64, dy: f64) -> (u8, f64) {
    if dy.abs() >= dx.abs() && dy.abs() > f64::EPSILON {
        (if dy < 0.0 { 4 } else { 5 }, dy.abs())
    } else if dx.abs() > f64::EPSILON {
        (if dx < 0.0 { 6 } else { 7 }, dx.abs())
    } else {
        (5, 0.0)
    }
}

fn wheel_clicks(distance: f64) -> u8 {
    (distance / WHEEL_STEP).round().clamp(1.0, MAX_WHEEL_CLICKS) as u8
}

struct Stroke {
    modifiers: Vec<u8>,
    key: u8,
}

fn lookup_key(map: &HashMap<u32, (u8, bool)>, token: &str) -> Result<(u8, bool), String> {
    if let Some(keysym) = keys::named(token) {
        return lookup(map, keysym).ok_or_else(|| format!("the keyboard has no {token} key"));
    }
    let mut chars = token.chars();
    let character = chars.next().ok_or_else(|| "empty key name".to_string())?;
    if chars.next().is_some() {
        return Err(format!("{token:?} is not a key name"));
    }
    let keysym = character as u32;
    if let Some(found) = lookup(map, keysym) {
        return Ok(found);
    }
    let alternate = if character.is_ascii_lowercase() {
        character.to_ascii_uppercase() as u32
    } else if character.is_ascii_uppercase() {
        character.to_ascii_lowercase() as u32
    } else {
        keysym
    };
    lookup(map, alternate)
        .map(|(keycode, shifted)| (keycode, !shifted))
        .ok_or_else(|| format!("the keyboard cannot type {token:?}"))
}

fn lookup(map: &HashMap<u32, (u8, bool)>, keysym: u32) -> Option<(u8, bool)> {
    map.get(&keysym).copied()
}

pub(crate) fn intern(conn: &RustConnection, name: &str) -> Result<Atom, String> {
    let cookie = conn
        .intern_atom(false, name.as_bytes())
        .map_err(|error| format!("could not intern {name}: {error}"))?;
    let reply = cookie
        .reply()
        .map_err(|error| format!("could not intern {name}: {error}"))?;
    Ok(reply.atom)
}

fn same_pid(window: &XWindow, pid: Option<u32>) -> bool {
    pid.is_some() && window.pid == pid
}
