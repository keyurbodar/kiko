use std::collections::HashMap;
use std::time::Duration;

use kiko_driver::{BrowserState, BrowserStatus, DriverError, ErrorCode, Result, Tab};
use serde_json::json;

use crate::cdp::Link;
use crate::discovery::{self, Kind, Profile};
use crate::read::Refs;

#[derive(Default)]
pub struct State {
    links: HashMap<String, Link>,
    sessions: HashMap<(String, String), String>,
    refs: HashMap<String, Refs>,
    last_active: HashMap<(String, u32), String>,
    last_used: Option<String>,
}

pub fn consent() -> DriverError {
    DriverError::new(
        ErrorCode::Denied,
        "this browser is not accepting remote debugging; turn on \"Allow remote debugging for this browser instance\" at chrome://inspect/#remote-debugging",
    )
}

pub fn split_tab(tab: &str) -> Result<(String, String)> {
    tab.split_once(':')
        .map(|(slug, target)| (slug.to_string(), target.to_string()))
        .ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                format!("{tab} is not a browser tab id"),
            )
        })
}

impl State {
    pub async fn status(&mut self) -> Vec<BrowserStatus> {
        let profiles = discovery::profiles();
        let running = discovery::running_many(&profiles);
        let mut statuses = Vec::new();
        for (profile, running) in profiles.into_iter().zip(running) {
            let state = match profile.kind {
                Kind::Other => BrowserState::Unsupported,
                Kind::Chromium => match discovery::port(&profile.dir) {
                    Some(port) if discovery::answers(port.port).await => BrowserState::Connected,
                    _ if running => BrowserState::NeedsConsent,
                    _ => BrowserState::NotRunning,
                },
            };
            statuses.push(BrowserStatus {
                name: profile.name,
                state,
            });
        }
        statuses
    }

    pub async fn connected(&mut self) -> Vec<Profile> {
        let mut connected = Vec::new();
        for profile in discovery::profiles() {
            if profile.kind != Kind::Chromium {
                continue;
            }
            if let Some(port) = discovery::port(&profile.dir)
                && discovery::answers(port.port).await
            {
                connected.push(profile);
            }
        }
        connected
    }

    pub async fn link(&mut self, slug: &str) -> Result<Link> {
        if let Some(link) = self.links.get(slug)
            && link.is_open()
        {
            self.last_used = Some(slug.to_string());
            return Ok(link.clone());
        }
        self.links.remove(slug);
        let profile = discovery::find(slug).ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                format!("there is no browser called {slug} on this computer"),
            )
        })?;
        self.connect(&profile).await
    }

    pub async fn connect(&mut self, profile: &Profile) -> Result<Link> {
        if let Some(link) = self.links.get(&profile.slug)
            && link.is_open()
        {
            return Ok(link.clone());
        }
        self.links.remove(&profile.slug);
        if profile.kind != Kind::Chromium {
            return Err(DriverError::new(
                ErrorCode::Unsupported,
                format!(
                    "{} cannot be driven over the DevTools protocol",
                    profile.name
                ),
            ));
        }
        let port = discovery::port(&profile.dir).ok_or_else(consent)?;
        if !discovery::answers(port.port).await {
            return Err(consent());
        }
        let mut delay = Duration::from_millis(100);
        let mut last = None;
        for attempt in 0..3 {
            match Link::connect(&profile.slug, &profile.name, port.port, &port.path).await {
                Ok(link) => {
                    self.links.insert(profile.slug.clone(), link.clone());
                    self.sessions
                        .retain(|(cached, _), _| cached != &profile.slug);
                    self.last_used = Some(profile.slug.clone());
                    return Ok(link);
                }
                Err(error) => {
                    last = Some(error);
                    if attempt < 2 {
                        tokio::time::sleep(delay).await;
                        delay *= 3;
                    }
                }
            }
        }
        Err(last.unwrap_or_else(consent))
    }

    pub async fn preferred(&mut self) -> Result<Link> {
        if let Some(link) = self
            .last_used
            .as_ref()
            .and_then(|slug| self.links.get(slug))
            .filter(|link| link.is_open())
        {
            return Ok(link.clone());
        }
        let connected = self.connected().await;
        let profile = connected.first().cloned().ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                "no browser is open with remote debugging allowed",
            )
        })?;
        self.connect(&profile).await
    }

    pub async fn session(&mut self, slug: &str, target: &str) -> Result<(Link, String)> {
        let link = self.link(slug).await?;
        let key = (slug.to_string(), target.to_string());
        if let Some(session) = self.sessions.get(&key) {
            return Ok((link, session.clone()));
        }
        let session = attach(&link, target).await?;
        self.sessions.insert(key, session.clone());
        Ok((link, session))
    }

    pub fn forget_session(&mut self, slug: &str, target: &str) {
        self.sessions
            .remove(&(slug.to_string(), target.to_string()));
    }

    pub fn refs(&mut self, tab: &str) -> &mut Refs {
        self.refs.entry(tab.to_string()).or_default()
    }

    pub fn forget_tab(&mut self, tab: &str) {
        self.refs.remove(tab);
        self.sessions
            .retain(|(slug, target), _| format!("{slug}:{target}") != tab);
    }

    pub fn remember_active(&mut self, slug: &str, window: u32, tab: &str) {
        self.last_active
            .insert((slug.to_string(), window), tab.to_string());
    }

    pub fn remembered_active(&self, slug: &str, window: u32) -> Option<&str> {
        self.last_active
            .get(&(slug.to_string(), window))
            .map(String::as_str)
    }
}

pub async fn attach(link: &Link, target: &str) -> Result<String> {
    let result = link
        .send(
            "Target.attachToTarget",
            json!({ "targetId": target, "flatten": true }),
        )
        .await?;
    result
        .get("sessionId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            DriverError::new(
                ErrorCode::NotFound,
                format!("{} has no tab {target}", link.name()),
            )
        })
}

pub fn tab_of(
    slug: &str,
    target: &str,
    window: u32,
    index: u32,
    active: bool,
    title: String,
    url: String,
) -> Tab {
    Tab {
        id: format!("{slug}:{target}"),
        browser: slug.to_string(),
        window_id: window,
        index,
        active,
        title,
        url,
    }
}
