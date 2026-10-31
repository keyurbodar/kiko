import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

title = sys.argv[1] if len(sys.argv) > 1 else "kiko-cua-fixture"
seed = sys.argv[2] if len(sys.argv) > 2 else ""

window = Gtk.Window(title=title)
window.set_default_size(420, 160)

box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
box.set_margin_top(12)
box.set_margin_bottom(12)
box.set_margin_start(12)
box.set_margin_end(12)

label = Gtk.Label(label="kiko cua fixture")
entry = Gtk.Entry()
entry.set_text(seed)
entry.get_accessible().set_name("kiko-cua-entry")

box.pack_start(label, False, False, 0)
box.pack_start(entry, False, False, 0)
window.add(box)
window.connect("destroy", Gtk.main_quit)
window.show_all()

Gtk.main()
