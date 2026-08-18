import ClerkKit
import Combine
import Foundation

@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var isSignedIn = false
    @Published private(set) var email: String?
    @Published private(set) var captureOwnerID: String?
    @Published private(set) var rememberedUserID: String?
    @Published private(set) var didExplicitlySignOut = false

    private static let rememberedUserIDKey = "rememberedUserID"
    private let defaults: UserDefaults
    private var eventTask: Task<Void, Never>?
    private var isSigningOut = false

    init() {
        defaults = UserDefaults(suiteName: "group.com.srinivasib.drft") ?? .standard
        let rememberedUserID = defaults.string(forKey: Self.rememberedUserIDKey)
        self.rememberedUserID = rememberedUserID
        captureOwnerID = rememberedUserID
    }

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
        // Ignore Clerk events that arrive before its active session is replaced.
        isSigningOut = true
        didExplicitlySignOut = true
        captureOwnerID = nil
        rememberedUserID = nil
        defaults.removeObject(forKey: Self.rememberedUserIDKey)
        try? await Clerk.shared.auth.signOut()
        isSigningOut = false
        refreshState()
    }

    private func refreshState() {
        let user = Clerk.shared.user
        isSignedIn = Clerk.shared.session?.status == .active
        if isSignedIn && !isSigningOut {
            didExplicitlySignOut = false
            if let userID = user?.id {
                captureOwnerID = userID
                rememberedUserID = userID
                defaults.set(userID, forKey: Self.rememberedUserIDKey)
            }
        } else if didExplicitlySignOut {
            captureOwnerID = nil
        }
        email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses.first?.emailAddress
    }
}
