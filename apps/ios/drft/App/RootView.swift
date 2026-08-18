import ClerkKit
import SwiftUI

struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var authService: AuthService
    @ObservedObject var convexService: ConvexService
    let captureQueue: CaptureQueue
    let captureFocusRequest: Int
    @State private var hasEnteredCapture = false
    @State private var cameFromBackground = false
    @State private var captureIsPresented = true
    @State private var captureDragOffset: CGFloat = 0

    var body: some View {
        Group {
            if !clerk.isLoaded {
                if authService.rememberedUserID != nil && !authService.didExplicitlySignOut {
                    captureAndShelf
                } else {
                    Stillness.page.ignoresSafeArea()
                }
            } else if authService.isSignedIn || (hasEnteredCapture && !authService.didExplicitlySignOut) {
                captureAndShelf
            } else {
                SignInView()
            }
        }
        .task {
            authService.load()
        }
        .onChange(of: clerk.isLoaded) { _, _ in
            authService.load()
        }
        .onChange(of: authService.isSignedIn, initial: true) { _, isSignedIn in
            guard isSignedIn else { return }
            hasEnteredCapture = true
            presentCapture()
        }
        .onChange(of: authService.didExplicitlySignOut) { _, didSignOut in
            guard didSignOut else { return }
            hasEnteredCapture = false
            Task {
                await convexService.clearLocalCaches()
            }
        }
        .onChange(of: convexService.authenticatedUserID, initial: true) { _, userID in
            // Items are enqueued under Clerk's user.id but flushed by matching
            // the Convex JWT's sub claim. The default Clerk `convex` template
            // makes these equal; if the template ever diverges, captures
            // strand on disk while the UI keeps confirming — fail loudly.
            if let userID, let ownerID = authService.captureOwnerID, userID != ownerID {
                assertionFailure(
                    "Convex JWT sub (\(userID)) != Clerk user id (\(ownerID)); queued captures will never flush"
                )
            }
            captureQueue.updateAuthenticatedUserID(userID)
        }
        .onChange(of: captureFocusRequest) {
            presentCapture()
        }
        // Re-entering the app lands on capture ("the shelf is never the
        // resume state"), but only a true return from background counts:
        // resume passes through .inactive, and notification-shade or
        // Control Center blips visit .inactive without ever leaving, so
        // the flag — not any single phase transition — decides.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                cameFromBackground = true
            } else if phase == .active, cameFromBackground {
                cameFromBackground = false
                presentCapture()
            }
        }
    }

    private var captureAndShelf: some View {
        GeometryReader { geometry in
            ZStack {
                ShelfView(
                    authService: authService,
                    convexService: convexService,
                    isVisible: !captureIsPresented || captureDragOffset > 0,
                    onCatchThought: presentCapture
                )

                CaptureView(
                    captureQueue: captureQueue,
                    authService: authService,
                    convexService: convexService,
                    focusRequest: captureFocusRequest,
                    isPresented: captureIsPresented,
                    onShelfDragChanged: updateCaptureDrag,
                    onRevealShelf: revealShelf
                )
                .offset(
                    y: captureIsPresented
                        ? captureDragOffset
                        : geometry.size.height + geometry.safeAreaInsets.bottom + 24
                )
                .allowsHitTesting(captureIsPresented)
                .zIndex(1)
            }
            .clipped()
        }
        .background(Stillness.page)
    }

    private func updateCaptureDrag(_ offset: CGFloat) {
        if offset == 0 {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                captureDragOffset = 0
            }
        } else {
            captureDragOffset = offset
        }
    }

    private func revealShelf() {
        withAnimation(.easeInOut(duration: 0.34)) {
            captureIsPresented = false
            captureDragOffset = 0
        }
    }

    private func presentCapture() {
        captureDragOffset = 0
        withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) {
            captureIsPresented = true
        }
    }
}
