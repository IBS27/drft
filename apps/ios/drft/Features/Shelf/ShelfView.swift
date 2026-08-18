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
                    wordmark

                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if let returnedThought = layout.returnedThought {
                                sectionLabel("RETURNED TODAY")
                                thoughtRow(returnedThought)
                                Hairline()
                                Spacer(minLength: 42)
                            }

                            ForEach(layout.sections) { section in
                                sectionLabel(section.group.label)
                                ForEach(section.thoughts) { thought in
                                    thoughtRow(thought)
                                    Hairline()
                                }
                                Spacer(minLength: 34)
                            }
                        }
                        .padding(.horizontal, 28)
                        .padding(.top, 34)
                        .padding(.bottom, 94)
                    }
                    .scrollIndicators(.hidden)
                }
                .overlay(alignment: .bottomTrailing) {
                    catchThoughtAffordance
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
            .presentationBackground(Stillness.surface)
            .presentationDragIndicator(.hidden)
            .presentationDetents([.medium, .large])
        }
    }

    private var wordmark: some View {
        Button {
            settingsArePresented = true
        } label: {
            Text("drft")
                .stillnessWordmark()
                .padding(.vertical, 13)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 5)
        .accessibilityLabel("Open settings")
    }

    private var catchThoughtAffordance: some View {
        Button {
            onCatchThought()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Stillness.onNow)
                .frame(width: 56, height: 56)
                .background(Stillness.now, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(NewThoughtButtonStyle())
        .padding(.trailing, 28)
        .padding(.bottom, 20)
        .accessibilityLabel("New thought")
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .stillnessLabel(.timestamp)
            .padding(.bottom, 12)
    }

    private func thoughtRow(_ thought: ConvexService.CollectionThought) -> some View {
        let age = ShelfFormatting.ageLabel(for: thought.createdAt, now: now)

        return Button {
            convexService.prewarmThought(id: thought.id)
            withAnimation(.easeInOut(duration: 0.28)) {
                selectedThoughtID = thought.id
            }
        } label: {
            HStack(spacing: 14) {
                Text(thought.preview)
                    .font(StillnessType.shelfThought)
                    .foregroundStyle(Stillness.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(age)
                    .font(StillnessType.relatedMetadata)
                    .tracking(0.88)
                    .monospacedDigit()
                    .foregroundStyle(Stillness.faint)
                    .lineLimit(1)
            }
            .padding(.vertical, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0).onEnded { _ in
                convexService.prewarmThought(id: thought.id)
            }
        )
        .accessibilityLabel("\(thought.preview), \(age)")
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

private struct NewThoughtButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}
