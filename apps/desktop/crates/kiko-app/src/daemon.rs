use std::io;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::config;
use crate::log;
use crate::state::{self, Shared};

const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const STABLE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(200);
const GRACE: Duration = Duration::from_secs(3);

static CHILD_PID: AtomicI32 = AtomicI32::new(0);

pub struct Supervisor {
    stop: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Supervisor {
    pub fn start(shared: Shared) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let worker = thread::spawn(move || supervise(&flag, &shared));
        Self {
            stop,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.lock().ok().and_then(|mut worker| worker.take()) {
            let _ = worker.join();
        }
    }
}

pub fn child_pid() -> Option<i32> {
    match CHILD_PID.load(Ordering::SeqCst) {
        0 => None,
        pid => Some(pid),
    }
}

fn supervise(stop: &AtomicBool, shared: &Shared) {
    let mut backoff = MIN_BACKOFF;
    while !stop.load(Ordering::SeqCst) {
        let mut child = match spawn() {
            Ok(child) => child,
            Err(error) => {
                log::line(format!("kiko-core did not start: {error}"));
                state::lock(shared).running = false;
                wait(stop, backoff);
                backoff = grow(backoff);
                continue;
            }
        };
        log::line(format!("kiko-core started as {}", child.id()));
        state::lock(shared).running = true;
        let started = Instant::now();
        forward(&mut child);
        watch(&mut child, stop);
        state::lock(shared).running = false;
        CHILD_PID.store(0, Ordering::SeqCst);
        if stop.load(Ordering::SeqCst) {
            return;
        }
        backoff = if started.elapsed() >= STABLE {
            MIN_BACKOFF
        } else {
            grow(backoff)
        };
        wait(stop, backoff);
    }
}

fn spawn() -> io::Result<Child> {
    let core = config::core_path();
    let mut command = Command::new(&core);
    command
        .arg("run")
        .env("KIKO_DRIVER", config::socket_name())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command.spawn()?;
    CHILD_PID.store(child.id() as i32, Ordering::SeqCst);
    Ok(child)
}

fn forward(child: &mut Child) {
    if let Some(stdout) = child.stdout.take() {
        pipe(stdout, "kiko-core");
    }
    if let Some(stderr) = child.stderr.take() {
        pipe(stderr, "kiko-core!");
    }
}

fn pipe(source: impl std::io::Read + Send + 'static, tag: &'static str) {
    thread::spawn(move || {
        use std::io::BufRead;
        for line in io::BufReader::new(source).lines() {
            match line {
                Ok(line) => log::line(format!("{tag} {line}")),
                Err(_) => break,
            }
        }
    });
}

fn watch(child: &mut Child, stop: &AtomicBool) {
    loop {
        if stop.load(Ordering::SeqCst) {
            terminate(child);
            return;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                log::line(format!("kiko-core exited: {status}"));
                return;
            }
            Ok(None) => thread::sleep(POLL),
            Err(error) => {
                log::line(format!("kiko-core could not be watched: {error}"));
                return;
            }
        }
    }
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    let until = Instant::now() + GRACE;
    while Instant::now() < until {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(POLL),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn wait(stop: &AtomicBool, duration: Duration) {
    let until = Instant::now() + duration;
    while Instant::now() < until && !stop.load(Ordering::SeqCst) {
        thread::sleep(POLL);
    }
}

fn grow(backoff: Duration) -> Duration {
    (backoff * 2).min(MAX_BACKOFF)
}
