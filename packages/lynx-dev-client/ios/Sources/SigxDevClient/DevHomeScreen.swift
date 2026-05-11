import SwiftUI

/// Dev-mode landing screen for sigx-lynx apps that ship without a bundled
/// `main.lynx.bundle`. Lets the user enter a dev-server URL by hand, scan a
/// QR code, or pick from recent URLs. The app template renders this when it
/// has no `--sigx_dev_url` launch arg AND no bundle in `Bundle.main`.
///
/// Wraps itself in a `NavigationStack` so it owns the title bar; consumer just
/// drops `DevHomeScreen { url in /* navigate to LynxView */ }` at the root.
public struct DevHomeScreen: View {
    let onSelectUrl: (String) -> Void

    @State private var urlText = ""
    @State private var recentUrls: [String] = []
    @State private var showQRScanner = false

    public init(onSelectUrl: @escaping (String) -> Void) {
        self.onSelectUrl = onSelectUrl
    }

    public var body: some View {
        // NavigationView (iOS 13+) rather than NavigationStack (iOS 16+) so
        // the dev client works on apps with deployment target 15.0.
        NavigationView {
            VStack(spacing: 0) {
                VStack(spacing: 12) {
                    HStack {
                        TextField("Dev server URL", text: $urlText)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .submitLabel(.go)
                            .onSubmit { connect() }

                        Button(action: { showQRScanner = true }) {
                            Image(systemName: "qrcode.viewfinder")
                                .font(.title2)
                        }
                    }

                    Button(action: connect) {
                        Text("Connect")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding()

                Divider()

                if recentUrls.isEmpty {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text("Enter a dev server URL or scan a QR code")
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    Spacer()
                } else {
                    HStack {
                        Text("Recent")
                            .font(.headline)
                        Spacer()
                        Button("Clear") {
                            SigxDevClient.clearRecentUrls()
                            recentUrls = []
                        }
                        .font(.subheadline)
                    }
                    .padding(.horizontal)
                    .padding(.top, 12)

                    List {
                        ForEach(recentUrls, id: \.self) { url in
                            Button(action: {
                                urlText = url
                                connectTo(url)
                            }) {
                                Text(url)
                                    .lineLimit(1)
                                    .foregroundColor(.primary)
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                SigxDevClient.removeRecentUrl(recentUrls[index])
                            }
                            recentUrls = SigxDevClient.recentUrls
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("sigx-lynx dev")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showQRScanner) {
                NavigationView {
                    DevQRScanner { code in
                        showQRScanner = false
                        urlText = code
                        connectTo(code)
                    }
                }
            }
            .onAppear {
                recentUrls = SigxDevClient.recentUrls
            }
        }
    }

    private func connect() {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        connectTo(trimmed)
    }

    private func connectTo(_ url: String) {
        SigxDevClient.addRecentUrl(url)
        recentUrls = SigxDevClient.recentUrls
        onSelectUrl(url)
    }
}
