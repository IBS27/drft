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
    /// Told whether the last shown line has ink below the baseline (g, p,
    /// y, a comma…), so a row can sit its divider the same distance under
    /// "tide tables" as under "plan…".
    var onLastLineDescends: ((Bool) -> Void)? = nil

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
        .onPreferenceChange(Text.LayoutKey.self) { layouts in
            guard let onLastLineDescends, let layout = layouts.last?.layout else { return }
            onLastLineDescends(Self.lastLineDescends(in: layout, of: text))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(text))
    }

    private func ruler(lines: Int) -> some View {
        Text(Array(repeating: "Ag", count: lines).joined(separator: "\n"))
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .hidden()
            // Only the shown text's layout is reported.
            .transformPreference(Text.LayoutKey.self) { $0 = [] }
    }

    /// Geist's glyphs that reach below the baseline.
    private static let descenders = Set("gjpqy,;()[]{}/\\|@$_Q".utf16)

    /// Whether any character on the shown text's last line descends. The
    /// shown text is `text` or a prefix of it plus "…", so offsets index
    /// `text` either way; a closing "…" never descends and is skipped.
    /// Anything outside ASCII counts as descending, keeping the full room.
    private static func lastLineDescends(in layout: Text.Layout, of text: String) -> Bool {
        let indices = layout.flatMap { line in line.flatMap(\.characterIndices) }
        guard let first = indices.min(),
              let last = indices.max(),
              let lastLine = layout.last
        else { return true }

        let units = Array(text.utf16)
        let isTruncated = first.distance(to: last) + 1 < units.count
        for index in lastLine.flatMap(\.characterIndices) {
            let offset = first.distance(to: index)
            if isTruncated, index == last { continue }
            guard offset < units.count else { return true }
            let unit = units[offset]
            if unit > 0x7F || descenders.contains(unit) { return true }
        }
        return false
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
