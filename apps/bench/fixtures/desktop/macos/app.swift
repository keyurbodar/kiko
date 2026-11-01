import AppKit
import Carbon
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

var options: [String: String] = [:]
var arguments = Array(CommandLine.arguments.dropFirst())
var argumentIndex = 0
while argumentIndex + 1 < arguments.count {
    let key = arguments[argumentIndex]
    let value = arguments[argumentIndex + 1]
    if key.hasPrefix("--") {
        options[key] = value
        argumentIndex += 2
    } else {
        argumentIndex += 1
    }
}

guard let screen = options["--screen"],
      let statePath = options["--state"],
      let dataPath = options["--data"],
      let requestPath = options["--request"],
      let work = options["--work"]
else {
    fail("usage: app --screen s --state p --data p --request p --work dir")
}

func loadJSON(_ path: String) -> [String: Any] {
    guard let raw = FileManager.default.contents(atPath: path),
          let parsed = try? JSONSerialization.jsonObject(with: raw),
          let dictionary = parsed as? [String: Any]
    else {
        fail("cannot read \(path)")
    }
    return dictionary
}

let data = loadJSON(dataPath)
let request = loadJSON(requestPath)

var state: [String: Any] = ["screen": screen, "ready": true]
let stateLock = NSLock()

func save(_ changes: [String: Any]) {
    stateLock.lock()
    defer { stateLock.unlock() }
    for (key, value) in changes {
        state[key] = value
    }
    guard let payload = try? JSONSerialization.data(withJSONObject: state, options: []) else {
        return
    }
    try? payload.write(to: URL(fileURLWithPath: statePath), options: .atomic)
}

func text(_ value: Any?) -> String {
    value as? String ?? ""
}

func number(_ value: Any?) -> Int? {
    if let int = value as? Int { return int }
    if let double = value as? Double { return Int(double) }
    if let string = value as? String { return Int(string) }
    return nil
}

func flag(_ value: Any?) -> Bool? {
    if let bool = value as? Bool { return bool }
    if let int = value as? Int { return int != 0 }
    return nil
}

func path(_ relative: String) -> String {
    if relative.hasPrefix("/") { return relative }
    return (work as NSString).appendingPathComponent(relative)
}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

var windows: [NSWindow] = []
var boxes: [ActionBox] = []
var delegates: [AnyObject] = []
var actions: [String: ([String: Any]) -> [String: Any]] = [:]

func makeWindow(_ title: String, _ width: CGFloat, _ height: CGFloat, x: CGFloat = 120, y: CGFloat = 80) -> (NSWindow, FlippedView) {
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: width, height: height),
        styleMask: [.titled, .closable],
        backing: .buffered,
        defer: false
    )
    window.title = title
    window.isReleasedWhenClosed = false
    let view = FlippedView(frame: NSRect(x: 0, y: 0, width: width, height: height))
    window.contentView = view
    let screenHeight = NSScreen.main?.frame.height ?? 900
    window.setFrameTopLeftPoint(NSPoint(x: x, y: screenHeight - y))
    windows.append(window)
    return (window, view)
}

func addLabel(_ parent: NSView, _ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat = 400) {
    let label = NSTextField(labelWithString: value)
    label.frame = NSRect(x: x, y: y, width: width, height: 22)
    label.font = .systemFont(ofSize: 13)
    parent.addSubview(label)
}

func addMultilineLabel(_ parent: NSView, _ value: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) {
    let label = NSTextField(wrappingLabelWithString: value)
    label.frame = NSRect(x: x, y: y, width: width, height: height)
    label.font = .systemFont(ofSize: 13)
    parent.addSubview(label)
}

func addEntry(_ parent: NSView, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ value: String = "", _ height: CGFloat = 30) -> NSTextField {
    let field = NSTextField(frame: NSRect(x: x, y: y, width: width, height: height))
    field.stringValue = value
    field.isBezeled = true
    field.bezelStyle = .roundedBezel
    field.font = .systemFont(ofSize: 13)
    parent.addSubview(field)
    return field
}

final class ActionBox: NSObject {
    private let handler: (Any?) -> Void

    init(_ handler: @escaping (Any?) -> Void) {
        self.handler = handler
    }

    @objc func fire(_ sender: Any?) {
        handler(sender)
    }
}

