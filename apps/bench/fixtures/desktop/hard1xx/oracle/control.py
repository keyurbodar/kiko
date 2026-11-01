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
    path = os.path.join(workdir, "state.json")
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
    raise SystemExit(f"the state never matched {predicate}")


def read(workdir, name):
    with open(os.path.join(workdir, name)) as handle:
        return json.load(handle)


def scenario(screen, workdir, request, deadline):
    if screen in ("code", "hidpi", "minimized"):
        send(workdir, {"action": "type", "text": request["code"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("code") is not None, deadline)
    elif screen == "text":
        send(workdir, {"action": "type", "text": request["text"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("text") is not None, deadline)
    elif screen == "saveas":
        send(workdir, {"action": "save_as", "text": f"archive/{request['name']}"}, deadline)
        wait_state(workdir, lambda state: state.get("saved_path") is not None, deadline)
    elif screen == "rename":
        send(workdir, {"action": "rename", "text": request["prefix"], "start": request["start"]}, deadline)
        wait_state(workdir, lambda state: state.get("renamed") is not None, deadline)
    elif screen == "prefs":
        send(workdir, {"action": "apply", "dark": request["dark"], "font": request["font"]}, deadline)
        wait_state(workdir, lambda state: state.get("applied") is not None, deadline)
    elif screen == "bigform":
        send(workdir, {"action": "submit", "values": request["values"]}, deadline)
        wait_state(workdir, lambda state: state.get("submitted") is not None, deadline)
    elif screen == "modal":
        send(workdir, {"action": "type", "field": "name", "text": request["name"]}, deadline)
        wait_state(workdir, lambda state: state.get("modal_shown") is True, deadline)
        send(workdir, {"action": "continue"}, deadline)
        send(workdir, {"action": "type", "field": "email", "text": request["email"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("email") is not None, deadline)
    elif screen == "notification":
        wait_state(workdir, lambda state: state.get("notification") is True, deadline)
        send(workdir, {"action": "dismiss"}, deadline)
        send(workdir, {"action": "type", "field": "name", "text": request["name"]}, deadline)
        send(workdir, {"action": "type", "field": "email", "text": request["email"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("email") is not None, deadline)
    elif screen == "same_title":
        send(workdir, {"action": "type", "text": request["code"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("target_code") is not None, deadline)
    elif screen == "second_window":
        send(workdir, {"action": "open_notes"}, deadline)
        send(workdir, {"action": "type", "text": request["note"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(workdir, lambda state: state.get("note") is not None, deadline)
    elif screen == "owner":
        data = read(workdir, "data.json")
        send(workdir, {"action": "type", "text": request["code"]}, deadline)
        send(workdir, {"action": "save"}, deadline)
        wait_state(
            workdir,
            lambda state: state.get("code") is not None and state.get("owner_text") == data["owner"],
            deadline,
        )
    else:
        raise SystemExit(f"there is no {screen} scenario")


def main(argv):
    if len(argv) != 3:
        raise SystemExit("usage: control.py <screen> <workdir>")
    screen, workdir = argv[1], argv[2]
    request = read(workdir, "request.json")
    scenario(screen, workdir, request, time.monotonic() + 20)


if __name__ == "__main__":
    main(sys.argv)
