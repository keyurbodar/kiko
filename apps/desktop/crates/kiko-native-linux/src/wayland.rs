use std::ffi::OsString;
use std::future::Future;
use std::io::Write as _;
use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions};
use ashpd::desktop::screencast::{
    CursorMode, Screencast, SelectSourcesOptions, SourceType, Stream, Streams,
};
use ashpd::desktop::{PersistMode, ResponseError, Session, SessionPortal};
use ashpd::enumflags2::BitFlags;
use futures_util::StreamExt as _;
use kiko_driver::{DriverError, ErrorCode, Image, Rect};

use crate::capture;
use crate::error::{denied, failed, timeout};
use crate::frames::Frames;
use crate::keys;

const LEFT_BUTTON: i32 = 0x110;
const WHEEL_STEP: f64 = 50.0;
const MAX_WHEEL_STEPS: f64 = 20.0;
const RESTORE_BUDGET: Duration = Duration::from_secs(5);
const PORTAL_BUDGET: Duration = Duration::from_secs(5);
const CALL_BUDGET: Duration = Duration::from_secs(5);
const CLOSE_BUDGET: Duration = Duration::from_secs(1);
const COVER_SLACK: f64 = 64.0;
const TOKEN_DIR: u32 = 0o700;
const TOKEN_FILE: u32 = 0o600;
const SCREEN_HINT: &str =
    "ask the owner to allow screen capture from the Screen Recording row of the kiko menu";
const INPUT_HINT: &str =
    "ask the owner to allow remote control from the Remote Control row of the kiko menu";
const SCREEN_CANCEL: &str = "the owner cancelled the screen sharing dialog";
const INPUT_CANCEL: &str = "the owner cancelled the remote control dialog";

pub(crate) struct Wayland {
    tokens: Tokens,
    capture: Option<Capture>,
    input: Option<Input>,
}

struct Capture {
    session: Arc<Session<Screencast>>,
    frames: Frames,
    closed: Arc<AtomicBool>,
    cover: Cover,
}

#[derive(Clone, Debug)]
struct Cover {
    mapping: Option<String>,
    position: Option<(i32, i32)>,
    size: Option<(i32, i32)>,
}

impl Cover {
    fn of(stream: &Stream) -> Self {
        Self {
            mapping: stream.mapping_id().map(str::to_string),
            position: stream.position(),
            size: stream.size(),
        }
    }

    fn matches(&self, window: Rect) -> bool {
        let Some((width, height)) = self.size else {
            return false;
        };
        (f64::from(width) - window.w).abs() <= COVER_SLACK
            && (f64::from(height) - window.h).abs() <= COVER_SLACK
    }

    fn describe(&self) -> String {
        let size = self
            .size
            .map(|(width, height)| format!("{width}x{height}"))
            .unwrap_or_else(|| "an unknown size".to_string());
        let position = self
            .position
            .map(|(x, y)| format!(" at {x},{y}"))
            .unwrap_or_default();
        match self.mapping.as_deref() {
            Some(mapping) => format!("{size}{position}, {mapping}"),
            None => format!("{size}{position}"),
        }
    }
}

impl Capture {
    fn needs_reset(&self) -> bool {
        self.closed.load(Ordering::SeqCst) || self.frames.stopped()
    }
}

struct Input {
    remote: RemoteDesktop,
    session: Session<RemoteDesktop>,
    stream: u32,
}

#[derive(Clone, Default)]
struct Tokens {
    capture: Option<String>,
    input: Option<String>,
}

impl Wayland {
    pub fn new() -> Self {
        Self {
            tokens: Tokens {
                capture: read_token(capture_path().as_deref()),
                input: read_token(input_path().as_deref()),
            },
            capture: None,
            input: None,
        }
    }

    pub fn screen_granted(&self) -> bool {
        self.tokens.capture.is_some()
    }

    pub fn input_granted(&self) -> bool {
        self.tokens.input.is_some()
    }

    pub async fn request_screen(&mut self) -> Result<(), DriverError> {
        let (capture, restore) = open_capture_session(None, None).await?;
        self.reset_capture().await;
        self.remember_capture(restore.as_deref());
        self.capture = Some(capture);
        Ok(())
    }

    pub async fn request_input(&mut self) -> Result<(), DriverError> {
        let (input, restore) = open_input(None, None).await?;
        if let Some(old) = self.input.take() {
            close(&old.session).await;
        }
        self.input = Some(input);
        self.remember_input(restore.as_deref());
        Ok(())
    }

