import json
import os
import select
import shutil
import socket
import subprocess
import time

from eventlog import EventLog

TITLE = "User activity"
UNMEASURED = ["pointerMoves"]


def hyprctl(*args, check=True):
    result = subprocess.run(["hyprctl", *args], capture_output=True, text=True, timeout=10)
    if check and result.returncode != 0:
        raise RuntimeError(f"hyprctl {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def hyprctl_json(*args):
    return json.loads(hyprctl("-j", *args) or "null")


def event_socket_path():
    signature = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
    if not signature:
        raise RuntimeError("HYPRLAND_INSTANCE_SIGNATURE is not set")
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return os.path.join(runtime, "hypr", signature, ".socket2.sock")


def key_command():
    if shutil.which("wtype"):
        return ["wtype", "-k", "a"]
    if shutil.which("ydotool"):
        return ["ydotool", "key", "30:1", "30:0"]
    return None


def move_pointer(offset):
    parts = [int(value) for value in offset.split(",")]
    if len(parts) != 2:
        raise ValueError("expected dx,dy")
    current = hyprctl("cursorpos").strip().split(",")
    x, y = int(current[0]), int(current[1])
    target = f"{x + parts[0]} {y + parts[1]}"
    hyprctl("dispatch", "movecursor", target)


class Sentinel:
    def __init__(self, log_path, stop_file):
        self.log = EventLog(log_path)
        self.stop_file = stop_file
        self.keys_received = 0
        self.ticks = 0
        self.pending = None
        self.stopping = False
        self.active = {}
        self.clients = []
        self.address = None
        self.buffer = ""
        self.socket = None
        self.key = key_command()
        self.window = None
        self.Gtk = None

    def build_window(self):
        import gi

        gi.require_version("Gtk", "3.0")
        from gi.repository import GLib, Gtk

        GLib.set_prgname("BenchSentinel")
        self.Gtk = Gtk
        window = Gtk.Window(title=TITLE)
        window.set_default_size(420, 240)
        window.move(60, 60)
        window.connect("key-press-event", self.on_key)
        window.show_all()
        return window

    def on_key(self, _widget, _event):
        self.keys_received += 1
        return False

    def pump(self):
        if self.Gtk is not None:
            while self.Gtk.events_pending():
                self.Gtk.main_iteration_do(False)

    def wait(self, seconds):
        self.pump()
        readable, _, _ = select.select([self.socket], [], [], seconds)
        if readable:
            self.read_events()
        self.pump()

    def read_events(self):
        try:
            data = self.socket.recv(65536)
        except BlockingIOError:
            return
        if not data:
            return
        self.buffer += data.decode("utf-8", "replace")
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            self.on_event(line)

    def on_event(self, line):
        name, _, _payload = line.partition(">>")
        if name in ("activewindow", "openwindow", "closewindow", "movewindow", "workspace"):
            self.refresh()

    def refresh(self):
        self.active = hyprctl_json("activewindow") or {}
        self.clients = hyprctl_json("clients") or []

    def own(self):
        for client in self.clients:
            if client.get("title") == TITLE:
                return client
        return None

    def focused(self):
        return self.active.get("title") == TITLE

    def above(self):
        own = self.own()
        if own is None:
            return []
        order = own.get("focusHistoryID", 0)
        workspace = (own.get("workspace") or {}).get("id")
        names = []
        for client in self.clients:
            if client.get("title") == TITLE:
                continue
            if not client.get("mapped") or client.get("hidden"):
                continue
            if (client.get("workspace") or {}).get("id") != workspace:
                continue
            if client.get("focusHistoryID", order) < order:
                names.append(client.get("class") or client.get("title") or "window")
        return names

    def sample(self):
        self.log.emit("sample", front="self" if self.focused() else "other", key=self.focused(), above=self.above())

    def send_key(self):
        if self.key is None:
            return
        subprocess.run(self.key, capture_output=True, timeout=10)

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

    def acquire_focus(self, deadline):
        while time.time() < deadline:
            own = self.own()
            if own is not None:
                self.address = own.get("address")
                hyprctl("dispatch", "focuswindow", f"address:{self.address}", check=False)
                hyprctl("dispatch", "bringactivetotop", check=False)
                time.sleep(0.2)
                self.refresh()
                if self.focused():
                    return True
            self.wait(0.2)
        return False

    def run(self):
        self.window = self.build_window()
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.connect(event_socket_path())
        self.socket.setblocking(False)
        self.refresh()
        if not self.acquire_focus(time.time() + 8):
            if self.key is None:
                self.sample()
                self.log.emit("ready", pid=os.getpid(), unmeasured=UNMEASURED + ["focusSteals", "keysSwallowed"])
            else:
                self.log.emit("error", message="Hyprland did not focus the sentinel window")
                return 3
        else:
            unmeasured = list(UNMEASURED)
            if self.key is None:
                unmeasured += ["keysSwallowed"]
            self.sample()
            self.log.emit("ready", pid=os.getpid(), unmeasured=unmeasured)
        next_sample = time.time()
        next_tick = time.time() + 1.0
        next_refresh = time.time() + 1.0
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
            if now >= next_refresh:
                self.refresh()
                next_refresh = now + 1.0
            self.wait(0.02)
        return 0
