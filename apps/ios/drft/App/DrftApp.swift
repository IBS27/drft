import ClerkKit
import Foundation
import SwiftUI

@MainActor
@main
struct DrftApp: App {
    @StateObject private var authService: AuthService
    @StateObject private var convexService: ConvexService
    @State private var captureFocusRequest = 0
    private let captureQueue: CaptureQueue

    private static var clerkPublishableKey: String {
        guard
            let key = Bundle.main.object(
                forInfoDictionaryKey: "ClerkPublishableKey"
            ) as? String,
            key.hasPrefix("pk_test_") || key.hasPrefix("pk_live_")
        else {
            preconditionFailure(
                "Set CLERK_PUBLISHABLE_KEY for this iOS build configuration."
            )
        }
        return key
    }

    init() {
        Clerk.configure(
            publishableKey: Self.clerkPublishableKey,
            options: .init(
                redirectConfig: .init(
                    redirectUrl: "drft://callback",
                    callbackUrlScheme: "drft"
                )
            )
        )

        let authService = AuthService()
        let convexService = ConvexService()
        let captureQueue = CaptureQueue(deploymentUrl: ConvexService.deploymentUrl) { text in
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
