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
request_path = options["--request"]
work = options["--work"]
control_path = os.path.join(work, "control.sock")

with open(data_path) as handle:
    data = json.load(handle)
with open(request_path) as handle:
    request = json.load(handle)

state = {"screen": screen, "ready": True}
actions = {}


def save(**changes):
    state.update(changes)
    temporary = state_path + ".tmp"
    with open(temporary, "w") as handle:
        json.dump(state, handle)
    os.replace(temporary, state_path)


settings = Gtk.Settings.get_default()
settings.set_property("gtk-theme-name", "Adwaita")
css = Gtk.CssProvider()
css.load_from_data(b"*{font-family:DejaVu Sans;font-size:11pt}")
Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), css, 800)


def make_window(title="Bench Fixture", width=720, height=480, x=0, y=0):
    window = Gtk.Window(title=title)
    window.set_default_size(width, height)
    window.set_decorated(False)
    window.move(x, y)
    fixed = Gtk.Fixed()
    window.add(fixed)
    return window, fixed


def label(parent, text, x, y, width=400):
    widget = Gtk.Label(label=text, xalign=0)
    widget.set_size_request(width, -1)
    parent.put(widget, x, y)
    return widget


def entry(parent, x, y, width=320, text="", height=36):
    widget = Gtk.Entry()
    widget.set_size_request(width, height)
    widget.set_text(text)
    parent.put(widget, x, y)
    return widget


def button(parent, text, x, y, width=140, handler=None):
    widget = Gtk.Button(label=text)
    widget.set_size_request(width, 36)
    parent.put(widget, x, y)
    if handler:
        widget.connect("clicked", handler)
    return widget


def text_of(command):
    value = command.get("text")
    if not isinstance(value, str):
        raise ValueError("the command needs a text value")
    return value


def build_saveas():
    def write_to(path):
        with open(path, "w") as handle:
            handle.write(note.get_text())
        save(saved_path=path)

    def on_response(dialog, response):
        if response == Gtk.ResponseType.OK:
            write_to(dialog.get_filename())
        dialog.destroy()

    def open_dialog(_):
        dialog = Gtk.FileChooserDialog(title="Save As", parent=win, action=Gtk.FileChooserAction.SAVE)
        dialog.add_buttons(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL, Gtk.STOCK_SAVE, Gtk.ResponseType.OK)
        dialog.set_current_folder(work)
        dialog.set_current_name(request["name"])
        dialog.set_do_overwrite_confirmation(False)
        dialog.connect("response", on_response)
        dialog.show_all()

    def control(command):
        path = text_of(command)
        if not os.path.isabs(path):
            path = os.path.join(work, path)
        write_to(path)
        return {"ok": True}

    label(fixed, "Draft note", 40, 20)
    note = entry(fixed, 40, 50, 560, data["text"])
    button(fixed, "Save As…", 40, 120, 180, handler=open_dialog)
    actions["saveas"] = control


def build_rename():
    def rename_all(prefix_text, first):
        prefix.set_text(prefix_text)
        start.set_value(first)
        renamed = []
        for index, name in enumerate(data["files"]):
            _base, extension = os.path.splitext(name)
            target = f"{prefix_text}-{first + index}{extension}"
            os.replace(os.path.join(work, "docs", name), os.path.join(work, "docs", target))
            renamed.append(target)
        save(renamed=renamed)

    def on_click(_button):
        rename_all(prefix.get_text(), int(start.get_value()))

    def control(command):
        rename_all(text_of(command), int(command["start"]))
        return {"ok": True}

    label(fixed, "Files in docs/", 40, 20)
    label(fixed, "\n".join(data["files"]), 40, 50)
    label(fixed, "Prefix", 420, 40)
    prefix = entry(fixed, 420, 70, 180)
    label(fixed, "Start at", 420, 120)
    start = Gtk.SpinButton.new_with_range(1, 99, 1)
    start.set_value(1)
    start.set_size_request(120, 36)
    fixed.put(start, 420, 150)
    button(fixed, "Rename all", 420, 220, 180, handler=on_click)
    actions["rename"] = control


