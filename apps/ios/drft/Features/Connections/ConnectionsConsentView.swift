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
                    Spacer(minLength: 48)

                    Text("connections")
                        .stillnessLabel(.section)

                    Text("drft can link a new thought to the older ones it echoes.")
                        .font(StillnessType.readingThought)
                        .lineSpacing(6)
                        .foregroundStyle(Stillness.ink)
                        .padding(.top, 22)

                    Text("to do that, the text of each thought is sent to OpenAI, which turns it into numbers drft can compare. OpenAI doesn't train on it, and nothing else about you is sent.")
                        .stillnessMutedBody()
                        .lineSpacing(5)
                        .padding(.top, 22)

                    HStack(spacing: StillnessSpacing.actionGap) {
                        choice(true, label: "allow")
                        choice(false, label: "not now")
                    }
                    .padding(.top, 36)
                    .animation(.easeOut(duration: 0.2), value: pending)

                    Text("couldn't save — try again")
                        .font(StillnessType.sectionLabel)
                        .tracking(2.4)
                        .textCase(.uppercase)
                        .foregroundStyle(Stillness.faint)
                        .padding(.top, 8)
                        .opacity(failed ? 1 : 0)
                        .accessibilityHidden(!failed)

                    Spacer(minLength: 48)

                    Text("you can change this anytime in settings")
                        .stillnessFaintFootnote()

                    Link(destination: .privacyPolicy) {
                        Text("privacy policy")
                            .stillnessFaintFootnote()
                            .underline()
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                }
                .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .leading)
                .padding(.horizontal, 32)
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
                .font(StillnessType.action)
                .tracking(StillnessType.actionTracking)
                .textCase(.uppercase)
                .padding(.vertical, 13)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(ChoiceButtonStyle(isSetAside: pending != nil && pending != allowed))
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

private struct ChoiceButtonStyle: ButtonStyle {
    let isSetAside: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Stillness.ink)
            .opacity(isSetAside ? 0.3 : configuration.isPressed ? 0.7 : 1)
    }
}
