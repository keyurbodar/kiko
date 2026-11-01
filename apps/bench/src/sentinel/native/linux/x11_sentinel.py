import os
import select
import time

from Xlib import X, Xatom, display, protocol
from Xlib.ext import xtest

from eventlog import EventLog

PARTIAL_UNMEASURED = {"focusSteals", "pointerMoves", "windowsRaised"}


def move_pointer(offset):
    parts = [int(value) for value in offset.split(",")]
    if len(parts) != 2:
        raise ValueError("expected dx,dy")
    handle = display.Display()
    root = handle.screen().root
    pointer = root.query_pointer()
    root.warp_pointer(pointer.root_x + parts[0], pointer.root_y + parts[1])
    handle.sync()
    moved = root.query_pointer()
    if abs(moved.root_x - pointer.root_x) < 1 and abs(moved.root_y - pointer.root_y) < 1:
        raise RuntimeError("the X pointer did not move")


class Sentinel:
    def __init__(self, log_path, stop_file, handle, partial):
        self.log = EventLog(log_path)
        self.stop_file = stop_file
        self.partial = partial
        self.display = handle
        self.screen = self.display.screen()
        self.root = self.screen.root
        self.atom = lambda name: self.display.intern_atom(name)
        self.atom_active = self.atom("_NET_ACTIVE_WINDOW")
        self.atom_stacking = self.atom("_NET_CLIENT_LIST_STACKING")
        self.atom_desktop = self.atom("_NET_WM_DESKTOP")
        self.atom_current_desktop = self.atom("_NET_CURRENT_DESKTOP")
        self.atom_pid = self.atom("_NET_WM_PID")
        self.atom_type = self.atom("_NET_WM_WINDOW_TYPE")
        self.chrome_types = {
            self.atom("_NET_WM_WINDOW_TYPE_DOCK"),
            self.atom("_NET_WM_WINDOW_TYPE_DESKTOP"),
            self.atom("_NET_WM_WINDOW_TYPE_NOTIFICATION"),
        }
        self.atom_delete = self.atom("WM_DELETE_WINDOW")
        self.atom_protocols = self.atom("WM_PROTOCOLS")
        self.window = self.build_window()
        self.keycode = self.display.keysym_to_keycode(0x61)
        self.keys_received = 0
        self.stray_keys = 0
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

    def front_id(self):
        return self.focus_id() if self.partial else self.active_id()

    def ready(self):
        if self.partial:
            return self.focused()
        return self.focused() and self.active_id() == self.window.id

    def handle(self, event):
        if event.type == X.KeyPress:
            if event.window.id == self.window.id:
                self.keys_received += 1
            elif self.stray_keys < 3:
                self.stray_keys += 1
                self.log.emit("stray_key", window=event.window.id)
        if event.type == X.ClientMessage and event.data[1][0] == self.atom_delete:
            self.begin_stop()

    def pump(self):
        while self.display.pending_events() > 0:
            self.handle(self.display.next_event())
        while select.select([self.display.fileno()], [], [], 0)[0]:
            self.handle(self.display.next_event())
        while self.display.pending_events() > 0:
            self.handle(self.display.next_event())

    def wait(self, seconds):
        self.pump()
        readable, _, _ = select.select([self.display.fileno()], [], [], seconds)
        if readable:
            self.pump()

    def windows_above(self):
        if self.partial:
            return []
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
            kinds = window.get_full_property(self.atom_type, Xatom.ATOM)
            if kinds is not None and any(kind in self.chrome_types for kind in kinds.value):
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
        front = "self" if self.front_id() == self.window.id else "other"
        extra = {}
        if not self.partial:
            pointer = self.root.query_pointer()
            extra["pointer"] = [pointer.root_x, pointer.root_y]
        self.log.emit(
            "sample",
            front=front,
            key=self.focused(),
            above=self.windows_above(),
            **extra,
        )

    def send_key(self):
        xtest.fake_input(self.display, X.KeyPress, self.keycode)
        xtest.fake_input(self.display, X.KeyRelease, self.keycode)
        self.display.sync()

    def handshake(self):
        deadline = time.time() + 5
        while time.time() < deadline:
            self.activate()
            before = self.keys_received
            self.send_key()
            until = time.time() + 1.0
            while time.time() < until:
                self.wait(0.02)
                if self.keys_received > before:
                    self.keys_received = 0
                    return True
        return False

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
        while time.time() < deadline and not self.ready():
            self.activate()
            self.wait(0.2)
        if not self.ready():
            if not self.partial:
                self.log.emit("error", message="window did not take the focus")
                return 3
            self.log.emit("ready", pid=os.getpid(), unmeasured=sorted(PARTIAL_UNMEASURED | {"keysSwallowed"}))
            return self.loop(sends_keys=False)
        self.sample()
        if self.partial:
            if not self.handshake():
                self.log.emit("error", message="the witness window did not receive a key")
                return 3
            self.log.emit("ready", pid=os.getpid(), keycode=self.keycode, unmeasured=sorted(PARTIAL_UNMEASURED))
        else:
            self.log.emit("ready", pid=os.getpid(), keycode=self.keycode)
        return self.loop(sends_keys=True)

    def loop(self, sends_keys):
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
            if sends_keys and now >= next_tick:
                self.tick()
                next_tick = now + 1.0
            self.wait(0.02)
        return 0
