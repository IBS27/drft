import Foundation

actor CollectionCache {
    private struct Entry: Codable {
        let userID: String
        let date: String
        let collection: ConvexService.Collection
    }

    private let fileManager: FileManager
    private let directoryURL: URL
    private let fileURL: URL

    init(
        deploymentURL: String,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager

        let applicationSupport =
            fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first ?? fileManager.temporaryDirectory
        let deploymentID = URL(string: deploymentURL)?.host ?? "default"
        let directoryURL =
            applicationSupport
            .appendingPathComponent("drft", isDirectory: true)
            .appendingPathComponent("CollectionCache", isDirectory: true)
            .appendingPathComponent(deploymentID, isDirectory: true)

        self.directoryURL = directoryURL
        fileURL = directoryURL.appendingPathComponent("collection.json")
    }

    /// The thoughts last seen for this person, whatever day that was, so the
    /// first open of a day paints at once. The returned thought belongs to
    /// the day it was cached for; on any other day it waits for live data.
    func load(userID: String, date: String) -> ConvexService.Collection? {
        guard let data = try? Data(contentsOf: fileURL),
            let entry = try? JSONDecoder().decode(Entry.self, from: data),
            entry.userID == userID
        else { return nil }
        guard entry.date != date else { return entry.collection }

        return ConvexService.Collection(
            thoughts: entry.collection.thoughts,
            resurfacedId: nil
        )
    }

    func store(
        _ collection: ConvexService.Collection,
        userID: String,
        date: String
    ) {
        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(
                Entry(userID: userID, date: date, collection: collection)
            )
            try data.write(
                to: fileURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            // A cache failure only costs the next fast paint.
        }
    }

    func clear() {
        try? fileManager.removeItem(at: directoryURL)
    }
}
