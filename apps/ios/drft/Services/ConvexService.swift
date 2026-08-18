import ClerkConvex
import Combine
// ConvexMobile 0.8.1 does not yet annotate ConvexClientWithAuth as Sendable.
@preconcurrency import ConvexMobile
import Foundation

@MainActor
final class ConvexService: ObservableObject {
    @Published private(set) var authenticatedUserID: String?

    struct Collection: Codable, Equatable, Sendable {
        let thoughts: [CollectionThought]
        let resurfacedId: String?
    }

    struct CollectionThought: Codable, Identifiable, Equatable, Sendable {
        let _id: String
        let preview: String
        let createdAt: Double

        var id: String { _id }
    }

    struct Thought: Decodable, Equatable, Sendable {
        enum Status: String, Decodable, Sendable {
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

    struct Connection: Decodable, Equatable, Sendable {
        enum ThoughtStatus: String, Decodable, Sendable {
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
    private let collectionCache: CollectionCache
    private var authStateCancellable: AnyCancellable?
    private var thoughtCache: [String: Thought] = [:]
    private var thoughtRecency: [String] = []
    private var prewarmSubscriptions: [String: AnyCancellable] = [:]
    private var prewarmTasks: [String: Task<Void, Never>] = [:]
    private var isLocalCachingSuspended = false

    private static let thoughtCacheLimit = 24
    private static let prewarmDuration: Duration = .seconds(30)
    private static let prewarmLimit = 8

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
        collectionCache = CollectionCache(deploymentURL: Self.deploymentUrl)

        authStateCancellable = client.authState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                switch state {
                case .authenticated(let token):
                    let userID = Self.userID(from: token)
                    if self?.authenticatedUserID == nil, userID != nil {
                        self?.isLocalCachingSuspended = false
                    }
                    self?.authenticatedUserID = userID
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

    func cachedCollection(userID: String, date: String) async -> Collection? {
        await collectionCache.load(userID: userID, date: date)
    }

    func cacheCollection(_ collection: Collection, userID: String, date: String) async {
        guard !isLocalCachingSuspended else { return }
        await collectionCache.store(collection, userID: userID, date: date)
    }

    func cachedThought(id: String) -> Thought? {
        guard let thought = thoughtCache[id] else { return nil }
        touchThought(id: id)
        return thought
    }

    func cacheThought(_ thought: Thought) {
        guard !isLocalCachingSuspended else { return }
        thoughtCache[thought._id] = thought
        touchThought(id: thought._id)

        while thoughtRecency.count > Self.thoughtCacheLimit {
            let evictedID = thoughtRecency.removeFirst()
            thoughtCache.removeValue(forKey: evictedID)
        }
    }

    func prewarmThought(id: String) {
        guard !isLocalCachingSuspended else { return }
        guard thoughtCache[id] == nil, prewarmSubscriptions[id] == nil else { return }
        guard prewarmSubscriptions.count < Self.prewarmLimit else { return }

        prewarmSubscriptions[id] = thought(id: id)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] _ in
                    self?.stopPrewarmingThought(id: id)
                },
                receiveValue: { [weak self] thought in
                    if let thought {
                        self?.cacheThought(thought)
                    }
                }
            )
        prewarmTasks[id] = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.prewarmDuration)
            guard !Task.isCancelled else { return }
            self?.stopPrewarmingThought(id: id)
        }
    }

    func clearLocalCaches() async {
        // Sign-out subscriptions remain live briefly, so stop their cache writes
        // before clearing data and keep them stopped until a fresh sign-in.
        isLocalCachingSuspended = true
        thoughtCache.removeAll()
        thoughtRecency.removeAll()
        for subscription in prewarmSubscriptions.values {
            subscription.cancel()
        }
        prewarmSubscriptions.removeAll()
        for task in prewarmTasks.values {
            task.cancel()
        }
        prewarmTasks.removeAll()
        await collectionCache.clear()
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

    private func touchThought(id: String) {
        thoughtRecency.removeAll { $0 == id }
        thoughtRecency.append(id)
    }

    private func stopPrewarmingThought(id: String) {
        prewarmSubscriptions.removeValue(forKey: id)?.cancel()
        prewarmTasks.removeValue(forKey: id)?.cancel()
    }
}
