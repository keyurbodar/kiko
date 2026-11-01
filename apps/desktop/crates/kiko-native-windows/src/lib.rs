#![cfg(windows)]

mod capture;
mod hwnd;
mod input;
mod keys;
mod uia;

use kiko_driver::api::{
    ActParams, ActResult, Action, DriverError, ErrorCode, Grant, Look, LookParams, Mode,
    OpenParams, OpenTarget, PermissionKind, Permissions, Point, Route,
};
use kiko_driver::{Native, Result, outline};

use uia::Outcome;

const DEFAULT_MAX_WIDTH: u32 = 1280;

pub fn driver() -> Result<Box<dyn Native>> {
    hwnd::claim_per_monitor_v2();
    Ok(Box::new(WindowsDriver {
        uia: uia::Uia::new()?,
    }))
}

struct WindowsDriver {
    uia: uia::Uia,
}

impl Native for WindowsDriver {
    fn permissions(&self) -> Permissions {
        Permissions {
            accessibility: Grant::Granted,
            screen: if capture::supported() {
                Grant::Granted
            } else {
                Grant::Unknown
            },
            automation: Grant::NotNeeded,
        }
    }

    fn request_permission(&mut self, _: PermissionKind) -> Result<()> {
        Ok(())
    }

    fn windows(&mut self) -> Result<Vec<kiko_driver::api::Window>> {
        Ok(hwnd::list())
    }

    fn look(&mut self, params: &LookParams) -> Result<Look> {
        let window = self.window(&params.window)?;
        let handle = hwnd::parse_id(&params.window)?;
        let nodes = if params.tree {
            self.uia.look(handle, window.frame)?
        } else {
            Vec::new()
        };
        let image = if params.image && !window.minimized {
            capture::capture(
                handle,
                window.frame,
                params.max_width.unwrap_or(DEFAULT_MAX_WIDTH),
            )
        } else {
            None
        };
        Ok(Look {
            outline: outline(&nodes),
            window,
            image,
            nodes,
        })
    }

    fn act(&mut self, params: &ActParams) -> Result<ActResult> {
        let handle = hwnd::parse_id(&params.window)?;
        if !hwnd::exists(handle) {
            return Err(DriverError::new(
                ErrorCode::NotFound,
                format!("no window {}", params.window),
            ));
        }
        match params.mode {
            Mode::Background => self.act_background(handle, params),
            Mode::Foreground => self.act_foreground(handle, params),
        }
    }

    fn open(&mut self, params: &OpenParams) -> Result<()> {
        let target = match &params.target {
            OpenTarget::App(app) => app.clone(),
            OpenTarget::Url(url) => url.clone(),
            OpenTarget::Path(path) => path.clone(),
        };
        let show = match params.mode {
            Mode::Background => input::SW_SHOW_NO_ACTIVATE,
            Mode::Foreground => input::SW_SHOW_NORMAL,
        };
        input::shell_open(&target, show)
    }
}

impl WindowsDriver {
    fn window(&self, id: &str) -> Result<kiko_driver::api::Window> {
        let handle = hwnd::parse_id(id)?;
        hwnd::info(handle)
            .ok_or_else(|| DriverError::new(ErrorCode::NotFound, format!("no window {id}")))
    }

    fn act_background(&self, handle: isize, params: &ActParams) -> Result<ActResult> {
        if let Some(point) = params.point {
            if params.action != Action::Press {
                return Err(DriverError::new(
                    ErrorCode::BackgroundUnavailable,
                    "only press can use a point in the background; retry with mode foreground",
                ));
            }
            let frame = hwnd::frame(handle)
                .ok_or_else(|| DriverError::new(ErrorCode::NotFound, "the window is gone"))?;
            return Ok(ActResult {
                route: input::post_click(handle, frame, point)?,
            });
        }
        if params.reference.is_none() {
            return self.act_without_ref(handle, params);
        }
        let reference = params.reference.unwrap_or_default();
        let outcome = self.uia.act(uia::ActRequest {
            window: handle,
            reference,
            action: params.action,
            text: params.text.as_deref(),
            dx: params.dx,
            dy: params.dy,
            mode: Mode::Background,
        })?;
        match outcome {
            Outcome::Route(route) => Ok(ActResult { route }),
            Outcome::Native {
                hwnd: native,
                screen,
            } => self.deliver_native(handle, native, screen, params),
            Outcome::Text { hwnd: native, text } => Ok(ActResult {
                route: input::post_set_text(native, &text)?,
            }),
            Outcome::Pointer { .. } => Err(DriverError::new(
                ErrorCode::BackgroundUnavailable,
                "this action needs the screen; retry with mode foreground",
            )),
        }
    }

