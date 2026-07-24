import Combine
import Foundation
import SwiftUI

@MainActor
final class CaptureModel: ObservableObject {
    enum Phase: Equatable {
        case editing
        case fadingCapture
        case showingConfirmation
        case fadingConfirmation
    }

    @Published var text = "" {
        didSet {
            if isListening, !isApplyingTranscript, text != oldValue {
                stopDictation()
            }
        }
    }
    @Published private(set) var isListening = false
    @Published private(set) var phase: Phase = .editing
    @Published private(set) var focusRequest = 0

    private let captureQueue: CaptureQueue
    private let ownerIDProvider: @MainActor () -> String?
    private let dictationService: DictationService
    private var confirmationTask: Task<Void, Never>?
    private var dictationTask: Task<Void, Never>?
    private var isApplyingTranscript = false

    init(
        captureQueue: CaptureQueue,
        ownerIDProvider: @escaping @MainActor () -> String?,
        dictationService: DictationService = DictationService()
    ) {
        self.captureQueue = captureQueue
        self.ownerIDProvider = ownerIDProvider
        self.dictationService = dictationService
    }

    var canKeep: Bool {
        phase == .editing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var isCaptureVisible: Bool {
        phase == .editing
    }

    var isConfirmationVisible: Bool {
        phase == .showingConfirmation
    }

    func toggleDictation() {
        guard phase == .editing else { return }

        if isListening {
            stopDictation()
            return
        }

        let existingText = text
        let separator = existingText.isEmpty || existingText.last?.isWhitespace == true ? "" : " "
        isListening = true

        dictationTask?.cancel()
        dictationTask = Task { [weak self] in
            guard let self else { return }
            let started = await dictationService.start(
                onTranscript: { [weak self] transcript in
                    guard let self else { return }
                    isApplyingTranscript = true
                    text = existingText + separator + transcript
                    isApplyingTranscript = false
                },
                onStop: { [weak self] in
                    self?.isListening = false
                }
            )

            guard !Task.isCancelled else {
                if started {
                    dictationService.stop()
                }
                return
            }
            isListening = started
            dictationTask = nil
        }
    }

    func stopDictation() {
        dictationTask?.cancel()
        dictationTask = nil
        dictationService.stop()
        isListening = false
    }

    func keep() {
        guard canKeep else { return }

        let capturedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        stopDictation()
        captureQueue.enqueue(
            text: capturedText,
            ownerID: ownerIDProvider()
        )

        confirmationTask?.cancel()
        phase = .fadingCapture
        AccessibilityNotification.Announcement("Thought kept").post()
        confirmationTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(250))
                guard let self else { return }
                phase = .showingConfirmation

                try await Task.sleep(for: .milliseconds(750))
                phase = .fadingConfirmation

                try await Task.sleep(for: .milliseconds(250))
                text = ""
                phase = .editing
                focusRequest += 1
                confirmationTask = nil
            } catch {
                return
            }
        }
    }
}
