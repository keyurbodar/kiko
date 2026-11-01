use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use kiko_driver::{BrowserStatus, Grant, Permissions, Status};

use crate::config;
use crate::control::{self, Command};
use crate::daemon::Supervisor;
use crate::driver::{Driver, SharedDriver};
use crate::log;
use crate::login;
use crate::open;
use crate::serve;
use crate::single;
use crate::state::{self, Shared};
use crate::tray::{self, Action, Handler};

const SECOND_LAUNCH_TRIES: u32 = 20;
const SECOND_LAUNCH_WAIT: Duration = Duration::from_millis(100);

pub fn run(args: &[String]) -> i32 {
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("kiko {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_help();
        return 0;
    }
    if args.iter().any(|arg| arg == "--show") {
        return show_running();
    }
    if args.iter().any(|arg| arg == "--quit") {
        return quit_running();
    }
    if let Err(error) = config::ensure_dir() {
        eprintln!("kiko: {error}");
        return 1;
    }
    let _ = log::init(&config::log_file());
    log::line(format!("kiko {} starting", env!("CARGO_PKG_VERSION")));

    match acquire() {
        Ok(()) => start(),
        Err(code) => code,
    }
}

fn acquire() -> Result<(), i32> {
    for _ in 0..SECOND_LAUNCH_TRIES {
        match single::acquire(&config::lock_file()) {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                if once(Command::Show) {
                    return Err(0);
                }
            }
            Err(error) => {
                log::line(format!("single instance lock failed: {error}"));
                return Err(1);
            }
        }
        thread::sleep(SECOND_LAUNCH_WAIT);
    }
    Err(show_running())
}

fn once(command: Command) -> bool {
    control::send(&config::control_name(), command).is_ok()
}

fn start() -> i32 {
    install_signals();

    let shared = state::shared();
    let driver: SharedDriver = Arc::new(Mutex::new(Driver::build()));

    let listener = match serve::bind(&config::socket_name()) {
        Ok(listener) => listener,
        Err(error) => {
            log::line(format!("driver socket failed: {error}"));
            return 1;
        }
    };
    serve::run(listener, Arc::clone(&driver), status());

    let supervisor = Arc::new(Supervisor::start(Arc::clone(&shared)));
    let shutdown = shutdown(Arc::clone(&supervisor));
    let (commands, incoming) = mpsc::channel();
    let show = commands.clone();
    let quit = Arc::clone(&shutdown);
    if let Err(error) = control::listen(&config::control_name(), move |command| match command {
        Command::Show => {
            let _ = show.send(Command::Show);
        }
        Command::Quit => quit(),
    }) {
        log::line(format!("control socket failed: {error}"));
    }

    let handler = handler(Arc::clone(&driver), shutdown, Arc::clone(&shared));
    state::refresh(&shared, &driver);
    tray::run(shared, driver, handler, incoming)
}

fn show_running() -> i32 {
    deliver(Command::Show)
}

fn quit_running() -> i32 {
    deliver(Command::Quit)
}

fn deliver(command: Command) -> i32 {
    for _ in 0..SECOND_LAUNCH_TRIES {
        if control::send(&config::control_name(), command).is_ok() {
            return 0;
        }
        thread::sleep(SECOND_LAUNCH_WAIT);
    }
    eprintln!("kiko is not running");
    1
}

fn shutdown(supervisor: Arc<Supervisor>) -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(move || {
        log::line("kiko quitting");
        supervisor.stop();
        std::process::exit(0);
    })
}

fn handler(driver: SharedDriver, shutdown: Arc<dyn Fn() + Send + Sync>, shared: Shared) -> Handler {
    Arc::new(move |action| match action {
        Action::Pause => toggle(&config::pause_file()),
        Action::Login => toggle_login(),
        Action::Open => {
            if let Some(url) = state::lock(&shared).url.clone()
                && let Err(error) = open::url(&url)
            {
                log::line(format!("could not open {url}: {error}"));
            }
        }
        Action::Permission(kind) => {
            let driver = Arc::clone(&driver);
            thread::spawn(move || {
                let requested = driver
                    .lock()
                    .map_err(|_| "the driver lock is poisoned".to_string())
                    .and_then(|mut driver| {
                        driver
                            .native
                            .request_permission(kind)
                            .map_err(|error| error.to_string())
                    });
                if let Err(error) = requested {
                    log::line(format!("could not request {kind:?}: {error}"));
                }
            });
        }
        Action::Quit => shutdown(),
    })
}

fn toggle(path: &std::path::Path) {
    let result = if path.exists() {
        std::fs::remove_file(path)
    } else {
        std::fs::write(path, b"1")
    };
    if let Err(error) = result {
        log::line(format!("could not toggle {}: {error}", path.display()));
    }
}

fn toggle_login() {
    if let Err(error) = login::set(!login::enabled()) {
        log::line(format!("could not change start at login: {error}"));
    }
}

fn status() -> Status {
    Status {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        session: session(),
        permissions: Permissions {
            accessibility: Grant::Unknown,
            screen: Grant::Unknown,
            automation: Grant::Unknown,
        },
        browsers: Vec::<BrowserStatus>::new(),
    }
}

fn session() -> String {
    if cfg!(target_os = "macos") {
        return "aqua".into();
    }
    if cfg!(windows) {
        return "win32".into();
    }
    std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "x11".into())
}

fn print_help() {
    println!("kiko {}", env!("CARGO_PKG_VERSION"));
    println!("usage: kiko [--version] [--show] [--quit]");
    println!();
    println!("  --show   open the kiko menu of the running app");
    println!("  --quit   stop the running app and its daemon");
}

fn install_signals() {
    #[cfg(unix)]
    unsafe {
        let handler = on_signal as unsafe extern "C" fn(libc::c_int);
        libc::signal(libc::SIGTERM, handler as libc::sighandler_t);
        libc::signal(libc::SIGINT, handler as libc::sighandler_t);
    }
}

#[cfg(unix)]
unsafe extern "C" fn on_signal(_: libc::c_int) {
    if let Some(pid) = crate::daemon::child_pid() {
        unsafe { libc::kill(pid, libc::SIGTERM) };
    }
    unsafe { libc::_exit(0) };
}
