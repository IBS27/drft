import SwiftUI

struct CaptureView: View {
    @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var authService: AuthService
    @ObservedObject private var convexService: ConvexService
    @StateObject private var model: CaptureModel
    @State private var settingsArePresented = false
    @State private var listeningPulse = false
    @FocusState private var inputIsFocused: Bool
    private let focusRequest: Int
    private let isPresented: Bool
    private let onShelfDragChanged: (CGFloat) -> Void
    private let onRevealShelf: () -> Void

    init(
        captureQueue: CaptureQueue,
        authService: AuthService,
        convexService: ConvexService,
        focusRequest: Int,
        isPresented: Bool,
        onShelfDragChanged: @escaping (CGFloat) -> Void,
        onRevealShelf: @escaping () -> Void
    ) {
        self.authService = authService
        self.convexService = convexService
        self.focusRequest = focusRequest
        self.isPresented = isPresented
        self.onShelfDragChanged = onShelfDragChanged
        self.onRevealShelf = onRevealShelf
        _model = StateObject(
            wrappedValue: CaptureModel(
                captureQueue: captureQueue,
                ownerIDProvider: { [weak authService] in
                    authService?.captureOwnerID
                }
            )
        )
    }

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                Button {
                    model.stopDictation()
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

                Spacer(minLength: 28)

                VStack(spacing: 22) {
                    TextField("", text: $model.text, axis: .vertical)
                        .textFieldStyle(.plain)
                        .textInputAutocapitalization(.never)
                        .stillnessThought()
                        .tint(Stillness.ink)
                        .focused($inputIsFocused)
                        .lineLimit(1...(dynamicTypeSize.isAccessibilitySize ? 8 : 5))
                        .submitLabel(.return)
                        .accessibilityLabel("Thought")

                    TimelineView(.periodic(from: .now, by: 15)) { context in
                        Text(timestamp(for: context.date))
                            .stillnessLabel(.timestamp)
                    }
                }
                .frame(maxWidth: 345)
                .padding(.horizontal, 24)

                Spacer(minLength: 28)
            }
            .opacity(model.isCaptureVisible ? 1 : 0)
            .animation(
                model.isCaptureVisible
                    ? .easeIn(duration: 0.18)
                    : .easeOut(duration: 0.25),
                value: model.isCaptureVisible
            )
            .allowsHitTesting(model.isCaptureVisible)

            NowDot()
                .scaleEffect(
                    accessibilityReduceMotion || model.phase != .fadingCapture
                        ? 1
                        : 0.6
                )
                .animation(
                    accessibilityReduceMotion
                        ? nil
                        : .spring(response: 0.4, dampingFraction: 0.8),
                    value: model.phase
                )
                .opacity(model.isConfirmationVisible ? 1 : 0)
                .animation(
                    model.phase == .fadingConfirmation
                        ? .easeOut(duration: 0.25)
                        : .easeIn(duration: 0.15),
                    value: model.phase
                )
                .accessibilityHidden(true)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actionRow
        }
        .sensoryFeedback(.impact(weight: .light), trigger: model.phase) { _, phase in
            phase == .fadingCapture
        }
        .simultaneousGesture(shelfDragGesture)
        .task(id: focusRequest) {
            inputIsFocused = false
            if settingsArePresented {
                settingsArePresented = false
                return
            }
            guard isPresented else { return }
            await Task.yield()
            inputIsFocused = true
        }
        .onChange(of: isPresented, initial: true) { _, isPresented in
            guard isPresented else {
                inputIsFocused = false
                model.stopDictation()
                return
            }
            Task { @MainActor in
                await Task.yield()
                inputIsFocused = true
            }
        }
        .onChange(of: model.focusRequest) {
            inputIsFocused = true
        }
        .onChange(of: model.isListening, initial: true) { _, isListening in
            updateListeningPulse(isListening: isListening)
        }
        .onChange(of: accessibilityReduceMotion) {
            updateListeningPulse(isListening: model.isListening)
        }
        .onDisappear {
            model.stopDictation()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                guard isPresented else { return }
                inputIsFocused = false
                Task { @MainActor in
                    await Task.yield()
                    inputIsFocused = true
                }
            } else {
                model.stopDictation()
            }
        }
        .sheet(isPresented: $settingsArePresented, onDismiss: {
            inputIsFocused = false
            Task { @MainActor in
                await Task.yield()
                inputIsFocused = true
            }
        }) {
            SettingsView(
                authService: authService,
                convexService: convexService
            )
                .presentationBackground(Stillness.surface)
                .presentationDragIndicator(.hidden)
                .presentationDetents([.medium, .large])
        }
    }

    private var actionRow: some View {
        HStack(spacing: StillnessSpacing.actionGap) {
            Button {
                model.toggleDictation()
            } label: {
                speakLabel
                    .padding(.vertical, 13)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.isListening ? "Stop listening" : "Speak")

            Button {
                model.keep()
            } label: {
                HStack(spacing: StillnessSpacing.dotLabelGap) {
                    NowDot()
                    Text("KEEP")
                        .stillnessLabel(.actionInk)
                }
                .padding(.vertical, 13)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!model.canKeep)
            .opacity(model.canKeep ? 1 : 0.35)
            .animation(.easeOut(duration: 0.15), value: model.canKeep)
            .accessibilityLabel("Keep")
        }
        .padding(.bottom, 9)
        .opacity(model.isCaptureVisible ? 1 : 0)
        .animation(
            model.isCaptureVisible
                ? .easeIn(duration: 0.18)
                : .easeOut(duration: 0.25),
            value: model.isCaptureVisible
        )
        .allowsHitTesting(model.isCaptureVisible)
    }

    private var shelfDragGesture: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .local)
            .onChanged { value in
                guard isPresented, model.phase == .editing else { return }
                let vertical = value.translation.height
                let horizontal = abs(value.translation.width)
                guard vertical > 0, vertical > horizontal else { return }

                if vertical > 8 {
                    inputIsFocused = false
                    model.stopDictation()
                }
                onShelfDragChanged(vertical)
            }
            .onEnded { value in
                guard isPresented, model.phase == .editing else {
                    onShelfDragChanged(0)
                    return
                }
                let vertical = value.translation.height
                let horizontal = abs(value.translation.width)
                let predictedVertical = value.predictedEndTranslation.height
                let isVerticalPull = vertical > 0 && vertical > horizontal
                let isCommitted = vertical > 110 || predictedVertical > 190

                if isVerticalPull && isCommitted {
                    inputIsFocused = false
                    onRevealShelf()
                } else {
                    onShelfDragChanged(0)
                }
            }
    }

    @ViewBuilder
    private var speakLabel: some View {
        if model.isListening {
            HStack(spacing: 9) {
                if accessibilityReduceMotion {
                    NowDot(diameter: 8)
                } else {
                    NowDot(diameter: 8)
                        .scaleEffect(listeningPulse ? 1 : 0.72)
                        .opacity(listeningPulse ? 1 : 0.55)
                }
                Text("LISTENING")
                    .stillnessLabel(.actionInk)
            }
        } else {
            Text("SPEAK")
                .stillnessLabel(.actionMuted)
        }
    }

    private func updateListeningPulse(isListening: Bool) {
        guard isListening else {
            withAnimation(.easeOut(duration: 0.15)) {
                listeningPulse = false
            }
            return
        }

        guard !accessibilityReduceMotion else {
            listeningPulse = true
            return
        }

        listeningPulse = false
        withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
            listeningPulse = true
        }
    }

    private func timestamp(for date: Date) -> String {
        "\(ShelfFormatting.time(for: date)) · unfiled"
    }
}
