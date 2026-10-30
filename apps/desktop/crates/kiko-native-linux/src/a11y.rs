use std::future::Future;
use std::time::Duration;

use atspi::proxy::accessible::AccessibleProxy;
use atspi::proxy::cache::CacheProxy;
use atspi::proxy::component::ComponentProxy;
use atspi::proxy::selection::SelectionProxy;
use atspi::proxy::text::TextProxy;
use atspi::proxy::value::ValueProxy;
use atspi::zbus::Connection;
use atspi::zbus::proxy::CacheProperties;
use atspi::{InterfaceSet, Role, StateSet};
use atspi_connection::AccessibilityConnection;
use kiko_driver::DriverError;

use crate::error::{denied, failed};

pub(crate) const CALL: Duration = Duration::from_millis(800);
const CONNECT: Duration = Duration::from_secs(5);
const ADVERTISE: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct Target {
    pub bus: String,
    pub path: String,
}

impl Target {
    pub fn from_ref(reference: &atspi::ObjectRefOwned) -> Option<Self> {
        Some(Self {
            bus: reference.name_as_str()?.to_string(),
            path: reference.path_as_str().to_string(),
        })
    }

    pub fn parse(id: &str) -> Option<Self> {
        let boundary = id.find('/')?;
        let (bus, path) = id.split_at(boundary);
        if bus.is_empty() || !path.starts_with('/') {
            return None;
        }
        Some(Self {
            bus: bus.to_string(),
            path: path.to_string(),
        })
    }

    pub fn id(&self) -> String {
        format!("{}{}", self.bus, self.path)
    }
}

pub(crate) struct CacheEntry {
    pub object: Target,
    pub parent: Option<Target>,
    pub index: i32,
    pub count: i32,
    pub children: Vec<Target>,
    pub ifaces: InterfaceSet,
    pub role: Role,
    pub name: String,
    pub states: StateSet,
}

pub(crate) async fn advertise() -> Result<(), DriverError> {
    let session = Connection::session()
        .await
        .map_err(|error| denied(format!("no session bus: {error}")))?;
    let proxy = zbus::Proxy::new(&session, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Status")
        .await
        .map_err(|error| denied(format!("the accessibility status is unavailable: {error}")))?;
    let enabled = proxy
        .get_property::<bool>("IsEnabled")
        .await
        .unwrap_or(false);
    if !enabled {
        proxy
            .set_property("IsEnabled", true)
            .await
            .map_err(|error| denied(format!("could not enable accessibility: {error}")))?;
    }
    Ok(())
}

pub(crate) async fn enable() -> Result<(), DriverError> {
    tokio::time::timeout(ADVERTISE, advertise())
        .await
        .map_err(|_| denied("the accessibility status did not answer"))?
}

pub(crate) async fn connect() -> Result<AccessibilityConnection, DriverError> {
    tokio::time::timeout(CONNECT, AccessibilityConnection::new())
        .await
        .map_err(|_| denied("the accessibility bus did not answer"))?
        .map_err(|error| denied(format!("the accessibility bus is unavailable: {error}")))
}

pub(crate) async fn within<T, E>(
    budget: Duration,
    future: impl Future<Output = std::result::Result<T, E>>,
) -> Option<T> {
    if budget.is_zero() {
        return None;
    }
    tokio::time::timeout(budget, future).await.ok()?.ok()
}

pub(crate) async fn accessible<'a>(
    conn: &'a Connection,
    target: &Target,
) -> Result<AccessibleProxy<'a>, DriverError> {
    AccessibleProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(target.bus.clone())
        .map_err(|error| failed(format!("bad accessibility destination: {error}")))?
        .path(target.path.clone())
        .map_err(|error| failed(format!("bad accessibility path: {error}")))?
        .build()
        .await
        .map_err(|error| failed(format!("could not reach the element: {error}")))
}

pub(crate) async fn root(conn: &Connection) -> Result<AccessibleProxy<'_>, DriverError> {
    AccessibleProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination("org.a11y.atspi.Registry")
        .map_err(|error| failed(format!("bad registry destination: {error}")))?
        .path("/org/a11y/atspi/accessible/root")
        .map_err(|error| failed(format!("bad registry path: {error}")))?
        .build()
        .await
        .map_err(|error| {
            failed(format!(
                "the accessibility registry is unavailable: {error}"
            ))
        })
}

