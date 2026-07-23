import ClerkKit
import Combine

@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var isSignedIn = false
    @Published private(set) var email: String?
    @Published private(set) var captureOwnerID: String?
    @Published private(set) var didExplicitlySignOut = false

    private var eventTask: Task<Void, Never>?

    func load() {
        refreshState()

        guard eventTask == nil else { return }
        eventTask = Task { [weak self] in
            for await _ in Clerk.shared.auth.events {
                guard !Task.isCancelled else { return }
                self?.refreshState()
            }
        }
    }

    func signOut() async {
        didExplicitlySignOut = true
        captureOwnerID = nil
        try? await Clerk.shared.auth.signOut()
        refreshState()
    }

    private func refreshState() {
        let user = Clerk.shared.user
        isSignedIn = Clerk.shared.session?.status == .active
        if isSignedIn {
            didExplicitlySignOut = false
            captureOwnerID = user?.id
        } else if didExplicitlySignOut {
            captureOwnerID = nil
        }
        email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses.first?.emailAddress
    }
}
