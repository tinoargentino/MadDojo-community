import Cocoa

final class AppDelegate: NSObject, NSApplicationDelegate {
    var server: Process?
    var status: NSStatusItem!
    var openItem: NSMenuItem!
    var timer: Timer?
    var serverURL: URL?
    let readyFile = FileManager.default.temporaryDirectory.appendingPathComponent("maddojo-\(UUID().uuidString).ready")
    var logURL: URL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "MadDojo")
        let menu = NSMenu()
        openItem = NSMenuItem(title: "Starting MadDojo…", action: #selector(openApp), keyEquivalent: "o")
        openItem.target = self
        openItem.isEnabled = false
        menu.autoenablesItems = false
        menu.addItem(openItem)
        let quit = NSMenuItem(title: "Quit MadDojo", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(.separator())
        menu.addItem(quit)
        status.menu = menu
        do {
            let resources = Bundle.main.resourceURL!
            let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/MadDojo")
            try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            logURL = logs.appendingPathComponent("server.log")
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
            let log = try FileHandle(forWritingTo: logURL)
            let task = Process()
            task.executableURL = resources.appendingPathComponent("runtime/bin/python3.11")
            task.currentDirectoryURL = resources.appendingPathComponent("app")
            task.arguments = ["-m", "backend.desktop", "--ready-file", readyFile.path]
            var env = ProcessInfo.processInfo.environment
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            env.removeValue(forKey: "PYTHONHOME")
            env.removeValue(forKey: "PYTHONPATH")
            task.environment = env
            task.standardOutput = log
            task.standardError = log
            server = task
            try task.run()
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.checkReady() }
        } catch { showError(error.localizedDescription) }
    }
    func checkReady() {
        if let text = try? String(contentsOf: readyFile, encoding: .utf8), let url = URL(string: text) {
            timer?.invalidate()
            serverURL = url
            openItem.title = "Open MadDojo"
            openItem.isEnabled = true
            NSWorkspace.shared.open(url)
        } else if let task = server, !task.isRunning {
            timer?.invalidate()
            showError("The local server could not start. Details are in \(logURL.path).")
        }
    }
    func showError(_ text: String) {
        let alert = NSAlert()
        alert.messageText = "MadDojo could not start"
        alert.informativeText = text
        alert.runModal()
        NSApp.terminate(nil)
    }
    @objc func openApp() { if let url = serverURL { NSWorkspace.shared.open(url) } }
    @objc func quitApp() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        if let task = server, task.isRunning { task.terminate(); task.waitUntilExit() }
        try? FileManager.default.removeItem(at: readyFile)
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
