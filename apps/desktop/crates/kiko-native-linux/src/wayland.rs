use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions};
use ashpd::desktop::screencast::{
    CursorMode, Screencast, SelectSourcesOptions, SourceType, Streams,
};
use ashpd::desktop::{PersistMode, ResponseError, Session, SessionPortal};
use ashpd::enumflags2::BitFlags;
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
const SCREEN_HINT: &str = "ask the owner to allow screen capture from the kiko menu";
const INPUT_HINT: &str = "ask the owner to allow remote control from the kiko menu";

pub(crate) struct Wayland {
    tokens: Tokens,
    capture: Option<Capture>,
    input: Option<Input>,
}

struct Capture {
    frames: Frames,
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
                capture: read_token(&capture_path()),
                input: read_token(&input_path()),
            },
            capture: None,
            input: None,
        }
    }

    pub fn screen_granted(&self) -> bool {
        self.tokens.capture.is_some()
    }

    pub async fn request(&mut self) -> Result<(), DriverError> {
        let (screencast, session, streams) = open_capture(None, None).await?;
        self.remember_capture(streams.restore_token());
        self.capture = Some(Capture {
            frames: read_frames(&screencast, &session, &streams).await?,
        });
        let (input, token) = open_input(None, None).await?;
        self.remember_input(token.as_deref());
        self.input = Some(input);
        Ok(())
    }

    pub async fn capture(&mut self, covers: Rect, max_width: u32) -> Result<Image, DriverError> {
        let frames = self.frames().await?;
        let frame = frames
            .latest()
            .ok_or_else(|| timeout("the shared window has not sent a picture yet"))?;
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
        )
        .await
    }

    async fn frames(&mut self) -> Result<&mut Frames, DriverError> {
        if self.capture.is_none() {
            let token = self.tokens.capture.clone().ok_or_else(|| {
                denied(format!("kiko has no screen capture grant; {SCREEN_HINT}"))
            })?;
            let (screencast, session, streams) = restore_capture(&token).await?;
            let frames = read_frames(&screencast, &session, &streams).await?;
            self.capture = Some(Capture { frames });
        }
        self.capture
            .as_mut()
            .map(|capture| &mut capture.frames)
            .ok_or_else(|| failed("the screen sharing session is unavailable"))
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
        write_token(&capture_path(), token);
    }

    fn remember_input(&mut self, token: Option<&str>) {
        let Some(token) = token else {
            return;
        };
        self.tokens.input = Some(token.to_string());
        write_token(&input_path(), token);
    }
}

async fn restore_capture(
    token: &str,
) -> Result<(Screencast, Session<Screencast>, Streams), DriverError> {
    match open_capture(Some(token), Some(RESTORE_BUDGET)).await {
        Ok(opened) => Ok(opened),
        Err(error) => Err(needs_grant(error, SCREEN_HINT)),
    }
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
    )
    .await?;
    let session = portal_call(
        PORTAL_BUDGET,
        screencast.create_session(Default::default()),
        "could not open a screen sharing session",
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
        .map_err(|error| portal_error("could not ask for a window", error))?
        .response()
        .map_err(|error| portal_error("could not select a window", error))?;
    screencast
        .start(session, None, Default::default())
        .await
        .map_err(|error| portal_error("could not start screen sharing", error))?
        .response()
        .map_err(|error| portal_error("the owner did not share a window", error))
}

async fn read_frames(
    screencast: &Screencast,
    session: &Session<Screencast>,
    streams: &Streams,
) -> Result<Frames, DriverError> {
    let node = streams
        .streams()
        .first()
        .ok_or_else(|| failed("the portal shared no window"))?
        .pipe_wire_node_id();
    let fd = portal_call(
        PORTAL_BUDGET,
        screencast.open_pipe_wire_remote(session, Default::default()),
        "could not read the shared window",
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
    )
    .await?;
    let screencast = portal_call(
        PORTAL_BUDGET,
        Screencast::new(),
        "the ScreenCast portal is unavailable",
    )
    .await?;
    let session = portal_call(
        PORTAL_BUDGET,
        remote.create_session(Default::default()),
        "could not open a remote control session",
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
        .map_err(|error| portal_error("could not ask for input devices", error))?
        .response()
        .map_err(|error| portal_error("could not select input devices", error))?;
    screencast
        .select_sources(session, capture_options(token))
        .await
        .map_err(|error| portal_error("could not ask for a window to control", error))?
        .response()
        .map_err(|error| portal_error("could not select a window to control", error))?;
    let selected = remote
        .start(session, None, Default::default())
        .await
        .map_err(|error| portal_error("could not start remote control", error))?
        .response()
        .map_err(|error| portal_error("the owner did not allow remote control", error))?;
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
) -> Result<T, DriverError> {
    match tokio::time::timeout(budget, future).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(portal_error(context, error)),
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

fn portal_error(context: &str, error: ashpd::Error) -> DriverError {
    match error {
        ashpd::Error::Response(ResponseError::Cancelled) => {
            denied("the owner cancelled the screen sharing dialog")
        }
        other => failed(format!("{context}: {other}")),
    }
}

fn data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("kiko")
}

fn capture_path() -> PathBuf {
    data_dir().join("screencast-token")
}

fn input_path() -> PathBuf {
    data_dir().join("remote-desktop-token")
}

fn read_token(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
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
    let _ = std::fs::write(path, format!("{token}\n"));
}
