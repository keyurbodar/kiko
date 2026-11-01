#!/usr/bin/env python3
import argparse
import time

from Xlib import X, display, protocol


def activate(handle, root, window, atom_active):
    event = protocol.event.ClientMessage(
        window=window,
        client_type=atom_active,
        data=(32, [1, X.CurrentTime, 0, 0, 0]),
    )
    root.send_event(event, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    handle.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=12.0)
    args = parser.parse_args()
    handle = display.Display()
    screen = handle.screen()
    root = screen.root
    atom_active = handle.intern_atom("_NET_ACTIVE_WINDOW")
    window = root.create_window(
        760,
        260,
        360,
        220,
        0,
        screen.root_depth,
        X.InputOutput,
        X.CopyFromParent,
        background_pixel=screen.white_pixel,
        event_mask=X.ExposureMask,
    )
    window.set_wm_name("Other window")
    window.set_wm_class("OtherWindow", "OtherWindow")
    window.map()
    handle.flush()
    deadline = time.time() + args.seconds
    while time.time() < deadline:
        activate(handle, root, window, atom_active)
        time.sleep(0.5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