@discardableResult
func addButton(_ parent: NSView, _ title: String, _ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ handler: @escaping () -> Void) -> NSButton {
    let box = ActionBox { _ in handler() }
    boxes.append(box)
    let button = NSButton(title: title, target: box, action: #selector(ActionBox.fire(_:)))
    button.frame = NSRect(x: x, y: y, width: width, height: 32)
    button.bezelStyle = .rounded
    parent.addSubview(button)
    return button
}

@discardableResult
func addStepper(_ parent: NSView, _ x: CGFloat, _ y: CGFloat, _ initial: Int, _ field: NSTextField) -> NSStepper {
    let stepper = NSStepper(frame: NSRect(x: x, y: y, width: 24, height: 30))
    stepper.minValue = 1
    stepper.maxValue = 99
    stepper.doubleValue = Double(initial)
    let box = ActionBox { sender in
        guard let stepper = sender as? NSStepper else { return }
        field.stringValue = String(Int(stepper.doubleValue))
    }
    boxes.append(box)
    stepper.target = box
    stepper.action = #selector(ActionBox.fire(_:))
    parent.addSubview(stepper)
    return stepper
}

final class TextWatcher: NSObject, NSTextFieldDelegate {
    private let changed: (() -> Void)?
    private let ended: (() -> Void)?

    init(changed: (() -> Void)? = nil, ended: (() -> Void)? = nil) {
        self.changed = changed
        self.ended = ended
    }

    func controlTextDidChange(_ notification: Notification) {
        changed?()
    }

    func controlTextDidEndEditing(_ notification: Notification) {
        ended?()
    }
}

func watch(_ field: NSTextField, changed: (() -> Void)? = nil, ended: (() -> Void)? = nil) {
    let watcher = TextWatcher(changed: changed, ended: ended)
    delegates.append(watcher)
    field.delegate = watcher
}

func show(_ window: NSWindow) {
    window.makeKeyAndOrderFront(nil)
}

final class ControlServer {
    private let path: String
    private let queue = DispatchQueue(label: "kiko.bench.control")
    private var descriptor: Int32 = -1
    private var source: DispatchSourceRead?
    private let handler: ([String: Any]) -> [String: Any]

    init(path: String, handler: @escaping ([String: Any]) -> [String: Any]) {
        self.path = path
        self.handler = handler
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return }
        unlink(path)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let copied = path.withCString { pointer -> Bool in
            withUnsafeMutableBytes(of: &address.sun_path) { raw in
                let bytes = Array(String(cString: pointer).utf8)
                guard bytes.count < raw.count else { return false }
                raw.copyBytes(from: bytes)
                raw[bytes.count] = 0
                return true
            }
        }
        guard copied else { close(descriptor); descriptor = -1; return }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addressPointer in
                bind(descriptor, addressPointer, size)
            }
        }
        guard bound == 0, listen(descriptor, 8) == 0 else {
            close(descriptor)
            descriptor = -1
            return
        }
        let readSource = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
        readSource.setEventHandler { [weak self] in self?.acceptOne() }
        readSource.resume()
        source = readSource
    }

    deinit {
        source?.cancel()
        if descriptor >= 0 { close(descriptor) }
    }

    private func acceptOne() {
        let connection = accept(descriptor, nil, nil)
        guard connection >= 0 else { return }
        let incoming = readLine(connection)
        let parsed = try? JSONSerialization.jsonObject(with: incoming)
        let command = parsed.flatMap { $0 as? [String: Any] } ?? [:]
        DispatchQueue.main.async {
            let reply = self.handler(command)
            let payload = (try? JSONSerialization.data(withJSONObject: reply))
                ?? Data("{}".utf8)
            var output = payload
            output.append(0x0a)
            output.withUnsafeBytes { buffer in
                if let base = buffer.baseAddress {
                    _ = write(connection, base, buffer.count)
                }
            }
            close(connection)
        }
    }

    private func readLine(_ connection: Int32) -> Data {
        var incoming = Data()
        var byte: UInt8 = 0
        while true {
            let count = read(connection, &byte, 1)
            if count <= 0 || byte == 0x0a { break }
            incoming.append(byte)
        }
        return incoming
    }
}

