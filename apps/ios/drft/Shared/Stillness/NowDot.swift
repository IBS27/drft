import SwiftUI

struct NowDot: View {
    var diameter: CGFloat = StillnessSpacing.nowDot

    var body: some View {
        Circle()
            .fill(Stillness.now)
            .frame(width: diameter, height: diameter)
    }
}
