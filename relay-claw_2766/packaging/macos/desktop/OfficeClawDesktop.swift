import Cocoa
import AVFoundation
import Speech
import UserNotifications
import WebKit

@main
class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem?
    private var serviceProcess: Process?
    private var serviceStartedByLauncher = false
    private let projectRoot: String
    private let logFilePath: String
    private let runtimeStatePath: String
    private var frontendUrl: String
    private var splashView: SplashView?
    private var pendingActivationThreadId: String?
    private var pendingOAuthCallbackItems: [URLQueryItem]?
    private let speechAudioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var speechRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechRecognitionTask: SFSpeechRecognitionTask?
    private var speechSessionId: String?

    // No nib/storyboard — must wire the delegate manually.
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }

    override init() {
        let bundle = Bundle.main
        projectRoot = bundle.resourcePath ?? bundle.bundlePath
        logFilePath = NSString(string: "~/.office-claw/logs/desktop-launcher.log")
            .expandingTildeInPath
        runtimeStatePath = NSString(string: "~/.office-claw/run/macos/runtime-state.json")
            .expandingTildeInPath
        // No hardcoded port — will be read from runtime-state.json once services start.
        // Empty string signals "not yet known"; waitForFrontend polls runtime state.
        frontendUrl = ""
        super.init()
    }

    func applicationDidFinishLaunching(_: Notification) {
        ensureLogDirectory()
        UNUserNotificationCenter.current().delegate = self
        setupMainMenu()
        setupStatusBarItem()
        createMainWindow()
        showSplash()
        Task { await initialize() }
    }

    func application(_: NSApplication, open urls: [URL]) {
        for url in urls {
            if queueOAuthCallback(from: url) {
                continue
            }
        }
        Task { @MainActor in
            restoreFromExternalActivation(nil)
            navigateToPendingOAuthCallbackIfPossible()
        }
    }

    // MARK: - Main Menu (enables Cmd+C/V/X/A in WKWebView)

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About OfficeClaw", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Hide OfficeClaw", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit OfficeClaw", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit menu — connects Cmd+C/V/X/A to the responder chain so WKWebView receives them
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationWillTerminate(_: Notification) {
        stopManagedServices()
    }

    // MARK: - Window Setup

    private func createMainWindow() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 960)
        let windowRect = NSRect(
            x: screen.midX - 720, y: screen.midY - 480,
            width: 1440, height: 960
        )

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "OfficeClaw"
        window.minSize = NSSize(width: 592, height: 640)
        window.delegate = self
        window.center()

        if let iconPath = Bundle.main.path(forResource: "AppIcon", ofType: "icns") {
            NSApp.applicationIconImage = NSImage(contentsOfFile: iconPath)
        }
    }

    private func showSplash() {
        splashView = SplashView(frame: window.contentView!.bounds)
        splashView!.autoresizingMask = [.width, .height]
        window.contentView = splashView
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: - Status Bar

    private func setupStatusBarItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem?.button {
            button.image = NSImage(
                systemSymbolName: "briefcase.fill",
                accessibilityDescription: "OfficeClaw"
            )
        }

        let menu = NSMenu()
        menu.addItem(
            NSMenuItem(title: "Show OfficeClaw", action: #selector(showWindow), keyEquivalent: "")
        )
        menu.addItem(NSMenuItem.separator())
        menu.addItem(
            NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        )
        statusItem?.menu = menu
    }

    @objc private func showWindow() {
        restoreFromExternalActivation(nil)
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    // MARK: - Initialization

    private func initialize() async {
        do {
            appendLog("Launcher boot started.")
            updateSplashStatus("Checking local workspace services...")
            refreshFrontendUrlFromRuntimeState()

            if !(await isFrontendReady()) {
                updateSplashStatus("Starting local services...")
                startManagedServices()
                serviceStartedByLauncher = true
            } else {
                appendLog("Frontend already running - reusing existing services.")
            }

            updateSplashStatus("Waiting for UI...")
            try await waitForFrontend(timeout: 120)

            updateSplashStatus("Opening desktop window...")
            await MainActor.run { initializeWebView() }
            appendLog("Desktop window ready.")
        } catch {
            appendLog("Launcher failed: \(error)")
            await MainActor.run {
                let alert = NSAlert()
                alert.messageText = "OfficeClaw"
                alert.informativeText = "\(error.localizedDescription)\n\nSee log: \(logFilePath)"
                alert.alertStyle = .critical
                alert.runModal()
                NSApp.terminate(nil)
            }
        }
    }

    // MARK: - Service Management

    private func startManagedServices() {
        let startScript = (projectRoot as NSString).appendingPathComponent("scripts/start-macos.sh")
        guard FileManager.default.fileExists(atPath: startScript) else {
            appendLog("Missing startup script: \(startScript)")
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [startScript]
        process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        process.environment = buildServiceEnvironment()

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let line = String(data: data, encoding: .utf8) else { return }
            self?.appendLog("[start] \(line.trimmingCharacters(in: .newlines))")
        }

        process.terminationHandler = { [weak self] proc in
            self?.appendLog("Service host exited with code \(proc.terminationStatus).")
        }

        do {
            try process.run()
            serviceProcess = process
            appendLog("Started service host via start-macos.sh.")
        } catch {
            appendLog("Failed to start services: \(error)")
        }
    }

    private func stopManagedServices() {
        guard serviceStartedByLauncher, let process = serviceProcess, process.isRunning else {
            return
        }
        appendLog("Stopping managed services...")
        process.interrupt()

        let deadline = Date().addingTimeInterval(5)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
        }
        if process.isRunning {
            process.terminate()
            appendLog("Force-terminated service host.")
        } else {
            appendLog("Service host stopped gracefully.")
        }
    }

    private func buildServiceEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        // Clear inherited port/URL vars so bundled mode uses its own random ports,
        // not values leaked from a co-running office-claw dev environment.
        for key in ["REDIS_PORT", "REDIS_URL", "API_SERVER_PORT", "FRONTEND_PORT", "PORT"] {
            env.removeValue(forKey: key)
        }
        env["OFFICE_CLAW_RESPECT_DOTENV_PORTS"] = "1"
        env["OFFICE_CLAW_DIRECT_NO_WATCH"] = "1"
        env["OFFICE_CLAW_STRICT_PROFILE_DEFAULTS"] = "1"
        env["OFFICE_CLAW_MACOS_BUNDLED"] = "1"
        env["PATH"] = "\(projectRoot)/tools/node/bin:\(projectRoot)/tools/redis/bin:\(env["PATH"] ?? "")"
        return env
    }

    // MARK: - Frontend Health Check

    private func isFrontendReady() async -> Bool {
        guard let url = URL(string: frontendUrl) else { return false }
        var request = URLRequest(url: url, timeoutInterval: 1.5)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode < 500
            }
            return false
        } catch {
            return false
        }
    }

    private func waitForFrontend(timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            refreshFrontendUrlFromRuntimeState()
            if await isFrontendReady() { return }

            if serviceStartedByLauncher,
               let process = serviceProcess, !process.isRunning {
                throw NSError(
                    domain: "OfficeClaw", code: 1,
                    userInfo: [NSLocalizedDescriptionKey:
                        "Local services exited before the UI became ready."]
                )
            }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        throw NSError(
            domain: "OfficeClaw", code: 2,
            userInfo: [NSLocalizedDescriptionKey:
                "Timed out waiting for the frontend at \(frontendUrl)"]
        )
    }

    // MARK: - WebView

    private func initializeWebView() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.userContentController.add(self, name: "officeClawDesktop")

        let huaweiScript = WKUserScript(
            source: """
            (function(){
            var urls={
            '注册':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/userRegister/regbyemail.html?themeName=red&access_type=offline&clientID=103493351&loginChannel=88000000&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23&casLoginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&countryCode=th&scope=https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Funified.profile+https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Frisk.idstate&reqClientType=88&state=8d71793cbfd845e38ed4b62fc6801a8a&lang=zh-cn',
            '忘记密码':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/resetPwd/forgetbyid.html?reqClientType=88&loginChannel=88000000&regionCode=th&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23%2FhwIDLogin&lang=zh-cn&themeName=lightred&clientID=103493351&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin%3Fservice%3Dhttps%253A%252F%252Fversatile.cn-north-4.myhuaweicloud.com%252Fv1%252Fclaw%252Fcas%252Flogin%252Fcallback&refererPage=unified_login&srcScenID=6000014&state=3873d9b02024477f910a0c9585fa53ad#/forgetPwd/forgetbyid',
            '忘记账号名':'https://reg.huaweicloud.com/registerui/cn/index.html#/account/forgotName'
            };
            function isHuaweicloud(){try{var h=location.hostname;return h&&/\\.huaweicloud\\.com$/i.test(h)}catch(e){return false}}
            function replaceSpans(){if(!isHuaweicloud())return;Object.keys(urls).forEach(function(text){var result=document.evaluate('//span[contains(@class,\"hwid-vertical-align\") and normalize-space(text())=\"'+text+'\"]',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(var i=0;i<result.snapshotLength;i++){var s=result.snapshotItem(i);if(s.tagName==='A')continue;var linkUrl=urls[text];var parent=s.parentNode;var hwidLinkAncestor=null;while(parent&&parent!==document){if(parent.classList&&parent.classList.contains('hwid-link')){hwidLinkAncestor=parent;break}parent=parent.parentNode}if(hwidLinkAncestor){var p=s.parentNode;while(p&&p!==hwidLinkAncestor.parentNode){(function(el,url){el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(url,'_blank','noopener,noreferrer')},true)})(p,linkUrl);p=p.parentNode}}var a=document.createElement('a');a.href=linkUrl;a.className=s.className;a.textContent=s.textContent;a.style.cssText='font-size:14px;color:#000;';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(this.href,'_blank','noopener,noreferrer')});a.addEventListener('mouseenter',function(){this.style.color='#526ecc'});a.addEventListener('mouseleave',function(){this.style.color='#000'});s.parentNode.replaceChild(a,s)}})}
            replaceSpans();
            function fixPrivacyLinks(){if(!isHuaweicloud())return;var container=document.querySelector('.privacyMsg');if(!container)return;var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(this.href,'_blank','noopener,noreferrer')},true)}}
            fixPrivacyLinks();
            function hideElements(){if(!isHuaweicloud())return;var html=document.documentElement;if(html)html.style.setProperty('min-width','0','important');var body=document.body;if(body)body.style.setProperty('min-width','0','important');var idp=document.getElementById('idpLinkDiv');if(idp)idp.style.display='none';var eChannel=document.getElementById('eChannelLinkDiv');if(eChannel)eChannel.style.display='none';var vmall=document.getElementById('vmallLinkDiv');if(vmall)vmall.style.display='none';var idpLogin=document.getElementById('idpLoginLinkDiv');if(idpLogin)idpLogin.style.display='none';var intervals=document.querySelectorAll('#hwAccountLinkDiv ~ .intervalDiv');for(var i=0;i<intervals.length;i++){intervals[i].style.display='none'}}
            hideElements();
            function styleLoginAdv(){if(!isHuaweicloud())return;var container=document.getElementById('loginAdv');if(!container)return;var img=document.getElementById('loginAdImgDefault');if(img)img.style.marginRight='20px';var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.removeAttribute('href');a.removeAttribute('target')}}
            styleLoginAdv();
            if(document.readyState!=='complete'){document.addEventListener('DOMContentLoaded',function(){replaceSpans();fixPrivacyLinks();hideElements();styleLoginAdv()})}
            new MutationObserver(function(){replaceSpans();fixPrivacyLinks();hideElements();styleLoginAdv()}).observe(document.documentElement,{childList:true,subtree:true});
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(huaweiScript)

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self

        splashView = nil
        window.contentView = webView

        if let callbackURL = buildLoginCallbackURLFromPendingItems() {
            webView.load(URLRequest(url: callbackURL))
            appendLog("Applied OAuth deep link callback.")
            pendingOAuthCallbackItems = nil
        } else if let url = URL(string: frontendUrl) {
            webView.load(URLRequest(url: url))
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "officeClawDesktop" else { return }
        handleDesktopMessage(message.body)
    }

    private func queueOAuthCallback(from deepLinkURL: URL) -> Bool {
        guard let callbackItems = extractOAuthCallbackItems(from: deepLinkURL) else {
            return false
        }
        pendingOAuthCallbackItems = callbackItems
        appendLog("Received OAuth deep link callback.")
        return true
    }

    private func extractOAuthCallbackItems(from deepLinkURL: URL) -> [URLQueryItem]? {
        guard deepLinkURL.scheme?.lowercased() == "officeclaw",
              deepLinkURL.host?.lowercased() == "oauth",
              deepLinkURL.path.lowercased() == "/callback",
              let components = URLComponents(url: deepLinkURL, resolvingAgainstBaseURL: false)
        else {
            return nil
        }

        let queryItems = components.queryItems ?? []

        func queryValue(_ name: String) -> String {
            guard let raw = queryItems.first(where: { $0.name.lowercased() == name })?.value else {
                return ""
            }
            return raw.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let error = queryValue("error")
        if !error.isEmpty {
            return [URLQueryItem(name: "error", value: error)]
        }

        let code = queryValue("code")
        let state = queryValue("state")
        if !code.isEmpty && !state.isEmpty {
            return [
                URLQueryItem(name: "code", value: code),
                URLQueryItem(name: "state", value: state),
            ]
        }

        let hasCodeParam = queryItems.contains(where: { $0.name.lowercased() == "code" })
        let hasStateParam = queryItems.contains(where: { $0.name.lowercased() == "state" })
        if hasCodeParam || hasStateParam {
            return [URLQueryItem(name: "error", value: "access_denied")]
        }

        return nil
    }

    private func buildLoginCallbackURLFromPendingItems() -> URL? {
        guard let callbackItems = pendingOAuthCallbackItems,
              !frontendUrl.isEmpty,
              var frontendComponents = URLComponents(string: frontendUrl)
        else {
            return nil
        }

        frontendComponents.path = "/login/callback"
        frontendComponents.queryItems = callbackItems
        return frontendComponents.url
    }

    @MainActor
    private func navigateToPendingOAuthCallbackIfPossible() {
        guard let callbackURL = buildLoginCallbackURLFromPendingItems() else {
            return
        }
        guard webView != nil else {
            return
        }

        webView.load(URLRequest(url: callbackURL))
        pendingOAuthCallbackItems = nil
        appendLog("Handled OAuth deep link callback.")
    }

    private func handleDesktopMessage(_ body: Any) {
        guard let payload = parseDesktopMessage(body),
              let type = payload["type"] as? String
        else { return }

        if type == "desktop.notification" {
            let title = payload["title"] as? String ?? "OfficeClaw"
            let notificationBody = payload["body"] as? String ?? ""
            let notificationType = payload["notificationType"] as? String ?? "info"
            let threadId = payload["threadId"] as? String
            showDesktopNotificationIfUnfocused(
                title: title,
                body: notificationBody,
                notificationType: notificationType,
                threadId: threadId
            )
            return
        }

        if type == "voice.transcription.start" {
            let sessionId = payload["sessionId"] as? String
            let language = payload["language"] as? String
            startNativeTranscription(sessionId: sessionId, language: language)
            return
        }

        if type == "voice.transcription.stop" {
            let sessionId = payload["sessionId"] as? String
            stopNativeTranscription(sessionId: sessionId)
        }
    }

    private func startNativeTranscription(sessionId: String?, language: String?) {
        stopNativeTranscription(sessionId: nil)
        speechSessionId = (sessionId?.isEmpty == false) ? sessionId : UUID().uuidString

        let localeId = (language?.isEmpty == false) ? language! : "zh-CN"
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) ?? SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            publishVoiceMessage(type: "voice.transcription.error", text: nil, error: "Speech recognizer unavailable")
            return
        }

        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            guard let self = self else { return }
            guard authStatus == .authorized else {
                self.publishVoiceMessage(type: "voice.transcription.error", text: nil, error: "Speech authorization denied")
                return
            }

            AVCaptureDevice.requestAccess(for: .audio) { granted in
                guard granted else {
                    self.publishVoiceMessage(type: "voice.transcription.error", text: nil, error: "Microphone permission denied")
                    return
                }
                DispatchQueue.main.async {
                    self.beginSpeechRecognition(recognizer: recognizer)
                }
            }
        }
    }

    private func beginSpeechRecognition(recognizer: SFSpeechRecognizer) {
        speechRecognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = speechRecognitionRequest else { return }
        request.shouldReportPartialResults = true

        let inputNode = speechAudioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.speechRecognitionRequest?.append(buffer)
        }

        do {
            speechAudioEngine.prepare()
            try speechAudioEngine.start()
        } catch {
            publishVoiceMessage(type: "voice.transcription.error", text: nil, error: error.localizedDescription)
            return
        }

        speechRecognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.publishVoiceMessage(type: result.isFinal ? "voice.transcription.final" : "voice.transcription.partial", text: text, error: nil)
                if result.isFinal {
                    self.stopNativeTranscription(sessionId: self.speechSessionId)
                }
            }
            if let error = error {
                self.publishVoiceMessage(type: "voice.transcription.error", text: nil, error: error.localizedDescription)
                self.stopNativeTranscription(sessionId: self.speechSessionId)
            }
        }
    }

    private func stopNativeTranscription(sessionId: String?) {
        if let sessionId = sessionId, let current = speechSessionId, sessionId != current { return }
        if speechAudioEngine.isRunning {
            speechAudioEngine.stop()
        }
        speechAudioEngine.inputNode.removeTap(onBus: 0)
        speechRecognitionRequest?.endAudio()
        speechRecognitionTask?.cancel()
        speechRecognitionTask = nil
        speechRecognitionRequest = nil
        speechRecognizer = nil
        speechSessionId = nil
    }

    private func publishVoiceMessage(type: String, text: String?, error: String?) {
        var payload: [String: Any] = [
            "type": type,
            "sessionId": speechSessionId as Any,
            "text": text as Any,
            "error": error as Any
        ]
        if payload["sessionId"] == nil {
            payload["sessionId"] = NSNull()
        }
        if payload["text"] == nil {
            payload["text"] = NSNull()
        }
        if payload["error"] == nil {
            payload["error"] = NSNull()
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              var json = String(data: data, encoding: .utf8)
        else { return }

        json = json
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")

        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(
                "(function(){window.dispatchEvent(new CustomEvent('office-claw-desktop-message',{detail:JSON.parse('\(json)')}));})();",
                completionHandler: nil
            )
        }
    }

    private func parseDesktopMessage(_ body: Any) -> [String: Any]? {
        if let payload = body as? [String: Any] {
            return payload
        }

        guard let string = body as? String,
              let data = string.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        return json
    }

    private func isWindowForeground() -> Bool {
        return NSApp.isActive && window.isKeyWindow
    }

    private func showDesktopNotificationIfUnfocused(title: String, body: String, notificationType _: String, threadId: String?) {
        guard !isWindowForeground() else { return }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error = error {
                self.appendLog("Notification authorization failed: \(error.localizedDescription)")
                return
            }
            guard granted else {
                self.appendLog("Notification authorization was not granted.")
                return
            }

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            if let threadId = threadId, !threadId.isEmpty {
                content.userInfo = ["threadId": threadId]
            }

            let request = UNNotificationRequest(
                identifier: "desktop-notification-\(UUID().uuidString)",
                content: content,
                trigger: nil
            )
            UNUserNotificationCenter.current().add(request) { error in
                if let error = error {
                    self.appendLog("Desktop notification failed: \(error.localizedDescription)")
                }
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let threadId = response.notification.request.content.userInfo["threadId"] as? String
        DispatchQueue.main.async {
            self.restoreFromExternalActivation(threadId)
            completionHandler()
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    private func restoreFromExternalActivation(_ threadId: String?) {
        if let threadId = threadId, !threadId.isEmpty {
            pendingActivationThreadId = threadId
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        navigateToThreadIfReady(pendingActivationThreadId)
    }

    private func navigateToThreadIfReady(_ threadId: String?) {
        guard let threadId = threadId, !threadId.isEmpty else { return }
        guard let webView = webView else {
            pendingActivationThreadId = threadId
            return
        }

        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        let encodedThreadId = threadId.addingPercentEncoding(withAllowedCharacters: allowed) ?? threadId
        let targetPath = "/thread/\(encodedThreadId)"
        let escapedTargetPath = escapeJavaScriptSingleQuoted(targetPath)
        let script = """
        (function(){try{if(window.location.pathname!=='\(escapedTargetPath)'){window.location.assign('\(escapedTargetPath)');}}catch(_){}})();
        """
        webView.evaluateJavaScript(script) { _, error in
            if let error = error {
                self.appendLog("Failed to navigate to thread from notification: \(error.localizedDescription)")
                return
            }
            self.pendingActivationThreadId = nil
        }
    }

    private func escapeJavaScriptSingleQuoted(_ value: String) -> String {
        return value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
    }

    private func injectLoginCss() {
        let huaweiScript = """
        (function(){
        var urls={
        '注册':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/userRegister/regbyemail.html?themeName=red&access_type=offline&clientID=103493351&loginChannel=88000000&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23&casLoginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin&countryCode=th&scope=https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Funified.profile+https%3A%2F%2Fwww.huawei.com%2Fauth%2Faccount%2Frisk.idstate&reqClientType=88&state=8d71793cbfd845e38ed4b62fc6801a8a&lang=zh-cn',
        '忘记密码':'https://id5.cloud.huawei.com/UnifiedIDMPortal/portal/resetPwd/forgetbyid.html?reqClientType=88&loginChannel=88000000&regionCode=th&loginUrl=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2Flogin.html%23%2FhwIDLogin&lang=zh-cn&themeName=lightred&clientID=103493351&service=https%3A%2F%2Fauth.huaweicloud.com%2Fauthui%2FcasLogin%3Fservice%3Dhttps%253A%252F%252Fversatile.cn-north-4.myhuaweicloud.com%252Fv1%252Fclaw%252Fcas%252Flogin%252Fcallback&refererPage=unified_login&srcScenID=6000014&state=3873d9b02024477f910a0c9585fa53ad#/forgetPwd/forgetbyid',
        '忘记账号名':'https://reg.huaweicloud.com/registerui/cn/index.html#/account/forgotName'
        };
        function isHuaweicloud(){try{var h=location.hostname;return h&&/\\.huaweicloud\\.com$/i.test(h)}catch(e){return false}}
        function replaceSpans(){if(!isHuaweicloud())return;Object.keys(urls).forEach(function(text){var result=document.evaluate('//span[contains(@class,\"hwid-vertical-align\") and normalize-space(text())=\"'+text+'\"]',document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(var i=0;i<result.snapshotLength;i++){var s=result.snapshotItem(i);if(s.tagName==='A')continue;var linkUrl=urls[text];var parent=s.parentNode;var hwidLinkAncestor=null;while(parent&&parent!==document){if(parent.classList&&parent.classList.contains('hwid-link')){hwidLinkAncestor=parent;break}parent=parent.parentNode}if(hwidLinkAncestor){var p=s.parentNode;while(p&&p!==hwidLinkAncestor.parentNode){(function(el,url){el.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(url,'_blank','noopener,noreferrer')},true)})(p,linkUrl);p=p.parentNode}}var a=document.createElement('a');a.href=linkUrl;a.className=s.className;a.textContent=s.textContent;a.style.cssText='font-size:14px;color:#000;';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(this.href,'_blank','noopener,noreferrer')});a.addEventListener('mouseenter',function(){this.style.color='#526ecc'});a.addEventListener('mouseleave',function(){this.style.color='#000'});s.parentNode.replaceChild(a,s)}})}
        replaceSpans();
        function fixPrivacyLinks(){if(!isHuaweicloud())return;var container=document.querySelector('.privacyMsg');if(!container)return;var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();window.open(this.href,'_blank','noopener,noreferrer')},true)}}
        fixPrivacyLinks();
        function hideElements(){if(!isHuaweicloud())return;var html=document.documentElement;if(html)html.style.setProperty('min-width','0','important');var body=document.body;if(body)body.style.setProperty('min-width','0','important');var idp=document.getElementById('idpLinkDiv');if(idp)idp.style.display='none';var eChannel=document.getElementById('eChannelLinkDiv');if(eChannel)eChannel.style.display='none';var vmall=document.getElementById('vmallLinkDiv');if(vmall)vmall.style.display='none';var idpLogin=document.getElementById('idpLoginLinkDiv');if(idpLogin)idpLogin.style.display='none';var intervals=document.querySelectorAll('#hwAccountLinkDiv ~ .intervalDiv');for(var i=0;i<intervals.length;i++){intervals[i].style.display='none'}}
        hideElements();
        function fixForgetPwdLink(){if(!isHuaweicloud())return;var container=document.querySelector('.forgetPwdLink');if(!container)return;var forgetPwdUrl='https://auth.huaweicloud.com/authui/login.html?locale=zh-cn&UserType=e&service=https%3A%2F%2Fversatile.cn-north-4.myhuaweicloud.com%2Fv1%2Fclaw%2Fcas%2Flogin%2Fcallback#/fpwd';var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];if(a.textContent.trim()==='忘记密码'){a.className='loginBottomColor';a.removeAttribute('ng-click');a.href=forgetPwdUrl;a.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();window.open(this.href,'_blank','noopener,noreferrer')},true);break}}var spans=container.querySelectorAll('span');for(var i=0;i<spans.length;i++){var s=spans[i];if(s.textContent.trim()==='忘记密码'){var a=document.createElement('a');a.href=forgetPwdUrl;a.textContent='忘记密码';a.style.cssText='font-size:14px;color:rgba(0,0,0,.5);';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(this.href,'_blank','noopener,noreferrer')});a.addEventListener('mouseenter',function(){this.style.color='#526ecc';this.style.textDecoration='none'});a.addEventListener('mouseleave',function(){this.style.color='rgba(0,0,0,.5)'});s.parentNode.replaceChild(a,s);break}}}
        fixForgetPwdLink();
        function styleLoginAdv(){if(!isHuaweicloud())return;var container=document.getElementById('loginAdv');if(!container)return;var img=document.getElementById('loginAdImgDefault');if(img)img.style.marginRight='20px';var links=container.querySelectorAll('a');for(var i=0;i<links.length;i++){var a=links[i];a.removeAttribute('href');a.removeAttribute('target')}}
        styleLoginAdv();
        })();
        """
        webView.evaluateJavaScript(huaweiScript, completionHandler: nil)
    }

    // MARK: - Runtime State

    private func refreshFrontendUrlFromRuntimeState() {
        guard FileManager.default.fileExists(atPath: runtimeStatePath),
              let data = FileManager.default.contents(atPath: runtimeStatePath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        if let frontendPort = json["FRONTEND_PORT"] as? Int, frontendPort > 0 {
            frontendUrl = "http://127.0.0.1:\(frontendPort)/"
            return
        }
        if let portStr = json["FRONTEND_PORT"] as? String, let port = Int(portStr), port > 0 {
            frontendUrl = "http://127.0.0.1:\(port)/"
        }
    }

    // MARK: - Logging

    private func ensureLogDirectory() {
        let logDir = (logFilePath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: logDir, withIntermediateDirectories: true
        )
    }

    private func appendLog(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let line = "[\(timestamp)] \(message)\n"
        if let handle = FileHandle(forWritingAtPath: logFilePath) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8) ?? Data())
            handle.closeFile()
        } else {
            FileManager.default.createFile(
                atPath: logFilePath,
                contents: line.data(using: .utf8)
            )
        }
    }

    // MARK: - Splash

    private func updateSplashStatus(_ text: String) {
        Task { @MainActor in
            splashView?.statusText = text
        }
    }
}

// MARK: - NSWindowDelegate

extension AppDelegate: NSWindowDelegate {
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }
}

// MARK: - WKNavigationDelegate

extension AppDelegate: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           url.host != "127.0.0.1" && url.host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        injectLoginCss()
        navigateToThreadIfReady(pendingActivationThreadId)
    }
}

// MARK: - Splash View

class SplashView: NSView {
    var statusText: String = "Preparing OfficeClaw..." {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.setFill()
        dirtyRect.fill()

        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .center

        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.white,
            .font: NSFont.systemFont(ofSize: 16, weight: .medium),
            .paragraphStyle: paragraphStyle,
        ]

        let textRect = NSRect(
            x: 20, y: bounds.midY - 40,
            width: bounds.width - 40, height: 30
        )
        statusText.draw(in: textRect, withAttributes: attrs)

        let subtitleAttrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.gray,
            .font: NSFont.systemFont(ofSize: 12),
            .paragraphStyle: paragraphStyle,
        ]
        let subtitleRect = NSRect(
            x: 20, y: bounds.midY - 70,
            width: bounds.width - 40, height: 20
        )
        "Loading services...".draw(in: subtitleRect, withAttributes: subtitleAttrs)
    }
}