    pub async fn capture(&mut self, covers: Rect, max_width: u32) -> Result<Image, DriverError> {
        let result = self.shot(covers, max_width).await;
        if result.is_ok() || !self.capture.as_ref().is_some_and(Capture::needs_reset) {
            return result;
        }
        self.reset_capture().await;
        self.shot(covers, max_width).await
    }

    async fn shot(&mut self, covers: Rect, max_width: u32) -> Result<Image, DriverError> {
        self.prepare_capture().await?;
        let cover = self
            .capture
            .as_ref()
            .map(|capture| capture.cover.clone())
            .ok_or_else(|| failed("the screen sharing session is unavailable"))?;
        if !cover.matches(covers) {
            return Err(denied(format!(
                "kiko's screen share covers {}, not this window; {SCREEN_HINT}",
                cover.describe()
            )));
        }
        let frame = self.frames().await?.latest()?;
        capture::encode(frame.to_rgb()?, max_width, covers)
    }

    pub async fn key(&mut self, keysym: u32, pressed: bool) -> Result<(), DriverError> {
        let input = self.input_session().await?;
        let state = if pressed {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        portal_call(
            CALL_BUDGET,
            input.remote.notify_keyboard_keysym(
                &input.session,
                keysym as i32,
                state,
                Default::default(),
            ),
            "could not send the key",
            INPUT_CANCEL,
        )
        .await
    }

    pub async fn type_text(&mut self, text: &str) -> Result<(), DriverError> {
        for character in text.chars() {
            let keysym = keys::character(character);
            self.key(keysym, true).await?;
            self.key(keysym, false).await?;
        }
        Ok(())
    }

    pub async fn type_keys(&mut self, spec: &str) -> Result<(), DriverError> {
        for chord in keys::chords(spec).map_err(failed)? {
            for keysym in &chord.modifiers {
                self.key(*keysym, true).await?;
            }
            self.key(chord.key, true).await?;
            self.key(chord.key, false).await?;
            for keysym in chord.modifiers.iter().rev() {
                self.key(*keysym, false).await?;
            }
        }
        Ok(())
    }

    pub async fn motion(&mut self, x: f64, y: f64) -> Result<(), DriverError> {
        let input = self.input_session().await?;
        portal_call(
            CALL_BUDGET,
            input.remote.notify_pointer_motion_absolute(
                &input.session,
                input.stream,
                x,
                y,
                Default::default(),
            ),
            "could not move the pointer",
            INPUT_CANCEL,
        )
        .await
    }

    pub async fn button(&mut self, pressed: bool) -> Result<(), DriverError> {
        let input = self.input_session().await?;
        let state = if pressed {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        portal_call(
            CALL_BUDGET,
            input.remote.notify_pointer_button(
                &input.session,
                LEFT_BUTTON,
                state,
                Default::default(),
            ),
            "could not press the pointer",
            INPUT_CANCEL,
        )
        .await
    }

    pub async fn scroll(&mut self, dx: f64, dy: f64) -> Result<(), DriverError> {
        use ashpd::desktop::remote_desktop::Axis;
        let (axis, distance) = if dy.abs() >= dx.abs() && dy.abs() > f64::EPSILON {
            (Axis::Vertical, dy)
        } else if dx.abs() > f64::EPSILON {
            (Axis::Horizontal, dx)
        } else {
            return Ok(());
        };
        let steps = (distance.abs() / WHEEL_STEP)
            .round()
            .clamp(1.0, MAX_WHEEL_STEPS) as i32;
        let steps = if distance < 0.0 { -steps } else { steps };
        let input = self.input_session().await?;
        portal_call(
            CALL_BUDGET,
            input.remote.notify_pointer_axis_discrete(
                &input.session,
                axis,
                steps,
                Default::default(),
            ),
            "could not scroll",
            INPUT_CANCEL,
        )
        .await
    }

    async fn frames(&mut self) -> Result<&mut Frames, DriverError> {
        self.prepare_capture().await?;
        self.capture
            .as_mut()
            .map(|capture| &mut capture.frames)
            .ok_or_else(|| failed("the screen sharing session is unavailable"))
    }

    async fn prepare_capture(&mut self) -> Result<(), DriverError> {
        if self.capture.as_ref().is_none_or(Capture::needs_reset) {
            self.reset_capture().await;
        }
        if self.capture.is_none() {
            self.ensure_capture().await?;
        }
        Ok(())
    }

    async fn ensure_capture(&mut self) -> Result<(), DriverError> {
        let token =
            self.tokens.capture.clone().ok_or_else(|| {
                denied(format!("kiko has no screen capture grant; {SCREEN_HINT}"))
            })?;
        let (capture, restore) = open_capture_session(Some(&token), Some(RESTORE_BUDGET))
            .await
            .map_err(|error| needs_grant(error, SCREEN_HINT))?;
        self.remember_capture(restore.as_deref());
        self.capture = Some(capture);
        Ok(())
    }

    async fn reset_capture(&mut self) {
        if let Some(capture) = self.capture.take() {
            close(capture.session.as_ref()).await;
        }
    }

    async fn input_session(&mut self) -> Result<&mut Input, DriverError> {
        if self.input.is_none() {
            let token =
                self.tokens.input.clone().ok_or_else(|| {
                    denied(format!("kiko has no remote control grant; {INPUT_HINT}"))
                })?;
            let (input, _) = restore_input(&token).await?;
            self.input = Some(input);
        }
        self.input
            .as_mut()
            .ok_or_else(|| failed("the remote control session is unavailable"))
    }

    fn remember_capture(&mut self, token: Option<&str>) {
        let Some(token) = token else {
            return;
        };
        self.tokens.capture = Some(token.to_string());
        if let Some(path) = capture_path() {
            write_token(&path, token);
        }
    }

    fn remember_input(&mut self, token: Option<&str>) {
        let Some(token) = token else {
            return;
        };
        self.tokens.input = Some(token.to_string());
        if let Some(path) = input_path() {
            write_token(&path, token);
        }
    }
}

async fn open_capture_session(
    token: Option<&str>,
    budget: Option<Duration>,
) -> Result<(Capture, Option<String>), DriverError> {
    let (screencast, session, streams) = open_capture(token, budget).await?;
    let restore = streams.restore_token().map(str::to_string);
    let Some(stream) = streams.streams().first() else {
        close(&session).await;
        return Err(failed("the portal shared no window"));
    };
    let cover = Cover::of(stream);
    let node = stream.pipe_wire_node_id();
    let session = Arc::new(session);
    let closed = watch_closed(&session);
    match read_frames(&screencast, session.as_ref(), node).await {
        Ok(frames) => Ok((
            Capture {
                session,
                frames,
                closed,
                cover,
            },
            restore,
        )),
        Err(error) => {
            close(session.as_ref()).await;
            Err(error)
        }
    }
}

fn watch_closed(session: &Arc<Session<Screencast>>) -> Arc<AtomicBool> {
    let closed = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&closed);
    let session = Arc::clone(session);
    tokio::spawn(async move {
        let Ok(mut stream) = session.receive_closed().await else {
            return;
        };
        if stream.next().await.is_some() {
            flag.store(true, Ordering::SeqCst);
        }
    });
    closed
}

async fn restore_input(token: &str) -> Result<(Input, Option<String>), DriverError> {
    match open_input(Some(token), Some(RESTORE_BUDGET)).await {
        Ok(opened) => Ok(opened),
        Err(error) => Err(needs_grant(error, INPUT_HINT)),
    }
}

async fn open_capture(
    token: Option<&str>,
    budget: Option<Duration>,
) -> Result<(Screencast, Session<Screencast>, Streams), DriverError> {
    let screencast = portal_call(
        PORTAL_BUDGET,
        Screencast::new(),
        "the ScreenCast portal is unavailable",
        SCREEN_CANCEL,
    )
    .await?;
    let session = portal_call(
        PORTAL_BUDGET,
        screencast.create_session(Default::default()),
        "could not open a screen sharing session",
        SCREEN_CANCEL,
    )
    .await?;
    let started = match budget {
        Some(budget) => {
            match tokio::time::timeout(budget, start_capture(&screencast, &session, token)).await {
                Ok(started) => started,
                Err(_) => Err(denied("kiko's screen capture grant needs the owner again")),
            }
        }
        None => start_capture(&screencast, &session, token).await,
    };
    match started {
        Ok(streams) => Ok((screencast, session, streams)),
        Err(error) => {
            close(&session).await;
            Err(error)
        }
    }
}

async fn start_capture(
    screencast: &Screencast,
    session: &Session<Screencast>,
    token: Option<&str>,
) -> Result<Streams, DriverError> {
    screencast
        .select_sources(session, capture_options(token))
        .await
        .map_err(|error| portal_error("could not ask for a window", SCREEN_CANCEL, error))?
        .response()
        .map_err(|error| portal_error("could not select a window", SCREEN_CANCEL, error))?;
    screencast
        .start(session, None, Default::default())
        .await
        .map_err(|error| portal_error("could not start screen sharing", SCREEN_CANCEL, error))?
        .response()
        .map_err(|error| portal_error("the owner did not share a window", SCREEN_CANCEL, error))
}

async fn read_frames(
    screencast: &Screencast,
    session: &Session<Screencast>,
    node: u32,
) -> Result<Frames, DriverError> {
    let fd = portal_call(
        PORTAL_BUDGET,
        screencast.open_pipe_wire_remote(session, Default::default()),
        "could not read the shared window",
        SCREEN_CANCEL,
    )
    .await?;
    Frames::start(fd, node)
}

async fn open_input(
    token: Option<&str>,
    budget: Option<Duration>,
) -> Result<(Input, Option<String>), DriverError> {
    let remote = portal_call(
        PORTAL_BUDGET,
        RemoteDesktop::new(),
        "the RemoteDesktop portal is unavailable",
        INPUT_CANCEL,
    )
    .await?;
    let screencast = portal_call(
        PORTAL_BUDGET,
        Screencast::new(),
        "the ScreenCast portal is unavailable",
        INPUT_CANCEL,
    )
    .await?;
    let session = portal_call(
        PORTAL_BUDGET,
        remote.create_session(Default::default()),
        "could not open a remote control session",
        INPUT_CANCEL,
    )
    .await?;
    let started = match budget {
        Some(budget) => {
            match tokio::time::timeout(budget, start_input(&remote, &screencast, &session, token))
                .await
            {
                Ok(started) => started,
                Err(_) => Err(denied("kiko's remote control grant needs the owner again")),
            }
        }
        None => start_input(&remote, &screencast, &session, token).await,
    };
    match started {
        Ok((stream, restore)) => Ok((
            Input {
                remote,
                session,
                stream,
            },
            restore,
        )),
        Err(error) => {
            close(&session).await;
            Err(error)
        }
    }
}

async fn start_input(
    remote: &RemoteDesktop,
    screencast: &Screencast,
    session: &Session<RemoteDesktop>,
    token: Option<&str>,
) -> Result<(u32, Option<String>), DriverError> {
    remote
        .select_devices(session, input_options(token))
        .await
        .map_err(|error| portal_error("could not ask for input devices", INPUT_CANCEL, error))?
        .response()
        .map_err(|error| portal_error("could not select input devices", INPUT_CANCEL, error))?;
    screencast
        .select_sources(session, capture_options(token))
        .await
        .map_err(|error| {
            portal_error("could not ask for a window to control", INPUT_CANCEL, error)
        })?
        .response()
        .map_err(|error| {
            portal_error("could not select a window to control", INPUT_CANCEL, error)
        })?;
    let selected = remote
        .start(session, None, Default::default())
        .await
        .map_err(|error| portal_error("could not start remote control", INPUT_CANCEL, error))?
        .response()
        .map_err(|error| {
            portal_error(
                "the owner did not allow remote control",
                INPUT_CANCEL,
                error,
            )
        })?;
    let stream = selected
        .streams()
        .first()
        .ok_or_else(|| failed("the portal shared no window to control"))?
        .pipe_wire_node_id();
    Ok((stream, selected.restore_token().map(str::to_string)))
}

fn capture_options(token: Option<&str>) -> SelectSourcesOptions {
    SelectSourcesOptions::default()
        .set_sources(BitFlags::from(SourceType::Window))
        .set_multiple(false)
        .set_cursor_mode(CursorMode::Hidden)
        .set_persist_mode(PersistMode::ExplicitlyRevoked)
        .set_restore_token(token)
}

fn input_options(token: Option<&str>) -> SelectDevicesOptions {
    SelectDevicesOptions::default()
        .set_devices(DeviceType::Keyboard | DeviceType::Pointer)
        .set_persist_mode(PersistMode::ExplicitlyRevoked)
        .set_restore_token(token)
}

async fn close<T: SessionPortal>(session: &Session<T>) {
    let _ = tokio::time::timeout(CLOSE_BUDGET, session.close()).await;
}

async fn portal_call<T>(
    budget: Duration,
    future: impl Future<Output = Result<T, ashpd::Error>>,
    context: &str,
    cancel: &str,
) -> Result<T, DriverError> {
    match tokio::time::timeout(budget, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(portal_error(context, cancel, error)),
        Err(_) => Err(timeout(format!("{context}: the portal did not answer"))),
    }
}

fn needs_grant(error: DriverError, hint: &str) -> DriverError {
    if error.code == ErrorCode::Denied {
        denied(format!("{}; {hint}", error.message))
    } else {
        error
    }
}

fn portal_error(context: &str, cancel: &str, error: ashpd::Error) -> DriverError {
    match error {
        ashpd::Error::Response(ResponseError::Cancelled) => denied(cancel),
        other => failed(format!("{context}: {other}")),
    }
}

fn data_dir() -> Option<PathBuf> {
    data_home(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))
}

