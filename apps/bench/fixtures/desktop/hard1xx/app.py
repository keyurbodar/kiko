import json
import os
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

with open(data_path) as handle:
    data = json.load(handle)
with open(request_path) as handle:
    request = json.load(handle)

state = {"screen": screen, "ready": True}


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


def build_saveas():
    def open_dialog(_):
        dialog = Gtk.FileChooserDialog(title="Save As", parent=win, action=Gtk.FileChooserAction.SAVE)
        dialog.add_buttons(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL, Gtk.STOCK_SAVE, Gtk.ResponseType.OK)
        dialog.set_current_folder(work)
        dialog.set_current_name(request["name"])
        dialog.set_do_overwrite_confirmation(False)
        response = dialog.run()
        if response == Gtk.ResponseType.OK:
            path = dialog.get_filename()
            with open(path, "w") as handle:
                handle.write(note.get_text())
            save(saved_path=path)
        dialog.destroy()

    label(fixed, "Draft note", 40, 20)
    note = entry(fixed, 40, 50, 560, data["text"])
    button(fixed, "Save As…", 40, 120, 180, handler=open_dialog)


def build_rename():
    def rename_all(_):
        prefix_text = prefix.get_text()
        first = int(start.get_value())
        renamed = []
        for index, name in enumerate(data["files"]):
            _base, extension = os.path.splitext(name)
            target = f"{prefix_text}-{first + index}{extension}"
            os.replace(os.path.join(work, "docs", name), os.path.join(work, "docs", target))
            renamed.append(target)
        save(renamed=renamed)

    label(fixed, "Files in docs/", 40, 20)
    label(fixed, "\n".join(data["files"]), 40, 50)
    label(fixed, "Prefix", 420, 40)
    prefix = entry(fixed, 420, 70, 180)
    label(fixed, "Start at", 420, 120)
    start = Gtk.SpinButton.new_with_range(1, 99, 1)
    start.set_value(1)
    start.set_size_request(120, 36)
    fixed.put(start, 420, 150)
    button(fixed, "Rename all", 420, 220, 180, handler=rename_all)


def build_prefs():
    def apply(_):
        save(applied={"dark": dark.get_active(), "font": int(font.get_value())})
        panel.destroy()

    def open_preferences(_):
        panel.set_transient_for(win)
        panel.show_all()

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
    button(panel_fixed, "OK", 30, 200, 120, handler=apply)


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
    button(fixed, "Submit", 10, 440, 120, handler=lambda _: save(submitted=[widget.get_text() for widget in entries]))


def build_modal():
    shown = {"value": False}

    def show_session():
        dialog = Gtk.Dialog(title="Session", transient_for=win, modal=True)
        dialog.add_button("_Continue", Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.OK)
        dialog.vbox.add(Gtk.Label(label="Your session is about to expire."))
        dialog.show_all()
        save(modal_shown=True)
        dialog.run()
        dialog.destroy()
        return False

    def maybe_show(_widget, _event):
        if shown["value"] or not name.get_text():
            return False
        shown["value"] = True
        GLib.idle_add(show_session)
        return False

    label(fixed, "Name", 40, 20)
    name = entry(fixed, 40, 50, 400)
    label(fixed, "Email", 40, 100)
    email = entry(fixed, 40, 130, 400)
    name.connect("focus-out-event", maybe_show)
    button(fixed, "Save", 40, 190, 140, handler=lambda _: save(name=name.get_text(), email=email.get_text()))


def build_code():
    label(fixed, "Reference code", 40, 20)
    code = entry(fixed, 40, 50, 300)
    button(fixed, "Save", 40, 120, 140, handler=lambda _: save(code=code.get_text()))


def build_text():
    label(fixed, "Gruß", 40, 20)
    text = entry(fixed, 40, 50, 320)
    button(fixed, "Save", 40, 120, 140, handler=lambda _: save(text=text.get_text()))


def build_minimized():
    build_code()
    GLib.timeout_add(700, lambda: win.iconify() or False)


def build_same_title():
    decoy, decoy_fixed = make_window("Bench Fixture", 340, 300, 0, 0)
    label(decoy_fixed, "Scratch", 20, 20)
    scratch = entry(decoy_fixed, 20, 50, 280)
    scratch.connect("changed", lambda _: save(decoy_text=scratch.get_text()))

    target, target_fixed = make_window("Bench Fixture", 340, 300, 380, 0)
    label(target_fixed, "Reference code", 20, 20)
    code = entry(target_fixed, 20, 50, 280)
    button(target_fixed, "Save", 20, 120, 120, handler=lambda _: save(target_code=code.get_text()))
    save(decoy_text="", target_code=None)
    decoy.show_all()
    target.show_all()
    target.present()


def build_notification():
    shown = {"value": False}
    notice = {"window": None}

    def dismiss(_):
        save(dismissed=True)
        if notice["window"] is not None:
            notice["window"].destroy()

    def show_notice():
        if shown["value"]:
            return False
        shown["value"] = True
        panel, panel_fixed = make_window("New message", 520, 120, 100, 110)
        panel.set_keep_above(True)
        label(panel_fixed, "New message from Ops", 20, 10, 460)
        button(panel_fixed, "Dismiss", 20, 60, 140, handler=dismiss)
        panel.show_all()
        notice["window"] = panel
        save(notification=True)
        return False

    def maybe_show(_widget):
        if shown["value"] or not name.get_text():
            return
        GLib.idle_add(show_notice)

    label(fixed, "Name", 40, 20)
    name = entry(fixed, 40, 50, 400)
    label(fixed, "Email", 40, 100)
    email = entry(fixed, 40, 130, 400)
    name.connect("changed", maybe_show)
    button(fixed, "Save", 40, 190, 140, handler=lambda _: save(name=name.get_text(), email=email.get_text()))
    GLib.timeout_add(1200, show_notice)


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

    GLib.timeout_add(15, type_owner)
    label(fixed, "Reference code", 20, 20)
    code = entry(fixed, 20, 50, 280)
    button(fixed, "Save", 20, 120, 120, handler=lambda _: save(code=code.get_text()))


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
Gtk.main()
