use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use kiko_driver::{DriverError, ErrorCode, Result};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct Link(Arc<Inner>);

struct Inner {
    slug: String,
    name: String,
    out: mpsc::UnboundedSender<Message>,
    shared: Arc<Shared>,
    next: AtomicU64,
    reader: Mutex<Option<JoinHandle<()>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
}

struct Shared {
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>,
    closed: AtomicBool,
}

impl Shared {
    fn pending(&self) -> MutexGuard<'_, HashMap<u64, oneshot::Sender<Result<Value>>>> {
        self.pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn close(&self, error: DriverError) {
        self.closed.store(true, Ordering::SeqCst);
        for (_, waiter) in self.pending().drain() {
            let _ = waiter.send(Err(error.clone()));
        }
    }
}

impl Inner {
    fn stop(&self, slot: &Mutex<Option<JoinHandle<()>>>) {
        if let Some(task) = slot
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
        {
            task.abort();
        }
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.stop(&self.reader);
        self.stop(&self.writer);
    }
}

impl Link {
    pub async fn connect(slug: &str, name: &str, port: u16, path: &str) -> Result<Self> {
        let url = format!("ws://127.0.0.1:{port}{path}");
        let socket = timeout(CONNECT_TIMEOUT, async {
            let stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
            let _ = stream.set_nodelay(true);
            let (socket, _) = tokio_tungstenite::client_async(url, stream).await?;
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(socket)
        })
        .await
        .map_err(|_| {
            DriverError::new(
                ErrorCode::Timeout,
                format!("{name} did not answer on port {port}"),
            )
        })?
        .map_err(|error| {
            DriverError::new(
                ErrorCode::Failed,
                format!("could not reach {name}: {error}"),
            )
        })?;
        let (mut sink, mut stream) = socket.split();
        let (out, mut queue) = mpsc::unbounded_channel::<Message>();
        let shared = Arc::new(Shared {
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
        });
        let writer = tokio::spawn(async move {
            while let Some(message) = queue.recv().await {
                if sink.send(message).await.is_err() {
                    break;
                }
            }
        });
        let reading = shared.clone();
        let reader = tokio::spawn(async move {
            while let Some(message) = stream.next().await {
                match message {
                    Ok(Message::Text(text)) => answer(&reading, text.as_str()),
                    Ok(Message::Close(_)) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            reading.close(DriverError::new(
                ErrorCode::Failed,
                "the browser closed the debugging connection",
            ));
        });
        Ok(Self(Arc::new(Inner {
            slug: slug.to_string(),
            name: name.to_string(),
            out,
            shared,
            next: AtomicU64::new(1),
            reader: Mutex::new(Some(reader)),
            writer: Mutex::new(Some(writer)),
        })))
    }

    pub fn slug(&self) -> &str {
        &self.0.slug
    }

    pub fn name(&self) -> &str {
        &self.0.name
    }

    pub fn is_open(&self) -> bool {
        !self.0.shared.closed.load(Ordering::SeqCst) && !self.0.out.is_closed()
    }

    pub async fn send(&self, method: &str, params: Value) -> Result<Value> {
        self.send_with(None, method, params, REQUEST_TIMEOUT).await
    }

    pub async fn send_to(&self, session: &str, method: &str, params: Value) -> Result<Value> {
        self.send_with(Some(session), method, params, REQUEST_TIMEOUT)
            .await
    }

    pub async fn send_with(
        &self,
        session: Option<&str>,
        method: &str,
        params: Value,
        budget: Duration,
    ) -> Result<Value> {
        if !self.is_open() {
            return Err(lost(&self.0.name));
        }
        let id = self.0.next.fetch_add(1, Ordering::Relaxed);
        let (reply, answer) = oneshot::channel();
        self.0.shared.pending().insert(id, reply);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        if self
            .0
            .out
            .send(Message::Text(message.to_string().into()))
            .is_err()
        {
            self.0.shared.pending().remove(&id);
            return Err(lost(&self.0.name));
        }
        match timeout(budget, answer).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(lost(&self.0.name)),
            Err(_) => {
                self.0.shared.pending().remove(&id);
                Err(DriverError::new(
                    ErrorCode::Timeout,
                    format!("{} did not answer {method} in time", self.0.name),
                ))
            }
        }
    }
}

fn lost(name: &str) -> DriverError {
    DriverError::new(
        ErrorCode::Failed,
        format!("lost the debugging connection to {name}"),
    )
}

fn answer(shared: &Shared, text: &str) {
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(waiter) = shared.pending().remove(&id) else {
        return;
    };
    let _ = waiter.send(reply(&message));
}

fn reply(message: &Value) -> Result<Value> {
    if let Some(error) = message.get("error") {
        let text = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the browser refused the command");
        return Err(DriverError::new(code_for(text), text.to_string()));
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn code_for(message: &str) -> ErrorCode {
    let lower = message.to_lowercase();
    if lower.contains("no node")
        || lower.contains("could not find node")
        || lower.contains("detached")
    {
        ErrorCode::Stale
    } else if lower.contains("no target")
        || lower.contains("not found")
        || lower.contains("session with given id")
    {
        ErrorCode::NotFound
    } else if lower.contains("not supported") || lower.contains("wasn't found") {
        ErrorCode::Unsupported
    } else {
        ErrorCode::Failed
    }
}
