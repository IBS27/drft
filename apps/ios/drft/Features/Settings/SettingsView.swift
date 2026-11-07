import SwiftUI

struct SettingsView: View {
    /// The device's timezone as a place ("Chicago"), not a database id.
    private static var placeName: String {
        (TimeZone.current.identifier.split(separator: "/").last.map(String.init) ?? "Local")
            .replacingOccurrences(of: "_", with: " ")
    }

    @ObservedObject private var authService: AuthService
    @ObservedObject private var convexService: ConvexService
    @Environment(\.dismiss) private var dismiss
    @AppStorage private var dailyThoughtTime: Date
    @State private var hasEditedDailyThoughtTime = false
    @State private var lastSyncedSendTime: String?
    @State private var saveTask: Task<Void, Never>?
    @State private var deletionIsConfirming = false
    @State private var isDeletingAccount = false
    @State private var deletionFailed = false
    @State private var pendingConnections: Bool?
    @State private var headerHeight: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    /// Opens hugging its content; the guess only stands until the first
    /// measurement, which lands before the sheet is on screen.
    @State private var detent = PresentationDetent.height(Self.estimatedHeight)

    private static let estimatedHeight: CGFloat = 640

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
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    Text("Settings")
                        .font(.geist(22, .semibold, relativeTo: .title2))
                        .tracking(-0.3)
                        .foregroundStyle(Stillness.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 8)
                        .accessibilityAddTraits(.isHeader)

