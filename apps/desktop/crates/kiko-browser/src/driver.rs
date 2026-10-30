use std::future::Future;
use std::pin::Pin;
use std::sync::mpsc::{SyncSender, sync_channel};
use std::thread::JoinHandle;

use kiko_driver::{
    ActResult, Browser, BrowserActParams, BrowserEvalParams, BrowserOpenParams, BrowserReadParams,
    BrowserStatus, DriverError, ErrorCode, Page, Result, Tab, TabParams,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::state::State;
use crate::{act, eval, read, tabs};

type Reply = Result<serde_json::Value>;
type Run =
    Box<dyn for<'a> FnOnce(&'a mut State) -> Pin<Box<dyn Future<Output = Reply> + 'a>> + Send>;

struct Job {
    run: Run,
    reply: SyncSender<Reply>,
}

pub struct Driver {
    jobs: Option<UnboundedSender<Job>>,
    thread: Option<JoinHandle<()>>,
}

pub fn browser() -> Box<dyn Browser> {
    Box::new(Driver::start())
}

impl Driver {
    fn start() -> Self {
        let (jobs, mut queue) = unbounded_channel::<Job>();
        let thread = std::thread::Builder::new()
            .name("kiko-browser".into())
            .spawn(move || {
                let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    return;
                };
                runtime.block_on(async move {
                    let mut state = State::default();
                    while let Some(job) = queue.recv().await {
                        let reply = (job.run)(&mut state).await;
                        let _ = job.reply.send(reply);
                    }
                });
            })
            .ok();
        Self {
            jobs: Some(jobs),
            thread,
        }
    }

    fn call<T>(
        &self,
        run: impl for<'a> FnOnce(&'a mut State) -> Pin<Box<dyn Future<Output = Result<T>> + 'a>>
        + Send
        + 'static,
    ) -> Result<T>
    where
        T: Serialize + DeserializeOwned + Send + 'static,
    {
        let (reply, answer) = sync_channel(1);
        let job = Job {
            reply,
            run: Box::new(move |state| {
                Box::pin(async move {
                    match run(state).await {
                        Ok(value) => serde_json::to_value(value).map_err(|error| {
                            DriverError::new(ErrorCode::Failed, error.to_string())
                        }),
                        Err(error) => Err(error),
                    }
                })
            }),
        };
        self.jobs
            .as_ref()
            .ok_or_else(stopped)?
            .send(job)
            .map_err(|_| stopped())?;
        let value = answer.recv().map_err(|_| stopped())??;
        serde_json::from_value(value)
            .map_err(|error| DriverError::new(ErrorCode::Failed, error.to_string()))
    }
}

fn stopped() -> DriverError {
    DriverError::new(ErrorCode::Failed, "the browser driver stopped")
}

impl Drop for Driver {
    fn drop(&mut self) {
        self.jobs.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Browser for Driver {
    fn status(&mut self) -> Vec<BrowserStatus> {
        self.call(|state| Box::pin(async move { Ok(state.status().await) }))
            .unwrap_or_default()
    }

    fn tabs(&mut self) -> Result<Vec<Tab>> {
        self.call(|state| {
            Box::pin(async move {
                let mut found = Vec::new();
                for profile in state.connected().await {
                    let Ok(link) = state.connect(&profile).await else {
                        continue;
                    };
                    if let Ok(list) = tabs::list(state, &link, &profile.slug).await {
                        found.extend(list);
                    }
                }
                Ok(found)
            })
        })
    }

    fn open(&mut self, params: &BrowserOpenParams) -> Result<Tab> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { tabs::open(state, &params).await }))
    }

    fn close(&mut self, params: &TabParams) -> Result<()> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { tabs::close(state, &params).await }))
    }

    fn show(&mut self, params: &TabParams) -> Result<()> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { tabs::show(state, &params).await }))
    }

    fn read(&mut self, params: &BrowserReadParams) -> Result<Page> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { read::read(state, &params).await }))
    }

    fn act(&mut self, params: &BrowserActParams) -> Result<ActResult> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { act::act(state, &params).await }))
    }

    fn eval(&mut self, params: &BrowserEvalParams) -> Result<serde_json::Value> {
        let params = params.clone();
        self.call(move |state| Box::pin(async move { eval::run(state, &params).await }))
    }
}
