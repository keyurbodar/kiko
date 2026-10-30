#!/usr/bin/python3
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def write(name, text="1"):
    with open(os.path.join(out, name), "w") as handle:
        handle.write(text)


def on_click(_button):
    write("clicked")


def on_toggle(button):
    write("toggled", "1" if button.get_active() else "0")


def on_entry(entry):
    write("entry", entry.get_text())


target = Gtk.Window(title="Kiko Target")
target.set_default_size(400, 300)
target.move(100, 100)

target_background = Gtk.EventBox()
target_background.set_name("target-bg")
target.add(target_background)

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
box.set_margin_top(10)
box.set_margin_bottom(10)
box.set_margin_start(10)
box.set_margin_end(10)
target_background.add(box)

button = Gtk.Button(label="Press me")
button.connect("clicked", on_click)
box.pack_start(button, False, False, 0)

entry = Gtk.Entry()
entry.set_text("start")
entry.connect("changed", on_entry)
box.pack_start(entry, False, False, 0)

check = Gtk.CheckButton(label="Enable")
check.connect("toggled", on_toggle)
box.pack_start(check, False, False, 0)

cover = Gtk.Window(title="Kiko Cover")
cover.set_default_size(700, 500)
cover.move(0, 0)
cover_background = Gtk.EventBox()
cover_background.set_name("cover-bg")
cover.add(cover_background)

provider = Gtk.CssProvider()
provider.load_from_data(
    b"#target-bg { background-color: #3366cc; } #cover-bg { background-color: #cc3333; }"
)
Gtk.StyleContext.add_provider_for_screen(
    Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
)

target.show_all()
cover.show_all()
cover.present()


def ready():
    write("ready")
    return False


GLib.timeout_add(300, ready)
Gtk.main()
