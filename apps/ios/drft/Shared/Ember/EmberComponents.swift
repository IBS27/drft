import SwiftUI

/// The Phosphor icons the web app uses, bundled as template vectors in
/// Assets.xcassets/Phosphor (regular weight unless named `-fill`).
enum PhosphorIcon: String {
    case arrowBendUpLeft = "ph-arrow-bend-up-left"
    case arrowLeft = "ph-arrow-left"
    case arrowUpRight = "ph-arrow-up-right"
    case caretDown = "ph-caret-down"
    case caretRight = "ph-caret-right"
    case envelopeSimple = "ph-envelope-simple"
    case gearSix = "ph-gear-six"
    case githubLogoFill = "ph-github-logo-fill"
    case googleLogoFill = "ph-google-logo-fill"
    case graph = "ph-graph"
    case microphone = "ph-microphone"
    case moon = "ph-moon"
    case plus = "ph-plus"
    case signOut = "ph-sign-out"
    case x = "ph-x"
}

struct EmberIcon: View {
    @ScaledMetric private var scaledSize: CGFloat

    let icon: PhosphorIcon
    private let baseSize: CGFloat

    init(_ icon: PhosphorIcon, size: CGFloat = 16) {
        self.icon = icon
        baseSize = size
        _scaledSize = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    // Icons grow with text, but stop short of spilling out of the fixed
    // header and button frames at accessibility sizes.
    private var size: CGFloat {
        min(scaledSize, baseSize * 1.5)
    }

    var body: some View {
        Image(icon.rawValue)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A count, or a few words about one: a quiet fact, never the accent.
struct Badge: View {
    enum Size {
        case small
        case medium
    }

    let text: String
    var size: Size = .small

    var body: some View {
        Text(text)
            .font(size == .medium ? StillnessType.badgeLarge : StillnessType.badge)
            .monospacedDigit()
            .foregroundStyle(Stillness.chromeLabel)
            .lineLimit(1)
            .padding(.horizontal, size == .medium ? 11 : 7)
            .frame(minHeight: size == .medium ? 26 : 18)
            .background(Stillness.hairline.opacity(0.7), in: Capsule())
    }
}

/// A small fact gathered around a thought: where it has been.
struct Chip<Label: View>: View {
    enum Kind {
        /// "Now": returned today.
        case now
        /// Quiet: set down.
        case quiet
    }

    let kind: Kind
    @ViewBuilder let label: () -> Label

    var body: some View {
        HStack(spacing: 6) {
            label()
        }
        .font(StillnessType.captionEmphasis)
        .foregroundStyle(kind == .now ? Stillness.nowInk : Stillness.chromeText)
        .padding(.horizontal, 12)
        .frame(minHeight: 28)
        .background(kind == .now ? Stillness.nowTint : Stillness.surface, in: Capsule())
        .overlay {
            if kind == .quiet {
                Capsule().strokeBorder(Stillness.hairline, lineWidth: 1)
            }
        }
    }
}

/// Every button in the room is a pill: solid vermilion for the one action
/// that matters, an outlined vermilion for resting, and quiet ones beside.
struct PillButtonStyle: ButtonStyle {
    enum Kind {
        case primary
        /// Solid ink: a standing action that isn't "now" (New thought).
        case ink
        case outline
        case neutral
        case quiet
    }

    @Environment(\.isEnabled) private var isEnabled

    let kind: Kind
    var height: CGFloat = 44
    var horizontalPadding: CGFloat = 18

    func makeBody(configuration: Configuration) -> some View {
        let isPressed = configuration.isPressed

        configuration.label
            .font(kind == .primary || kind == .ink ? StillnessType.primaryButton : StillnessType.control)
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontalPadding)
            .frame(minHeight: height)
            .background(fill(isPressed: isPressed), in: Capsule())
            .overlay {
                switch kind {
                case .outline:
                    Capsule().strokeBorder(Stillness.nowEdge, lineWidth: 1.5)
                case .neutral:
                    Capsule().strokeBorder(
                        isPressed ? Stillness.nowEdge : Stillness.hairline,
                        lineWidth: 1
                    )
                case .ink:
                    Capsule().strokeBorder(Stillness.hairline, lineWidth: 1)
                case .primary, .quiet:
                    EmptyView()
                }
            }
            .shadow(
                color: (kind == .primary || kind == .ink) && isEnabled ? Stillness.shadow : .clear,
                radius: 5,
                y: 3
            )
            .contentShape(Capsule())
            .scaleEffect(isPressed ? 0.98 : 1)
            // A primary action waiting for words reads as quiet, not broken.
            .opacity(isEnabled || kind == .primary ? 1 : 0.35)
            .animation(.easeOut(duration: 0.15), value: isPressed)
            .animation(.easeOut(duration: 0.15), value: isEnabled)
    }

    private var foreground: Color {
        switch kind {
        case .primary: isEnabled ? Stillness.onNow : Stillness.chromeLabel
        case .ink: Stillness.onInkPill
        case .outline: Stillness.nowInk
        case .neutral: Stillness.chromeText
        case .quiet: Stillness.chromeText
        }
    }

    private func fill(isPressed: Bool) -> Color {
        switch kind {
        case .primary: isEnabled ? Stillness.now : Stillness.hairline
        case .ink: Stillness.inkPill
        case .neutral: isPressed ? Stillness.nowTint : Stillness.surface
        case .outline, .quiet: isPressed ? Stillness.nowTint : .clear
        }
    }
}

/// A round icon control in page chrome: back, settings.
struct IconButtonStyle: ButtonStyle {
    var diameter: CGFloat = 40

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(configuration.isPressed ? Stillness.ink : Stillness.chromeText)
            .frame(width: max(diameter, 44), height: max(diameter, 44))
            .background {
                Circle()
                    .fill(configuration.isPressed ? Stillness.nowTint : .clear)
                    .frame(width: diameter, height: diameter)
            }
            .contentShape(Circle())
    }
}

/// A row in a list that tints when pressed, the touch reading of the web's
/// hover.
struct RowButtonStyle: ButtonStyle {
    var background: Color = .clear
    var pressedBackground: Color = Stillness.nowTint

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed ? pressedBackground : background,
                in: RoundedRectangle(cornerRadius: StillnessSpacing.cardRadius, style: .continuous)
            )
            .contentShape(RoundedRectangle(cornerRadius: StillnessSpacing.cardRadius, style: .continuous))
    }
}

