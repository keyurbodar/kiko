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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log")
    parser.add_argument("--stop-file")
    parser.add_argument("--move-pointer")
    args = parser.parse_args()
    current = stack()
    if args.move_pointer:
        if current == "hyprland":
            import hyprland_sentinel

            hyprland_sentinel.move_pointer(args.move_pointer)
            return 0
        import x11_sentinel

        try:
            x11_sentinel.move_pointer(args.move_pointer)
        except RuntimeError as error:
            sys.stderr.write(f"sentinel: {error}\n")
            return 3
        return 0
    if not args.log:
        sys.stderr.write("sentinel: --log PATH is required\n")
        return 2
    if current == "hyprland":
        import hyprland_sentinel

        return hyprland_sentinel.Sentinel(args.log, args.stop_file).run()
    if not os.environ.get("DISPLAY"):
        message = "no X11 display: the sentinel needs XWayland in a Wayland session"
        EventLog(args.log).emit("error", message=message)
        sys.stderr.write(f"sentinel: {message}\n")
        return 2
    from Xlib import display

    handle = display.Display()
    if not handle.has_extension("XTEST"):
        EventLog(args.log).emit("error", message="XTEST is missing from the X server")
        return 2
    import x11_sentinel

    return x11_sentinel.Sentinel(args.log, args.stop_file, handle, partial=current == "wayland").run()


if __name__ == "__main__":
    sys.exit(main())