fn data_home(xdg: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    let base = xdg
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            home.filter(|value| !value.is_empty())
                .map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join("kiko"))
}

fn capture_path() -> Option<PathBuf> {
    data_dir().map(|directory| directory.join("screencast-token"))
}

fn input_path() -> Option<PathBuf> {
    data_dir().map(|directory| directory.join("remote-desktop-token"))
}

fn read_token(path: Option<&Path>) -> Option<String> {
    let text = std::fs::read_to_string(path?).ok()?;
    text.lines()
        .next()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

fn write_token(path: &Path, token: &str) {
    let Some(directory) = path.parent() else {
        return;
    };
    if std::fs::create_dir_all(directory).is_err() {
        return;
    }
    let _ = std::fs::set_permissions(directory, std::fs::Permissions::from_mode(TOKEN_DIR));
    let temporary = path.with_extension("tmp");
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(TOKEN_FILE)
        .open(&temporary)
        .and_then(|mut file| file.write_all(format!("{token}\n").as_bytes()))
        .and_then(|()| std::fs::rename(&temporary, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return;
    }
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(TOKEN_FILE));
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;
    use std::path::PathBuf;

    use kiko_driver::Rect;

    use super::{Cover, TOKEN_DIR, TOKEN_FILE, data_home, write_token};

    fn cover(size: Option<(i32, i32)>) -> Cover {
        Cover {
            mapping: None,
            position: Some((0, 0)),
            size,
        }
    }

    fn window(w: f64, h: f64) -> Rect {
        Rect {
            x: 0.0,
            y: 0.0,
            w,
            h,
        }
    }

    fn mode(path: &std::path::Path) -> u32 {
        std::fs::metadata(path)
            .expect("the path")
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn a_look_at_the_granted_window_matches() {
        assert!(cover(Some((400, 300))).matches(window(400.0, 300.0)));
        assert!(cover(Some((410, 310))).matches(window(400.0, 300.0)));
    }

    #[test]
    fn a_look_at_another_window_is_refused() {
        assert!(!cover(Some((700, 500))).matches(window(400.0, 300.0)));
    }

    #[test]
    fn a_grant_without_a_size_matches_no_window() {
        assert!(!cover(None).matches(window(400.0, 300.0)));
    }

    #[test]
    fn a_grant_says_what_it_covers() {
        let described = cover(Some((700, 500))).describe();
        assert!(described.contains("700x500"), "{described}");
        assert!(described.contains("0,0"), "{described}");
    }

    #[test]
    fn tokens_live_under_the_data_home() {
        assert_eq!(
            data_home(Some(PathBuf::from("/data").into_os_string()), None),
            Some(PathBuf::from("/data/kiko"))
        );
        assert_eq!(
            data_home(None, Some(PathBuf::from("/home/kiko").into_os_string())),
            Some(PathBuf::from("/home/kiko/.local/share/kiko"))
        );
        assert_eq!(
            data_home(
                Some("".into()),
                Some(PathBuf::from("/home/kiko").into_os_string())
            ),
            Some(PathBuf::from("/home/kiko/.local/share/kiko"))
        );
    }

    #[test]
    fn a_missing_home_leaves_no_place_for_tokens() {
        assert_eq!(data_home(None, None), None);
    }

    #[test]
    fn a_restore_token_is_private_to_its_owner() {
        let directory = std::env::temp_dir().join(format!("kiko-token-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("the token directory");
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755))
            .expect("the loose token directory");
        let path = directory.join("screencast-token");
        std::fs::write(&path, "old\n").expect("the old token");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))
            .expect("the loose token");

        write_token(&path, "secret");

        assert_eq!(mode(&directory), TOKEN_DIR);
        assert_eq!(mode(&path), TOKEN_FILE);
        assert_eq!(
            std::fs::read_to_string(&path).expect("the token"),
            "secret\n"
        );
        assert!(
            !directory.join("screencast-token.tmp").exists(),
            "the temporary token was left behind"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }
}
