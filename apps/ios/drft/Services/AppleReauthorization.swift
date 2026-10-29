import AuthenticationServices
import UIKit

// Apple asks apps to revoke the Sign in with Apple grant when an account is
// deleted. Clerk's native sign-in keeps only the identity token, so there is
// no stored token to revoke: this asks Apple for a fresh authorization code
// (one Face ID confirmation), and the server trades it for a token and
// revokes that.
@MainActor
final class AppleReauthorization: NSObject {
    private var continuation: CheckedContinuation<(String, String), Error>?
    private var controller: ASAuthorizationController?

    struct MissingCode: Error {}
    struct DifferentAppleID: Error {}

    /// A fresh code for the Apple ID the account signed in with. Another
    /// Apple ID on this device would mint (and revoke) a new, unrelated
    /// grant, so its code is refused.
    static func authorizationCode(forAppleUserID appleUserID: String) async throws -> String {
        let (user, code) = try await AppleReauthorization().request()
        guard user == appleUserID else { throw DifferentAppleID() }
        return code
    }

    private func request() async throws -> (String, String) {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = []
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<(String, String), Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }
}

extension AppleReauthorization: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        let code = credential?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        let result: Result<(String, String), Error> =
            if let credential, let code { .success((credential.user, code)) } else { .failure(MissingCode()) }
        MainActor.assumeIsolated {
            finish(result)
        }
    }

    nonisolated func authorizationController(
        controller _: ASAuthorizationController,
        didCompleteWithError error: any Error
    ) {
        MainActor.assumeIsolated {
            finish(.failure(error))
        }
    }
}

extension AppleReauthorization: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(
        for _: ASAuthorizationController
    ) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
            if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
                return window
            }
            if let scene = scenes.first {
                return ASPresentationAnchor(windowScene: scene)
            }
            return ASPresentationAnchor()
        }
    }
}
