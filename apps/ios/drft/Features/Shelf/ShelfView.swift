import Combine
import SwiftUI

@MainActor
private final class ShelfModel: ObservableObject {
    @Published private(set) var collection: ConvexService.Collection?

    private var subscription: AnyCancellable?
    private var subscriptionKey: String?
    private var displayKey: String?
    private var liveKey: String?
    private var cacheTask: Task<Void, Never>?

    func activate(
        date: String,
        displayUserID: String?,
        authenticatedUserID: String?,
        convexService: ConvexService
    ) {
        guard let displayUserID else {
            displayKey = nil
            liveKey = nil
            collection = nil
            cacheTask?.cancel()
            subscription?.cancel()
            subscription = nil
            subscriptionKey = nil
            return
        }

        let key = "\(displayUserID)|\(date)"
        if key != displayKey {
            displayKey = key
            liveKey = nil
            collection = nil
            cacheTask?.cancel()
            cacheTask = Task { @MainActor [weak self] in
                let cached = await convexService.cachedCollection(
                    userID: displayUserID,
                    date: date
                )
                guard !Task.isCancelled,
                    self?.displayKey == key,
                    self?.liveKey != key
                else { return }
                self?.collection = cached
            }
        }

        guard let authenticatedUserID else {
            subscription?.cancel()
            subscription = nil
            subscriptionKey = nil
            return
        }

        let nextSubscriptionKey = "\(authenticatedUserID)|\(date)"
        guard nextSubscriptionKey != subscriptionKey else { return }
        subscriptionKey = nextSubscriptionKey
        subscription?.cancel()
        subscription = convexService.collection(date: date)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self, weak convexService] collection in
                    guard let self, self.displayKey == key else { return }
                    liveKey = key
                    self.collection = collection
                    guard let convexService else { return }
                    Task {
                        await convexService.cacheCollection(
                            collection,
                            userID: authenticatedUserID,
                            date: date
                        )
                    }
                }
            )
    }
}

private struct ShelfSection: Identifiable {
    let group: ShelfGroup
    let thoughts: [ConvexService.CollectionThought]

    var id: String { group.label }
}

@MainActor
private struct ShelfLayout {
    let returnedThought: ConvexService.CollectionThought?
    let sections: [ShelfSection]

    init(collection: ConvexService.Collection?, now: Date) {
        guard let collection else {
            returnedThought = nil
            sections = []
            return
        }

        returnedThought = collection.thoughts.first {
            $0.id == collection.resurfacedId
        }

        var grouped: [ShelfGroup: [ConvexService.CollectionThought]] = [:]
        for thought in collection.thoughts where thought.id != collection.resurfacedId {
            grouped[ShelfFormatting.group(for: thought.createdAt, now: now), default: []]
                .append(thought)
        }
        sections = ShelfGroup.allCases.compactMap { group in
            guard let thoughts = grouped[group], !thoughts.isEmpty else { return nil }
            return ShelfSection(group: group, thoughts: thoughts)
        }
    }
}

