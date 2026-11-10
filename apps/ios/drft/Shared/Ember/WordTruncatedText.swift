import SwiftUI
import UIKit

/// Text held to a few lines that, when it runs long, ends on a whole word
/// and an ellipsis ("…plan tomorrow…"), never mid-word. It takes the full
/// width it is offered and sets its own font and line spacing, because the
/// cut is measured in that same face (`WordFit`).
///
/// The width is only known after a first layout, which shows the text
/// clipped by the system; the measured cut replaces it before it is drawn.
struct WordTruncatedText: View {
    let text: String
    let face: GeistFace
    var lineSpacing: CGFloat = 0
    var lineLimit = 2
    /// Told whether the last shown line has ink below the baseline (g, p,
    /// y, a comma…), so a row can sit its divider the same distance under
    /// "tide tables" as under "plan…".
    var onLastLineDescends: ((Bool) -> Void)? = nil

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var width: CGFloat?

    var body: some View {
        shown
            .font(face.font)
            .lineSpacing(lineSpacing)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self, of: \.size.width) { width = $0 }
            .onPreferenceChange(Text.LayoutKey.self) { layouts in
                guard let onLastLineDescends, let layout = layouts.last?.layout else { return }
                onLastLineDescends(Self.lastLineDescends(in: layout, of: text))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(text))
    }

    @ViewBuilder private var shown: some View {
        switch fit {
        case .whole:
            // Shown whole, its lines are balanced so the last one isn't
            // a stray word or two; a shortened one already fills them.
            // No line limit: balancing finds its width by watching the
            // text grow a line.
            BalancedWrap {
                Text(text)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .shortened(let prefix):
            // The limit only matters should SwiftUI ever wrap a measured
            // cut differently: the row keeps its height.
            Text(prefix + "…")
                .lineLimit(lineLimit)
                .fixedSize(horizontal: false, vertical: true)
        case .clipped, nil:
            // One unbroken word longer than the lines themselves, or the
            // first layout.
            Text(text)
                .lineLimit(lineLimit)
        }
    }

    private var fit: WordFit.Result? {
        guard let width, width > 0 else { return nil }
        return WordFit.result(
            for: text,
            width: width,
            font: face.uiFont(at: dynamicTypeSize),
            lineSpacing: lineSpacing,
            lineLimit: lineLimit
        )
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

    /// Every whole-word prefix of `text` ending before `limit`, longest
    /// first, each with its trailing punctuation and dangling joining words
    /// dropped.
    static func shortenings(of text: String, before limit: String.Index? = nil) -> [String] {
        var results: [String] = []
        var seen: Set<String> = []
        var index = limit ?? text.endIndex

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

/// Finds what a `WordTruncatedText` shows, once per text, width and font.
/// Measured with TextKit, which breaks lines where SwiftUI's `Text` does.
@MainActor
enum WordFit {
    enum Result {
        /// The text fits as it is.
        case whole
        /// The longest whole-word prefix that fits with an ellipsis after it.
        case shortened(String)
        /// No word boundary fits; the system clips it.
        case clipped
    }

    private struct Key: Hashable {
        let text: String
        let width: CGFloat
        let fontName: String
        let pointSize: CGFloat
        let lineSpacing: CGFloat
        let lineLimit: Int
    }

    private static var results: [Key: Result] = [:]
    private static let resultLimit = 512

    static func result(
        for text: String,
        width: CGFloat,
        font: UIFont,
        lineSpacing: CGFloat,
        lineLimit: Int
    ) -> Result {
        let key = Key(
            text: text,
            width: width,
            fontName: font.fontName,
            pointSize: font.pointSize,
            lineSpacing: lineSpacing,
            lineLimit: lineLimit
        )
        if let known = results[key] { return known }

        let result = measure(
            text,
            width: width,
            font: font,
            lineSpacing: lineSpacing,
            lineLimit: lineLimit
        )
        // Rows scrolled past long ago aren't worth keeping.
        if results.count >= resultLimit { results.removeAll(keepingCapacity: true) }
        results[key] = result
        return result
    }

    private static func measure(
        _ text: String,
        width: CGFloat,
        font: UIFont,
        lineSpacing: CGFloat,
        lineLimit: Int
    ) -> Result {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = lineSpacing
        // `Text` breaks lines this way; an attributed string's default differs.
        paragraph.lineBreakStrategy = .standard
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .paragraphStyle: paragraph]

        func height(_ string: String) -> CGFloat {
            NSAttributedString(string: string, attributes: attributes).boundingRect(
                with: CGSize(width: width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            ).height
        }
        func ruler(lines: Int) -> CGFloat {
            height(Array(repeating: "Ag", count: lines).joined(separator: "\n"))
        }
        // Halfway between the two rulers: anything that wraps to
        // `lineLimit` lines fits, one line more never does, whatever the
        // font's line height.
        let budget = (ruler(lines: lineLimit) + ruler(lines: lineLimit + 1)) / 2
        func fits(_ string: String) -> Bool { height(string) <= budget }

        // A long text is only measured as far as it could show. Start at
        // twice what these lines hold of Geist, which averages half an em
        // a character, and reach further while that much still fits.
        var reach = max(32, Int(CGFloat(lineLimit) * width / (font.pointSize / 4)))
        var end = text.index(text.startIndex, offsetBy: reach, limitedBy: text.endIndex)
            ?? text.endIndex
        while end < text.endIndex, fits(String(text[..<end])) {
            reach *= 2
            end = text.index(text.startIndex, offsetBy: reach, limitedBy: text.endIndex)
                ?? text.endIndex
        }
        if end == text.endIndex, fits(text) { return .whole }

        // `text[..<end]` overflows, so no longer prefix can fit. A prefix
        // that does fit may still end in the word that straddles `end`.
        var limit = end
        while limit < text.endIndex, !text[limit].isWhitespace {
            limit = text.index(after: limit)
        }
        if limit < text.endIndex { limit = text.index(after: limit) }
        let candidates = WordTruncatedText.shortenings(of: text, before: limit)

        // Longest first: the ones that fit are all at the short end.
        var low = 0
        var high = candidates.count
        while low < high {
            let middle = (low + high) / 2
            if fits(candidates[middle] + "…") { high = middle } else { low = middle + 1 }
        }
        return low < candidates.count ? .shortened(candidates[low]) : .clipped
    }
}
