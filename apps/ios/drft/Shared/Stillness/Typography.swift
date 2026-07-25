import SwiftUI

enum StillnessType {
    static let wordmark = Font.custom(
        "Helvetica Neue",
        size: 15,
        relativeTo: .subheadline
    ).weight(.regular)
    static let thought = Font.custom(
        "Helvetica Neue",
        size: 30,
        relativeTo: .title
    ).weight(.light)
    static let timestamp = Font.custom(
        "Helvetica Neue",
        size: 13,
        relativeTo: .footnote
    ).weight(.light)
    static let action = Font.custom(
        "Helvetica Neue",
        size: 15,
        relativeTo: .subheadline
    ).weight(.regular)

    static let wordmarkTracking: CGFloat = 7.5
    static let thoughtLineSpacing: CGFloat = 15
    static let timestampTracking: CGFloat = 3.9
    static let actionTracking: CGFloat = 4.5
}

private struct WordmarkStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(StillnessType.wordmark)
            .tracking(StillnessType.wordmarkTracking)
            .textCase(.uppercase)
            .foregroundStyle(Stillness.faint)
    }
}

private struct ThoughtStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(StillnessType.thought)
            .lineSpacing(StillnessType.thoughtLineSpacing)
            .multilineTextAlignment(.center)
            .foregroundStyle(Stillness.ink)
    }
}

private struct MutedBodyStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.custom(
                "Helvetica Neue",
                size: 15,
                relativeTo: .subheadline
            ).weight(.light))
            .foregroundStyle(Stillness.muted)
    }
}

private struct FaintFootnoteStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.custom(
                "Helvetica Neue",
                size: 13,
                relativeTo: .footnote
            ).weight(.light))
            .foregroundStyle(Stillness.faint)
    }
}

private struct StillnessLabelStyle: ViewModifier {
    let kind: StillnessLabelKind

    func body(content: Content) -> some View {
        content
            .font(kind.font)
            .tracking(kind.tracking)
            .textCase(.uppercase)
            .foregroundStyle(kind.color)
    }
}

enum StillnessLabelKind {
    case timestamp
    case actionMuted
    case actionInk

    fileprivate var font: Font {
        switch self {
        case .timestamp:
            StillnessType.timestamp
        case .actionMuted, .actionInk:
            StillnessType.action
        }
    }

    fileprivate var tracking: CGFloat {
        switch self {
        case .timestamp:
            StillnessType.timestampTracking
        case .actionMuted, .actionInk:
            StillnessType.actionTracking
        }
    }

    fileprivate var color: Color {
        switch self {
        case .timestamp:
            Stillness.faint
        case .actionMuted:
            Stillness.muted
        case .actionInk:
            Stillness.ink
        }
    }
}

extension View {
    func stillnessWordmark() -> some View {
        modifier(WordmarkStyle())
    }

    func stillnessThought() -> some View {
        modifier(ThoughtStyle())
    }

    func stillnessMutedBody() -> some View {
        modifier(MutedBodyStyle())
    }

    func stillnessFaintFootnote() -> some View {
        modifier(FaintFootnoteStyle())
    }

    func stillnessLabel(_ kind: StillnessLabelKind) -> some View {
        modifier(StillnessLabelStyle(kind: kind))
    }
}
