import SwiftUI

/// Text held to a few lines that, when it runs long, ends on a whole word
/// and an ellipsis ("…plan tomorrow…"), never mid-word. Font, colour and
/// line spacing come from the environment, like a plain `Text`.
///
/// It is measured with SwiftUI's own text layout at the row's real width:
/// two hidden rulers give the height of `lineLimit` lines, and a
/// `ViewThatFits` shows the longest word-boundary prefix within it.
struct WordTruncatedText: View {
    let text: String
    var lineLimit = 2

    var body: some View {
        LineBudgetLayout {
            ruler(lines: lineLimit)
            ruler(lines: lineLimit + 1)

            ViewThatFits(in: .vertical) {
                Text(text)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(Self.shortenings(of: text), id: \.self) { prefix in
                    Text(prefix + "…")
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // One unbroken word longer than the lines themselves.
                Text(text)
                    .lineLimit(lineLimit)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(text))
    }

    private func ruler(lines: Int) -> some View {
        Text(Array(repeating: "Ag", count: lines).joined(separator: "\n"))
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .hidden()
    }

    /// Short words that read as unfinished right before an ellipsis.
    private static let joiningWords: Set<String> = [
        "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "to",
        "in", "on", "at", "by", "for", "from", "with", "as", "into", "than",
        "that", "if", "&",
    ]

    /// Closing marks stay; everything else that would sit before the
    /// ellipsis (commas, dashes, opening quotes) goes.
    private static let keptClosers: Set<Character> = [")", "]", "}", "”", "’", "\"", "'"]

    /// Every whole-word prefix of `text`, longest first, each with its
    /// trailing punctuation and dangling joining words dropped.
    static func shortenings(of text: String) -> [String] {
        var results: [String] = []
        var seen: Set<String> = []
        var index = text.endIndex

        while let wordEnd = previousWordEnd(in: text, before: index) {
            index = wordEnd
            let prefix = tidy(text[..<wordEnd])
            if !prefix.isEmpty, seen.insert(prefix).inserted {
                results.append(prefix)
            }
        }

        return results
    }

    /// The end of the last word that finishes strictly before `limit`:
    /// a non-space character followed by whitespace.
    private static func previousWordEnd(in text: String, before limit: String.Index) -> String.Index? {
        var index = limit
        // Step back over the current word, then over the gap before it.
        while index > text.startIndex, !text[text.index(before: index)].isWhitespace {
            index = text.index(before: index)
        }
        while index > text.startIndex, text[text.index(before: index)].isWhitespace {
            index = text.index(before: index)
        }
        return index > text.startIndex ? index : nil
    }

    private static func tidy(_ prefix: Substring) -> String {
        var result = trimmingTail(prefix)
        // Keep at least one word.
        while let gap = result.lastIndex(where: \.isWhitespace),
              joiningWords.contains(result[result.index(after: gap)...].lowercased()) {
            result = trimmingTail(result[..<gap])
        }
        return result
    }

    private static func trimmingTail(_ text: Substring) -> String {
        var end = text.endIndex
        while end > text.startIndex {
            let character = text[text.index(before: end)]
            let isDroppable = character.isWhitespace
                || ((character.isPunctuation || character.isSymbol) && !keptClosers.contains(character))
            guard isDroppable else { break }
            end = text.index(before: end)
        }
        return String(text[..<end])
    }
}

/// Lays out [ruler(n lines), ruler(n + 1 lines), content], proposing the
/// content a height halfway between the two rulers: anything that wraps
/// to n lines fits, n + 1 never does, whatever the font's line height.
private struct LineBudgetLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard subviews.count == 3 else { return .zero }
        return subviews[2].sizeThatFits(contentProposal(width: proposal.width, subviews: subviews))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 3 else { return }
        let rulerProposal = ProposedViewSize(width: bounds.width, height: nil)
        subviews[0].place(at: bounds.origin, proposal: rulerProposal)
        subviews[1].place(at: bounds.origin, proposal: rulerProposal)
        subviews[2].place(
            at: bounds.origin,
            proposal: contentProposal(width: bounds.width, subviews: subviews)
        )
    }

    /// Baselines and edges are the shown text's, so the layout lines up
    /// beside other text like a plain `Text`.
    func explicitAlignment(
        of guide: VerticalAlignment,
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGFloat? {
        guard subviews.count == 3 else { return nil }
        let dimensions = subviews[2].dimensions(
            in: contentProposal(width: bounds.width, subviews: subviews)
        )
        return bounds.minY + dimensions[guide]
    }

    private func contentProposal(width: CGFloat?, subviews: Subviews) -> ProposedViewSize {
        let rulerProposal = ProposedViewSize(width: width, height: nil)
        let fits = subviews[0].sizeThatFits(rulerProposal).height
        let overflows = subviews[1].sizeThatFits(rulerProposal).height
        return ProposedViewSize(width: width, height: (fits + overflows) / 2)
    }
}
