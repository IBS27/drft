import SwiftUI

struct CaptureView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var authService: AuthService
    @StateObject private var model: CaptureModel
    @State private var settingsArePresented = false
    @State private var listeningPulse = false
    @FocusState private var inputIsFocused: Bool
    private let focusRequest: Int

    init(captureQueue: CaptureQueue, authService: AuthService, focusRequest: Int) {
        self.authService = authService
        self.focusRequest = focusRequest
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
                }
                .buttonStyle(.plain)
                .padding(.top, 18)

                Spacer(minLength: 28)

                VStack(spacing: 22) {
                    TextField("", text: $model.text, axis: .vertical)
                        .textFieldStyle(.plain)
                        .stillnessThought()
                        .focused($inputIsFocused)
                        .lineLimit(1...5)
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

                HStack(spacing: StillnessSpacing.actionGap) {
                    Button {
                        model.toggleDictation()
                    } label: {
                        speakLabel
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
                    }
                    .buttonStyle(.plain)
                    .disabled(!model.canKeep)
                    .opacity(model.canKeep ? 1 : 0.35)
                    .accessibilityLabel("Keep")
                }
                .padding(.bottom, 22)
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
                .opacity(model.isConfirmationVisible ? 1 : 0)
                .animation(
                    model.phase == .fadingConfirmation
                        ? .easeOut(duration: 0.25)
                        : .easeIn(duration: 0.15),
                    value: model.phase
                )
                .accessibilityHidden(true)
        }
        .contentShape(Rectangle())
        .task(id: focusRequest) {
            inputIsFocused = false
            if settingsArePresented {
                settingsArePresented = false
                return
            }
            await Task.yield()
            inputIsFocused = true
        }
        .onChange(of: model.focusRequest) {
            inputIsFocused = true
        }
        .onChange(of: model.isListening, initial: true) { _, isListening in
            if isListening {
                listeningPulse = false
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                    listeningPulse = true
                }
            } else {
                withAnimation(.easeOut(duration: 0.15)) {
                    listeningPulse = false
                }
            }
        }
        .onDisappear {
            model.stopDictation()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
            model.stopDictation()
        }
        .sheet(isPresented: $settingsArePresented, onDismiss: {
            inputIsFocused = false
            Task { @MainActor in
                await Task.yield()
                inputIsFocused = true
            }
        }) {
            SettingsView(authService: authService)
                .presentationBackground(Stillness.surface)
                .presentationDragIndicator(.hidden)
                .presentationDetents([.large])
        }
    }

    @ViewBuilder
    private var speakLabel: some View {
        if model.isListening {
            HStack(spacing: 9) {
                NowDot(diameter: 8)
                    .scaleEffect(listeningPulse ? 1 : 0.72)
                    .opacity(listeningPulse ? 1 : 0.55)
                Text("LISTENING")
                    .stillnessLabel(.actionInk)
            }
        } else {
            Text("SPEAK")
                .stillnessLabel(.actionMuted)
        }
    }

    private func timestamp(for date: Date) -> String {
        let time = date.formatted(
            .dateTime
                .hour(.twoDigits(amPM: .omitted))
                .minute(.twoDigits)
        )
        return "\(time) · unfiled"
    }
}
