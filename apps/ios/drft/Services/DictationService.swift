import AVFAudio
import Speech
import UIKit

@MainActor
final class DictationService {
    typealias TranscriptHandler = @MainActor @Sendable (String) -> Void
    typealias StopHandler = @MainActor @Sendable () -> Void

    private let audioEngine = AVAudioEngine()
    private let speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var onTranscript: TranscriptHandler?
    private var onStop: StopHandler?
    private var activeGeneration: UUID?
    private var hasInstalledTap = false
    private var isSessionRunning = false
    private var interruptionTask: Task<Void, Never>?
    private var routeChangeTask: Task<Void, Never>?

    init(locale: Locale = .current) {
        speechRecognizer = SFSpeechRecognizer(locale: locale)
        startAudioSessionMonitoring()
    }

    deinit {
        interruptionTask?.cancel()
        routeChangeTask?.cancel()
    }

    @discardableResult
    func start(
        onTranscript: @escaping TranscriptHandler,
        onStop: @escaping StopHandler
    ) async -> Bool {
        stop()

        let generation = UUID()
        activeGeneration = generation
        self.onTranscript = onTranscript
        self.onStop = onStop

        guard await requestPermissionsIfNeeded(for: generation) else {
            teardown(generation: generation)
            return false
        }
        guard isCurrent(generation), !Task.isCancelled, let speechRecognizer else {
            teardown(generation: generation)
            return false
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        recognitionRequest = request

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: [])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            guard
                !audioSession.currentRoute.inputs.isEmpty,
                format.sampleRate.isFinite,
                format.sampleRate > 0,
                format.channelCount > 0
            else {
                teardown(generation: generation)
                return false
            }

            inputNode.installTap(
                onBus: 0,
                bufferSize: 1_024,
                format: format,
                block: Self.audioTapHandler(for: request)
            )
            hasInstalledTap = true
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            teardown(generation: generation)
            return false
        }

        guard isCurrent(generation), !Task.isCancelled else {
            teardown(generation: generation)
            return false
        }

        recognitionTask = speechRecognizer.recognitionTask(
            with: request,
            resultHandler: Self.recognitionHandler(
                for: self,
                generation: generation
            )
        )
        isSessionRunning = true
        return true
    }

    func stop() {
        teardown(generation: activeGeneration)
    }

    private func teardown(generation: UUID?) {
        if let generation, activeGeneration != generation {
            return
        }

        activeGeneration = nil
        isSessionRunning = false
        let stopHandler = onStop
        onStop = nil

        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInstalledTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInstalledTap = false
        }

        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        onTranscript = nil

        try? AVAudioSession.sharedInstance().setActive(
            false,
            options: .notifyOthersOnDeactivation
        )
        stopHandler?()
    }

    private func isCurrent(_ generation: UUID) -> Bool {
        activeGeneration == generation
    }

    private func requestPermissionsIfNeeded(for generation: UUID) async -> Bool {
        let speechStatus: SFSpeechRecognizerAuthorizationStatus
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined:
            speechStatus = await Self.requestSpeechAuthorization()
        case let status:
            speechStatus = status
        }

        guard isCurrent(generation), !Task.isCancelled else { return false }
        guard speechStatus == .authorized else {
            await openSettings(for: generation)
            return false
        }

        let microphoneGranted: Bool
        switch AVAudioApplication.shared.recordPermission {
        case .undetermined:
            microphoneGranted = await Self.requestMicrophonePermission()
        case .granted:
            microphoneGranted = true
        case .denied:
            microphoneGranted = false
        @unknown default:
            microphoneGranted = false
        }

        guard isCurrent(generation), !Task.isCancelled else { return false }
        guard microphoneGranted else {
            await openSettings(for: generation)
            return false
        }
        return true
    }

    private nonisolated static func audioTapHandler(
        for request: SFSpeechAudioBufferRecognitionRequest
    ) -> AVAudioNodeTapBlock {
        { buffer, _ in
            request.append(buffer)
        }
    }

    private nonisolated static func recognitionHandler(
        for service: DictationService,
        generation: UUID
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { [weak service] result, error in
            let transcript = result?.bestTranscription.formattedString
            let shouldStop = result?.isFinal == true || error != nil

            Task { @MainActor [weak service] in
                guard let service, service.isCurrent(generation) else { return }
                if let transcript {
                    service.onTranscript?(transcript)
                }
                if shouldStop {
                    service.teardown(generation: generation)
                }
            }
        }
    }

    private nonisolated static func requestSpeechAuthorization() async
        -> SFSpeechRecognizerAuthorizationStatus
    {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private nonisolated static func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func openSettings(for generation: UUID) async {
        guard isCurrent(generation), !Task.isCancelled else { return }
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        await UIApplication.shared.open(url)
    }

    private func startAudioSessionMonitoring() {
        interruptionTask = Task { [weak self] in
            for await notification in NotificationCenter.default.notifications(
                named: AVAudioSession.interruptionNotification
            ) {
                guard !Task.isCancelled else { return }
                guard
                    let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    AVAudioSession.InterruptionType(rawValue: typeValue) == .began
                else { continue }
                self?.stopForAudioSessionChange()
            }
        }

        routeChangeTask = Task { [weak self] in
            for await notification in NotificationCenter.default.notifications(
                named: AVAudioSession.routeChangeNotification
            ) {
                guard !Task.isCancelled else { return }
                guard
                    let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                    let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue),
                    reason == .newDeviceAvailable ||
                        reason == .oldDeviceUnavailable ||
                        reason == .noSuitableRouteForCategory ||
                        reason == .routeConfigurationChange
                else { continue }
                self?.stopForAudioSessionChange()
            }
        }
    }

    private func stopForAudioSessionChange() {
        guard isSessionRunning else { return }
        teardown(generation: activeGeneration)
    }
}
