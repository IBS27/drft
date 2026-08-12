import Combine
import SwiftUI

@MainActor
private final class ShelfModel: ObservableObject {
    @Published private(set) var collection: ConvexService.Collection?

    private var subscription: AnyCancellable?
    private var subscriptionKey: String?

    func subscribe(
        date: String,
        authenticatedUserID: String,
        convexService: ConvexService
    ) {
        let key = "\(authenticatedUserID)|\(date)"
        guard key != subscriptionKey else { return }
        subscriptionKey = key
        subscription?.cancel()
        subscription = convexService.collection(date: date)
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] collection in
                    self?.collection = collection
                }
            )
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

    let onCatchThought: () -> Void

    init(
        authService: AuthService,
        convexService: ConvexService,
        onCatchThought: @escaping () -> Void
    ) {
        self.authService = authService
        self.convexService = convexService
        self.onCatchThought = onCatchThought
    }

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                wordmark

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if let returnedThought {
                            sectionLabel("RETURNED TODAY")
                            thoughtRows([returnedThought])
                            Spacer(minLength: 42)
                        }

                        ForEach(ShelfGroup.allCases, id: \.label) { group in
                            let rows = rows(in: group)
                            if !rows.isEmpty {
                                sectionLabel(group.label)
                                thoughtRows(rows)
                                Spacer(minLength: 34)
                            }
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
            guard let authenticatedUserID = convexService.authenticatedUserID else {
                return
            }
            model.subscribe(
                date: date,
                authenticatedUserID: authenticatedUserID,
                convexService: convexService
            )
        }
        .task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(30))
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

    private var returnedThought: ConvexService.CollectionThought? {
        guard let returnedID = model.collection?.resurfacedId else { return nil }
        return model.collection?.thoughts.first { $0.id == returnedID }
    }

    private func rows(in group: ShelfGroup) -> [ConvexService.CollectionThought] {
        let returnedID = model.collection?.resurfacedId
        return (model.collection?.thoughts ?? []).filter { thought in
            thought.id != returnedID
                && ShelfFormatting.group(for: thought.createdAt, now: now) == group
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .stillnessLabel(.timestamp)
            .padding(.bottom, 12)
    }

    private func thoughtRows(
        _ thoughts: [ConvexService.CollectionThought]
    ) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(thoughts.enumerated()), id: \.element.id) { index, thought in
                if index > 0 {
                    Hairline()
                }
                Button {
                    withAnimation(.easeInOut(duration: 0.28)) {
                        selectedThoughtID = thought.id
                    }
                } label: {
                    Text(thought.preview)
                        .font(StillnessType.shelfThought)
                        .foregroundStyle(Stillness.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(thought.preview)
            }
            Hairline()
        }
    }

    private var subscriptionTaskID: String {
        "\(convexService.authenticatedUserID ?? "")|\(date)"
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
