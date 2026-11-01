#!/usr/bin/env python3
import argparse
import os
import sys

from eventlog import EventLog


def stack():
    if os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        return "hyprland"
    if os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        return "wayland"
    return "x11"


def fail(log_path, message):
    EventLog(log_path).emit("error", message=message)
    sys.stderr.write(f"sentinel: {message}\n")
    return 3


def dispatch(args, current):
    if args.move_pointer:
        if current == "hyprland":
            import hyprland_sentinel

            hyprland_sentinel.move_pointer(args.move_pointer)
            return 0
        import x11_sentinel

        x11_sentinel.move_pointer(args.move_pointer)
        return 0
    if not args.log:
        sys.stderr.write("sentinel: --log PATH is required\n")
        return 2
    if current == "hyprland":
        import hyprland_sentinel

        return hyprland_sentinel.Sentinel(args.log, args.stop_file).run()
    if not os.environ.get("DISPLAY"):
        return fail(args.log, "no X11 display: the sentinel needs XWayland in a Wayland session")
    from Xlib import display

    handle = display.Display()
    if not handle.has_extension("XTEST"):
        return fail(args.log, "XTEST is missing from the X server")
    import x11_sentinel

    return x11_sentinel.Sentinel(args.log, args.stop_file, handle, partial=current == "wayland").run()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log")
    parser.add_argument("--stop-file")
    parser.add_argument("--move-pointer")
    args = parser.parse_args()
    try:
        return dispatch(args, stack())
    except Exception as error:
        return fail(args.log, f"{type(error).__name__}: {error}")


if __name__ == "__main__":
    sys.exit(main())
