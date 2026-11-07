import SwiftUI

/// Sets wrapped text at the narrowest width that keeps its line count, so
/// the last line isn't left holding a word or two ("…lend out time, not /
/// just books" becomes "…lend out / time, not just books"). Like CSS
/// `text-wrap: balance`, but never narrower than `minimumFraction` of the
/// room, so a barely-wrapping line doesn't become a thin column. Text
/// that fits on one line is untouched. Wraps a single `Text`.
struct BalancedWrap: Layout {
    var minimumFraction: CGFloat = 2.0 / 3.0

    func makeCache(subviews: Subviews) -> [CGFloat: CGFloat] { [:] }

    func updateCache(_ cache: inout [CGFloat: CGFloat], subviews: Subviews) {
        cache = [:]
    }

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout [CGFloat: CGFloat]
    ) -> CGSize {
        guard let text = subviews.first else { return .zero }
        guard let width = proposal.width, width.isFinite, width > 0 else {
            return text.sizeThatFits(proposal)
        }
        let balanced = balancedWidth(for: width, text: text, cache: &cache)
        let size = text.sizeThatFits(ProposedViewSize(width: balanced, height: proposal.height))
        // Wrapped text still claims the full room, as a plain `Text` would,
        // so re-proposing the reported width never narrows it further.
        return CGSize(width: balanced < width ? width : size.width, height: size.height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout [CGFloat: CGFloat]
    ) {
        guard let text = subviews.first else { return }
        let width = balancedWidth(for: bounds.width, text: text, cache: &cache)
        text.place(at: bounds.origin, proposal: ProposedViewSize(width: width, height: bounds.height))
    }

    /// Baselines are the text's own, so rows still align on its first line.
    func explicitAlignment(
        of guide: VerticalAlignment,
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout [CGFloat: CGFloat]
    ) -> CGFloat? {
        guard let text = subviews.first else { return nil }
        let width = balancedWidth(for: bounds.width, text: text, cache: &cache)
        return bounds.minY + text.dimensions(in: ProposedViewSize(width: width, height: nil))[guide]
    }

    private func balancedWidth(
        for width: CGFloat,
        text: LayoutSubview,
        cache: inout [CGFloat: CGFloat]
    ) -> CGFloat {
        guard width.isFinite, width > 0 else { return width }
        if let known = cache[width] { return known }

        func height(at candidate: CGFloat) -> CGFloat {
            text.sizeThatFits(ProposedViewSize(width: candidate, height: nil)).height
        }

        var result = width
        // One line: nothing to balance.
        if text.sizeThatFits(.unspecified).width > width {
            let target = height(at: width)
            var low = (width * minimumFraction).rounded(.up)
            var high = width
            if height(at: low) <= target + 0.5 {
                high = low
            } else {
                // `low` adds a line, `high` doesn't: close in on the edge.
                while high - low > 1 {
                    let middle = ((low + high) / 2).rounded()
                    if height(at: middle) <= target + 0.5 { high = middle } else { low = middle }
                }
            }
            result = high
        }

        cache[width] = result
        return result
    }
}
