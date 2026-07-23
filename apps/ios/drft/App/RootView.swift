import ClerkKit
import SwiftUI

struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @ObservedObject var authService: AuthService
    @ObservedObject var convexService: ConvexService
    let captureQueue: CaptureQueue
    let captureFocusRequest: Int
    @State private var hasEnteredCapture = false

    var body: some View {
        Group {
            if !clerk.isLoaded {
                Stillness.page.ignoresSafeArea()
            } else if authService.isSignedIn || (hasEnteredCapture && !authService.didExplicitlySignOut) {
                CaptureView(
                    captureQueue: captureQueue,
                    authService: authService,
                    focusRequest: captureFocusRequest
                )
            } else {
                SignInView()
            }
        }
        .task {
            authService.load()
        }
        .onChange(of: authService.isSignedIn, initial: true) { _, isSignedIn in
            guard isSignedIn else { return }
            hasEnteredCapture = true
        }
        .onChange(of: authService.didExplicitlySignOut) { _, didSignOut in
            guard didSignOut else { return }
            hasEnteredCapture = false
        }
        .onChange(of: convexService.authenticatedUserID, initial: true) { _, userID in
            captureQueue.updateAuthenticatedUserID(userID)
        }
    }
}
