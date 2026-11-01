use std::sync::mpsc::{self, Sender};
use std::thread::JoinHandle;
use std::time::Duration;

use kiko_driver::{
    ActParams, ActResult, DriverError, ErrorCode, Look, LookParams, Native, OpenParams,
    PermissionKind, Permissions, Window,
};

use crate::permissions;
use crate::worker::{Job, Reply, Worker};

const WINDOWS_TIMEOUT: Duration = Duration::from_secs(5);
const LOOK_TIMEOUT: Duration = Duration::from_secs(8);
const ACT_TIMEOUT: Duration = Duration::from_secs(6);
const OPEN_TIMEOUT: Duration = Duration::from_secs(20);

pub struct MacDriver {
    jobs: Sender<Job>,
    worker: Option<JoinHandle<()>>,
}

impl MacDriver {
    pub fn new() -> kiko_driver::Result<Self> {
        let (jobs, receiver) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("kiko-macos-driver".to_string())
            .spawn(move || Worker::new().run(receiver))
            .map_err(|error| {
                DriverError::new(
                    ErrorCode::Failed,
                    format!("could not start the driver thread: {error}"),
                )
            })?;
        Ok(Self {
            jobs,
            worker: Some(worker),
        })
    }

    fn call<T>(
        &self,
        timeout: Duration,
        job: impl FnOnce(Reply<T>) -> Job,
    ) -> kiko_driver::Result<T> {
        let (reply, answer) = mpsc::channel();
        self.jobs
            .send(job(reply))
            .map_err(|_| DriverError::new(ErrorCode::Failed, "the driver thread stopped"))?;
        answer.recv_timeout(timeout).map_err(|_| {
            DriverError::new(
                ErrorCode::Timeout,
                "the window server did not answer in time",
            )
        })?
    }
}

impl Drop for MacDriver {
    fn drop(&mut self) {
        self.worker.take();
    }
}

impl Native for MacDriver {
    fn permissions(&self) -> Permissions {
        permissions::current()
    }

    fn request_permission(&mut self, kind: PermissionKind) -> kiko_driver::Result<()> {
        permissions::request(kind)
    }

    fn windows(&mut self) -> kiko_driver::Result<Vec<Window>> {
        self.call(WINDOWS_TIMEOUT, Job::Windows)
    }

    fn look(&mut self, params: &LookParams) -> kiko_driver::Result<Look> {
        self.call(LOOK_TIMEOUT, |reply| Job::Look(params.clone(), reply))
    }

    fn act(&mut self, params: &ActParams) -> kiko_driver::Result<ActResult> {
        self.call(ACT_TIMEOUT, |reply| Job::Act(params.clone(), reply))
    }

    fn open(&mut self, params: &OpenParams) -> kiko_driver::Result<()> {
        self.call(OPEN_TIMEOUT, |reply| Job::Open(params.clone(), reply))
    }
}
