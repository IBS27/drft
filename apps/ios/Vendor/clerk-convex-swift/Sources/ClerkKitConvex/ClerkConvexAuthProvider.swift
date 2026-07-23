import ClerkKit
@preconcurrency import ConvexMobile

@MainActor
public final class ClerkConvexAuthProvider: AuthProvider {
    public typealias T = String

    private static let jwtTemplate = "convex"

    private var onIdToken: (@Sendable (String?) -> Void)?
    private var tokenRefreshListenerTask: Task<Void, Never>?
    private var sessionSyncTask: Task<Void, Never>?
    private weak var client: ConvexClientWithAuth<String>?

    public init() {}

    public func bind(client: ConvexClientWithAuth<String>) {
        self.client = client
        startSessionSync()
    }

    public func login(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> String {
        try await authenticate(onIdToken: onIdToken)
    }

    public func loginFromCache(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> String {
        try await authenticate(onIdToken: onIdToken)
    }

    public func logout() async throws {
        tokenRefreshListenerTask?.cancel()
        tokenRefreshListenerTask = nil
        onIdToken = nil
        try await Clerk.shared.auth.signOut()
    }

    public nonisolated func extractIdToken(from authResult: String) -> String {
        authResult
    }

    private func authenticate(
        onIdToken: @Sendable @escaping (String?) -> Void
    ) async throws -> String {
        self.onIdToken = onIdToken
        let token = try await fetchToken()
        setupTokenRefreshListener()
        return token
    }

    private func fetchToken() async throws -> String {
        guard Clerk.shared.isLoaded else {
            throw ClerkConvexAuthError.clerkNotLoaded
        }
        guard let session = Clerk.shared.session, session.status == .active else {
            throw ClerkConvexAuthError.noActiveSession
        }
        guard let token = try await session.getToken(
            .init(template: Self.jwtTemplate)
        ) else {
            throw ClerkConvexAuthError.tokenRetrievalFailed("Token returned nil")
        }
        return token
    }

    private func setupTokenRefreshListener() {
        tokenRefreshListenerTask?.cancel()
        tokenRefreshListenerTask = Task { [weak self] in
            guard let self else { return }

            for await event in Clerk.shared.auth.events {
                guard !Task.isCancelled else { break }
                guard case .tokenRefreshed = event else { continue }

                do {
                    onIdToken?(try await fetchToken())
                } catch {
                    onIdToken?(nil)
                }
            }
        }
    }

    private func startSessionSync() {
        sessionSyncTask?.cancel()
        sessionSyncTask = Task { @MainActor [weak self] in
            guard let self else { return }

            await syncSession(newSession: Clerk.shared.session)
            for await event in Clerk.shared.auth.events {
                guard !Task.isCancelled else { break }
                guard case .sessionChanged(let oldSession, let newSession) = event else {
                    continue
                }
                await syncSession(oldSession: oldSession, newSession: newSession)
            }
        }
    }

    private func syncSession(oldSession: Session? = nil, newSession: Session?) async {
        guard let client else { return }

        if shouldLogin(oldSession: oldSession, newSession: newSession) {
            _ = await client.loginFromCache()
        } else if shouldLogout(oldSession: oldSession, newSession: newSession) {
            await client.logout()
        }
    }

    private func shouldLogin(oldSession: Session?, newSession: Session?) -> Bool {
        newSession?.status == .active &&
            (oldSession?.status != .active || oldSession?.id != newSession?.id)
    }

    private func shouldLogout(oldSession: Session?, newSession: Session?) -> Bool {
        oldSession?.id != nil && newSession == nil
    }
}
