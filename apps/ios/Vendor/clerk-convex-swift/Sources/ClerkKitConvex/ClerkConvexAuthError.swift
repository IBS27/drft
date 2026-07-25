import Foundation

public enum ClerkConvexAuthError: LocalizedError, Sendable, Equatable {
    case clerkNotLoaded
    case noActiveSession
    case tokenRetrievalFailed(String)

    public var errorDescription: String? {
        switch self {
        case .clerkNotLoaded:
            "Clerk has not finished loading. Ensure Clerk.shared.isLoaded is true before authenticating."
        case .noActiveSession:
            "No active Clerk session. Please sign in first using Clerk."
        case .tokenRetrievalFailed(let reason):
            reason
        }
    }
}