    fn act_without_ref(&self, handle: isize, params: &ActParams) -> Result<ActResult> {
        let route = match params.action {
            Action::Key => input::post_keys(handle, &keys::parse(params.keys.as_deref())?)?,
            Action::Type => input::post_text(handle, params.text.as_deref().unwrap_or_default())?,
            _ => {
                return Err(DriverError::new(
                    ErrorCode::Unsupported,
                    "background actions need a ref or a point",
                ));
            }
        };
        Ok(ActResult { route })
    }

    fn deliver_native(
        &self,
        handle: isize,
        native: isize,
        screen: Point,
        params: &ActParams,
    ) -> Result<ActResult> {
        let route = match params.action {
            Action::Key => input::post_keys(native, &keys::parse(params.keys.as_deref())?)?,
            Action::Type => input::post_text(native, params.text.as_deref().unwrap_or_default())?,
            _ => input::post_click_screen(handle, screen)?,
        };
        Ok(ActResult { route })
    }

    fn act_foreground(&self, handle: isize, params: &ActParams) -> Result<ActResult> {
        input::foreground_window(handle)?;
        if params.action == Action::Raise {
            return Ok(ActResult {
                route: Route::Foreground,
            });
        }
        if let Some(point) = params.point {
            let frame = hwnd::frame(handle)
                .ok_or_else(|| DriverError::new(ErrorCode::NotFound, "the window is gone"))?;
            let screen = Point {
                x: frame.x + point.x,
                y: frame.y + point.y,
            };
            match params.action {
                Action::Scroll => input::foreground_wheel(screen, params.dx, params.dy)?,
                Action::ShowMenu => input::foreground_right_click(screen)?,
                Action::Key => input::foreground_keys(&keys::parse(params.keys.as_deref())?)?,
                Action::Type => {
                    input::foreground_click(screen)?;
                    input::foreground_text(params.text.as_deref().unwrap_or_default())?;
                }
                _ => input::foreground_click(screen)?,
            }
            return Ok(ActResult {
                route: Route::Foreground,
            });
        }
        let Some(reference) = params.reference else {
            match params.action {
                Action::Key => input::foreground_keys(&keys::parse(params.keys.as_deref())?)?,
                Action::Type => input::foreground_text(params.text.as_deref().unwrap_or_default())?,
                _ => {
                    return Err(DriverError::new(
                        ErrorCode::Unsupported,
                        "foreground actions need a ref or a point",
                    ));
                }
            }
            return Ok(ActResult {
                route: Route::Foreground,
            });
        };
        let outcome = self.uia.act(uia::ActRequest {
            window: handle,
            reference,
            action: params.action,
            text: params.text.as_deref(),
            dx: params.dx,
            dy: params.dy,
            mode: Mode::Foreground,
        })?;
        match outcome {
            Outcome::Route(route) => Ok(ActResult { route }),
            Outcome::Pointer { screen } => {
                self.pointer_action(screen, params)?;
                Ok(ActResult {
                    route: Route::Foreground,
                })
            }
            Outcome::Native { .. } | Outcome::Text { .. } => Err(DriverError::new(
                ErrorCode::Failed,
                "the accessibility call returned a background route in foreground mode",
            )),
        }
    }

    fn pointer_action(&self, screen: Point, params: &ActParams) -> Result<()> {
        match params.action {
            Action::ShowMenu => input::foreground_right_click(screen),
            Action::Scroll => input::foreground_wheel(screen, params.dx, params.dy),
            Action::Key => input::foreground_keys(&keys::parse(params.keys.as_deref())?),
            Action::Type => {
                input::foreground_click(screen)?;
                input::foreground_text(params.text.as_deref().unwrap_or_default())
            }
            Action::SetValue => {
                input::foreground_click(screen)?;
                input::foreground_select_all()?;
                input::foreground_text(params.text.as_deref().unwrap_or_default())
            }
            _ => input::foreground_click(screen),
        }
    }
}
