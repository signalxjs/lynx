import SwiftUI
import UIKit

/// Action callbacks the dev menu invokes. Mirrors the shape of Android's
/// `DevMenuActions` so iOS templates wire up the same set of buttons.
public struct DevMenuActions {
    public let onReload: () -> Void
    public let onChangeUrl: (String) -> Void
    public let onCopyUrl: () -> Void
    /// Sandbox-host hook: when non-nil, the dev menu shows a "Back to Home"
    /// button that disconnects from the current bundle and returns to
    /// `DevHomeScreen` (so the user can pick a different URL). Nil for apps
    /// with a baked bundle — there's no home to return to.
    public let onDisconnect: (() -> Void)?
    /// Dev-tool toggles (mirror Android). When non-nil, the menu shows a
    /// "Dev Tools" section with the perf HUD / logbox / inspector switches.
    public let onTogglePerfHud: (() -> Void)?
    public let onToggleLogBox: (() -> Void)?
    public let onToggleInspector: (() -> Void)?
    public let perfHudEnabled: Bool
    public let logBoxEnabled: Bool
    public let inspectorEnabled: Bool
    public let currentUrl: String
    public let nativeModules: [String]

    public init(
        onReload: @escaping () -> Void,
        onChangeUrl: @escaping (String) -> Void,
        onCopyUrl: @escaping () -> Void,
        onDisconnect: (() -> Void)? = nil,
        onTogglePerfHud: (() -> Void)? = nil,
        onToggleLogBox: (() -> Void)? = nil,
        onToggleInspector: (() -> Void)? = nil,
        currentUrl: String,
        perfHudEnabled: Bool = false,
        logBoxEnabled: Bool = false,
        inspectorEnabled: Bool = false,
        nativeModules: [String] = []
    ) {
        self.onReload = onReload
        self.onChangeUrl = onChangeUrl
        self.onCopyUrl = onCopyUrl
        self.onDisconnect = onDisconnect
        self.onTogglePerfHud = onTogglePerfHud
        self.onToggleLogBox = onToggleLogBox
        self.onToggleInspector = onToggleInspector
        self.perfHudEnabled = perfHudEnabled
        self.logBoxEnabled = logBoxEnabled
        self.inspectorEnabled = inspectorEnabled
        self.currentUrl = currentUrl
        self.nativeModules = nativeModules
    }
}

/// SwiftUI dev menu sheet. Present with `.sheet(isPresented:)`, then bind the
/// dismissal back through `isPresented`.
public struct DevMenuView: View {
    @Binding var isPresented: Bool
    let actions: DevMenuActions

    @State private var newUrl: String = ""
    @State private var showUrlInput: Bool = false
    @State private var copyToast: String?
    // Local mirrors of the toggle state so checkmarks update live while the
    // menu stays open (DevMenuActions is an immutable snapshot per presentation).
    @State private var perfHudOn: Bool = false
    @State private var logBoxOn: Bool = false
    @State private var inspectorOn: Bool = false

    public init(isPresented: Binding<Bool>, actions: DevMenuActions) {
        self._isPresented = isPresented
        self.actions = actions
    }

    public var body: some View {
        NavigationView {
            List {
                Section {
                    Button {
                        actions.onReload()
                        isPresented = false
                    } label: {
                        Label("Reload", systemImage: "arrow.clockwise")
                    }

                    DisclosureGroup(isExpanded: $showUrlInput) {
                        HStack {
                            TextField("Server URL", text: $newUrl)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .disableAutocorrection(true)
                                .submitLabel(.go)
                                .onSubmit { submitUrl() }
                            Button("Go") { submitUrl() }
                                .buttonStyle(.borderedProminent)
                                .disabled(newUrl.isEmpty)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Label("Change Dev Server", systemImage: "pencil")
                            if !showUrlInput {
                                Text(actions.currentUrl)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .padding(.leading, 28)
                            }
                        }
                    }

                    Button {
                        actions.onCopyUrl()
                        copyToast = "URL copied"
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                            copyToast = nil
                            isPresented = false
                        }
                    } label: {
                        Label(copyToast ?? "Copy URL", systemImage: "doc.on.doc")
                    }

                    if let onDisconnect = actions.onDisconnect {
                        Button(role: .destructive) {
                            isPresented = false
                            onDisconnect()
                        } label: {
                            Label("Back to Home", systemImage: "house")
                        }
                    }
                }

                if actions.onTogglePerfHud != nil || actions.onToggleLogBox != nil || actions.onToggleInspector != nil {
                    Section("Dev Tools") {
                        if let toggle = actions.onTogglePerfHud {
                            Button { perfHudOn.toggle(); toggle() } label: {
                                toggleRow("Performance HUD", systemImage: "gauge", on: perfHudOn)
                            }
                        }
                        if let toggle = actions.onToggleLogBox {
                            Button { logBoxOn.toggle(); toggle() } label: {
                                toggleRow("LogBox", systemImage: "exclamationmark.bubble", on: logBoxOn)
                            }
                        }
                        if let toggle = actions.onToggleInspector {
                            Button { inspectorOn.toggle(); toggle() } label: {
                                toggleRow("Element Inspector", systemImage: "magnifyingglass", on: inspectorOn)
                            }
                        }
                    }
                }

                if !actions.nativeModules.isEmpty {
                    Section("Native Modules (\(actions.nativeModules.count))") {
                        ForEach(actions.nativeModules, id: \.self) { name in
                            Text(name)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("sigx Dev Menu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { isPresented = false }
                }
            }
            .onAppear {
                newUrl = actions.currentUrl
                perfHudOn = actions.perfHudEnabled
                logBoxOn = actions.logBoxEnabled
                inspectorOn = actions.inspectorEnabled
            }
        }
    }

    private func submitUrl() {
        guard !newUrl.isEmpty else { return }
        actions.onChangeUrl(newUrl)
        showUrlInput = false
        isPresented = false
    }

    /// A dev-menu row with a leading icon/label and a trailing checkmark when on.
    private func toggleRow(_ title: String, systemImage: String, on: Bool) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
            Spacer()
            if on {
                Image(systemName: "checkmark").foregroundColor(.accentColor)
            }
        }
    }
}
