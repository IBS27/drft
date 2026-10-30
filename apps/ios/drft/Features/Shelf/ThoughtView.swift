import Combine
import SwiftUI

@MainActor
private final class ThoughtModel: ObservableObject {
    @Published private(set) var thought: ConvexService.Thought?

    private var thoughtSubscription: AnyCancellable?
    private var subscribedThoughtID: String?

    func subscribe(thoughtID: String, convexService: ConvexService) {
        guard thoughtID != subscribedThoughtID else { return }
        subscribedThoughtID = thoughtID
        thoughtSubscription?.cancel()
        thought = convexService.cachedThought(id: thoughtID)

        thoughtSubscription = convexService.thought(id: thoughtID)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self, weak convexService] thought in
                    guard self?.subscribedThoughtID == thoughtID else { return }
                    self?.thought = thought
                    if let thought {
                        convexService?.cacheThought(thought)
                    }
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
                            EmberIcon(.arrowLeft, size: 20)
                        }
                        .buttonStyle(IconButtonStyle())
                        .accessibilityLabel(
                            thoughtPath.count > 1 ? "Back to thought" : "Back to shelf"
                        )

                        Spacer()
                    }

                    if let thought = model.thought {
                        Text(ShelfFormatting.captureLine(for: thought.createdAt))
                            .font(StillnessType.headerDate)
                            .foregroundStyle(Stillness.chromeText)
                            .lineLimit(1)
                            .padding(.horizontal, 52)
                            .allowsHitTesting(false)
                            .opacity(isLeaving ? 0 : 1)
                            .animation(.easeOut(duration: 0.24), value: isLeaving)
                    }
                }
                .padding(.horizontal, 8)
                .frame(height: 56)

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
        .tint(Stillness.now)
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

            // Your words, exactly as captured, left-aligned as on the web's
            // phone layout.
            Text(thought.text)
                .font(StillnessType.readingThought)
                .tracking(StillnessType.readingThoughtTracking)
                .lineSpacing(StillnessType.readingThoughtLineSpacing)
                .multilineTextAlignment(.leading)
                .foregroundStyle(Stillness.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            if thought.lastReturnedAt != nil || thought.status == .resting {
                HStack(spacing: 8) {
                    if let lastReturnedAt = thought.lastReturnedAt {
                        Chip(kind: .now) {
                            EmberIcon(.arrowBendUpLeft, size: 14)
                            Text(returnedLabel(for: lastReturnedAt))
                        }
                    }

                    if thought.status == .resting {
                        Chip(kind: .quiet) {
                            EmberIcon(.moon, size: 14)
                            Text("Set down")
                            if let restedAt = thought.restedAt {
                                Text(ShelfFormatting.ageLabel(for: restedAt))
                                    .font(StillnessType.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(Stillness.chromeLabel)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 18)
            }

            if thought.status == .resting, let restingNote = thought.restingNote {
                Text(restingNote)
                    .font(StillnessType.body)
                    .lineSpacing(5)
                    .foregroundStyle(Stillness.chromeLabel)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12)
            }

            let connections = displayedConnections(for: thought)
            if !connections.isEmpty {
                relatedThoughts(
                    connections,
                    width: max(0, availableWidth - 48)
                )
            }

            if let setAside {
                setAsideStatus(setAside)
                    .padding(.top, 12)
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
            ? "today"
            : ShelfFormatting.ageLabel(for: milliseconds)
        return "Returned \(age)"
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
            HStack(spacing: 8) {
                Text("Related thoughts")
                    .font(StillnessType.sectionTitle)
                    .foregroundStyle(Stillness.ink)
                Badge(text: "\(connections.count)")
            }
            .padding(.bottom, 6)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            ForEach(Array(connections.enumerated()), id: \.element._id) { index, connection in
                if index > 0 {
                    Hairline()
                }

                RelatedThoughtRow(
                    connection: connection,
                    width: width,
                    metadata: connection.otherStatus == .resting
                        ? nil
                        : ShelfFormatting.ageLabel(
                            for: connection.otherCreatedAt
                        ),
                    onPrefetch: {
                        convexService.prewarmThought(id: connection.otherId)
                    },
                    onOpen: { openRelatedThought(connection.otherId) },
                    onSetAside: { setRelatedThoughtAside(connection, index: index) }
                )
            }
        }
        .frame(width: width)
        .padding(.top, 40)
    }

    private func setAsideStatus(_ state: SetAsideState) -> some View {
        HStack(spacing: 4) {
            Text(
                state.failed
                    ? "Couldn't set the related thought aside."
                    : "Related thought set aside."
            )
            .font(StillnessType.caption)
            .foregroundStyle(state.failed ? Stillness.nowInk : Stillness.chromeLabel)

            if !state.failed {
                Button("Undo", action: undoSetAside)
                    .buttonStyle(UndoButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func openRelatedThought(_ id: String) {
        guard id != activeThoughtID else { return }
        convexService.prewarmThought(id: id)
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
            VStack(spacing: 12) {
                TextField(
                    "",
                    text: $closingLine,
                    prompt: Text("Where it landed (optional)")
                        .foregroundStyle(Stillness.chromeLabel)
                )
                    .textFieldStyle(.plain)
                    .textInputAutocapitalization(.never)
                    .font(StillnessType.body)
                    .foregroundStyle(Stillness.ink)
                    .lineLimit(1)
                    .submitLabel(.return)
                    .focused($closingLineIsFocused)
                    .onSubmit(sendToRest)
                    .disabled(isSendingToRest)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(
                        Stillness.surface,
                        in: RoundedRectangle(
                            cornerRadius: StillnessSpacing.cardRadius,
                            style: .continuous
                        )
                    )
                    .overlay {
                        RoundedRectangle(
                            cornerRadius: StillnessSpacing.cardRadius,
                            style: .continuous
                        )
                        .strokeBorder(
                            closingLineIsFocused ? Stillness.nowEdge : Stillness.hairline,
                            lineWidth: 1
                        )
                    }
                    .accessibilityLabel("Where it landed (optional)")

                HStack(spacing: 8) {
                    Button("Set it down", action: sendToRest)
                        .buttonStyle(PillButtonStyle(kind: .primary))
                        .disabled(isSendingToRest)

                    Button("Not yet") {
                        closingLineIsFocused = false
                        isEnteringClosingLine = false
                    }
                    .buttonStyle(PillButtonStyle(kind: .quiet, horizontalPadding: 16))
                    .disabled(isSendingToRest)
                }
            }
            .frame(maxWidth: 360)
        } else {
            Button {
                isEnteringClosingLine = true
                Task { @MainActor in
                    await Task.yield()
                    closingLineIsFocused = true
                }
            } label: {
                HStack(spacing: 8) {
                    EmberIcon(.moon, size: 16)
                    Text("Let it rest")
                }
            }
            .buttonStyle(PillButtonStyle(kind: .outline))
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

private struct UndoButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(StillnessType.captionEmphasis)
            .foregroundStyle(Stillness.nowInk)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background {
                Capsule()
                    .fill(configuration.isPressed ? Stillness.nowTint : .clear)
                    .frame(height: 28)
            }
            .contentShape(Rectangle())
    }
}

private struct RelatedThoughtRow: View {
    @State private var settledOffset: CGFloat = 0
    @GestureState private var dragOffset: CGFloat = 0

    let connection: ConvexService.Connection
    let width: CGFloat
    /// The capture age, or nil when the related thought is set down.
    let metadata: String?
    let onPrefetch: () -> Void
    let onOpen: () -> Void
    let onSetAside: () -> Void

    private let actionWidth: CGFloat = 112

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            Text(connection.otherText)
                .font(StillnessType.body)
                .lineSpacing(StillnessType.bodyLineSpacing)
                .foregroundStyle(Stillness.ink)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let metadata {
                Text(metadata)
                    .font(StillnessType.caption)
                    .monospacedDigit()
                    .foregroundStyle(Stillness.chromeLabel)
                    .lineLimit(1)
            } else {
                Text("Set down")
                    .font(.geist(12, relativeTo: .caption))
                    .foregroundStyle(Stillness.chromeText)
                    .lineLimit(1)
                    .padding(.horizontal, 9)
                    .frame(minHeight: 22)
                    .overlay {
                        Capsule().strokeBorder(Stillness.hairline, lineWidth: 1)
                    }
            }
        }
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .frame(width: width, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .background(Stillness.page)
        // One element per row; without this each text child carried the
        // row's label and VoiceOver read every related thought twice. The
        // swipe-revealed button below stays out; Set aside is the named
        // action here instead.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Opens related thought")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
        .accessibilityAction(named: Text("Set aside"), onSetAside)
        .offset(x: rowOffset)
        .background(alignment: .trailing) {
            Button {
                onSetAside()
            } label: {
                HStack(spacing: 6) {
                    EmberIcon(.x, size: 14)
                    Text("Set aside")
                }
                .font(StillnessType.captionEmphasis)
                .foregroundStyle(Stillness.nowInk)
                .frame(width: actionWidth)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Stillness.nowTint)
            .opacity(actionRevealProgress)
            .accessibilityHidden(actionRevealProgress < 0.5)
        }
        .frame(width: width)
        .clipped()
        .contentShape(Rectangle())
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0).onEnded { _ in
                onPrefetch()
            }
        )
        .simultaneousGesture(swipeGesture)
        .onChange(of: connection._id) { _, _ in
            settledOffset = 0
        }
    }

    private var accessibilityText: String {
        "\(connection.otherText), \(metadata ?? "set down")"
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
