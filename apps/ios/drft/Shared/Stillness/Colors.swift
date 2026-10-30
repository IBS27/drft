import SwiftUI
import UIKit

/// The Stillness palette (docs/design.html), worn the Ember way
/// (docs/vivid.html#ember): the vermilion grows from a single dot into the
/// accent for "now". Mirrors the tokens in apps/web/src/index.css; the
/// Ember tints are the web's `color-mix(in oklab, …)` values, precomputed.
enum Stillness {
    static let page = dynamic(light: 0xFAFAF8, dark: 0x131311)
    static let surface = dynamic(light: 0xFCFCFB, dark: 0x181816)
    static let ink = dynamic(light: 0x2B2B28, dark: 0xEAEAE5)
    static let muted = dynamic(
        light: 0x75756F,
        dark: 0xA0A099,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )
    static let hairline = dynamic(
        light: 0xE8E8E4,
        dark: 0x2B2B28,
        lightHighContrast: 0xB4B4AE,
        darkHighContrast: 0x52524D
    )
    static let now = dynamic(light: 0xC73E1D, dark: 0xD9502A)
    /// Label color on a `now`-filled control: the page color, as on web.
    static let onNow = dynamic(light: 0xFAFAF8, dark: 0x131311)
    static let faint = dynamic(
        light: 0x75756F,
        dark: 0xA0A099,
        alpha: 0.6,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )

    /// Page-chrome text: headers, group names, quiet controls.
    static let chromeText = dynamic(
        light: 0x45453F,
        dark: 0xC9C9C2,
        lightHighContrast: 0x2B2B28,
        darkHighContrast: 0xEAEAE5
    )
    /// Secondary labels: times, captions, hints.
    static let chromeLabel = dynamic(
        light: 0x6B6B65,
        dark: 0x97978F,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )
    /// Soft wash for whatever is "now" (Back today, chips, pressed rows).
    static let nowTint = dynamic(light: 0xF8ECE7, dark: 0x281B16)
    /// The stronger wash: badges, the open row.
    static let nowTintStrong = dynamic(light: 0xF7E1DA, dark: 0x3A2219)
    /// Vermilion text that stays legible on the page and on both tints.
    static let nowInk = dynamic(light: 0xA33E25, dark: 0xE48367)
    /// The edge of outlined vermilion controls.
    static let nowEdge = dynamic(light: 0xE0A08E, dark: 0x7F412F)

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