func selectGermanLayout() {
    guard let created = TISCreateInputSourceList(nil, true)?.takeRetainedValue(),
          let sources = created as? [TISInputSource]
    else {
        return
    }
    for source in sources {
        guard let identifier = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { continue }
        let string = Unmanaged<CFString>.fromOpaque(identifier).takeUnretainedValue() as String
        if string == "com.apple.keylayout.German" {
            TISSetInputSourceEnabled(source, true)
            TISSelectInputSource(source)
            return
        }
    }
}

func buildSingleField(_ title: String) {
    let (window, view) = makeWindow("Bench Fixture", 400, 300)
    addLabel(view, title, 40, 20)
    let field = addEntry(view, 40, 50, 320)
    let key: String
    switch screen {
    case "text": key = "text"
    default: key = "code"
    }
    func saveValue() {
        save([key: field.stringValue])
    }
    addButton(view, "Save", 40, 120, 140) { saveValue() }
    actions[screen] = { command in
        switch text(command["action"]) {
        case "type": field.stringValue = text(command["text"])
        case "save": saveValue()
        default: return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
    show(window)
}

func buildSaveAs() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    addLabel(view, "Draft note", 40, 20)
    let note = addEntry(view, 40, 50, 560, text(data["text"]))
    func write(to destination: String) {
        try? note.stringValue.write(toFile: destination, atomically: true, encoding: .utf8)
        save(["saved_path": destination])
    }
    func presentSavePanel() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = text(request["name"])
        panel.directoryURL = URL(fileURLWithPath: work)
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            write(to: url.path)
        }
    }
    addButton(view, "Save As…", 40, 120, 180) { presentSavePanel() }
    actions["saveas"] = { command in
        write(to: path(text(command["text"])))
        return ["ok": true]
    }
    show(window)
}

func buildRename() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    let files = (data["files"] as? [String]) ?? []
    addLabel(view, "Files in docs/", 40, 20)
    addMultilineLabel(view, files.joined(separator: "\n"), 40, 50, 340, 200)
    addLabel(view, "Prefix", 420, 40)
    let prefixField = addEntry(view, 420, 70, 180)
    addLabel(view, "Start at", 420, 120)
    let startField = addEntry(view, 420, 150, 120, "1")
    addStepper(view, 545, 150, 1, startField)

    func renameAll(_ prefix: String, _ first: Int) {
        prefixField.stringValue = prefix
        startField.stringValue = String(first)
        var renamed: [String] = []
        for (index, name) in files.enumerated() {
            let extensionName = (name as NSString).pathExtension
            let target = extensionName.isEmpty ? "\(prefix)-\(first + index)" : "\(prefix)-\(first + index).\(extensionName)"
            let from = path("docs/\(name)")
            let to = path("docs/\(target)")
            try? FileManager.default.moveItem(atPath: from, toPath: to)
            renamed.append(target)
        }
        save(["renamed": renamed])
    }

    addButton(view, "Rename all", 420, 220, 180) {
        renameAll(prefixField.stringValue, Int(startField.stringValue) ?? 1)
    }
    actions["rename"] = { command in
        renameAll(text(command["text"]), number(command["start"]) ?? 1)
        return ["ok": true]
    }
    show(window)
}

func buildPreferences() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    let (panel, panelView) = makeWindow("Preferences", 420, 320, x: 220, y: 170)
    addLabel(view, "Change how the app looks.", 40, 20)
    addLabel(panelView, "Dark mode", 30, 20)
    let darkSwitch = NSSwitch(frame: NSRect(x: 30, y: 50, width: 60, height: 30))
    panelView.addSubview(darkSwitch)
    addLabel(panelView, "Font size", 30, 100)
    let fontField = addEntry(panelView, 30, 130, 120, "11")
    addStepper(panelView, 158, 130, 11, fontField)

    func apply(_ dark: Bool, _ font: Int) {
        darkSwitch.state = dark ? .on : .off
        fontField.stringValue = String(font)
        save(["applied": ["dark": dark, "font": font] as [String: Any]])
        panel.orderOut(nil)
    }

    addButton(panelView, "OK", 30, 200, 120) {
        apply(darkSwitch.state == .on, Int(fontField.stringValue) ?? 11)
    }
    addButton(view, "Preferences…", 40, 60, 180) { panel.makeKeyAndOrderFront(nil) }
    actions["prefs"] = { command in
        guard let dark = flag(command["dark"]), let font = number(command["font"]) else {
            return ["ok": false, "error": "the command needs dark and font"]
        }
        apply(dark, font)
        return ["ok": true]
    }
    show(window)
}

