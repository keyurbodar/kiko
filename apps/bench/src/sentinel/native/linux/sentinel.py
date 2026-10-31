#!/usr/bin/env python3
import argparse
import json
import os
import select
import sys
import time

from Xlib import X, XK, Xatom, display, protocol
from Xlib.ext import xtest


class EventLog:
    def __init__(self, path):
        self.file = open(path, "a", buffering=1) if path else None

    def emit(self, event, **extra):
        if self.file is None:
            return
        line = {"ev": event, "t": time.time() * 1000}
        line.update(extra)
        self.file.write(json.dumps(line) + "\n")


class Sentinel:
    def __init__(self, args):
        self.log = EventLog(args.log)
        self.stop_file = args.stop_file
        self.display = display.Display()
        self.screen = self.display.screen()
        self.root = self.screen.root
        self.atom = lambda name: self.display.intern_atom(name)
        self.atom_active = self.atom("_NET_ACTIVE_WINDOW")
        self.atom_stacking = self.atom("_NET_CLIENT_LIST_STACKING")
        self.atom_desktop = self.atom("_NET_WM_DESKTOP")
        self.atom_current_desktop = self.atom("_NET_CURRENT_DESKTOP")
        self.atom_pid = self.atom("_NET_WM_PID")
        self.atom_delete = self.atom("WM_DELETE_WINDOW")
        self.atom_protocols = self.atom("WM_PROTOCOLS")
        self.window = self.build_window()
        self.keycode = self.display.keysym_to_keycode(XK.string_to_keysym("a"))
        self.keys_received = 0
        self.ticks = 0
        self.pending = None
        self.stopping = False

    def build_window(self):
        window = self.root.create_window(
            420,
            340,
            420,
            240,
            0,
            self.screen.root_depth,
            X.InputOutput,
            X.CopyFromParent,
            background_pixel=self.screen.white_pixel,
            event_mask=X.ExposureMask
            | X.KeyPressMask
            | X.FocusChangeMask
            | X.StructureNotifyMask,
        )
        window.set_wm_name("User activity")
        window.set_wm_class("BenchSentinel", "BenchSentinel")
        window.change_property(self.atom_pid, Xatom.CARDINAL, 32, [os.getpid()])
        window.set_wm_protocols([self.atom_delete])
        return window

    def activate(self):
        event = protocol.event.ClientMessage(
            window=self.window,
            client_type=self.atom_active,
            data=(32, [1, X.CurrentTime, 0, 0, 0]),
        )
        self.root.send_event(
            event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask
        )
        self.window.set_input_focus(X.RevertToParent, X.CurrentTime)
        self.display.flush()

    def focus_id(self):
        focus = self.display.get_input_focus().focus
        return focus.id if hasattr(focus, "id") else 0

    def active_id(self):
        prop = self.root.get_full_property(self.atom_active, Xatom.WINDOW)
        if prop is None or len(prop.value) == 0:
            return None
        return prop.value[0]

    def focused(self):
        return self.focus_id() == self.window.id

    def pump(self):
        while self.display.pending_events() > 0:
            event = self.display.next_event()
            if event.type == X.KeyPress and event.window.id == self.window.id:
                self.keys_received += 1
            if event.type == X.ClientMessage and event.data[1][0] == self.atom_delete:
                self.begin_stop()

    def wait(self, seconds):
        readable, _, _ = select.select([self.display.fileno()], [], [], seconds)
        if readable:
            self.pump()

    def windows_above(self):
        prop = self.root.get_full_property(self.atom_stacking, Xatom.WINDOW)
        stack = list(prop.value) if prop is not None else []
        if self.window.id not in stack:
            return []
        current = self.root.get_full_property(self.atom_current_desktop, Xatom.CARDINAL)
        current_desktop = current.value[0] if current and len(current.value) else None
        names = []
        for wid in stack[stack.index(self.window.id) + 1 :]:
            name = self.describe(wid, current_desktop)
            if name is not None:
                names.append(name)
        return names

    def describe(self, wid, current_desktop):
        try:
            window = self.display.create_resource_object("window", wid)
            if window.get_attributes().map_state != X.IsViewable:
                return None
            geometry = window.get_geometry()
            if geometry.width <= 1 or geometry.height <= 1:
                return None
            owner = window.get_full_property(self.atom_pid, Xatom.CARDINAL)
            if owner is not None and len(owner.value) and owner.value[0] == os.getpid():
                return None
            desktop = window.get_full_property(self.atom_desktop, Xatom.CARDINAL)
            if desktop is not None and len(desktop.value) and current_desktop is not None:
                if desktop.value[0] not in (0xFFFFFFFF, current_desktop):
                    return None
            classes = window.get_wm_class()
            return classes[1] if classes else f"x11:{wid}"
        except Exception:
            return None

    def sample(self):
        pointer = self.root.query_pointer()
        active = self.active_id()
        front = "self" if active == self.window.id else "other"
        self.log.emit(
            "sample",
            front=front,
            key=self.focused(),
            above=self.windows_above(),
            pointer=[pointer.root_x, pointer.root_y],
        )

    def send_key(self):
        xtest.fake_input(self.display, X.KeyPress, self.keycode)
        xtest.fake_input(self.display, X.KeyRelease, self.keycode)
        self.display.sync()

    def resolve_pending(self):
        if self.pending is None:
            return
        number, before = self.pending
        self.pending = None
        self.log.emit("tick", n=number, received=self.keys_received > before)

    def tick(self):
        self.resolve_pending()
        self.pending = (self.ticks, self.keys_received)
        self.ticks += 1
        self.send_key()

    def begin_stop(self):
        if self.stopping:
            return
        self.stopping = True
        deadline = time.time() + 0.5
        while time.time() < deadline:
            self.wait(0.02)
        self.resolve_pending()
        self.log.emit("exit")

    def run(self):
        self.window.map()
        self.display.flush()
        deadline = time.time() + 8
        while time.time() < deadline and not self.focused():
            self.activate()
            self.wait(0.2)
        if not self.focused():
            self.log.emit("error", message="window did not take the focus")
            return 3
        self.log.emit("ready", pid=os.getpid())
        next_sample = time.time()
        next_tick = time.time() + 1.0
        while not self.stopping:
            if self.stop_file and os.path.exists(self.stop_file):
                self.begin_stop()
                break
            now = time.time()
            if now >= next_sample:
                self.sample()
                next_sample = now + 0.1
            if now >= next_tick:
                self.tick()
                next_tick = now + 1.0
            self.wait(0.02)
        return 0


def move_pointer(display_handle, offset):
    parts = [int(value) for value in offset.split(",")]
    if len(parts) != 2:
        raise ValueError("expected dx,dy")
    root = display_handle.screen().root
    pointer = root.query_pointer()
    root.warp_pointer(pointer.root_x + parts[0], pointer.root_y + parts[1])
    display_handle.sync()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log")
    parser.add_argument("--stop-file")
    parser.add_argument("--move-pointer")
    args = parser.parse_args()
    if os.environ.get("WAYLAND_DISPLAY") and not os.environ.get("DISPLAY"):
        message = "Wayland exposes no global pointer position; the sentinel needs X11"
        EventLog(args.log).emit("error", message=message)
        sys.stderr.write(message + "\n")
        return 2
    if args.move_pointer:
        handle = display.Display()
        move_pointer(handle, args.move_pointer)
        return 0
    if not args.log:
        sys.stderr.write("sentinel: --log PATH is required\n")
        return 2
    handle = display.Display()
    if not handle.has_extension("XTEST"):
        EventLog(args.log).emit("error", message="XTEST is missing")
        return 2
    return Sentinel(args).run()


if __name__ == "__main__":
    sys.exit(main())
