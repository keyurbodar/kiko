use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
    NSWorkspace,
};

#[derive(Debug, Clone)]
pub struct App {
    pub pid: i32,
    pub name: String,
    pub bundle: Option<String>,
}

fn describe(app: &NSRunningApplication) -> App {
    App {
        pid: app.processIdentifier(),
        name: app
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_default(),
        bundle: app.bundleIdentifier().map(|bundle| bundle.to_string()),
    }
}

pub fn running() -> Vec<App> {
    let workspace = NSWorkspace::sharedWorkspace();
    workspace
        .runningApplications()
        .iter()
        .filter(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular)
        .map(|app| describe(&app))
        .collect()
}

pub fn frontmost() -> Option<App> {
    let workspace = NSWorkspace::sharedWorkspace();
    workspace.frontmostApplication().map(|app| describe(&app))
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
