import SwiftUI

/// The one-time question before any thought text is sent to OpenAI.
struct ConnectionsConsentView: View {
    @ObservedObject var convexService: ConvexService
    @State private var pending: Bool?
    @State private var failed = false
    @State private var attempt = 0

    // A write stalled offline must not hold capture behind this screen.
    private static let patience: Duration = .seconds(8)

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    EmberIcon(.graph, size: 20)
                        .foregroundStyle(Stillness.nowInk)
                        .frame(width: 40, height: 40)
                        .background(Stillness.nowTint, in: Circle())

                    Text("Connections")
                        .font(.geist(22, .semibold, relativeTo: .title2))
                        .tracking(-0.44)
                        .foregroundStyle(Stillness.ink)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.top, 20)

                    Text("drft can link a new thought to the older ones it echoes.")
                        .font(.geist(16, relativeTo: .callout))
                        .lineSpacing(5)
                        .foregroundStyle(Stillness.chromeText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    Text("To do that, the text of each thought is sent to OpenAI, which turns it into numbers drft can compare. OpenAI doesn't train on it, and nothing else about you is sent.")
                        .font(.geist(14, relativeTo: .subheadline))
                        .lineSpacing(5)
                        .foregroundStyle(Stillness.chromeLabel)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)

                    HStack(spacing: 12) {
                        choice(true, label: "Allow")
                        choice(false, label: "Not now")
                    }
                    .padding(.top, 32)
                    .animation(.easeOut(duration: 0.2), value: pending)

                    Text("Couldn't save. Try again.")
                        .font(StillnessType.caption)
                        .foregroundStyle(Stillness.nowInk)
                        .padding(.top, 12)
                        .opacity(failed ? 1 : 0)
                        .accessibilityHidden(!failed)

                    VStack(alignment: .leading, spacing: 0) {
                        Text("You can change this anytime in settings.")
                            .foregroundStyle(Stillness.chromeLabel)

                        Link(destination: .privacyPolicy) {
                            Text("Privacy policy")
                                .underline(color: Stillness.chromeLabel)
                                .foregroundStyle(Stillness.chromeLabel)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                    }
                    .font(StillnessType.caption)
                    .padding(.top, 12)
                }
                .padding(28)
                .frame(maxWidth: 448, alignment: .leading)
                .emberSurface()
                .padding(.horizontal, 20)
                .padding(.vertical, 40)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Stillness.page.ignoresSafeArea())
    }

    private func choice(_ allowed: Bool, label: String) -> some View {
        Button {
            decide(allowed)
        } label: {
            Text(label)
        }
        .buttonStyle(PillButtonStyle(
            kind: allowed ? .primary : .neutral,
            horizontalPadding: 24
        ))
        .opacity(pending != nil && pending != allowed ? 0.4 : 1)
    }

    private func decide(_ allowed: Bool) {
        guard pending == nil else { return }
        attempt += 1
        let current = attempt
        pending = allowed
        failed = false

        let timeout = Task {
            try await Task.sleep(for: Self.patience)
            fail(current)
        }
        Task {
            do {
                // Success settles the server value, which dismisses this view.
                try await convexService.setAiConnections(allowed)
                timeout.cancel()
            } catch {
                timeout.cancel()
                fail(current)
            }
        }
    }

    private func fail(_ failedAttempt: Int) {
        guard failedAttempt == attempt, pending != nil else { return }
        pending = nil
        failed = true
    }
}
