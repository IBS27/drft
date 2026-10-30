import SwiftUI

/// drft, with the vermilion dot that marks "now".
struct Wordmark: View {
    enum Size {
        case regular
        case large
    }

    var size: Size = .regular

    var body: some View {
        HStack(spacing: size == .large ? 12 : 8) {
            Circle()
                .fill(Stillness.now)
                .frame(width: dotDiameter, height: dotDiameter)
                .accessibilityHidden(true)

            Text("drft")
                .font(size == .large
                    ? .geist(32, .semibold, relativeTo: .largeTitle)
                    : StillnessType.wordmark)
                .tracking(size == .large ? -0.96 : StillnessType.wordmarkTracking)
                .foregroundStyle(Stillness.ink)
        }
    }

    private var dotDiameter: CGFloat {
        size == .large ? 12 : 8
    }
}
