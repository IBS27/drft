import ClerkConvex
import Combine
// ConvexMobile 0.8.1 does not yet annotate ConvexClientWithAuth as Sendable.
@preconcurrency import ConvexMobile
import Foundation

@MainActor
final class ConvexService: ObservableObject {
    @Published private(set) var authenticatedUserID: String?

    private struct TokenClaims: Decodable {
        let sub: String
    }

    private let authProvider: ClerkConvexAuthProvider
    private let client: ConvexClientWithAuth<String>
    private var authStateCancellable: AnyCancellable?

    init() {
        let authProvider = ClerkConvexAuthProvider()
        let client = ConvexClientWithAuth(
            deploymentUrl: "https://hidden-penguin-861.convex.cloud",
            authProvider: authProvider
        )
        self.authProvider = authProvider
        self.client = client

        authStateCancellable = client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                switch state {
                case .authenticated(let token):
                    self?.authenticatedUserID = Self.userID(from: token)
                case .loading, .unauthenticated:
                    self?.authenticatedUserID = nil
                }
            }
    }

    func capture(text: String) async throws -> String {
        try await client.mutation("thoughts:capture", with: ["text": text])
    }

    private static func userID(from token: String) -> String? {
        let segments = token.split(separator: ".")
        guard segments.count > 1 else { return nil }

        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - payload.count % 4) % 4
        payload.append(String(repeating: "=", count: padding))

        guard let data = Data(base64Encoded: payload) else { return nil }
        return try? JSONDecoder().decode(TokenClaims.self, from: data).sub
    }
}
