use kiko_driver::{
    ActParams, ActResult, Browser, DriverError, ErrorCode, Grant, Look, LookParams, Native,
    OpenParams, Permissions, Result, Unavailable, Window,
};

pub type SharedDriver = std::sync::Arc<std::sync::Mutex<Driver>>;

pub struct Driver {
    pub native: Box<dyn Native>,
    pub browser: Box<dyn Browser>,
}

impl Driver {
    pub fn build() -> Self {
        Self {
            native: native(),
            browser: browser(),
        }
    }
}

fn unsupported(what: &str) -> DriverError {
    DriverError::new(
        ErrorCode::Unsupported,
        format!("no {what} driver on this computer"),
    )
}

pub struct NoNative;

impl Native for NoNative {
    fn permissions(&self) -> Permissions {
        Permissions {
            accessibility: Grant::Unknown,
            screen: Grant::Unknown,
            automation: Grant::Unknown,
        }
    }

    fn request_permission(&mut self, _: kiko_driver::PermissionKind) -> Result<()> {
        Err(unsupported("native"))
    }

    fn windows(&mut self) -> Result<Vec<Window>> {
        Err(unsupported("native"))
    }

    fn look(&mut self, _: &LookParams) -> Result<Look> {
        Err(unsupported("native"))
    }

    fn act(&mut self, _: &ActParams) -> Result<ActResult> {
        Err(unsupported("native"))
    }

    fn open(&mut self, _: &OpenParams) -> Result<()> {
        Err(unsupported("native"))
    }
}

#[cfg(not(feature = "drivers"))]
fn native() -> Box<dyn Native> {
    Box::new(NoNative)
}

#[cfg(not(feature = "drivers"))]
fn browser() -> Box<dyn Browser> {
    Box::new(Unavailable)
}

#[cfg(feature = "drivers")]
fn native() -> Box<dyn Native> {
    match platform_native() {
        Ok(native) => native,
        Err(error) => {
            crate::log::line(format!("native driver unavailable: {error}"));
            Box::new(NoNative)
        }
    }
}

#[cfg(all(feature = "drivers", target_os = "macos"))]
fn platform_native() -> Result<Box<dyn Native>> {
    kiko_native_macos::driver()
}

#[cfg(all(feature = "drivers", target_os = "windows"))]
fn platform_native() -> Result<Box<dyn Native>> {
    kiko_native_windows::driver()
}

#[cfg(all(feature = "drivers", target_os = "linux"))]
fn platform_native() -> Result<Box<dyn Native>> {
    kiko_native_linux::driver()
}

#[cfg(feature = "drivers")]
fn browser() -> Box<dyn Browser> {
    kiko_browser::browser()
}
