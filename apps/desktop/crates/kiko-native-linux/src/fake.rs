use std::sync::Arc;

use atspi_connection::AccessibilityConnection;
use zbus::zvariant::OwnedObjectPath;

use crate::a11y::Target;

pub(crate) const PATH: &str = "/org/a11y/atspi/accessible/1";
pub(crate) const ACTION: &str = "org.a11y.atspi.Action";
pub(crate) const VALUE: &str = "org.a11y.atspi.Value";
pub(crate) const EDITABLE_TEXT: &str = "org.a11y.atspi.EditableText";
pub(crate) const TEXT: &str = "org.a11y.atspi.Text";
pub(crate) const COMPONENT: &str = "org.a11y.atspi.Component";
pub(crate) const SELECTION: &str = "org.a11y.atspi.Selection";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hangs {
    DoAction,
    SetTextContents,
    InsertText,
    SelectChild,
    ScrollTo,
    SetCurrentValue,
    GrabFocus,
    GetName,
    Never,
}

struct Shared {
    hangs: Hangs,
    interfaces: Vec<String>,
    bus: String,
    role: u32,
    name: String,
}

impl Shared {
    fn hangs(&self, which: Hangs) -> bool {
        self.hangs == which
    }

    fn reference(&self) -> (String, OwnedObjectPath) {
        (
            self.bus.clone(),
            OwnedObjectPath::try_from(PATH).expect("the fake path is an object path"),
        )
    }
}

async fn freeze() {
    std::future::pending::<()>().await;
}

struct Accessible(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.Accessible")]
impl Accessible {
    async fn get_role(&self) -> u32 {
        self.0.role
    }

    #[zbus(property)]
    async fn name(&self) -> String {
        if self.0.hangs(Hangs::GetName) {
            freeze().await;
        }
        self.0.name.clone()
    }

    async fn get_interfaces(&self) -> Vec<String> {
        self.0.interfaces.clone()
    }

    async fn get_children(&self) -> Vec<(String, OwnedObjectPath)> {
        vec![self.0.reference()]
    }

    #[zbus(property)]
    fn parent(&self) -> (String, OwnedObjectPath) {
        self.0.reference()
    }
}

struct Action(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.Action")]
impl Action {
    async fn get_actions(&self) -> Vec<(String, String, String)> {
        vec![("click".to_string(), String::new(), String::new())]
    }

    async fn do_action(&self, _index: i32) -> bool {
        if self.0.hangs(Hangs::DoAction) {
            freeze().await;
        }
        true
    }
}

struct Value(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.Value")]
impl Value {
    #[zbus(property)]
    fn current_value(&self) -> f64 {
        0.0
    }

    #[zbus(property)]
    fn maximum_value(&self) -> f64 {
        100.0
    }

    #[zbus(property)]
    fn minimum_value(&self) -> f64 {
        0.0
    }

    #[zbus(property)]
    async fn set_current_value(&self, _value: f64) {
        if self.0.hangs(Hangs::SetCurrentValue) {
            freeze().await;
        }
    }
}

struct EditableText(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.EditableText")]
impl EditableText {
    async fn set_text_contents(&self, _text: String) -> bool {
        if self.0.hangs(Hangs::SetTextContents) {
            freeze().await;
        }
        true
    }

    async fn insert_text(&self, _offset: i32, _text: String, _length: i32) -> bool {
        if self.0.hangs(Hangs::InsertText) {
            freeze().await;
        }
        true
    }
}

struct Text;

#[zbus::interface(name = "org.a11y.atspi.Text")]
impl Text {
    async fn character_count(&self) -> i32 {
        0
    }
}

struct Component(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.Component")]
impl Component {
    async fn grab_focus(&self) -> bool {
        if self.0.hangs(Hangs::GrabFocus) {
            freeze().await;
        }
        true
    }

    async fn scroll_to(&self, _scroll_type: u32) -> bool {
        if self.0.hangs(Hangs::ScrollTo) {
            freeze().await;
        }
        true
    }
}

struct Selection(Arc<Shared>);

#[zbus::interface(name = "org.a11y.atspi.Selection")]
impl Selection {
    async fn select_child(&self, _index: i32) -> bool {
        if self.0.hangs(Hangs::SelectChild) {
            freeze().await;
        }
        true
    }
}

pub(crate) fn serve(hangs: Hangs, interfaces: &[&str]) -> Target {
    spawn(
        hangs,
        interfaces.iter().map(|name| (*name).to_string()).collect(),
        0,
        "Kiko Fake".to_string(),
    )
}

pub(crate) fn serve_app(hangs: Hangs, role: u32, name: &str) -> Target {
    spawn(hangs, Vec::new(), role, name.to_string())
}

fn spawn(hangs: Hangs, interfaces: Vec<String>, role: u32, name: String) -> Target {
    let (ready, wait) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("kiko-fake-a11y".to_string())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("the fake accessibility runtime");
            runtime.block_on(async move {
                let connection = AccessibilityConnection::new()
                    .await
                    .expect("the fake needs the accessibility bus");
                let bus = connection
                    .connection()
                    .unique_name()
                    .expect("the accessibility bus gave the fake no name")
                    .to_string();
                let shared = Arc::new(Shared {
                    hangs,
                    interfaces,
                    bus: bus.clone(),
                    role,
                    name,
                });
                let server = connection.connection().object_server();
                server
                    .at(PATH, Accessible(Arc::clone(&shared)))
                    .await
                    .expect("the fake accessible did not register");
                server
                    .at(PATH, Action(Arc::clone(&shared)))
                    .await
                    .expect("the fake action did not register");
                server
                    .at(PATH, Value(Arc::clone(&shared)))
                    .await
                    .expect("the fake value did not register");
                server
                    .at(PATH, EditableText(Arc::clone(&shared)))
                    .await
                    .expect("the fake editable text did not register");
                server
                    .at(PATH, Text)
                    .await
                    .expect("the fake text did not register");
                server
                    .at(PATH, Component(Arc::clone(&shared)))
                    .await
                    .expect("the fake component did not register");
                server
                    .at(PATH, Selection(Arc::clone(&shared)))
                    .await
                    .expect("the fake selection did not register");
                let _ = ready.send(bus);
                freeze().await;
            });
        })
        .expect("the fake accessibility thread did not start");
    let bus = wait
        .recv()
        .expect("the fake accessibility peer did not start");
    Target {
        bus,
        path: PATH.to_string(),
    }
}
