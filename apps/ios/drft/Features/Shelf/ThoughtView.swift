import Combine
import SwiftUI

@MainActor
private final class ThoughtModel: ObservableObject {
    @Published private(set) var thought: ConvexService.Thought?
    @Published private(set) var hasConversation = false

    private var thoughtSubscription: AnyCancellable?
    private var conversationSubscription: AnyCancellable?

    func subscribe(thoughtID: String, convexService: ConvexService) {
        thoughtSubscription?.cancel()
        conversationSubscription?.cancel()

        thoughtSubscription = convexService.thought(id: thoughtID)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] thought in
                    self?.thought = thought
                }
            )
        conversationSubscription = convexService.conversationProbe(thoughtID: thoughtID)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] page in
                    self?.hasConversation = !page.page.isEmpty
                }
            )
    }
}

struct ThoughtView: View {
    @ObservedObject private var convexService: ConvexService
    @StateObject private var model = ThoughtModel()
    @State private var isEnteringClosingLine = false
    @State private var closingLine = ""
    @State private var isSendingToRest = false
    @State private var isLeaving = false
    @FocusState private var closingLineIsFocused: Bool

    let thoughtID: String
    let onBack: () -> Void

    init(
        thoughtID: String,
        convexService: ConvexService,
        onBack: @escaping () -> Void
    ) {
        self.thoughtID = thoughtID
        self.convexService = convexService
        self.onBack = onBack
    }

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Button {
                        onBack()
                    } label: {
                        Text("←")
                            .font(.custom(
                                "Helvetica Neue",
                                size: 22,
                                relativeTo: .title3
                            ).weight(.light))
                            .foregroundStyle(Stillness.faint)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back to shelf")

                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 5)

                GeometryReader { geometry in
                    ScrollView {
                        if let thought = model.thought {
                            thoughtContent(
                                thought,
                                minimumHeight: geometry.size.height
                            )
                            .opacity(isLeaving ? 0 : 1)
                            .animation(.easeOut(duration: 0.24), value: isLeaving)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .scrollDismissesKeyboard(.interactively)
                }
            }
        }
        .tint(Stillness.ink)
        .task(id: thoughtID) {
            model.subscribe(
                thoughtID: thoughtID,
                convexService: convexService
            )
            try? await convexService.markQuestionsSeen(thoughtID: thoughtID)
        }
    }

    private func thoughtContent(
        _ thought: ConvexService.Thought,
        minimumHeight: CGFloat
    ) -> some View {
        VStack(spacing: 0) {
            Text(thought.text)
                .font(StillnessType.readingThought)
                .lineSpacing(12)
                .multilineTextAlignment(.center)
                .foregroundStyle(Stillness.ink)
                .textSelection(.enabled)
                .frame(maxWidth: 350)

            Text(ShelfFormatting.captureLine(for: thought.createdAt))
                .stillnessLabel(.timestamp)
                .padding(.top, 30)

            if !thought.questions.isEmpty {
                VStack(spacing: 28) {
                    ForEach(thought.questions) { question in
                        Text(question.text)
                            .font(StillnessType.marginalia)
                            .lineSpacing(9)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(Stillness.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: 340)
                .padding(.top, 48)
            }

            Spacer(minLength: 48)

            if model.hasConversation {
                Text("continue on the web")
                    .stillnessFaintFootnote()
            }

            restControls
                .padding(.top, model.hasConversation ? 32 : 0)
                .padding(.bottom, 34)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: minimumHeight, alignment: .top)
        .padding(.horizontal, 24)
        .padding(.top, 42)
    }

    @ViewBuilder
    private var restControls: some View {
        if isEnteringClosingLine {
            VStack(spacing: 18) {
                TextField(
                    "",
                    text: $closingLine,
                    prompt: Text("where it landed — optional")
                        .foregroundStyle(Stillness.muted)
                )
                    .textFieldStyle(.plain)
                    .font(StillnessType.action.weight(.light))
                    .foregroundStyle(Stillness.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .submitLabel(.return)
                    .focused($closingLineIsFocused)
                    .onSubmit(sendToRest)
                    .disabled(isSendingToRest)

                HStack(spacing: 28) {
                    Button("SET IT DOWN", action: sendToRest)
                        .stillnessLabel(.actionInk)
                        .disabled(isSendingToRest)

                    Button("NOT YET") {
                        closingLineIsFocused = false
                        isEnteringClosingLine = false
                    }
                    .stillnessLabel(.actionMuted)
                    .disabled(isSendingToRest)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: 330)
        } else {
            Button {
                isEnteringClosingLine = true
                Task { @MainActor in
                    await Task.yield()
                    closingLineIsFocused = true
                }
            } label: {
                Text("REST")
                    .stillnessLabel(.actionMuted)
                    .padding(.vertical, 13)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func sendToRest() {
        guard !isSendingToRest else { return }
        isSendingToRest = true
        closingLineIsFocused = false
        let trimmed = closingLine.trimmingCharacters(in: .whitespacesAndNewlines)

        Task { @MainActor in
            do {
                try await convexService.rest(
                    thoughtID: thoughtID,
                    closingLine: trimmed.isEmpty ? nil : trimmed
                )
                isLeaving = true
                try? await Task.sleep(for: .milliseconds(240))
                onBack()
            } catch {
                isSendingToRest = false
            }
        }
    }
}