extension View {
    /// A quiet surface grouping rows: settings, the connections prompt.
    func emberSurface() -> some View {
        background(Stillness.surface)
        .clipShape(RoundedRectangle(cornerRadius: StillnessSpacing.surfaceRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: StillnessSpacing.surfaceRadius, style: .continuous)
                .strokeBorder(Stillness.hairline, lineWidth: 1)
        }
    }
}

/// The top of capture and the shelf: the wordmark on the left, settings on
/// the right. Both open settings; the wordmark keeps the tap it always had.
struct HomeHeader: View {
    var count: Int?
    /// Capture's way down to the shelf (the visible half of the pull-down
    /// gesture), beside settings.
    var onShowShelf: (() -> Void)?
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Button(action: onOpenSettings) {
                Wordmark()
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // The gear says the same thing to VoiceOver; one is enough.
            .accessibilityHidden(true)

            Spacer()

            if let onShowShelf {
                Button(action: onShowShelf) {
                    Text("Thoughts")
                        .font(StillnessType.control)
                        .foregroundStyle(Stillness.chromeText)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Stillness.surface, in: Capsule())
                        .overlay { Capsule().strokeBorder(Stillness.hairline, lineWidth: 1) }
                        .frame(minHeight: 44)
                        .padding(.trailing, 4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show thoughts")
            }

            if let count, count > 0 {
                Badge(text: "\(count) \(count == 1 ? "thought" : "thoughts")", size: .medium)
                    .padding(.trailing, 4)
            }

            Button(action: onOpenSettings) {
                EmberIcon(.gearSix, size: 17)
                    .foregroundStyle(Stillness.chromeText)
                    .frame(width: 32, height: 32)
                    .background(Stillness.surface, in: Circle())
                    .overlay { Circle().strokeBorder(Stillness.hairline, lineWidth: 1) }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Settings")
        }
        .padding(.leading, 22)
        .padding(.trailing, 10)
        .frame(height: 56)
    }
}
