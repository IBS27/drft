import SwiftUI
import UIKit

enum Stillness {
    static let page = dynamic(
        light: UIColor(red: 250 / 255, green: 250 / 255, blue: 248 / 255, alpha: 1),
        dark: UIColor(red: 19 / 255, green: 19 / 255, blue: 17 / 255, alpha: 1)
    )
    static let surface = dynamic(
        light: UIColor(red: 252 / 255, green: 252 / 255, blue: 251 / 255, alpha: 1),
        dark: UIColor(red: 24 / 255, green: 24 / 255, blue: 22 / 255, alpha: 1)
    )
    static let ink = dynamic(
        light: UIColor(red: 43 / 255, green: 43 / 255, blue: 40 / 255, alpha: 1),
        dark: UIColor(red: 234 / 255, green: 234 / 255, blue: 229 / 255, alpha: 1)
    )
    static let muted = dynamic(
        light: UIColor(red: 117 / 255, green: 117 / 255, blue: 111 / 255, alpha: 1),
        dark: UIColor(red: 160 / 255, green: 160 / 255, blue: 153 / 255, alpha: 1)
    )
    static let hairline = dynamic(
        light: UIColor(red: 232 / 255, green: 232 / 255, blue: 228 / 255, alpha: 1),
        dark: UIColor(red: 43 / 255, green: 43 / 255, blue: 40 / 255, alpha: 1)
    )
    static let now = dynamic(
        light: UIColor(red: 199 / 255, green: 62 / 255, blue: 29 / 255, alpha: 1),
        dark: UIColor(red: 217 / 255, green: 80 / 255, blue: 42 / 255, alpha: 1)
    )
    static let faint = muted.opacity(0.6)

    private static func dynamic(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}
