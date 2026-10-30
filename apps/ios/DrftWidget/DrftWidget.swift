import SwiftUI
import WidgetKit

struct DrftTimelineEntry: TimelineEntry {
    let date: Date
}

struct DrftTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DrftTimelineEntry {
        DrftTimelineEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (DrftTimelineEntry) -> Void) {
        completion(DrftTimelineEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DrftTimelineEntry>) -> Void) {
        completion(Timeline(entries: [DrftTimelineEntry(date: .now)], policy: .never))
    }
}

struct DrftWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 3) {
                    Wordmark()
                    Text("Catch a thought")
                        .font(.geist(13, relativeTo: .footnote))
                        .foregroundStyle(Stillness.chromeLabel)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .accessoryCircular:
                captureDot
                    .widgetAccentable()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .systemSmall:
                VStack(alignment: .leading, spacing: 0) {
                    Wordmark()
                    Spacer(minLength: 0)
                    capturePill
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            default:
                EmptyView()
            }
        }
        .containerBackground(Stillness.page, for: .widget)
        .widgetURL(URL(string: "drft://capture"))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Capture a thought in drft")
    }

    // One line on every phone width; shrinks a little rather than wrap.
    private var capturePillLabel: some View {
        Text("Catch a thought")
            .font(.geist(15, .medium, relativeTo: .subheadline))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, 12)
            .frame(minHeight: 30)
    }

    // Tinted and clear home screens keep only shape, not colour, so a filled
    // pill would swallow its own text. There the pill is an outline in the
    // accent group instead.
    @ViewBuilder
    private var capturePill: some View {
        if renderingMode == .fullColor {
            capturePillLabel
                .foregroundStyle(Stillness.nowInk)
                .background(Stillness.nowTint, in: Capsule())
        } else {
            capturePillLabel
                .overlay {
                    Capsule().strokeBorder(lineWidth: 1)
                }
                .widgetAccentable()
        }
    }

    @ViewBuilder
    private var captureDot: some View {
        switch renderingMode {
        case .accented, .vibrant:
            Circle()
                .frame(
                    width: StillnessSpacing.nowDot,
                    height: StillnessSpacing.nowDot
                )
        default:
            NowDot()
        }
    }
}

struct DrftWidget: Widget {
    let kind = "DrftWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DrftTimelineProvider()) { _ in
            DrftWidgetView()
        }
        .configurationDisplayName("drft")
        .description("Catch a thought")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct DrftWidgetBundle: WidgetBundle {
    var body: some Widget {
        DrftWidget()
    }
}
