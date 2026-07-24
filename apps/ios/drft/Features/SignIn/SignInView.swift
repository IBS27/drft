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
                Text("drft")
                    .font(.custom(
                        "Helvetica Neue",
                        size: 22,
                        relativeTo: .title3
                    ).weight(.light))
                    .tracking(11)
                    .foregroundStyle(Stillness.faint)

                Text("a space for unfinished thoughts")
                    .stillnessMutedBody()
                    .padding(.top, 20)

                VStack(alignment: .leading, spacing: 12) {
                    providerButton(.google, label: "google")
                    providerButton(.apple, label: "apple")
                    providerButton(.github, label: "github")
                }
                .padding(.top, 56)
                .animation(.easeOut(duration: 0.2), value: pending)

                Text("couldn't sign in — try again")
                    .font(.custom(
                        "Helvetica Neue",
                        size: 11,
                        relativeTo: .caption2
                    ).weight(.light))
                    .tracking(2.4)
                    .textCase(.uppercase)
                    .foregroundStyle(Stillness.faint)
                    .padding(.top, 32)
                    .opacity(failed ? 1 : 0)
                    .accessibilityHidden(!failed)
            }
            .padding(32)
        }
    }

    private func providerButton(
        _ provider: OAuthProvider,
        label: String
    ) -> some View {
        Button {
            start(provider)
        } label: {
            HStack(spacing: 14) {
                providerIcon(provider)
                    .frame(width: 16)

                Text(label)
                    .font(.custom(
                        "Helvetica Neue",
                        size: 12,
                        relativeTo: .caption
                    ).weight(.regular))
                    .tracking(3.1)
                    .textCase(.uppercase)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(ProviderButtonStyle(provider: provider, pending: pending))
    }

    @ViewBuilder
    private func providerIcon(_ provider: OAuthProvider) -> some View {
        // Optical sizes differ because the marks fill their view boxes differently.
        switch provider {
        case .google:
            GoogleIcon()
                .frame(width: 13, height: 13)
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 15, weight: .regular))
                .offset(y: -1)
        case .github:
            GitHubIcon()
                .frame(width: 14, height: 14)
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
                try await Clerk.shared.auth.signInWithOAuth(provider: provider)
            } catch is CancellationError {
                // The user dismissed the web auth sheet, which is not a failure.
            } catch let error as ASWebAuthenticationSessionError
                where error.code == .canceledLogin {
                // The user dismissed the web auth sheet, which is not a failure.
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
        configuration.label
            .foregroundStyle(
                pending == provider || configuration.isPressed
                    ? Stillness.ink
                    : Stillness.muted
            )
            .opacity(pending != nil && pending != provider ? 0.3 : 1)
    }
}

private struct GoogleIcon: Shape {
    func path(in rect: CGRect) -> Path {
        var path = SVGPathBuilder()
        path.move(toX: 12.48, y: 10.92)
        path.vertical(3.28)
        path.horizontal(7.84)
        path.cubic(-0.24, 1.84, -0.853, 3.187, -1.787, 4.133)
        path.cubic(-1.147, 1.147, -2.933, 2.4, -6.053, 2.4)
        path.cubic(-4.827, 0, -8.6, -3.893, -8.6, -8.72)
        path.smoothCubic(3.773, -8.72, 8.6, -8.72)
        path.cubic(2.6, 0, 4.507, 1.027, 5.907, 2.347)
        path.line(2.307, -2.307)
        path.cubic(
            toX: 12.48,
            y: 0,
            control1X: 18.747,
            control1Y: 1.44,
            control2X: 16.133,
            control2Y: 0
        )
        path.cubic(
            toX: 0.307,
            y: 12,
            control1X: 5.867,
            control1Y: 0,
            control2X: 0.307,
            control2Y: 5.387
        )
        path.smoothCubic(5.56, 12, 12.173, 12)
        path.cubic(3.573, 0, 6.267, -1.173, 8.373, -3.36)
        path.cubic(2.16, -2.16, 2.84, -5.213, 2.84, -7.667)
        path.cubic(0, -0.76, -0.053, -1.467, -0.173, -2.053)
        path.horizontal(to: 12.48)
        path.close()
        return path.scaled(to: rect)
    }
}

