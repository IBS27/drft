import SwiftUI
import UIKit

/// Geist, bundled from Stillness/Fonts and registered via `UIAppFonts`.
/// Referenced by PostScript name so each weight resolves to its own file.
enum GeistWeight {
    case regular
    case medium
    case semibold

    fileprivate var postScriptName: String {
        switch self {
        case .regular: "Geist-Regular"
        case .medium: "Geist-Medium"
        case .semibold: "Geist-SemiBold"
        }
    }
}

extension Font {
    static func geist(
        _ size: CGFloat,
        _ weight: GeistWeight = .regular,
        relativeTo style: Font.TextStyle = .body
    ) -> Font {
        .custom(weight.postScriptName, size: size, relativeTo: style)
    }
}

/// A Geist face in both forms: `font` for SwiftUI, `uiFont(at:)` for the
/// few places that measure text outside it. Both follow Dynamic Type to
/// the same size.
struct GeistFace {
    let size: CGFloat
    var weight: GeistWeight = .regular
    let style: Font.TextStyle

    var font: Font {
        .geist(size, weight, relativeTo: style)
    }

    func uiFont(at dynamicTypeSize: DynamicTypeSize) -> UIFont {
        let scaled = UIFontMetrics(forTextStyle: style.uiTextStyle).scaledValue(
            for: size,
            compatibleWith: UITraitCollection(
                preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize)
            )
        )
        // SwiftUI sets a scaled custom font at a whole number of points.
        let pointSize = scaled.rounded()
        return UIFont(name: weight.postScriptName, size: pointSize)
            ?? .systemFont(ofSize: pointSize)
    }
}

private extension Font.TextStyle {
    var uiTextStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .body: .body
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        @unknown default: .body
        }
    }
}

/// Ember's type scale (docs/vivid.html#ember): Geist at a readable weight,
/// sentence case, 13pt minimum for anything you need to read. Sizes follow
/// the web's phone layout. Geist's natural line height is 1.3em, so line
/// spacing below is the extra leading on top of it.
enum StillnessType {
    static let wordmark = Font.geist(17, .semibold, relativeTo: .headline)
    static let wordmarkTracking: CGFloat = -0.34

    /// The capture field: your words, alone at the center.
    static let captureThought = Font.geist(28, relativeTo: .title)
    static let captureThoughtTracking: CGFloat = -0.34
    static let captureThoughtLineSpacing: CGFloat = 4

    /// A thought being re-read: a step below capture.
    static let readingThought = Font.geist(28, relativeTo: .title2)
    static let readingThoughtTracking: CGFloat = -0.6
    static let readingThoughtLineSpacing: CGFloat = 2

    /// A page's name or a thought's date, centered in its header.
    static let headerTitle = Font.geist(15, .medium, relativeTo: .subheadline)
    static let headerDate = Font.geist(14, .medium, relativeTo: .subheadline)

    static let groupLabel = Font.geist(13, .medium, relativeTo: .footnote)
    static let sectionTitle = Font.geist(15, .medium, relativeTo: .subheadline)
    static let rowFace = GeistFace(size: 16, style: .body)
    static let row = rowFace.font
    static let bodyFace = GeistFace(size: 15, style: .subheadline)
    static let body = bodyFace.font
    static let bodyLineSpacing: CGFloat = 2
    static let meta = Font.geist(13.5, relativeTo: .footnote)
    static let caption = Font.geist(13, relativeTo: .footnote)
    static let captionEmphasis = Font.geist(13, .medium, relativeTo: .footnote)

    /// Solid vermilion actions (Keep, Allow, Set it down).
    static let primaryButton = Font.geist(15, .semibold, relativeTo: .subheadline)
    /// The same action waiting for words (an empty Keep).
    static let primaryButtonResting = Font.geist(15, .medium, relativeTo: .subheadline)
    /// Outlined and quiet pill controls.
    static let control = Font.geist(14.5, .medium, relativeTo: .subheadline)

    static let badge = Font.geist(11.5, .medium, relativeTo: .caption2)
    static let badgeLarge = Font.geist(13, .medium, relativeTo: .footnote)
}
