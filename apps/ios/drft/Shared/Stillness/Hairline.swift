import SwiftUI

struct Hairline: View {
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Rectangle()
            .fill(Stillness.hairline)
            .frame(height: 1 / max(displayScale, 1))
    }
}
