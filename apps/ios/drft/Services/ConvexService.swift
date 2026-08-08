import ClerkConvex
import Combine
// ConvexMobile 0.8.1 does not yet annotate ConvexClientWithAuth as Sendable.
@preconcurrency import ConvexMobile
import Foundation

@MainActor
final class ConvexService: ObservableObject {
    @Published private(set) var authenticatedUserID: String?

    struct Collection: Decodable {
        let thoughts: [CollectionThought]
        let resurfacedId: String?
    }

    struct CollectionThought: Decodable, Identifiable, Equatable {
        let _id: String
        let preview: String
        let createdAt: Double

        var id: String { _id }
    }

    struct Thought: Decodable, Equatable {
        enum Status: String, Decodable {
            case open
            case resting
        }

        let _id: String
        let text: String
        let createdAt: Double
        let status: Status
        let restingNote: String?
        let restedAt: Double?
        let lastReturnedAt: Double?
        let connections: [Connection]
    }

    struct Connection: Decodable, Equatable {
        enum ThoughtStatus: String, Decodable {
            case open
            case resting
        }

        let _id: String
        let otherId: String
        let otherText: String
        let otherCreatedAt: Double
        let otherStatus: ThoughtStatus
    }

    private struct DailyThoughtSettings: Decodable {
        let sendTime: String
    }

    private struct TokenClaims: Decodable {
        let sub: String
    }

    private let authProvider: ClerkConvexAuthProvider
    private let client: ConvexClientWithAuth<String>
    private var authStateCancellable: AnyCancellable?

    // Debug builds (Xcode runs) use the dev deployment; Release builds on device use prod.
    #if DEBUG
    static let deploymentUrl = "https://hidden-penguin-861.convex.cloud"
    #else
    static let deploymentUrl = "https://optimistic-stork-701.convex.cloud"
    #endif

    init() {
        let authProvider = ClerkConvexAuthProvider()
        let client = ConvexClientWithAuth(
            deploymentUrl: Self.deploymentUrl,
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

    func collection(date: String) -> AnyPublisher<Collection, ClientError> {
        client.subscribe(
            to: "thoughts:collection",
            with: ["date": date],
            yielding: Collection.self
        )
    }

    func thought(id: String) -> AnyPublisher<Thought?, ClientError> {
        client.subscribe(
            to: "thoughts:view",
            with: ["thoughtId": id],
            yielding: Thought?.self
        )
    }

    func rest(thoughtID: String, closingLine: String?) async throws {
        if let closingLine {
            try await client.mutation(
                "thoughts:rest",
                with: [
                    "thoughtId": thoughtID,
                    "note": closingLine,
                ]
            )
        } else {
            try await client.mutation(
                "thoughts:rest",
                with: ["thoughtId": thoughtID]
            )
        }
    }

    func dismissConnection(id: String) async throws {
        try await client.mutation(
            "thoughts:dismissConnection",
            with: ["connectionId": id]
        )
    }

    func undismissConnection(id: String) async throws {
        try await client.mutation(
            "thoughts:undismissConnection",
            with: ["connectionId": id]
        )
    }

    func dailyThoughtSendTime() async throws -> String? {
        let settings = client.subscribe(
            to: "settings:get",
            yielding: DailyThoughtSettings?.self
        )
        for try await value in settings.first().values {
            return value?.sendTime
        }
        return nil
    }

    func saveDailyThoughtSettings(
        sendTime: String,
        timezone: String,
        email: String?
    ) async throws {
        if let email {
            try await client.mutation(
                "settings:save",
                with: [
                    "sendTime": sendTime,
                    "timezone": timezone,
                    "email": email,
                ]
            )
        } else {
            try await client.mutation(
                "settings:save",
                with: [
                    "sendTime": sendTime,
                    "timezone": timezone,
                ]
            )
        }
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
