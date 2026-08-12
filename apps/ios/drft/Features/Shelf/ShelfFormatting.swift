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
    // The backend speaks Gregorian dates (en-CA `YYYY-MM-DD`); a device
    // set to a Buddhist or Japanese system calendar must not leak its
    // own year numbering into them, so all shelf math pins the calendar
    // and keeps only the user's timezone — read per call, so a timezone
    // change mid-flight isn't frozen until relaunch.
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    static func localDate(for date: Date) -> String {
        let components = calendar.dateComponents(
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
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
        let today = calendar.startOfDay(for: now)
        if date >= today {
            return .today
        }
        let sixDaysAgo = calendar.date(byAdding: .day, value: -6, to: today) ?? today
        return date >= sixDaysAgo ? .thisWeek : .earlier
    }

    static func time(for date: Date) -> String {
        date.formatted(
            .dateTime
                .hour(.defaultDigits(amPM: .abbreviated))
                .minute(.twoDigits)
        )
    }

    static func captureLine(for milliseconds: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
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

        return "\(day) · \(time(for: date))"
    }

    static func ageLabel(for milliseconds: Double, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
        switch group(for: milliseconds, now: now) {
        case .today:
            return time(for: date)
        case .thisWeek:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.dateFormat = "EEE"
            return formatter.string(from: date).lowercased()
        case .earlier:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.dateFormat = calendar.component(.year, from: date)
                == calendar.component(.year, from: now) ? "d MMM" : "d MMM yy"
            return formatter.string(from: date).lowercased()
        }
    }
}
