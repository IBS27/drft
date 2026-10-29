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
    /// Set when this device's account was deleted, so what the device kept
    /// for it (queued captures) can be discarded.
    @Published private(set) var deletedAccountID: String?

    private static let rememberedUserIDKey = "rememberedUserID"
    private static let dailyThoughtTimeKey = "dailyThoughtTime"
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
        do {
            try await Clerk.shared.auth.signOut()
        } catch {
            // A deleted user's session is already gone on the server, so
            // removing it can fail; the refreshed client carries none.
            _ = try? await Clerk.shared.refreshClient()
        }
        isSigningOut = false
        refreshState()
    }

    enum AccountDeletionError: Error {
        case notSignedIn
    }

    /// Deletes the account on the server, then forgets it on this device.
    /// Once the server has the request the deletion is final; it finishes
    /// removing the data and the Clerk user on its own.
    func deleteAccount(using convexService: ConvexService) async throws {
        guard let user = Clerk.shared.user else { throw AccountDeletionError.notSignedIn }

        // Best effort, never a gate: without a code (dismissed sheet, another
        // Apple ID on this device) the deletion goes ahead unrevoked.
        var appleAuthorizationCode: String?
        if let apple = user.externalAccounts.first(where: { $0.provider == "oauth_apple" }) {
            appleAuthorizationCode = try? await AppleReauthorization.authorizationCode(
                forAppleUserID: apple.providerUserId
            )
        }

        do {
            try await convexService.deleteAccount(appleAuthorizationCode: appleAuthorizationCode)
        } catch {
            // The reply can be lost after the server already deleted the
            // user; Clerk no longer knowing the account is the proof.
            guard (try? await Clerk.shared.refreshClient()) != nil,
                  Clerk.shared.user?.id != user.id
            else { throw error }
        }

        deletedAccountID = user.id
        defaults.removeObject(forKey: Self.dailyThoughtTimeKey)
        // Clerk already ended the session with the user; this clears its
        // local state and the remembered identity.
        await signOut()
    }

    private func refreshState() {
        let user = Clerk.shared.user
        // A deleted account never counts as signed in, even while Clerk's
        // local copy of its session lingers.
        let isDeletedAccount = user?.id != nil && user?.id == deletedAccountID
        isSignedIn = Clerk.shared.session?.status == .active && !isDeletedAccount
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