struct ShelfView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var authService: AuthService
    @ObservedObject private var convexService: ConvexService
    @StateObject private var model = ShelfModel()
    @State private var date = ShelfFormatting.localDate(for: .now)
    @State private var now = Date.now
    @State private var settingsArePresented = false
    @State private var selectedThoughtID: String?

    let isVisible: Bool
    let onCatchThought: () -> Void

    init(
        authService: AuthService,
        convexService: ConvexService,
        isVisible: Bool,
        onCatchThought: @escaping () -> Void
    ) {
        self.authService = authService
        self.convexService = convexService
        self.isVisible = isVisible
        self.onCatchThought = onCatchThought
    }

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            if isVisible {
                let layout = ShelfLayout(collection: model.collection, now: now)

                VStack(spacing: 0) {
                    HomeHeader {
                        settingsArePresented = true
                    }

                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if let returnedThought = layout.returnedThought {
                                // Edges on the dividers' line, like an inset group.
                                backToday(returnedThought)
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 4)
                            }

                            ForEach(layout.sections) { section in
                                sectionHeader(section)
                                ForEach(Array(section.thoughts.enumerated()), id: \.element.id) { index, thought in
                                    if index > 0 {
                                        Hairline()
                                            .padding(.horizontal, 16)
                                    }
                                    thoughtRow(thought)
                                }
                            }
                        }
                        .padding(.horizontal, 8)
                        .padding(.top, 8)
                        // Past the band (the inset below) by 24pt, so the
                        // last row always scrolls fully clear of the pill.
                        .padding(.bottom, 24)
                    }
                    .scrollIndicators(.hidden)
                    // A bounded band at the bottom, inset into the scroll
                    // view itself: the list scrolls to end above it, so no
                    // row ever sits under the button.
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        catchThoughtAffordance
                    }
                }
            }

            if let selectedThoughtID {
                ThoughtView(
                    thoughtID: selectedThoughtID,
                    convexService: convexService,
                    onBack: closeThought
                )
                .transition(.move(edge: .trailing).combined(with: .opacity))
                .zIndex(1)
            }
        }
        .task(id: subscriptionTaskID) {
            model.activate(
                date: date,
                displayUserID: displayUserID,
                authenticatedUserID: convexService.authenticatedUserID,
                convexService: convexService
            )
        }
        .task {
            while !Task.isCancelled {
                let nextDay = ShelfFormatting.startOfNextDay(after: .now)
                let delay = max(1, nextDay.timeIntervalSinceNow)
                do {
                    try await Task.sleep(for: .seconds(delay))
                } catch {
                    return
                }
                guard scenePhase == .active else { continue }
                now = .now
                date = ShelfFormatting.localDate(for: now)
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            guard phase == .active else { return }
            now = .now
            date = ShelfFormatting.localDate(for: now)
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: NSNotification.Name.NSSystemTimeZoneDidChange
            )
        ) { _ in
            now = .now
            date = ShelfFormatting.localDate(for: now)
        }
        .onChange(of: isVisible) { _, isVisible in
            guard isVisible else { return }
            now = .now
            date = ShelfFormatting.localDate(for: now)
        }
        .sheet(isPresented: $settingsArePresented) {
            SettingsView(
                authService: authService,
                convexService: convexService
            )
            .presentationBackground(Stillness.page)
            .presentationDragIndicator(.visible)
            .presentationDetents([.large])
        }
    }

    // A quiet surface pill on the thumb side, in its own opaque band below
    // the list: rows end at the band's edge, never under the pill.
    private var catchThoughtAffordance: some View {
        Button {
            onCatchThought()
        } label: {
            HStack(spacing: 8) {
                EmberIcon(.plus, size: 16)
                Text("New thought")
            }
        }
        .buttonStyle(PillButtonStyle(kind: .neutral, height: 44, horizontalPadding: 20))
        .padding(.bottom, 12)
        .padding(.trailing, 20)
        // On the thumb side, so it sits beside the list rather than on it.
        .frame(maxWidth: .infinity, alignment: .trailing)
        .background {
            Stillness.page
                .ignoresSafeArea(edges: .bottom)
                // A short soft edge above the band, not a long fade over rows.
                .overlay(alignment: .top) {
                    LinearGradient(
                        colors: [Stillness.page.opacity(0), Stillness.page],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 16)
                    .offset(y: -16)
                }
                .allowsHitTesting(false)
        }
        .accessibilityLabel("New thought")
    }

    private func sectionHeader(_ section: ShelfSection) -> some View {
        HStack(spacing: 8) {
            Text(section.group.label)
                .font(StillnessType.groupLabel)
                .foregroundStyle(Stillness.chromeText)
        }
        .padding(.horizontal, 16)
        // Closer to its own rows than to the group before.
        .padding(.top, 36)
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    // Today's returned thought, held apart above the groups on a tint.
    private func backToday(_ thought: ConvexService.CollectionThought) -> some View {
        Button {
            open(thought)
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        EmberIcon(.arrowBendUpLeft, size: 14)
                        Text("Back today")
                            .font(.geist(12.5, .medium, relativeTo: .footnote))
                    }
                    .foregroundStyle(Stillness.nowInk)

                    Text(thought.preview)
                        .font(StillnessType.body)
                        .lineSpacing(StillnessType.bodyLineSpacing)
                        .foregroundStyle(Stillness.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                EmberIcon(.caretRight, size: 13)
                    .foregroundStyle(Stillness.nowInk.opacity(0.7))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .buttonStyle(BackTodayButtonStyle {
            convexService.prewarmThought(id: thought.id)
        })
        .accessibilityLabel("Returned today: \(thought.preview)")
    }

    private func thoughtRow(_ thought: ConvexService.CollectionThought) -> some View {
        let age = ShelfFormatting.ageLabel(for: thought.createdAt, now: now)

        return Button {
            open(thought)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                Text(thought.preview)
                    .font(StillnessType.row)
                    .lineSpacing(3)
                    .foregroundStyle(Stillness.ink)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if thought.heldAt != nil {
                        EmberIcon(.bookmarkSimpleFill, size: 11)
                            .foregroundStyle(Stillness.chromeText)
                            .accessibilityLabel("held")
                    }
                    Text(age)
                        .font(StillnessType.caption)
                        .monospacedDigit()
                        .foregroundStyle(Stillness.chromeLabel)
                        .lineLimit(1)
                }
                // One date column, so every thought wraps at the same edge.
                .frame(minWidth: 72, alignment: .trailing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .buttonStyle(RowButtonStyle {
            convexService.prewarmThought(id: thought.id)
        })
        .accessibilityLabel("\(thought.preview), \(age)")
    }

    private func open(_ thought: ConvexService.CollectionThought) {
        convexService.prewarmThought(id: thought.id)
        withAnimation(.easeInOut(duration: 0.28)) {
            selectedThoughtID = thought.id
        }
    }

    private var displayUserID: String? {
        authService.captureOwnerID
            ?? authService.rememberedUserID
            ?? convexService.authenticatedUserID
    }

    private var subscriptionTaskID: String {
        [
            displayUserID ?? "",
            convexService.authenticatedUserID ?? "",
            date,
        ].joined(separator: "|")
    }

    private func closeThought() {
        withAnimation(.easeInOut(duration: 0.24)) {
            selectedThoughtID = nil
        }
    }
}

/// Today's returned thought: a light wash of the accent with a faint edge,
/// deepening while pressed.
private struct BackTodayButtonStyle: ButtonStyle {
    let onPress: () -> Void

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: StillnessSpacing.surfaceRadius, style: .continuous)
        configuration.label
            .background(configuration.isPressed ? Stillness.nowTint : Stillness.nowWash, in: shape)
            .overlay { shape.strokeBorder(Stillness.nowWashEdge, lineWidth: 1) }
            .contentShape(shape)
            .onChange(of: configuration.isPressed) { _, isPressed in
                if isPressed { onPress() }
            }
    }
}
