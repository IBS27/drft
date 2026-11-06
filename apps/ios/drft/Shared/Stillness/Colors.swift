import SwiftUI
import UIKit

/// The Stillness palette (docs/design.html), worn the Ember way
/// (docs/vivid.html#ember): the vermilion grows from a single dot into the
/// accent for "now". Mirrors the tokens in apps/web/src/index.css; the
/// Ember tints are the web's `color-mix(in oklab, …)` values, precomputed.
enum Stillness {
    static let page = dynamic(light: 0xF5F3EE, dark: 0x181715)
    static let surface = dynamic(light: 0xFBFAF7, dark: 0x201F1C)
    static let ink = dynamic(light: 0x26241F, dark: 0xEBE8E1)
    static let muted = dynamic(
        light: 0x716D64,
        dark: 0xA6A298,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )
    static let hairline = dynamic(
        light: 0xE4E0D7,
        dark: 0x312F2B,
        lightHighContrast: 0xB4B4AE,
        darkHighContrast: 0x52524D
    )
    static let now = dynamic(light: 0xC73E1D, dark: 0xDD5630)
    /// Label color on a `now`-filled control: the page color, as on web.
    static let onNow = dynamic(light: 0xF5F3EE, dark: 0x181715)
    static let faint = dynamic(
        light: 0x716D64,
        dark: 0xA6A298,
        alpha: 0.6,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )

    /// Page-chrome text: headers, group names, quiet controls.
    static let chromeText = dynamic(
        light: 0x423F38,
        dark: 0xCDC9BF,
        lightHighContrast: 0x2B2B28,
        darkHighContrast: 0xEAEAE5
    )
    /// Secondary labels: times, captions, hints.
    static let chromeLabel = dynamic(
        light: 0x6B675E,
        dark: 0x9C988E,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )
    /// Soft elevation under raised surfaces (the web's --lift).
    static let lift = dynamic(light: 0x3A2C1C, dark: 0x000000, alpha: 0.07)
    /// Soft wash for whatever is "now" (Back today, chips, pressed rows).
    static let nowTint = dynamic(light: 0xF1E5DD, dark: 0x301F18)
    /// The stronger wash: badges, the open row.
    static let nowTintStrong = dynamic(light: 0xEFDAD1, dark: 0x43251B)
    /// Vermilion text that stays legible on the page and on both tints.
    static let nowInk = dynamic(light: 0xA4381D, dark: 0xE18265)
    /// The edge of outlined vermilion controls.
    static let nowEdge = dynamic(light: 0xD79783, dark: 0x87422E)

    private static func dynamic(
        light: UInt32,
        dark: UInt32,
        alpha: CGFloat = 1,
        lightHighContrast: UInt32? = nil,
        darkHighContrast: UInt32? = nil
    ) -> Color {
        Color(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            if traits.accessibilityContrast == .high,
               let contrast = isDark ? darkHighContrast : lightHighContrast {
                return color(contrast, alpha: 1)
            }
            return color(isDark ? dark : light, alpha: alpha)
        })
    }

    private static func color(_ hex: UInt32, alpha: CGFloat) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
