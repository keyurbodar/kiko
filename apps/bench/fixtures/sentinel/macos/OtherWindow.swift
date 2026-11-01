import AppKit
import Foundation

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
    return args[index + 1]
}

final class OtherWindow: NSObject, NSApplicationDelegate {
    let seconds: Double
    var window: NSWindow!
    var timer: Timer?

    init(seconds: Double) {
        self.seconds = seconds
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 700, y: 300, width: 360, height: 220),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Other window"
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier != getpid() else {
                return
            }
            NSApp.activate(ignoringOtherApps: true)
            self.window.makeKeyAndOrderFront(nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + self.seconds) { exit(0) }
    }
}

@main
enum OtherWindowMain {
    @MainActor
    static func main() {
        let seconds = Double(argument("--seconds") ?? "12") ?? 12
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate = OtherWindow(seconds: seconds)
        app.delegate = delegate
        app.run()
    }
}
