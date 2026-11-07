import SwiftUI

struct Hairline: View {
    @Environment(\.displayScale) private var displayScale

    /// Points; nil draws a single device pixel. List separators pass 0.5
    /// so they hold on the cream page.
    var thickness: CGFloat?

    var body: some View {
        Rectangle()
            .fill(Stillness.hairline)
            .frame(height: thickness ?? 1 / max(displayScale, 1))
    }
}

extension Hairline {
    /// Between rows of a list: the shelf and Related thoughts.
    static let separatorThickness: CGFloat = 0.5
}
