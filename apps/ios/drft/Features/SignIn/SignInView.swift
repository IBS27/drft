import AuthenticationServices
import ClerkKit
import SwiftUI

struct SignInView: View {
    @State private var pending: OAuthProvider?
    @State private var failed = false

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                Wordmark(size: .large)
                    .accessibilityAddTraits(.isHeader)

                Text("A space for unfinished thoughts")
                    .font(.geist(16, relativeTo: .callout))
                    .foregroundStyle(Stillness.chromeText)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)

                VStack(spacing: 12) {
                    // Apple first: App Review expects it to be at least as prominent.
                    providerButton(.apple, label: "Continue with Apple")
                    providerButton(.google, label: "Continue with Google")
                    providerButton(.github, label: "Continue with GitHub")
                }
                .frame(maxWidth: 288)
                .padding(.top, 48)
                .animation(.easeOut(duration: 0.2), value: pending)

                Text("Couldn't sign in. Try again.")
                    .font(StillnessType.caption)
                    .foregroundStyle(Stillness.nowInk)
                    .padding(.top, 24)
                    .opacity(failed ? 1 : 0)
                    .accessibilityHidden(!failed)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 64)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Link(destination: .privacyPolicy) {
                Text("Privacy policy")
                    .font(StillnessType.caption)
                    .foregroundStyle(Stillness.chromeLabel)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .padding(.bottom, 8)
        }
    }

    private func providerButton(
        _ provider: OAuthProvider,
        label: String
    ) -> some View {
        Button {
            start(provider)
        } label: {
            HStack(spacing: 12) {
                providerIcon(provider)
                Text(label)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ProviderButtonStyle(provider: provider, pending: pending))
    }

    // Apple's own mark for Sign in with Apple (its button guidelines); the
    // web's Phosphor marks for the rest.
    @ViewBuilder
    private func providerIcon(_ provider: OAuthProvider) -> some View {
        switch provider {
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 17))
                .frame(width: 18, height: 18)
                .accessibilityHidden(true)
        case .google:
            EmberIcon(.googleLogoFill, size: 18)
        case .github:
            EmberIcon(.githubLogoFill, size: 18)
        default:
            EmptyView()
        }
    }

    private func start(_ provider: OAuthProvider) {
        guard pending == nil else { return }
        pending = provider
        failed = false

        Task { @MainActor in
            do {
                if provider == .apple {
                    // Native sheet; drft only needs the email, not the name.
                    try await Clerk.shared.auth.signInWithApple(requestedScopes: [.email])
                } else {
                    try await Clerk.shared.auth.signInWithOAuth(provider: provider)
                }
            } catch is CancellationError {
                // The user dismissed the web auth sheet, which is not a failure.
            } catch let error as ASWebAuthenticationSessionError
                where error.code == .canceledLogin {
                // The user dismissed the web auth sheet, which is not a failure.
            } catch let error as ASAuthorizationError
                where error.code == .canceled {
                // The user dismissed the Apple sheet, which is not a failure.
            } catch {
                failed = true
            }
            pending = nil
        }
    }
}

private struct ProviderButtonStyle: ButtonStyle {
    let provider: OAuthProvider
    let pending: OAuthProvider?

    func makeBody(configuration: Configuration) -> some View {
        let isActive = pending == provider || configuration.isPressed

        configuration.label
            .font(.geist(15, .medium, relativeTo: .subheadline))
            .foregroundStyle(Stillness.ink)
            .frame(minHeight: 48)
            .background(isActive ? Stillness.nowTint : Stillness.surface, in: Capsule())
            .overlay {
                Capsule().strokeBorder(
                    isActive ? Stillness.nowEdge : Stillness.hairline,
                    lineWidth: 1
                )
            }
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(pending != nil && pending != provider ? 0.4 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
