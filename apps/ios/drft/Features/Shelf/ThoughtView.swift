import Combine
import SwiftUI

@MainActor
private final class ThoughtModel: ObservableObject {
    @Published private(set) var thought: ConvexService.Thought?

    private var thoughtSubscription: AnyCancellable?

    func subscribe(thoughtID: String, convexService: ConvexService) {
        thoughtSubscription?.cancel()
        thought = nil

        thoughtSubscription = convexService.thought(id: thoughtID)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] thought in
                    self?.thought = thought
                }
            )
    }
}

private struct SetAsideState {
    let connection: ConvexService.Connection
    let index: Int
    var failed: Bool
}

private struct RestoredConnection {
    let connection: ConvexService.Connection
    let index: Int
}

struct ThoughtView: View {
    @ObservedObject private var convexService: ConvexService
    @StateObject private var model = ThoughtModel()
    @State private var isEnteringClosingLine = false
    @State private var closingLine = ""
    @State private var isSendingToRest = false
    @State private var isLeaving = false
    @State private var thoughtPath: [String]
    @State private var setAside: SetAsideState?
    @State private var restoredConnection: RestoredConnection?
    @State private var setAsideToken = UUID()
    @State private var navigationEpoch = UUID()
    @State private var dismissTask: Task<Void, Never>?
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
        _thoughtPath = State(initialValue: [thoughtID])
    }

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    HStack {
                        Button {
                            goBack()
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
                        .accessibilityLabel(
                            thoughtPath.count > 1 ? "Back to thought" : "Back to shelf"
                        )

                        Spacer()
                    }

                    if let thought = model.thought {
                        Text(ShelfFormatting.captureLine(for: thought.createdAt))
                            .stillnessLabel(.timestamp)
                            .lineLimit(1)
                            .allowsHitTesting(false)
                            .opacity(isLeaving ? 0 : 1)
                            .animation(.easeOut(duration: 0.24), value: isLeaving)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 5)

                GeometryReader { geometry in
                    ScrollView {
                        if let thought = model.thought {
                            thoughtContent(
                                thought,
                                availableWidth: geometry.size.width,
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
        .task(id: activeThoughtID) {
            resetTransientState()
            model.subscribe(
                thoughtID: activeThoughtID,
                convexService: convexService
            )
        }
        // Once the subscription itself carries the restored connection the
        // optimistic overlay has done its job — dropping it here keeps a
        // later dismissal from another device from being papered over.
        .onChange(of: model.thought?.connections.map(\._id)) { _, ids in
            guard let restored = restoredConnection,
                  ids?.contains(restored.connection._id) == true else { return }
            restoredConnection = nil
        }
    }

    private var activeThoughtID: String {
        thoughtPath.last ?? thoughtID
    }

    private func thoughtContent(
        _ thought: ConvexService.Thought,
        availableWidth: CGFloat,
        minimumHeight: CGFloat
    ) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 42)

            Text(thought.text)
                .font(StillnessType.readingThought)
                .lineSpacing(12)
                .multilineTextAlignment(.center)
                .foregroundStyle(Stillness.ink)
                .textSelection(.enabled)
                .frame(maxWidth: 350)

            if thought.status == .resting {
                VStack(spacing: 10) {
                    Text("SET DOWN")
                        .stillnessLabel(.timestamp)

                    if let restingNote = thought.restingNote {
                        Text(restingNote)
                            .stillnessMutedBody()
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: 350)
                .padding(.top, 26)
            }

            if let lastReturnedAt = thought.lastReturnedAt {
                Text(returnedLabel(for: lastReturnedAt))
                    .stillnessLabel(.timestamp)
                    .padding(.top, 22)
            }

            let connections = displayedConnections(for: thought)
            if !connections.isEmpty {
                relatedThoughts(
                    connections,
                    width: min(350, max(0, availableWidth - 48))
                )
            }

            if let setAside {
                setAsideStatus(setAside)
                    .padding(.top, 20)
            }

            Spacer(minLength: 42)

            if thought.status == .open {
                restControls
                    .padding(.bottom, 34)
            } else {
                Spacer(minLength: 34)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: minimumHeight)
        .padding(.horizontal, 24)
    }

    private func returnedLabel(for milliseconds: Double) -> String {
        let age = ShelfFormatting.group(for: milliseconds, now: .now) == .today
            ? "TODAY"
            : ShelfFormatting.ageLabel(for: milliseconds).uppercased()
        return "RETURNED · \(age)"
    }

    private func displayedConnections(
        for thought: ConvexService.Thought
    ) -> [ConvexService.Connection] {
        var connections = thought.connections

        if let restoredConnection,
           !connections.contains(where: { $0._id == restoredConnection.connection._id }) {
            connections.insert(
                restoredConnection.connection,
                at: min(restoredConnection.index, connections.count)
            )
        }

        if let setAside, !setAside.failed {
            connections.removeAll { $0._id == setAside.connection._id }
        }

        return connections
    }

    private func relatedThoughts(
        _ connections: [ConvexService.Connection],
        width: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("RELATED THOUGHTS")
                .stillnessLabel(.section)
                .padding(.bottom, 13)

            Hairline()

            ForEach(Array(connections.enumerated()), id: \.element._id) { index, connection in
                RelatedThoughtRow(
                    connection: connection,
                    width: width,
                    metadata: connection.otherStatus == .resting
                        ? "SET DOWN"
                        : ShelfFormatting.ageLabel(
                            for: connection.otherCreatedAt
                        ).uppercased(),
                    onOpen: { openRelatedThought(connection.otherId) },
                    onSetAside: { setRelatedThoughtAside(connection, index: index) }
                )

                Hairline()
            }
        }
        .frame(width: width)
        .padding(.top, 46)
    }

    private func setAsideStatus(_ state: SetAsideState) -> some View {
        HStack(spacing: 22) {
            Text(
                state.failed
                    ? "COULDN'T SET THE RELATED THOUGHT ASIDE"
                    : "RELATED THOUGHT SET ASIDE"
            )
            .font(StillnessType.relatedMetadata)
            .tracking(2.4)
            .foregroundStyle(Stillness.faint)

            if !state.failed {
                Button("UNDO", action: undoSetAside)
                    .font(StillnessType.relatedMetadata)
                    .tracking(2.4)
                    .foregroundStyle(Stillness.muted)
                    .buttonStyle(.plain)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: 350)
    }

    private func openRelatedThought(_ id: String) {
        guard id != activeThoughtID else { return }
        withAnimation(.easeInOut(duration: 0.22)) {
            thoughtPath.append(id)
        }
    }

    private func setRelatedThoughtAside(
        _ connection: ConvexService.Connection,
        index: Int
    ) {
        let token = UUID()
        setAsideToken = token
        restoredConnection = nil
        setAside = SetAsideState(
            connection: connection,
            index: index,
            failed: false
        )

        dismissTask = Task { @MainActor in
            do {
                try await convexService.dismissConnection(id: connection._id)
            } catch {
                guard setAsideToken == token else { return }
                setAside?.failed = true
            }
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(8))
            guard setAsideToken == token else { return }
            setAside = nil
        }
    }

    private func undoSetAside() {
        guard let setAside, !setAside.failed else { return }
        setAsideToken = UUID()
        restoredConnection = RestoredConnection(
            connection: setAside.connection,
            index: setAside.index
        )
        self.setAside = nil

        let dismissal = dismissTask
        Task { @MainActor in
            // The undo must land after the dismissal it reverses — racing
            // them lets a late dismissal commit win and swallow the undo.
            await dismissal?.value
            do {
                try await convexService.undismissConnection(
                    id: setAside.connection._id
                )
            } catch {
                guard restoredConnection?.connection._id
                    == setAside.connection._id else { return }
                restoredConnection = nil
            }
        }
    }

    private func goBack() {
        guard thoughtPath.count > 1 else {
            onBack()
            return
        }
        withAnimation(.easeInOut(duration: 0.22)) {
            thoughtPath.removeLast(1)
        }
    }

    private func resetTransientState() {
        isEnteringClosingLine = false
        closingLine = ""
        isSendingToRest = false
        isLeaving = false
        navigationEpoch = UUID()
        setAsideToken = UUID()
        setAside = nil
        restoredConnection = nil
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
        // The task outlives navigation, so it must only steer the visit it
        // was started on — the epoch changes on every move, so even leaving
        // and returning to the same thought orphans it.
        let submittedID = activeThoughtID
        let epoch = navigationEpoch

        Task { @MainActor in
            do {
                try await convexService.rest(
                    thoughtID: submittedID,
                    closingLine: trimmed.isEmpty ? nil : trimmed
                )
                guard epoch == navigationEpoch else { return }
                isLeaving = true
                try? await Task.sleep(for: .milliseconds(240))
                guard epoch == navigationEpoch else { return }
                onBack()
            } catch {
                guard epoch == navigationEpoch else { return }
                isSendingToRest = false
            }
        }
    }
}

private struct RelatedThoughtRow: View {
    @State private var settledOffset: CGFloat = 0
    @GestureState private var dragOffset: CGFloat = 0

    let connection: ConvexService.Connection
    let width: CGFloat
    let metadata: String
    let onOpen: () -> Void
    let onSetAside: () -> Void

    private let actionWidth: CGFloat = 112

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 9) {
                Text(connection.otherText)
                    .font(StillnessType.relatedThought)
                    .foregroundStyle(Stillness.ink)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(metadata)
                    .font(StillnessType.relatedMetadata)
                    .tracking(1.98)
                    .foregroundStyle(Stillness.faint)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 17)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(width: width, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .background(Stillness.page)
        .offset(x: rowOffset)
        .background(alignment: .trailing) {
            Button {
                onSetAside()
            } label: {
                Text("SET ASIDE")
                    .font(StillnessType.relatedMetadata)
                    .tracking(2.2)
                    .foregroundStyle(Stillness.muted)
                    .frame(width: actionWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Stillness.surface)
            .opacity(actionRevealProgress)
            .accessibilityHidden(actionRevealProgress < 0.5)
        }
        .accessibilityLabel(connection.otherText)
        .accessibilityHint("Opens related thought")
        .accessibilityAction(named: Text("Set aside"), onSetAside)
        .frame(width: width)
        .clipped()
        .contentShape(Rectangle())
        .simultaneousGesture(swipeGesture)
        .onChange(of: connection._id) { _, _ in
            settledOffset = 0
        }
    }

    private var rowOffset: CGFloat {
        min(0, max(-actionWidth, settledOffset + dragOffset))
    }

    private var actionRevealProgress: CGFloat {
        min(1, max(0, -rowOffset / actionWidth))
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($dragOffset) { value, state, _ in
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    return
                }
                state = value.translation.width
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    return
                }
                let proposedOffset = min(
                    0,
                    max(
                        -actionWidth,
                        settledOffset + value.predictedEndTranslation.width
                    )
                )
                withAnimation(.easeOut(duration: 0.2)) {
                    settledOffset = proposedOffset < -actionWidth / 2
                        ? -actionWidth
                        : 0
                }
            }
    }
}