def build_prefs():
    def apply(dark_value, font_value):
        panel.show_all()
        dark.set_active(dark_value)
        font.set_value(font_value)
        save(applied={"dark": bool(dark.get_active()), "font": int(font.get_value())})
        panel.hide()

    def open_preferences(_):
        panel.set_transient_for(win)
        panel.show_all()

    def control(command):
        apply(bool(command["dark"]), int(command["font"]))
        return {"ok": True}

    label(fixed, "Change how the app looks.", 40, 20)
    button(fixed, "Preferences…", 40, 60, 180, handler=open_preferences)
    panel, panel_fixed = make_window("Preferences", 420, 320, 150, 100)
    label(panel_fixed, "Dark mode", 30, 20)
    dark = Gtk.Switch()
    dark.set_size_request(60, 30)
    panel_fixed.put(dark, 30, 50)
    label(panel_fixed, "Font size", 30, 100)
    font = Gtk.SpinButton.new_with_range(9, 24, 1)
    font.set_value(11)
    font.set_size_request(120, 36)
    panel_fixed.put(font, 30, 130)
    button(panel_fixed, "OK", 30, 200, 120, handler=lambda _: apply(dark.get_active(), int(font.get_value())))
    actions["prefs"] = control


def build_bigform():
    fields = data["fields"]
    entries = []
    for index, field in enumerate(fields):
        row = index // 2
        column = index % 2
        x = 10 + column * 360
        y = 6 + row * 29
        label(fixed, field["label"], x, y, 110)
        entries.append(entry(fixed, x + 115, y, 200, height=26))

    def submit(values):
        for widget, value in zip(entries, values):
            widget.set_text(str(value))
        save(submitted=[widget.get_text() for widget in entries])

    def control(command):
        values = command.get("values")
        if not isinstance(values, list):
            raise ValueError("the command needs a values list")
        submit(values)
        return {"ok": True}

    button(fixed, "Submit", 10, 440, 120, handler=lambda _: submit([widget.get_text() for widget in entries]))
    actions["bigform"] = control


def build_modal():
    holder = {}

    def fill(field_name, value):
        if field_name == "name":
            name.set_text(value)
            maybe_show()
        elif field_name == "email":
            email.set_text(value)
        else:
            raise ValueError(f"there is no {field_name} field")

    def show_session():
        dialog = Gtk.Dialog(title="Session", transient_for=win, modal=True)
        dialog.add_button("_Continue", Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.OK)
        dialog.vbox.add(Gtk.Label(label="Your session is about to expire."))
        dialog.connect("response", lambda inner, _response: (holder.pop("dialog", None), inner.destroy()))
        dialog.show_all()
        holder["dialog"] = dialog
        save(modal_shown=True)

    def maybe_show():
        if holder.get("shown") or not name.get_text():
            return
        holder["shown"] = True
        show_session()

    def on_focus_out(_widget, _event):
        maybe_show()
        return False

    def control(command):
        action = command.get("action")
        if action == "type":
            fill(command.get("field"), text_of(command))
        elif action == "continue":
            dialog = holder.get("dialog")
            if dialog is None:
                raise ValueError("the session message is not showing")
            dialog.response(Gtk.ResponseType.OK)
        elif action == "save":
            save(name=name.get_text(), email=email.get_text())
        else:
            raise ValueError(f"unknown action {action}")
        return {"ok": True}

    label(fixed, "Name", 40, 20)
    name = entry(fixed, 40, 50, 400)
    label(fixed, "Email", 40, 100)
    email = entry(fixed, 40, 130, 400)
    name.connect("focus-out-event", on_focus_out)
    button(fixed, "Save", 40, 190, 140, handler=lambda _: save(name=name.get_text(), email=email.get_text()))
    actions["modal"] = control


def build_single_field(key, title):
    def save_value(_button=None):
        save(**{key: widget.get_text()})

    def control(command):
        action = command.get("action")
        if action == "type":
            widget.set_text(text_of(command))
        elif action == "save":
            save_value()
        else:
            raise ValueError(f"unknown action {action}")
        return {"ok": True}

    label(fixed, title, 40, 20)
    widget = entry(fixed, 40, 50, 320)
    button(fixed, "Save", 40, 120, 140, handler=save_value)
    actions[screen] = control


def build_code():
    build_single_field("code", "Reference code")


def build_text():
    build_single_field("text", "Gruß")


def build_minimized():
    build_single_field("code", "Reference code")
    GLib.timeout_add(700, lambda: win.iconify() or False)


def build_same_title():
    decoy, decoy_fixed = make_window("Bench Fixture", 340, 300, 0, 0)
    label(decoy_fixed, "Scratch", 20, 20)
    scratch = entry(decoy_fixed, 20, 50, 280)
    scratch.connect("changed", lambda _: save(decoy_text=scratch.get_text()))

    target, target_fixed = make_window("Bench Fixture", 340, 300, 380, 0)
    label(target_fixed, "Reference code", 20, 20)
    code = entry(target_fixed, 20, 50, 280)

    def save_target(_button=None):
        save(target_code=code.get_text())

    def control(command):
        action = command.get("action")
        if action == "type":
            code.set_text(text_of(command))
        elif action == "save":
            save_target()
        else:
            raise ValueError(f"unknown action {action}")
        return {"ok": True}

    button(target_fixed, "Save", 20, 120, 120, handler=save_target)
    save(decoy_text="", target_code=None)
    decoy.show_all()
    target.show_all()
    target.present()
    actions["same_title"] = control