pub(crate) async fn pid_of(dbus: &zbus::fdo::DBusProxy<'_>, bus: &str) -> Option<u32> {
    let name = zbus::names::BusName::try_from(bus).ok()?;
    within(CALL, dbus.get_connection_unix_process_id(name)).await
}

pub(crate) async fn component<'a>(
    conn: &'a Connection,
    target: &Target,
) -> Option<ComponentProxy<'a>> {
    ComponentProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(target.bus.clone())
        .ok()?
        .path(target.path.clone())
        .ok()?
        .build()
        .await
        .ok()
}

pub(crate) async fn selection<'a>(
    conn: &'a Connection,
    target: &Target,
) -> Option<SelectionProxy<'a>> {
    SelectionProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(target.bus.clone())
        .ok()?
        .path(target.path.clone())
        .ok()?
        .build()
        .await
        .ok()
}

pub(crate) async fn text<'a>(conn: &'a Connection, target: &Target) -> Option<TextProxy<'a>> {
    TextProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(target.bus.clone())
        .ok()?
        .path(target.path.clone())
        .ok()?
        .build()
        .await
        .ok()
}

pub(crate) async fn value<'a>(conn: &'a Connection, target: &Target) -> Option<ValueProxy<'a>> {
    ValueProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(target.bus.clone())
        .ok()?
        .path(target.path.clone())
        .ok()?
        .build()
        .await
        .ok()
}

pub(crate) async fn cache(
    conn: &Connection,
    bus: &str,
    budget: Duration,
) -> Option<Vec<CacheEntry>> {
    let proxy = CacheProxy::builder(conn)
        .cache_properties(CacheProperties::No)
        .destination(bus.to_string())
        .ok()?
        .path("/org/a11y/atspi/cache")
        .ok()?
        .build()
        .await
        .ok()?;
    if let Some(items) = within(budget, proxy.get_items()).await {
        return Some(items.iter().filter_map(entry).collect());
    }
    let legacy = within(budget, proxy.get_legacy_items()).await?;
    Some(legacy.iter().filter_map(legacy_entry).collect())
}

fn entry(item: &atspi::CacheItem) -> Option<CacheEntry> {
    let object = Target::from_ref(&item.object)?;
    let name = if item.name.is_empty() {
        item.short_name.clone()
    } else {
        item.name.clone()
    };
    Some(CacheEntry {
        object,
        parent: Target::from_ref(&item.parent),
        index: item.index,
        count: item.children,
        children: Vec::new(),
        ifaces: item.ifaces,
        role: item.role,
        name,
        states: item.states,
    })
}

fn legacy_entry(item: &atspi::LegacyCacheItem) -> Option<CacheEntry> {
    let object = Target::from_ref(&item.object)?;
    let children: Vec<Target> = item.children.iter().filter_map(Target::from_ref).collect();
    let name = if item.name.is_empty() {
        item.short_name.clone()
    } else {
        item.name.clone()
    };
    Some(CacheEntry {
        object,
        parent: None,
        index: 0,
        count: children.len() as i32,
        children,
        ifaces: item.ifaces,
        role: item.role,
        name,
        states: item.states,
    })
}

#[cfg(test)]
mod tests {
    use super::Target;

    #[test]
    fn parses_and_round_trips_window_ids() {
        let target = Target::parse(":1.42/org/a11y/atspi/accessible/77").unwrap();
        assert_eq!(target.bus, ":1.42");
        assert_eq!(target.path, "/org/a11y/atspi/accessible/77");
        assert_eq!(target.id(), ":1.42/org/a11y/atspi/accessible/77");
    }

    #[test]
    fn rejects_ids_that_are_not_bus_and_path() {
        assert!(Target::parse("nonsense").is_none());
        assert!(Target::parse("/org/a11y/atspi/accessible/1").is_none());
        assert!(Target::parse(":1.1relative").is_none());
    }
}
