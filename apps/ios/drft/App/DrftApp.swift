import ClerkKit
import SwiftUI

@MainActor
@main
struct DrftApp: App {
    @StateObject private var authService: AuthService
    @StateObject private var convexService: ConvexService
    @State private var captureFocusRequest = 0
    private let captureQueue: CaptureQueue

    init() {
        Clerk.configure(
            publishableKey: "pk_test_ZW5hYmxpbmctd29sZi0yMi5jbGVyay5hY2NvdW50cy5kZXYk",
            options: .init(
                redirectConfig: .init(
                    redirectUrl: "drft://callback",
                    callbackUrlScheme: "drft"
                )
            )
        )

        let authService = AuthService()
        let convexService = ConvexService()
        let captureQueue = CaptureQueue { text in
            try await convexService.capture(text: text)
        }
        authService.load()

        _authService = StateObject(wrappedValue: authService)
        _convexService = StateObject(wrappedValue: convexService)
        self.captureQueue = captureQueue
    }

    var body: some Scene {
        WindowGroup {
            RootView(
                authService: authService,
                convexService: convexService,
                captureQueue: captureQueue,
                captureFocusRequest: captureFocusRequest
            )
            .environment(Clerk.shared)
            .onOpenURL { url in
                if url.scheme == "drft" && url.host == "capture" {
                    captureFocusRequest += 1
                    return
                }
                Task {
                    _ = try? await Clerk.shared.handle(url)
                }
            }
        }
    }
}