func buildBigForm() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    let fields = (data["fields"] as? [[String: Any]]) ?? []
    var entries: [NSTextField] = []
    for (index, field) in fields.enumerated() {
        let row = index / 2
        let column = index % 2
        let x = CGFloat(10 + column * 360)
        let y = CGFloat(6 + row * 29)
        addLabel(view, text(field["label"]), x, y, 110)
        entries.append(addEntry(view, x + 115, y, 200, "", 26))
    }

    func submit(_ values: [String]) {
        for (field, value) in zip(entries, values) {
            field.stringValue = value
        }
        save(["submitted": entries.map { $0.stringValue }])
    }

    addButton(view, "Submit", 10, 440, 120) { submit(entries.map { $0.stringValue }) }
    actions["bigform"] = { command in
        guard let values = command["values"] as? [String] else {
            return ["ok": false, "error": "the command needs values"]
        }
        submit(values)
        return ["ok": true]
    }
    show(window)
}

func buildModal() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    var session: NSWindow?
    addLabel(view, "Name", 40, 20)
    let nameField = addEntry(view, 40, 50, 400)
    addLabel(view, "Email", 40, 100)
    let emailField = addEntry(view, 40, 130, 400)

    func showSession() {
        guard session == nil else { return }
        let (panel, panelView) = makeWindow("Session", 420, 140, x: 240, y: 260)
        addLabel(panelView, "Your session is about to expire.", 20, 10, 380)
        addButton(panelView, "Continue", 20, 60, 140) {
            panel.orderOut(nil)
            window.removeChildWindow(panel)
            session = nil
        }
        window.addChildWindow(panel, ordered: .above)
        panel.makeKeyAndOrderFront(nil)
        session = panel
        save(["modal_shown": true])
    }

    watch(nameField, ended: { showSession() })

    func fill(_ field: String, _ value: String) -> Bool {
        if field == "name" {
            nameField.stringValue = value
            showSession()
            return true
        }
        if field == "email" {
            emailField.stringValue = value
            return true
        }
        return false
    }

    addButton(view, "Save", 40, 190, 140) {
        save(["name": nameField.stringValue, "email": emailField.stringValue])
    }
    actions["modal"] = { command in
        switch text(command["action"]) {
        case "type":
            guard fill(text(command["field"]), text(command["text"])) else {
                return ["ok": false, "error": "there is no such field"]
            }
        case "continue":
            guard let panel = session else {
                return ["ok": false, "error": "the session message is not showing"]
            }
            panel.orderOut(nil)
            window.removeChildWindow(panel)
            session = nil
        case "save":
            save(["name": nameField.stringValue, "email": emailField.stringValue])
        default:
            return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
    show(window)
}

func buildNotification() {
    let (window, view) = makeWindow("Bench Fixture", 720, 480)
    var notice: NSWindow?
    var shown = false
    addLabel(view, "Name", 40, 20)
    let nameField = addEntry(view, 40, 50, 400)
    addLabel(view, "Email", 40, 100)
    let emailField = addEntry(view, 40, 130, 400)

    func dismiss() {
        save(["dismissed": true])
        if let panel = notice {
            panel.orderOut(nil)
            window.removeChildWindow(panel)
            notice = nil
        }
    }

    func showNotice() {
        guard !shown else { return }
        shown = true
        let (panel, panelView) = makeWindow("New message", 520, 120, x: 220, y: 200)
        addLabel(panelView, "New message from Ops", 20, 10, 460)
        addButton(panelView, "Dismiss", 20, 60, 140) { dismiss() }
        window.addChildWindow(panel, ordered: .above)
        panel.makeKeyAndOrderFront(nil)
        notice = panel
        save(["notification": true])
    }

    watch(nameField, changed: {
        if !nameField.stringValue.isEmpty { showNotice() }
    })

    func fill(_ field: String, _ value: String) -> Bool {
        if field == "name" {
            nameField.stringValue = value
            showNotice()
            return true
        }
        if field == "email" {
            emailField.stringValue = value
            return true
        }
        return false
    }

    addButton(view, "Save", 40, 190, 140) {
        save(["name": nameField.stringValue, "email": emailField.stringValue])
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { showNotice() }
    actions["notification"] = { command in
        switch text(command["action"]) {
        case "type":
            guard fill(text(command["field"]), text(command["text"])) else {
                return ["ok": false, "error": "there is no such field"]
            }
        case "dismiss": dismiss()
        case "save": save(["name": nameField.stringValue, "email": emailField.stringValue])
        default: return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
    show(window)
}

func buildSameTitle() {
    let (decoy, decoyView) = makeWindow("Bench Fixture", 340, 300, x: 80, y: 80)
    addLabel(decoyView, "Scratch", 20, 20)
    let scratchField = addEntry(decoyView, 20, 50, 280)
    watch(scratchField, changed: { save(["decoy_text": scratchField.stringValue]) })

    let (target, targetView) = makeWindow("Bench Fixture", 340, 300, x: 460, y: 80)
    addLabel(targetView, "Reference code", 20, 20)
    let codeField = addEntry(targetView, 20, 50, 280)
    addButton(targetView, "Save", 20, 120, 120) { save(["target_code": codeField.stringValue]) }

    save(["decoy_text": "", "target_code": NSNull()])
    show(decoy)
    show(target)
    actions["same_title"] = { command in
        switch text(command["action"]) {
        case "type": codeField.stringValue = text(command["text"])
        case "save": save(["target_code": codeField.stringValue])
        default: return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
}

func buildOwner() {
    let (window, view) = makeWindow("Bench Fixture", 400, 300)
    let (ownerWindow, ownerView) = makeWindow("Owner Scratchpad", 380, 300, x: 460, y: 80)
    addLabel(ownerView, "Owner notes", 20, 20)
    let ownerField = addEntry(ownerView, 20, 50, 320)
    addLabel(view, "Reference code", 20, 20)
    let codeField = addEntry(view, 20, 50, 280)

    let sentence = Array(text(data["owner"]))
    var typed = 0
    let timer = Timer(timeInterval: 0.015, repeats: true) { timer in
        if typed >= sentence.count {
            timer.invalidate()
            return
        }
        typed += 1
        ownerField.stringValue = String(sentence[0..<typed])
        save(["owner_text": ownerField.stringValue])
    }
    RunLoop.main.add(timer, forMode: .common)

    addButton(view, "Save", 20, 120, 120) { save(["code": codeField.stringValue]) }
    save(["owner_text": ""])
    show(ownerWindow)
    show(window)
    actions["owner"] = { command in
        switch text(command["action"]) {
        case "type": codeField.stringValue = text(command["text"])
        case "save": save(["code": codeField.stringValue])
        default: return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
}

func buildMinimized() {
    let (window, view) = makeWindow("Bench Fixture", 400, 300)
    addLabel(view, "Reference code", 40, 20)
    let field = addEntry(view, 40, 50, 320)
    addButton(view, "Save", 40, 120, 140) { save(["code": field.stringValue]) }
    actions["minimized"] = { command in
        switch text(command["action"]) {
        case "type": field.stringValue = text(command["text"])
        case "save": save(["code": field.stringValue])
        default: return ["ok": false, "error": "unknown action"]
        }
        return ["ok": true]
    }
    show(window)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { window.miniaturize(nil) }
}

func build() {
    switch screen {
    case "saveas": buildSaveAs()
    case "rename": buildRename()
    case "prefs": buildPreferences()
    case "bigform": buildBigForm()
    case "modal": buildModal()
    case "text": buildSingleField("Gruß")
    case "minimized": buildMinimized()
    case "same_title": buildSameTitle()
    case "notification": buildNotification()
    case "owner": buildOwner()
    default: buildSingleField("Reference code")
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
if options["--layout"] == "de" {
    selectGermanLayout()
}
build()
save([:])
var controlServer: ControlServer?
controlServer = ControlServer(path: (work as NSString).appendingPathComponent("control.sock")) { command in
    guard let handler = actions[screen] else {
        return ["ok": false, "error": "the \(screen) screen has no control actions"]
    }
    return handler(command)
}
application.activate(ignoringOtherApps: true)
application.run()