private struct GitHubIcon: Shape {
    func path(in rect: CGRect) -> Path {
        var path = SVGPathBuilder()
        path.move(toX: 12, y: 0.297)
        path.cubic(-6.63, 0, -12, 5.373, -12, 12)
        path.cubic(0, 5.303, 3.438, 9.8, 8.205, 11.385)
        path.cubic(0.6, 0.113, 0.82, -0.258, 0.82, -0.577)
        path.cubic(0, -0.285, -0.01, -1.04, -0.015, -2.04)
        path.cubic(-3.338, 0.724, -4.042, -1.61, -4.042, -1.61)
        path.cubic(
            toX: 3.633,
            y: 17.7,
            control1X: 4.422,
            control1Y: 18.07,
            control2X: 3.633,
            control2Y: 17.7
        )
        path.cubic(-1.087, -0.744, 0.084, -0.729, 0.084, -0.729)
        path.cubic(1.205, 0.084, 1.838, 1.236, 1.838, 1.236)
        path.cubic(1.07, 1.835, 2.809, 1.305, 3.495, 0.998)
        path.cubic(0.108, -0.776, 0.417, -1.305, 0.76, -1.605)
        path.cubic(-2.665, -0.3, -5.466, -1.332, -5.466, -5.93)
        path.cubic(0, -1.31, 0.465, -2.38, 1.235, -3.22)
        path.cubic(-0.135, -0.303, -0.54, -1.523, 0.105, -3.176)
        path.cubic(0, 0, 1.005, -0.322, 3.3, 1.23)
        path.cubic(0.96, -0.267, 1.98, -0.399, 3, -0.405)
        path.cubic(1.02, 0.006, 2.04, 0.138, 3, 0.405)
        path.cubic(2.28, -1.552, 3.285, -1.23, 3.285, -1.23)
        path.cubic(0.645, 1.653, 0.24, 2.873, 0.12, 3.176)
        path.cubic(0.765, 0.84, 1.23, 1.91, 1.23, 3.22)
        path.cubic(0, 4.61, -2.805, 5.625, -5.475, 5.92)
        path.cubic(0.42, 0.36, 0.81, 1.096, 0.81, 2.22)
        path.cubic(0, 1.606, -0.015, 2.896, -0.015, 3.286)
        path.cubic(0, 0.315, 0.21, 0.69, 0.825, 0.57)
        path.cubic(
            toX: 24,
            y: 12.297,
            control1X: 20.565,
            control1Y: 22.092,
            control2X: 24,
            control2Y: 17.592
        )
        path.cubic(0, -6.627, -5.373, -12, -12, -12)
        return path.scaled(to: rect)
    }
}

private struct SVGPathBuilder {
    private var path = Path()
    private var current = CGPoint.zero
    private var previousCubicControl: CGPoint?

    mutating func move(toX x: CGFloat, y: CGFloat) {
        current = CGPoint(x: x, y: y)
        path.move(to: current)
        previousCubicControl = nil
    }

    mutating func horizontal(_ deltaX: CGFloat) {
        line(deltaX, 0)
    }

    mutating func horizontal(to x: CGFloat) {
        line(toX: x, y: current.y)
    }

    mutating func vertical(_ deltaY: CGFloat) {
        line(0, deltaY)
    }

    mutating func line(_ deltaX: CGFloat, _ deltaY: CGFloat) {
        line(toX: current.x + deltaX, y: current.y + deltaY)
    }

    mutating func cubic(
        _ control1DeltaX: CGFloat,
        _ control1DeltaY: CGFloat,
        _ control2DeltaX: CGFloat,
        _ control2DeltaY: CGFloat,
        _ deltaX: CGFloat,
        _ deltaY: CGFloat
    ) {
        cubic(
            toX: current.x + deltaX,
            y: current.y + deltaY,
            control1X: current.x + control1DeltaX,
            control1Y: current.y + control1DeltaY,
            control2X: current.x + control2DeltaX,
            control2Y: current.y + control2DeltaY
        )
    }

    mutating func cubic(
        toX x: CGFloat,
        y: CGFloat,
        control1X: CGFloat,
        control1Y: CGFloat,
        control2X: CGFloat,
        control2Y: CGFloat
    ) {
        let end = CGPoint(x: x, y: y)
        let control2 = CGPoint(x: control2X, y: control2Y)
        path.addCurve(
            to: end,
            control1: CGPoint(x: control1X, y: control1Y),
            control2: control2
        )
        current = end
        previousCubicControl = control2
    }

    mutating func smoothCubic(
        _ control2DeltaX: CGFloat,
        _ control2DeltaY: CGFloat,
        _ deltaX: CGFloat,
        _ deltaY: CGFloat
    ) {
        let control1 = previousCubicControl.map {
            CGPoint(
                x: current.x * 2 - $0.x,
                y: current.y * 2 - $0.y
            )
        } ?? current
        cubic(
            toX: current.x + deltaX,
            y: current.y + deltaY,
            control1X: control1.x,
            control1Y: control1.y,
            control2X: current.x + control2DeltaX,
            control2Y: current.y + control2DeltaY
        )
    }

    mutating func close() {
        path.closeSubpath()
        previousCubicControl = nil
    }

    func scaled(to rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let originX = rect.midX - 12 * scale
        let originY = rect.midY - 12 * scale
        let transform = CGAffineTransform(
            a: scale,
            b: 0,
            c: 0,
            d: scale,
            tx: originX,
            ty: originY
        )
        return path.applying(transform)
    }

    private mutating func line(toX x: CGFloat, y: CGFloat) {
        current = CGPoint(x: x, y: y)
        path.addLine(to: current)
        previousCubicControl = nil
    }
}
