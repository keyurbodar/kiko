import json
import os
import socket
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

argv = sys.argv[1:]
options = dict(zip(argv[::2], argv[1::2]))
screen = options["--screen"]
state_path = options["--state"]
data_path = options["--data"]

with open(data_path) as handle:
    data = json.load(handle)

state = {"screen": screen, "ready": True}
work = os.path.dirname(os.path.abspath(state_path))
control_path = os.path.join(work, "control.sock")
actions = {}


def save(**changes):
    state.update(changes)
    with open(state_path, "w") as handle:
        json.dump(state, handle)


def read_config():
    try:
        with open("config.json") as handle:
            return json.load(handle)
    except Exception:
        return {}


settings = Gtk.Settings.get_default()
settings.set_property("gtk-theme-name", "Adwaita")
css = Gtk.CssProvider()
css.load_from_data(b"*{font-family:DejaVu Sans;font-size:11pt}")
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, 800)

win = Gtk.Window(title="Bench Fixture")
win.set_default_size(720, 480)
win.set_decorated(False)
win.move(0, 0)
win.connect("destroy", Gtk.main_quit)
fixed = Gtk.Fixed()
win.add(fixed)


def label(text, x, y, width=600):
    widget = Gtk.Label(label=text, xalign=0)
    widget.set_size_request(width, -1)
    fixed.put(widget, x, y)
    return widget


def entry(x, y, width=320, text=""):
    widget = Gtk.Entry()
    widget.set_size_request(width, 36)
    widget.set_text(text)
    fixed.put(widget, x, y)
    return widget


def button(text, x, y, width=140, handler=None):
    widget = Gtk.Button(label=text)
    widget.set_size_request(width, 36)
    fixed.put(widget, x, y)
    if handler:
        widget.connect("clicked", handler)
    return widget


def build_error():
    win.set_title("Sync Console")
    label("Sync failed: code " + data["code"], 40, 20)
    label("The matching line in logs/sync.log says what to change.", 40, 60)
    label("Fix config.json, then retry.", 40, 100)
    save(code=data["code"])

    def retry(_):
        config = read_config()
        if config.get("sync_key") == data["expectedKey"]:
            save(fixed=True)
        else:
            save(fixed=False)

    button("Retry", 40, 150, handler=retry)

    def control(command):
        if command.get("action") != "retry":
            raise ValueError(f"there is no {command.get('action')} action")
        retry(None)
        return {"ok": True}

    actions["error"] = control


def build_checklist():
    win.set_title("Release Checklist")
    label("Tick every check, then approve the release.", 40, 10)
    boxes = []
    for index, item in enumerate(data["checks"]):
        box = Gtk.CheckButton(label=item)
        box.set_size_request(500, 32)
        fixed.put(box, 40, 50 + index * 40)
        boxes.append(box)
    save(checks=[])

    def approve(_):
        save(approved=all(box.get_active() for box in boxes), checks=[box.get_label() for box in boxes if box.get_active()])

    button("Approve", 40, 200, handler=approve)

    def control(command):
        name = command.get("action")
        if name == "check_all":
            for box in boxes:
                box.set_active(True)
        elif name == "approve":
            approve(None)
        else:
            raise ValueError(f"there is no {name} action")
        return {"ok": True}

    actions["checklist"] = control


def build_transfer():
    win.set_title("Transfer Console")
    label("One-time code: " + data["code"], 40, 20)
    label("Enter the matching vault value and save.", 40, 60)
    field = entry(40, 100)
    save(code=data["code"])

    def save_value(_):
        save(value=field.get_text())

    button("Save", 40, 160, handler=save_value)

    def control(command):
        name = command.get("action")
        if name == "type":
            value = command.get("text")
            if not isinstance(value, str):
                raise ValueError("the command needs a text value")
            field.set_text(value)
        elif name == "save":
            save_value(None)
        else:
            raise ValueError(f"there is no {name} action")
        return {"ok": True}

    actions["transfer"] = control


builders = {"error": build_error, "checklist": build_checklist, "transfer": build_transfer}

def dispatch(command):
    handler = actions.get(screen)
    if handler is None:
        raise ValueError(f"the {screen} screen has no control actions")
    return handler(command)


def serve_connection(server):
    connection, _address = server.accept()
    connection.settimeout(10)
    try:
        chunks = b""
        while b"\n" not in chunks:
            chunk = connection.recv(65536)
            if not chunk:
                break
            chunks += chunk
        reply = dispatch(json.loads(chunks.decode() or "{}"))
    except Exception as error:
        reply = {"ok": False, "error": str(error)}
    try:
        connection.sendall((json.dumps(reply) + "\n").encode())
    except OSError:
        pass
    connection.close()
    return True


def start_control():
    if os.path.exists(control_path):
        os.unlink(control_path)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(control_path)
    server.listen(8)
    GLib.io_add_watch(server.fileno(), GLib.IO_IN, lambda _fd, _condition: serve_connection(server))


builders[screen]()
win.show_all()
save()
start_control()
Gtk.main()
