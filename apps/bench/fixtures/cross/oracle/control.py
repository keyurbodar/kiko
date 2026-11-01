import json
import os
import socket
import sys
import time


def connect(workdir, deadline):
    path = os.path.join(workdir, "control.sock")
    while time.monotonic() < deadline:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            client.connect(path)
            return client
        except OSError:
            client.close()
            time.sleep(0.02)
    raise SystemExit(f"no control socket at {path}")


def send(workdir, command, deadline):
    client = connect(workdir, deadline)
    client.settimeout(10)
    client.sendall((json.dumps(command) + "\n").encode())
    chunks = b""
    while b"\n" not in chunks:
        chunk = client.recv(65536)
        if not chunk:
            break
        chunks += chunk
    client.close()
    reply = json.loads(chunks.decode() or "{}")
    if not reply.get("ok"):
        raise SystemExit(f"{command} failed: {reply.get('error')}")


def wait_state(workdir, predicate, deadline):
    path = os.path.join(workdir, "app-state.json")
    while time.monotonic() < deadline:
        if os.path.exists(path):
            with open(path) as handle:
                try:
                    state = json.load(handle)
                except json.JSONDecodeError:
                    state = None
            if state is not None and predicate(state):
                return
        time.sleep(0.02)
    raise SystemExit(f"the app state never matched {predicate}")


def scenario(screen, workdir, deadline):
    if screen == "error":
        send(workdir, {"action": "retry"}, deadline)
        wait_state(workdir, lambda state: state.get("fixed") is True, deadline)
    elif screen == "checklist":
        send(workdir, {"action": "check_all"}, deadline)
        send(workdir, {"action": "approve"}, deadline)
        wait_state(workdir, lambda state: state.get("approved") is True, deadline)
    elif screen == "transfer":
        with open(os.path.join(workdir, "oracle-value.txt")) as handle:
            value = handle.read().strip()
        send(workdir, {"action": "type", "text": value}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("value") == value, deadline)
    else:
        raise SystemExit(f"there is no {screen} scenario")


def main(argv):
    if len(argv) != 3:
        raise SystemExit("usage: control.py <screen> <workdir>")
    screen, workdir = argv[1], argv[2]
    scenario(screen, workdir, time.monotonic() + 20)


if __name__ == "__main__":
    main(sys.argv)
