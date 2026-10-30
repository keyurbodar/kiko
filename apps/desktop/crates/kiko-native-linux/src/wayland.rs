use std::path::PathBuf;

use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions};
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use ashpd::desktop::{PersistMode, ResponseError, Session};
use ashpd::enumflags2::BitFlags;
use kiko_driver::{DriverError, Image, Rect};

use crate::capture;
use crate::error::{denied, failed};
use crate::frames::Frames;
use crate::keys;

const LEFT_BUTTON: i32 = 0x110;
const WHEEL_STEP: f64 = 50.0;
const MAX_WHEEL_STEPS: f64 = 20.0;

pub(crate) struct Wayland {
    stored: Stored,
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
struct Stored {
    token: Option<String>,
}

impl Wayland {
    pub fn new() -> Self {
        Self {
            stored: read_stored(),
            capture: None,
            input: None,
        }
    }

    pub fn shared(&self) -> bool {
        self.capture.is_some() || self.stored.token.is_some()
    }

    pub async fn request(&mut self) -> Result<(), DriverError> {
        self.capture_session().await.map(|_| ())
    }

    pub async fn capture(&mut self, covers: Rect, max_width: u32) -> Result<Image, DriverError> {
        let capture = self.capture_session().await?;
        let frame = capture
            .frames
            .latest()
            .ok_or_else(|| failed("the shared window has not sent a picture yet"))?;
        capture::encode(frame.to_rgb()?, max_width, covers)
    }

    pub async fn key(&mut self, keysym: u32, pressed: bool) -> Result<(), DriverError> {
        let input = self.input_session().await?;
        let state = if pressed {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        input
            .remote
            .notify_keyboard_keysym(&input.session, keysym as i32, state, Default::default())
            .await
            .map_err(|error| failed(format!("could not send the key: {error}")))
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
        input
            .remote
            .notify_pointer_motion_absolute(&input.session, input.stream, x, y, Default::default())
            .await
            .map_err(|error| failed(format!("could not move the pointer: {error}")))
    }

    pub async fn button(&mut self, pressed: bool) -> Result<(), DriverError> {
        let input = self.input_session().await?;
        let state = if pressed {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        input
            .remote
            .notify_pointer_button(&input.session, LEFT_BUTTON, state, Default::default())
            .await
            .map_err(|error| failed(format!("could not press the pointer: {error}")))
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
        input
            .remote
            .notify_pointer_axis_discrete(&input.session, axis, steps, Default::default())
            .await
            .map_err(|error| failed(format!("could not scroll: {error}")))
    }

    async fn capture_session(&mut self) -> Result<&mut Capture, DriverError> {
        if self.capture.is_none() {
            self.capture = Some(self.open_capture().await?);
        }
        self.capture
            .as_mut()
            .ok_or_else(|| failed("the screen sharing session is unavailable"))
    }

    async fn input_session(&mut self) -> Result<&mut Input, DriverError> {
        if self.input.is_none() {
            self.input = Some(self.open_input().await?);
        }
        self.input
            .as_mut()
            .ok_or_else(|| failed("the remote control session is unavailable"))
    }

    async fn open_capture(&mut self) -> Result<Capture, DriverError> {
        let screencast = Screencast::new()
            .await
            .map_err(|error| portal_error("the ScreenCast portal is unavailable", error))?;
        let session = screencast
            .create_session(Default::default())
            .await
            .map_err(|error| portal_error("could not open a screen sharing session", error))?;
        screencast
            .select_sources(
                &session,
                SelectSourcesOptions::default()
                    .set_sources(BitFlags::from(SourceType::Window))
                    .set_multiple(false)
                    .set_cursor_mode(CursorMode::Hidden)
                    .set_persist_mode(PersistMode::ExplicitlyRevoked)
                    .set_restore_token(self.stored.token.as_deref()),
            )
            .await
            .map_err(|error| portal_error("could not ask for a window", error))?
            .response()
            .map_err(|error| portal_error("could not select a window", error))?;
        let streams = screencast
            .start(&session, None, Default::default())
            .await
            .map_err(|error| portal_error("could not start screen sharing", error))?
            .response()
            .map_err(|error| portal_error("the owner did not share a window", error))?;
        let stream = streams
            .streams()
            .first()
            .ok_or_else(|| failed("the portal shared no window"))?;
        let node = stream.pipe_wire_node_id();
        self.remember(streams.restore_token());
        let fd = screencast
            .open_pipe_wire_remote(&session, Default::default())
            .await
            .map_err(|error| portal_error("could not read the shared window", error))?;
        Ok(Capture {
            frames: Frames::start(fd, node)?,
        })
    }

    async fn open_input(&mut self) -> Result<Input, DriverError> {
        let remote = RemoteDesktop::new()
            .await
            .map_err(|error| portal_error("the RemoteDesktop portal is unavailable", error))?;
        let screencast = Screencast::new()
            .await
            .map_err(|error| portal_error("the ScreenCast portal is unavailable", error))?;
        let session = remote
            .create_session(Default::default())
            .await
            .map_err(|error| portal_error("could not open a remote control session", error))?;
        remote
            .select_devices(
                &session,
                SelectDevicesOptions::default()
                    .set_devices(DeviceType::Keyboard | DeviceType::Pointer),
            )
            .await
            .map_err(|error| portal_error("could not ask for input devices", error))?
            .response()
            .map_err(|error| portal_error("could not select input devices", error))?;
        screencast
            .select_sources(
                &session,
                SelectSourcesOptions::default()
                    .set_sources(BitFlags::from(SourceType::Window))
                    .set_multiple(false)
                    .set_cursor_mode(CursorMode::Hidden),
            )
            .await
            .map_err(|error| portal_error("could not ask for a window to control", error))?
            .response()
            .map_err(|error| portal_error("could not select a window to control", error))?;
        let selected = remote
            .start(&session, None, Default::default())
            .await
            .map_err(|error| portal_error("could not start remote control", error))?
            .response()
            .map_err(|error| portal_error("the owner did not allow remote control", error))?;
        let stream = selected
            .streams()
            .first()
            .ok_or_else(|| failed("the portal shared no window to control"))?
            .pipe_wire_node_id();
        Ok(Input {
            remote,
            session,
            stream,
        })
    }

    fn remember(&mut self, token: Option<&str>) {
        let Some(token) = token else {
            return;
        };
        self.stored.token = Some(token.to_string());
        write_stored(&self.stored);
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

fn stored_path() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("kiko").join("screencast-token")
}

fn read_stored() -> Stored {
    let Ok(text) = std::fs::read_to_string(stored_path()) else {
        return Stored::default();
    };
    Stored {
        token: text
            .lines()
            .next()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(str::to_string),
    }
}

fn write_stored(stored: &Stored) {
    let path = stored_path();
    let Some(directory) = path.parent() else {
        return;
    };
    if std::fs::create_dir_all(directory).is_err() {
        return;
    }
    let text = format!("{}\n", stored.token.as_deref().unwrap_or_default());
    let _ = std::fs::write(path, text);
}