                    HStack {
                        Spacer()

                        Button {
                            dismiss()
                        } label: {
                            EmberIcon(.x, size: 14)
                        }
                        .buttonStyle(IconButtonStyle(diameter: 30, filled: true))
                        .accessibilityLabel("Close settings")
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 8)
                .frame(minHeight: 64)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                    headerHeight = $0
                }

                ScrollView {
                    VStack(spacing: 16) {
                        // Who you are is context, not a setting: a quiet
                        // line above the cards.
                        if let email = authService.email {
                            (Text("Signed in as ") + Text(email).foregroundStyle(Stillness.chromeText))
                                .font(StillnessType.caption)
                                .foregroundStyle(Stillness.chromeLabel)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        VStack(spacing: 0) {

                            // Controls centre on the whole row (title and
                            // description), like the chevron rows below.
                            HStack(spacing: 16) {
                                settingText(
                                    "Daily thought",
                                    detail: "One thought returns each morning, \(Self.placeName) time"
                                )

                                Spacer(minLength: 12)

                                HStack(spacing: 6) {
                                    Text(dailyThoughtTimeText)
                                        .font(StillnessType.body)
                                        .monospacedDigit()
                                        .foregroundStyle(Stillness.ink)
                                    EmberIcon(.caretDown, size: 11)
                                        .foregroundStyle(Stillness.chromeLabel)
                                }
                                    .padding(.leading, 14)
                                    .padding(.trailing, 11)
                                    .frame(minHeight: 36)
                                    .background(Stillness.page, in: Capsule())
                                    .overlay {
                                        Capsule().strokeBorder(Stillness.hairline, lineWidth: 1)
                                    }
                                    .accessibilityHidden(true)
                                    .overlay {
                                        DatePicker(
                                            "Daily thought",
                                            selection: $dailyThoughtTime,
                                            displayedComponents: .hourAndMinute
                                        )
                                        .labelsHidden()
                                        .datePickerStyle(.compact)
                                        .tint(Stillness.now)
                                        .colorMultiply(.clear)
                                    }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)

                            Hairline()

                            Toggle(isOn: connections) {
                                settingText(
                                    "Connections",
                                    detail: "Thought text is sent to OpenAI to find echoes"
                                )
                            }
                            .toggleStyle(EmberSwitchStyle())
                            .disabled(convexService.consent == .unknown)
                        }
                        .emberSurface()

                        VStack(spacing: 0) {
                            Link(destination: .privacyPolicy) {
                                linkRow("Privacy policy", icon: .arrowUpRight)
                            }
                            .buttonStyle(SettingsRowButtonStyle())

                            Hairline()

                            Button {
                                dismiss()
                                Task {
                                    await authService.signOut()
                                }
                            } label: {
                                linkRow("Sign out", icon: .signOut)
                            }
                            .buttonStyle(SettingsRowButtonStyle())
                            .disabled(isDeletingAccount)
                        }
                        .emberSurface()

                        VStack(alignment: .leading, spacing: 0) {
                            Button {
                                deletionIsConfirming = true
                            } label: {
                                HStack(spacing: 16) {
                                    settingText(
                                        isDeletingAccount ? "Deleting…" : "Delete account",
                                        detail: "Removes your thoughts and notes for good"
                                    )
                                    Spacer(minLength: 12)
                                    trailingGlyph(.caretRight)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                            }
                            .buttonStyle(SettingsRowButtonStyle())
                            .disabled(isDeletingAccount)

                            if deletionFailed {
                                Text("Couldn't finish deleting. Try again.")
                                    .font(StillnessType.caption)
                                    .foregroundStyle(Stillness.nowInk)
                                    .padding(.horizontal, 16)
                                    .padding(.bottom, 14)
                            }
                        }
                        .emberSurface()
                        // Set apart from the everyday settings, as on web.
                        .padding(.top, 24)

                        // Right under the last card, not stranded at the
                        // foot of the sheet.
                        Text(versionText)
                            .font(StillnessType.caption)
                            .foregroundStyle(Stillness.chromeLabel)
                            .frame(maxWidth: .infinity)
                            .padding(.top, -4)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        contentHeight = $0
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .presentationDetents([fittedDetent, .large], selection: $detent)
        .onChange(of: fittedDetent) { oldDetent, newDetent in
            // Follow the content (an error line appearing) unless the
            // sheet was pulled up to full height.
            if detent == oldDetent { detent = newDetent }
        }
        .interactiveDismissDisabled(isDeletingAccount)
        // The one irreversible act in the product: asked once, plainly.
        .alert("Delete your account?", isPresented: $deletionIsConfirming) {
            Button("Delete Everything", role: .destructive) {
                deleteAccount()
            }
            Button("Keep It", role: .cancel) {}
        } message: {
            Text("Your account and everything in it — every thought, its connections and notes, and the daily email — will be deleted. This can't be undone.")
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

    private var fittedDetent: PresentationDetent {
        let measured = headerHeight + contentHeight
        return .height(contentHeight > 0 ? ceil(measured) : Self.estimatedHeight)
    }

    /// A setting's name over its one-line description, a fixed 4pt apart
    /// whatever the trailing control.
    private func settingText(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(StillnessType.body)
                .foregroundStyle(Stillness.ink)
            Text(detail)
                .font(StillnessType.caption)
                .foregroundStyle(Stillness.chromeLabel)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func linkRow(_ title: String, icon: PhosphorIcon) -> some View {
        HStack(spacing: 16) {
            Text(title)
                .font(StillnessType.body)
                .foregroundStyle(Stillness.ink)

            Spacer(minLength: 12)

            trailingGlyph(icon)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    /// Every row's trailing mark (↗, sign out, ›) in one colour at one
    /// optical size (about 14pt): Phosphor draws the sign-out door large in
    /// its box and the arrow and chevron small, so each is nudged until
    /// their ink stands about 10pt tall.
    private func trailingGlyph(_ icon: PhosphorIcon) -> some View {
        let size: CGFloat = switch icon {
        case .signOut: 13
        case .arrowUpRight, .caretRight: 15
        default: 14
        }
        return EmberIcon(icon, size: size)
            .frame(width: 16, height: 16)
            .foregroundStyle(Stillness.chromeLabel)
    }

    private func deleteAccount() {
        deletionFailed = false
        isDeletingAccount = true
        saveTask?.cancel()
        Task { @MainActor in
            do {
                try await authService.deleteAccount(using: convexService)
                dismiss()
            } catch {
                isDeletingAccount = false
                deletionFailed = true
            }
        }
    }

    // Reflects the server (never asked reads as off); a change shows at once
    // and falls back to the server value if the write fails.
    private var connections: Binding<Bool> {
        Binding(
            get: {
                pendingConnections
                    ?? (convexService.consent == .decided(aiConnections: true))
            },
            set: { allowed in
                pendingConnections = allowed
                Task { @MainActor in
                    try? await convexService.setAiConnections(allowed)
                    if pendingConnections == allowed {
                        pendingConnections = nil
                    }
                }
            }
        )
    }

    private var dailyThoughtTimeText: String {
        ShelfFormatting.plainSpaces(
            dailyThoughtTime.formatted(date: .omitted, time: .shortened)
        ).lowercased()
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
        return "Version \(version) (\(build))"
    }
}

/// A row that tints when pressed; its surface clips the corners.
private struct SettingsRowButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Stillness.nowTint : .clear)
            .opacity(isEnabled ? 1 : 0.5)
    }
}

/// The web's switch: vermilion when on, a hairline track when off.
private struct EmberSwitchStyle: ToggleStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 16) {
                configuration.label

                Spacer(minLength: 12)

                ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                    Capsule()
                        .fill(configuration.isOn ? Stillness.switchOn : Stillness.hairline)
                        .overlay {
                            if !configuration.isOn {
                                Capsule().strokeBorder(Stillness.chromeLabel, lineWidth: 1)
                            }
                        }

                    Circle()
                        .fill(Stillness.switchKnob)
                        .overlay { Circle().strokeBorder(Stillness.switchKnobRing, lineWidth: 1) }
                        .frame(width: 20, height: 20)
                        .shadow(color: Stillness.switchKnobShadow, radius: 1.5, y: 1)
                        .padding(2)
                }
                .frame(width: 40, height: 24)
                .opacity(isEnabled ? 1 : 0.35)
                .animation(.easeOut(duration: 0.18), value: configuration.isOn)
                .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "on" : "off")
        .accessibilityAddTraits(.isToggle)
    }
}
