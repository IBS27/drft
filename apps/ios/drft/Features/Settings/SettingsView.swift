import SwiftUI

struct SettingsView: View {
    @ObservedObject private var authService: AuthService
    @Environment(\.dismiss) private var dismiss
    @AppStorage private var dailyThoughtTime: Date

    init(authService: AuthService) {
        self.authService = authService
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
                Text("SETTINGS")
                    .stillnessLabel(.timestamp)
                    .padding(.top, 34)
                    .padding(.bottom, 30)

                Text(authService.email ?? "")
                    .font(.custom("Helvetica Neue", size: 15).weight(.light))
                    .foregroundStyle(Stillness.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 24)

                Hairline()

                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 18) {
                        Text("daily thought")
                            .font(StillnessType.action)
                            .tracking(1.2)
                            .foregroundStyle(Stillness.ink)

                        Spacer(minLength: 12)

                        DatePicker(
                            "daily thought",
                            selection: $dailyThoughtTime,
                            displayedComponents: .hourAndMinute
                        )
                        .labelsHidden()
                        .datePickerStyle(.compact)
                        .tint(Stillness.ink)
                    }

                    Text("one thought returns each morning · arrives with phase 5")
                        .font(.custom("Helvetica Neue", size: 13).weight(.light))
                        .foregroundStyle(Stillness.faint)
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

                Spacer()

                Text(versionText)
                    .font(.custom("Helvetica Neue", size: 12).weight(.light))
                    .tracking(1.2)
                    .foregroundStyle(Stillness.faint)
                    .padding(.bottom, 18)
            }
            .padding(.horizontal, 28)
        }
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
