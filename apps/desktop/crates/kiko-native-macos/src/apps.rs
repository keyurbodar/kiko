use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

#[derive(Debug, Clone)]
pub struct App {
    pub name: String,
    pub bundle: Option<String>,
}

fn describe(app: &NSRunningApplication) -> App {
    App {
        name: app
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_default(),
        bundle: app.bundleIdentifier().map(|bundle| bundle.to_string()),
    }
}

pub fn with_pid(pid: i32) -> Option<App> {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid).map(|app| describe(&app))
}

pub fn activate(pid: i32) -> bool {
    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else {
        return false;
    };
    app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
}
