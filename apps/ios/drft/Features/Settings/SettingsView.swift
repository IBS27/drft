import SwiftUI

struct SettingsView: View {
    @ObservedObject private var authService: AuthService
    @ObservedObject private var convexService: ConvexService
    @Environment(\.dismiss) private var dismiss
    @AppStorage private var dailyThoughtTime: Date
    @State private var hasEditedDailyThoughtTime = false
    @State private var lastSyncedSendTime: String?
    @State private var saveTask: Task<Void, Never>?

    init(authService: AuthService, convexService: ConvexService) {
        self.authService = authService
        self.convexService = convexService
        _dailyThoughtTime = AppStorage(
            wrappedValue: Self.defaultDailyThoughtTime,
            "dailyThoughtTime",
            store: UserDefaults(suiteName: "group.com.srinivasib.drft")
        )
    }

    var body: some View {
        ZStack {
            Stillness.surface.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            Text("SETTINGS")
                                .stillnessLabel(.timestamp)

                            Spacer()

                            Button("CLOSE") {
                                dismiss()
                            }
                            .stillnessLabel(.actionMuted)
                            .padding(.vertical, 13)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                            .buttonStyle(.plain)
                            .accessibilityLabel("Close settings")
                        }
                        .padding(.top, 21)
                        .padding(.bottom, 17)

                        if let email = authService.email {
                            Text(email)
                                .stillnessMutedBody()
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.bottom, 24)
                        }

                        Hairline()

                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 18) {
                                Text("daily thought")
                                    .font(StillnessType.action)
                                    .tracking(1.2)
                                    .foregroundStyle(Stillness.ink)

                                Spacer(minLength: 12)

                                Text(dailyThoughtTimeText)
                                    .font(StillnessType.action)
                                    .tracking(1.2)
                                    .foregroundStyle(Stillness.muted)
                                    .accessibilityHidden(true)
                                    .overlay {
                                        DatePicker(
                                            "daily thought",
                                            selection: $dailyThoughtTime,
                                            displayedComponents: .hourAndMinute
                                        )
                                        .labelsHidden()
                                        .datePickerStyle(.compact)
                                        .tint(Stillness.ink)
                                        .colorMultiply(.clear)
                                    }
                            }

                            Text("one thought returns each morning")
                                .stillnessFaintFootnote()
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 24)

                        Hairline()

                        Button {
                            dismiss()
                            Task {
                                await authService.signOut()
                            }
                        } label: {
                            Text("sign out")
                                .font(StillnessType.action)
                                .tracking(1.2)
                                .foregroundStyle(Stillness.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 24)

                        Hairline()
                    }
                    .padding(.horizontal, 28)
                }

                Spacer()

                Text(versionText)
                    .font(.custom(
                        "Helvetica Neue",
                        size: 12,
                        relativeTo: .caption
                    ).weight(.light))
                    .tracking(1.2)
                    .foregroundStyle(Stillness.faint)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 18)
            }
        }
        .task(id: convexService.authenticatedUserID) {
            guard authService.isSignedIn,
                  convexService.authenticatedUserID != nil,
                  let sendTime = try? await convexService.dailyThoughtSendTime(),
                  let date = Self.date(from: sendTime),
                  !hasEditedDailyThoughtTime
            else { return }

            lastSyncedSendTime = sendTime
            dailyThoughtTime = date
        }
        .onChange(of: dailyThoughtTime) { _, date in
            let sendTime = Self.sendTime(from: date)
            guard sendTime != lastSyncedSendTime else { return }

            hasEditedDailyThoughtTime = true
            saveTask?.cancel()

            let timezone = TimeZone.current.identifier
            let email = authService.email
            saveTask = Task { @MainActor in
                do {
                    try await Task.sleep(for: .milliseconds(400))
                    guard authService.isSignedIn else { return }
                    try await convexService.saveDailyThoughtSettings(
                        sendTime: sendTime,
                        timezone: timezone,
                        email: email
                    )
                    guard !Task.isCancelled else { return }
                    lastSyncedSendTime = sendTime
                } catch {
                    // Settings are cached locally; syncing stays quiet offline.
                }
            }
        }
    }

    private var dailyThoughtTimeText: String {
        dailyThoughtTime
            .formatted(date: .omitted, time: .shortened)
            .lowercased()
    }

    private static var defaultDailyThoughtTime: Date {
        let calendar = Calendar.current
        return calendar.date(
            bySettingHour: 8,
            minute: 0,
            second: 0,
            of: .now
        ) ?? .now
    }

    private static func date(from sendTime: String) -> Date? {
        let components = sendTime.split(separator: ":")
        guard components.count == 2,
              let hour = Int(components[0]),
              let minute = Int(components[1]),
              (0...23).contains(hour),
              (0...59).contains(minute)
        else { return nil }

        return Calendar.current.date(
            bySettingHour: hour,
            minute: minute,
            second: 0,
            of: .now
        )
    }

    private static func sendTime(from date: Date) -> String {
        let components = Calendar.current.dateComponents(
            [.hour, .minute],
            from: date
        )
        return String(
            format: "%02d:%02d",
            components.hour ?? 8,
            components.minute ?? 0
        )
    }

    private var versionText: String {
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "1.0"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String ?? "1"
        return "drft \(version) · \(build)"
    }
}
