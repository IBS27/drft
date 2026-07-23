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

    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 3) {
                    Text("drft")
                        .stillnessWordmark()
                    Text("catch a thought")
                        .font(.custom("Helvetica Neue", size: 12).weight(.light))
                        .foregroundStyle(Stillness.faint)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            case .accessoryCircular:
                NowDot()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .systemSmall:
                VStack(spacing: 14) {
                    NowDot()
                    Text("drft")
                        .stillnessWordmark()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            default:
                EmptyView()
            }
        }
        .containerBackground(Stillness.page, for: .widget)
        .widgetURL(URL(string: "drft://capture"))
    }
}

struct DrftWidget: Widget {
    let kind = "DrftWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DrftTimelineProvider()) { _ in
            DrftWidgetView()
        }
        .configurationDisplayName("drft")
        .description("catch a thought")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct DrftWidgetBundle: WidgetBundle {
    var body: some Widget {
        DrftWidget()
    }
}
