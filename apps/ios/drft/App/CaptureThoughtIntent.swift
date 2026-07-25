import AppIntents

struct CaptureThoughtIntent: AppIntent, URLRepresentableIntent {
    static let title: LocalizedStringResource = "Capture a thought"
    static let description = IntentDescription("Open drft ready to capture a thought.")
    static var urlRepresentation: URLRepresentation { "drft://capture" }
}

struct DrftAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureThoughtIntent(),
            phrases: [
                "Capture a thought in \(.applicationName)"
            ],
            shortTitle: "Capture a thought",
            systemImageName: "circle.fill"
        )
    }
}
