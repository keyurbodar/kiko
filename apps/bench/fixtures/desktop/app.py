import json
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


def save(**changes):
    state.update(changes)
    with open(state_path, "w") as handle:
        json.dump(state, handle)


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


def label(text, x, y, width=400):
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


def build_form():
    label("Display name", 40, 20)
    name = entry(40, 50)
    button("Save", 40, 130, handler=lambda _: save(saved=name.get_text()))


def build_settings():
    label("Notifications", 40, 20)
    notifications = Gtk.Switch()
    notifications.set_size_request(60, 30)
    fixed.put(notifications, 40, 50)
    label("Automatic updates", 40, 90)
    updates = Gtk.Switch()
    updates.set_size_request(60, 30)
    fixed.put(updates, 40, 120)
    notifications.connect("notify::active", lambda *_: save(notifications=notifications.get_active()))
    updates.connect("notify::active", lambda *_: save(updates=updates.get_active()))
    button(
        "Apply",
        40,
        200,
        handler=lambda _: save(applied={"notifications": notifications.get_active(), "updates": updates.get_active()}),
    )


def build_menu():
    bar = Gtk.MenuBar()
    file_menu = Gtk.Menu()
    file_item = Gtk.MenuItem(label="_File", use_underline=True)
    file_item.set_submenu(file_menu)
    for name, key in (("Export as _CSV", "csv"), ("Export as _JSON", "json")):
        item = Gtk.MenuItem(label=name, use_underline=True)
        item.connect("activate", lambda _, value=key: save(export=value))
        file_menu.append(item)
    bar.append(file_item)
    bar.set_size_request(720, 32)
    fixed.put(bar, 0, 0)
    label("Choose an export format from the File menu.", 40, 60)


def build_list():
    label("Move a name to the top of the list.", 40, 10)
    store = Gtk.ListStore(str)
    for name in data["items"]:
        store.append([name])
    view = Gtk.TreeView(model=store)
    view.set_reorderable(True)
    view.set_headers_visible(False)
    view.set_fixed_height_mode(True)
    renderer = Gtk.CellRendererText()
    renderer.set_fixed_size(-1, 28)
    column = Gtk.TreeViewColumn("Name", renderer, text=0)
    column.set_sizing(Gtk.TreeViewColumnSizing.FIXED)
    column.set_fixed_width(400)
    view.append_column(column)
    view.set_size_request(400, 32 * len(data["items"]))
    fixed.put(view, 40, 50)

    def record(*_):
        GLib.idle_add(lambda: save(order=[row[0] for row in store]) or False)

    view.connect("button-release-event", record)
    view.connect("drag-end", record)


def build_tooltip():
    label("Hover the question mark to read the recovery code.", 40, 10)
    icon = Gtk.Button(label="?")
    icon.set_size_request(44, 44)
    icon.set_tooltip_text(data["code"])
    fixed.put(icon, 40, 50)
    label("Recovery code", 40, 110)
    code = entry(40, 140, 240)
    button("Submit", 40, 200, handler=lambda _: save(code=code.get_text()))


def build_dialog():
    label("Unsaved draft", 40, 10)
    draft = entry(40, 50, 360, data["draft"])
    close = button("Close", 40, 130)

    def confirm(_):
        dialog = Gtk.Dialog(title="Confirm", transient_for=win, modal=True)
        dialog.add_button("_Keep", 0)
        dialog.add_button("_Discard", 1)
        dialog.set_default_response(0)
        dialog.vbox.add(Gtk.Label(label="Discard unsaved changes?"))
        dialog.show_all()
        response = dialog.run()
        dialog.destroy()
        if response == 1:
            save(closed="discard", draft=draft.get_text())
            Gtk.main_quit()

    close.connect("clicked", confirm)


def build_slider():
    label("Refresh interval in seconds", 40, 10)
    scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1)
    scale.set_size_request(400, 40)
    scale.set_draw_value(True)
    fixed.put(scale, 40, 50)
    button("Save", 40, 130, handler=lambda _: save(value=int(round(scale.get_value()))))


def build_radio():
    label("Plan", 40, 10)
    group = None
    for index, name in enumerate(data["plans"]):
        widget = Gtk.RadioButton.new_with_label_from_widget(group, name)
        if group is None:
            group = widget
        widget.set_size_request(240, 32)
        fixed.put(widget, 40, 50 + index * 44)
    button(
        "Apply",
        40,
        220,
        handler=lambda _: save(plan=[w.get_label() for w in group.get_group() if w.get_active()][0]),
    )


def build_tree():
    label("Pick an item from the tree.", 40, 10)
    store = Gtk.TreeStore(str)
    for group in data["groups"]:
        parent = store.append(None, [group["name"]])
        for item in group["items"]:
            store.append(parent, [item])
    view = Gtk.TreeView(model=store)
    view.set_headers_visible(False)
    view.set_fixed_height_mode(True)
    renderer = Gtk.CellRendererText()
    renderer.set_fixed_size(-1, 28)
    column = Gtk.TreeViewColumn("Name", renderer, text=0)
    column.set_sizing(Gtk.TreeViewColumnSizing.FIXED)
    column.set_fixed_width(400)
    view.append_column(column)
    view.set_size_request(400, 280)
    fixed.put(view, 40, 40)
    chosen = {"value": None}

    def choose(_):
        model, iteration = view.get_selection().get_selected()
        if iteration is not None:
            chosen["value"] = model.get_value(iteration, 0)
        save(chosen=chosen["value"])

    button("Choose", 460, 40, handler=choose)


def build_windows():
    label("Open the notes window and save a note.", 40, 10)

    def open_notes(_):
        notes = Gtk.Window(title="Notes")
        notes.set_default_size(480, 240)
        notes.move(100, 100)
        box = Gtk.Fixed()
        notes.add(box)
        note = Gtk.Entry()
        note.set_size_request(300, 36)
        box.put(note, 30, 50)
        save_note = Gtk.Button(label="Save note")
        save_note.set_size_request(140, 36)
        box.put(save_note, 30, 110)
        save_note.connect("clicked", lambda _: save(note=note.get_text()))
        notes.show_all()

    button("Open notes", 40, 50, width=180, handler=open_notes)


builders = {
    "form": build_form,
    "settings": build_settings,
    "menu": build_menu,
    "list": build_list,
    "tooltip": build_tooltip,
    "dialog": build_dialog,
    "slider": build_slider,
    "radio": build_radio,
    "tree": build_tree,
    "windows": build_windows,
}

builders[screen]()
win.show_all()
save()
Gtk.main()
