import CoreGraphics

enum StillnessSpacing {
    static let nowDot: CGFloat = 10
    /// The one page gutter: every screen's left and right edges.
    static let gutter: CGFloat = 24
    /// Header controls (Thoughts, settings) share one height.
    static let headerControl: CGFloat = 36
    /// One radius for surfaces (rows, panels, fields); controls are pills.
    static let cardRadius: CGFloat = 10
    /// Raised surfaces that group rows: settings, related thoughts, capture.
    static let surfaceRadius: CGFloat = 14
}
