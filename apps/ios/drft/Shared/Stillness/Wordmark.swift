import SwiftUI

/// The logo mark (the app icon's dot and caret) beside "drft".
struct Wordmark: View {
    enum Size {
        case regular
        case large
    }

    var size: Size = .regular

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size == .large ? 14 : 8) {
            LogoMark(height: size == .large ? 24 : 12.5)
                // The mark's shapes end on its bottom edge: rest it on the baseline.
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] }

            Text("drft")
                .font(size == .large
                    ? .geist(32, .semibold, relativeTo: .largeTitle)
                    : StillnessType.wordmark)
                .tracking(size == .large ? -0.96 : StillnessType.wordmarkTracking)
                .foregroundStyle(Stillness.ink)
        }
    }
}

/// The dot and caret from the app icon, cropped to the glyph (20 × 26 units).
struct LogoMark: View {
    var height: CGFloat

    var body: some View {
        let unit = height / 26
        ZStack(alignment: .bottomLeading) {
            Circle()
                .fill(Stillness.now)
                .frame(width: 12 * unit, height: 12 * unit)
            RoundedRectangle(cornerRadius: 1.5 * unit)
                .fill(Stillness.ink)
                .frame(width: 4 * unit, height: height)
                .offset(x: 16 * unit)
        }
        .frame(width: 20 * unit, height: height, alignment: .bottomLeading)
        .accessibilityHidden(true)
    }
}
