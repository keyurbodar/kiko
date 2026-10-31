import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000.0
}

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

func currentPointer() -> CGPoint {
    CGEvent(source: nil)?.location ?? .zero
}

final class EventLog {
    private var fd: Int32 = -1

    init(path: String?) {
        guard let path else { return }
        fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
    }

    func emit(_ event: String, _ extra: [String: Any] = [:]) {
        guard fd >= 0 else { return }
        var line: [String: Any] = ["ev": event, "t": nowMs()]
        for (key, value) in extra { line[key] = value }
        guard var data = try? JSONSerialization.data(
            withJSONObject: line, options: [.sortedKeys, .withoutEscapingSlashes])
        else { return }
        data.append(0x0A)
        data.withUnsafeBytes { buffer in
            _ = Darwin.write(fd, buffer.baseAddress, buffer.count)
        }
    }
}

func installMainMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(
        withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    NSApp.mainMenu = main
}

final class Sentinel: NSObject, NSApplicationDelegate {
    let log: EventLog
    let stopPath: String?
    var window: NSWindow!
    var field: NSTextField!
    var sampler: Timer?
    var ticker: Timer?
    var signalSources: [DispatchSourceSignal] = []
    var keysReceived = 0
    var ticks = 0
    var pending: (n: Int, before: Int)?
    var stopping = false
    var activated = false
    var activationAttempts = 0

    init(log: EventLog, stopPath: String?) {
        self.log = log
        self.stopPath = stopPath
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
        buildWindow()
        installMonitor()
        installSignals()
        startActivation()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func buildWindow() {
        let width: CGFloat = 420
        let height: CGFloat = 240
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "User activity"
        window.isReleasedWhenClosed = false
        let screen = NSScreen.screens.first ?? NSScreen.main
        let screenHeight = screen?.frame.height ?? 900
        window.setFrame(
            NSRect(x: 420, y: screenHeight - 340 - height, width: width, height: height),
            display: false)
        field = NSTextField(frame: NSRect(x: 20, y: 40, width: width - 40, height: 28))
        field.placeholderString = "notes"
        field.setAccessibilityLabel("Sentinel input")
        window.contentView?.addSubview(field)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(field)
    }

    func installMonitor() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.keysReceived += 1
            return event
        }
    }

    func installSignals() {
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in self?.beginStop() }
            source.resume()
            signalSources.append(source)
        }
    }

    func startActivation() {
        guard AXIsProcessTrusted() else {
            log.emit("error", ["message": "Accessibility is not granted to the sentinel"])
            exit(3)
        }
        activate()
    }

    func activate() {
        activationAttempts += 1
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(field)
        _ = NSRunningApplication.current.activate(options: [
            .activateAllWindows, .activateIgnoringOtherApps,
        ])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            let front = NSWorkspace.shared.frontmostApplication
            let frontmost = front?.processIdentifier == getpid()
            if frontmost && self.window.isKeyWindow {
                self.begin()
            } else if self.activationAttempts < 4 {
                self.activate()
            } else {
                self.log.emit(
                    "error",
                    [
                        "message": "window did not become frontmost",
                        "front": front?.localizedName ?? "",
                    ])
                exit(3)
            }
        }
    }

    func begin() {
        guard !activated else { return }
        activated = true
        log.emit("ready", ["pid": Int(getpid())])
        sampler = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.sample()
        }
        ticker = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    func sample() {
        if let stopPath = self.stopPath, FileManager.default.fileExists(atPath: stopPath) {
            beginStop()
            return
        }
        guard !stopping else { return }
        let front = NSWorkspace.shared.frontmostApplication
        let isSelf = front?.processIdentifier == getpid()
        let point = currentPointer()
        log.emit(
            "sample",
            [
                "front": isSelf ? "self" : "other",
                "frontName": front?.localizedName ?? "",
                "key": NSApp.isActive && window.isKeyWindow,
                "above": windowsAbove(),
                "pointer": [Double(point.x), Double(point.y)],
            ])
    }

    func windowsAbove() -> [String] {
        guard window.windowNumber > 0,
            let list = CGWindowListCopyWindowInfo(
                [.optionOnScreenAboveWindow, .excludeDesktopElements],
                CGWindowID(window.windowNumber)) as? [[String: Any]]
        else { return [] }
        let selfPid = Int(getpid())
        var owners: [String] = []
        for entry in list {
            guard (entry[kCGWindowLayer as String] as? Int) == 0,
                let pid = entry[kCGWindowOwnerPID as String] as? Int, pid != selfPid
            else { continue }
            if let alpha = entry[kCGWindowAlpha as String] as? Double, alpha <= 0 { continue }
            if let bounds = entry[kCGWindowBounds as String] as? [String: Any],
                let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
                width <= 1 || height <= 1
            { continue }
            let name = entry[kCGWindowOwnerName as String] as? String ?? "pid:\(pid)"
            if !owners.contains(name) { owners.append(name) }
        }
        return owners
    }

    func tick() {
        resolvePending()
        pending = (ticks, keysReceived)
        ticks += 1
        sendKey()
    }

    func resolvePending() {
        guard let pending = self.pending else { return }
        self.pending = nil
        log.emit("tick", ["n": pending.n, "received": keysReceived > pending.before])
    }

    func sendKey() {
        let source = CGEventSource(stateID: .hidSystemState)
        let down = CGEvent(keyboardEventSource: source, virtualKey: 0x00, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: 0x00, keyDown: false)
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }

    func beginStop() {
        guard !stopping else { return }
        stopping = true
        sampler?.invalidate()
        ticker?.invalidate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.resolvePending()
            self?.log.emit("exit")
            exit(0)
        }
    }
}

@main
enum SentinelMain {
    @MainActor
    static func main() {
        let logPath = argument("--log")
        let stopPath = argument("--stop-file")
        let pointerOffset = argument("--move-pointer")
        let log = EventLog(path: logPath)
        if let pointerOffset {
            let parts = pointerOffset.split(separator: ",").compactMap { Double($0) }
            guard parts.count == 2, AXIsProcessTrusted() else {
                log.emit("error", ["message": "pointer move needs two offsets and Accessibility"])
                exit(2)
            }
            let origin = currentPointer()
            let target = CGPoint(x: origin.x + parts[0], y: origin.y + parts[1])
            let event = CGEvent(
                mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target,
                mouseButton: .left)
            event?.post(tap: .cghidEventTap)
            exit(0)
        }
        guard logPath != nil else {
            FileHandle.standardError.write(Data("sentinel: --log PATH is required\n".utf8))
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = Sentinel(log: log, stopPath: stopPath)
        app.delegate = delegate
        app.run()
    }
}