def build_notification():
    holder = {}
    owner = {"window": None}

    def fill(field_name, value):
        if field_name == "name":
            name.set_text(value)
            maybe_show()
        elif field_name == "email":
            email.set_text(value)
        else:
            raise ValueError(f"there is no {field_name} field")

    def dismiss():
        save(dismissed=True)
        panel = owner["window"]
        if panel is not None:
            panel.destroy()
            owner["window"] = None

    def show_notice():
        if holder.get("shown"):
            return
        holder["shown"] = True
        panel, panel_fixed = make_window("New message", 520, 120, 100, 110)
        panel.set_transient_for(win)
        label(panel_fixed, "New message from Ops", 20, 10, 460)
        button(panel_fixed, "Dismiss", 20, 60, 140, handler=lambda _: dismiss())
        panel.show_all()
        owner["window"] = panel
        save(notification=True)

    def maybe_show():
        if holder.get("shown") or not name.get_text():
            return
        show_notice()

    def control(command):
        action = command.get("action")
        if action == "type":
            fill(command.get("field"), text_of(command))
        elif action == "dismiss":
            dismiss()
        elif action == "save":
            save(name=name.get_text(), email=email.get_text())
        else:
            raise ValueError(f"unknown action {action}")
        return {"ok": True}

    label(fixed, "Name", 40, 20)
    name = entry(fixed, 40, 50, 400)
    label(fixed, "Email", 40, 100)
    email = entry(fixed, 40, 130, 400)
    name.connect("changed", lambda _widget: maybe_show())
    button(fixed, "Save", 40, 190, 140, handler=lambda _: save(name=name.get_text(), email=email.get_text()))
    GLib.timeout_add(1200, lambda: (show_notice(), False)[1])
    actions["notification"] = control


def build_owner():
    owner_window, owner_fixed = make_window("Owner Scratchpad", 380, 300, 380, 0)
    label(owner_fixed, "Owner notes", 20, 20)
    owner = entry(owner_fixed, 20, 50, 320)
    owner_window.show_all()
    save(owner_text="")

    def type_owner(index=[0]):
        sentence = data["owner"]
        if index[0] >= len(sentence):
            return False
        index[0] += 1
        owner.set_text(sentence[: index[0]])
        save(owner_text=owner.get_text())
        return True

    def save_code(_button=None):
        save(code=code.get_text())

    def control(command):
        action = command.get("action")
        if action == "type":
            code.set_text(text_of(command))
        elif action == "save":
            save_code()
        else:
            raise ValueError(f"unknown action {action}")
        return {"ok": True}

    GLib.timeout_add(15, type_owner)
    label(fixed, "Reference code", 20, 20)
    code = entry(fixed, 20, 50, 280)
    button(fixed, "Save", 20, 120, 120, handler=save_code)
    actions["owner"] = control


def build_second_window():
    notes = {}

    def show_notes(_button=None):
        if notes.get("window") is not None:
            notes["window"].present()
            return
        panel, panel_fixed = make_window("Notes", 480, 240, 100, 100)
        notes["window"] = panel
        notes["entry"] = entry(panel_fixed, 30, 50, 300)
        button(panel_fixed, "Save note", 30, 110, 160, handler=lambda _button: save(note=notes["entry"].get_text()))
        panel.show_all()

    def control(command):
        name = command.get("action")
        if name == "open_notes":
            show_notes()
        elif name == "type":
            notes["entry"].set_text(text_of(command))
        elif name == "save":
            save(note=notes["entry"].get_text())
        else:
            raise ValueError(f"there is no {name} action")
        return {"ok": True}

    label(fixed, "Open the notes window and save a note.", 40, 20)
    button(fixed, "Open notes", 40, 60, 180, handler=show_notes)
    actions["second_window"] = control


builders = {
    "saveas": build_saveas,
    "rename": build_rename,
    "prefs": build_prefs,
    "bigform": build_bigform,
    "modal": build_modal,
    "code": build_code,
    "text": build_text,
    "minimized": build_minimized,
    "same_title": build_same_title,
    "notification": build_notification,
    "owner": build_owner,
    "second_window": build_second_window,
}

if screen in ("code", "text", "owner"):
    win, fixed = make_window(width=400, height=300)
else:
    win, fixed = make_window()
win.connect("destroy", Gtk.main_quit)
builders[screen]()
if screen != "same_title":
    win.show_all()
save()


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


start_control()
Gtk.main()
