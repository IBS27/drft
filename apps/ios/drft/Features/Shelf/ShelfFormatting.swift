import Foundation

enum ShelfGroup: CaseIterable {
    case today
    case thisWeek
    case earlier

    var label: String {
        switch self {
        case .today:
            "TODAY"
        case .thisWeek:
            "THIS WEEK"
        case .earlier:
            "EARLIER"
        }
    }
}

enum ShelfFormatting {
    static func localDate(for date: Date) -> String {
        let components = Calendar.current.dateComponents(
            [.year, .month, .day],
            from: date
        )
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }

    static func group(for milliseconds: Double, now: Date) -> ShelfGroup {
        let calendar = Calendar.current
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
        let today = calendar.startOfDay(for: now)
        if date >= today {
            return .today
        }
        let sixDaysAgo = calendar.date(byAdding: .day, value: -6, to: today) ?? today
        return date >= sixDaysAgo ? .thisWeek : .earlier
    }

    static func captureLine(for milliseconds: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
        let calendar = Calendar.current
        let day: String

        if group(for: milliseconds, now: now) == .earlier {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.dateFormat = calendar.component(.year, from: date)
                == calendar.component(.year, from: now) ? "d MMM" : "d MMM yy"
            day = formatter.string(from: date)
        } else {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.dateFormat = "EEEE"
            day = formatter.string(from: date)
        }

        let time = date.formatted(
            .dateTime
                .hour(.twoDigits(amPM: .abbreviated))
                .minute(.twoDigits)
        )
        return "\(day) · \(time)"
    }

    static func draftPreview(_ text: String) -> String? {
        let words = text.split(whereSeparator: { $0.isWhitespace })
        guard !words.isEmpty else { return nil }
        return words.prefix(8).joined(separator: " ")
    }
}
