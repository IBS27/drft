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
        dark: 0x36342F,
        lightHighContrast: 0xB4B4AE,
        darkHighContrast: 0x52524D
    )
    static let now = dynamic(light: 0xC73E1D, dark: 0xCC4A24)
    /// Label color on a `now`-filled control: the page color, as on web.
    static let onNow = dynamic(light: 0xFFFAF5, dark: 0xFFFAF5)
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
        light: 0x635F56,
        dark: 0xB3AEA4,
        lightHighContrast: 0x4B4B47,
        darkHighContrast: 0xCDCDC7
    )
    /// The one destructive action: a deeper red than the accent.
    static let danger = dynamic(light: 0xA1302B, dark: 0xE0786E)
    /// A standing solid action that isn't "now" (New thought): warm dark in
    /// both themes rather than an inverted pill.
    static let inkPill = dynamic(light: 0x2F2C27, dark: 0x3A3732)
    static let onInkPill = dynamic(light: 0xF5F3EE, dark: 0xEBE8E1)
    /// An "on" switch: ink, never the accent (the web's --switch).
    static let switchOn = dynamic(light: 0x2F2C27, dark: 0xEBE8E1)
    /// Soft elevation under raised surfaces (the web's --lift).
    static let lift = dynamic(light: 0x3A2C1C, dark: 0x000000, alpha: 0.06)
    /// The short shadow under a solid primary pill.
    static let shadow = dynamic(light: 0x3A2C1C, dark: 0x000000, alpha: 0.2)
    /// The lightest wash of the accent: today's returned thought at rest.
    static let nowWash = dynamic(light: 0xF4EAE4, dark: 0x251B16)
    /// Soft wash for whatever is "now" (Back today, chips, pressed rows).
    static let nowTint = dynamic(light: 0xF1E5DD, dark: 0x2F1E17)
    /// The stronger wash: badges, the open row.
    static let nowTintStrong = dynamic(light: 0xEFDAD1, dark: 0x3A2118)
    /// Vermilion text that stays legible on the page and on both tints.
    static let nowInk = dynamic(light: 0xA4381D, dark: 0xDA9179)
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
