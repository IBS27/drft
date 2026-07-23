import Foundation
import Network
import UIKit

@MainActor
final class CaptureQueue {
    typealias Sender = @MainActor @Sendable (String) async throws -> String

    private struct Item: Codable, Sendable {
        let id: UUID
        let text: String
        let createdAt: Date
        let ownerID: String?
        let sequence: UInt64

        private enum CodingKeys: String, CodingKey {
            case id
            case text
            case createdAt
            case ownerID
            case sequence
        }

        init(id: UUID, text: String, createdAt: Date, ownerID: String, sequence: UInt64) {
            self.id = id
            self.text = text
            self.createdAt = createdAt
            self.ownerID = ownerID
            self.sequence = sequence
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(UUID.self, forKey: .id)
            text = try container.decode(String.self, forKey: .text)
            createdAt = try container.decode(Date.self, forKey: .createdAt)
            ownerID = try container.decodeIfPresent(String.self, forKey: .ownerID)
            sequence = try container.decodeIfPresent(UInt64.self, forKey: .sequence) ?? 0
        }
    }

    private struct Entry {
        let item: Item
        var fileURL: URL?
        var isInJournal: Bool
    }

    private struct JournalRecord {
        let data: Data
        let item: Item?
    }

    private static let appGroup = "group.com.srinivasib.drft"
    private static let directoryName = "CaptureQueue"
    private static let journalName = "CaptureQueue.journal"

    private let fileManager: FileManager
    private let directoryURL: URL
    private let journalURL: URL
    private let send: Sender
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(label: "com.srinivasib.drft.capture-queue.network")

    private var authenticatedUserID: String?
    private var lastSequence: UInt64 = 0
    private var isFlushing = false
    private var flushAgain = false
    private var retryDelay: Int64 = 1
    private var retryTask: Task<Void, Never>?
    private var activeTask: Task<Void, Never>?

    init(
        fileManager: FileManager = .default,
        send: @escaping Sender
    ) {
        self.fileManager = fileManager
        let directoryURL = Self.makeDirectoryURL(fileManager: fileManager)
        self.directoryURL = directoryURL
        journalURL = directoryURL.appendingPathComponent(Self.journalName)
        self.send = send

        prepareDirectory()
        lastSequence = maximumStoredSequence()
        startNetworkMonitoring()
        startActiveMonitoring()
    }

    @discardableResult
    func enqueue(text: String, ownerID: String?) -> Bool {
        guard let ownerID else { return false }

        lastSequence += 1
        let item = Item(
            id: UUID(),
            text: text,
            createdAt: .now,
            ownerID: ownerID,
            sequence: lastSequence
        )

        guard persist(item) || appendToJournal(item) else { return false }

        Task { [weak self] in
            await self?.flush()
        }
        return true
    }

    func updateAuthenticatedUserID(_ userID: String?) {
        guard authenticatedUserID != userID else { return }
        authenticatedUserID = userID
        retryTask?.cancel()
        retryTask = nil
        retryDelay = 1

        guard userID != nil else { return }
        Task { [weak self] in
            await self?.flush()
        }
    }

    func flush() async {
        guard authenticatedUserID != nil else { return }
        guard !isFlushing else {
            flushAgain = true
            return
        }

        isFlushing = true
        retryTask?.cancel()
        retryTask = nil

        repeat {
            flushAgain = false
            promoteJournalItems()

            guard let ownerID = authenticatedUserID else { break }
            while authenticatedUserID == ownerID,
                  let entry = oldestEntry(for: ownerID) {
                do {
                    _ = try await send(entry.item.text)
                    guard authenticatedUserID == ownerID else {
                        flushAgain = authenticatedUserID != nil
                        break
                    }
                    guard removeAcknowledged(entry) else {
                        scheduleRetry()
                        isFlushing = false
                        return
                    }
                    retryDelay = 1
                } catch {
                    if authenticatedUserID == ownerID {
                        scheduleRetry()
                    }
                    isFlushing = false
                    return
                }
            }
        } while flushAgain

        isFlushing = false
        retryDelay = 1
    }

    private static func makeDirectoryURL(fileManager: FileManager) -> URL {
        if let groupURL = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) {
            return groupURL.appendingPathComponent(directoryName, isDirectory: true)
        }

        if let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first {
            return applicationSupport
                .appendingPathComponent("drft", isDirectory: true)
                .appendingPathComponent(directoryName, isDirectory: true)
        }

        return fileManager.temporaryDirectory
            .appendingPathComponent("drft", isDirectory: true)
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    private func prepareDirectory() {
        try? fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
    }

    private func persist(_ item: Item) -> Bool {
        prepareDirectory()

        do {
            let data = try JSONEncoder().encode(item)
            try data.write(to: fileURL(for: item.id), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func appendToJournal(_ item: Item) -> Bool {
        prepareDirectory()

        do {
            let data = try JSONEncoder().encode(item)
            if !fileManager.fileExists(atPath: journalURL.path) {
                guard fileManager.createFile(atPath: journalURL.path, contents: nil) else {
                    return false
                }
            }

            let handle = try FileHandle(forWritingTo: journalURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data([0x0A]) + data + Data([0x0A]))
            try handle.synchronize()
            return true
        } catch {
            return false
        }
    }

    private func promoteJournalItems() {
        let records = journalRecords()
        let promotedIDs = Set(records.compactMap { record -> UUID? in
            guard let item = record.item, persist(item) else { return nil }
            return item.id
        })
        guard !promotedIDs.isEmpty else { return }

        _ = rewriteJournal(
            records.filter { record in
                guard let id = record.item?.id else { return true }
                return !promotedIDs.contains(id)
            }
        )
    }

    private func oldestEntry(for ownerID: String) -> Entry? {
        var entriesByID: [UUID: Entry] = [:]

        for (item, fileURL) in fileItems() {
            entriesByID[item.id] = Entry(
                item: item,
                fileURL: fileURL,
                isInJournal: false
            )
        }

        for item in journalRecords().compactMap(\.item) {
            if var entry = entriesByID[item.id] {
                entry.isInJournal = true
                entriesByID[item.id] = entry
            } else {
                entriesByID[item.id] = Entry(
                    item: item,
                    fileURL: nil,
                    isInJournal: true
                )
            }
        }

        return entriesByID.values
            .filter { $0.item.ownerID == ownerID }
            .min { left, right in
                if left.item.sequence == right.item.sequence {
                    return left.item.id.uuidString < right.item.id.uuidString
                }
                return left.item.sequence < right.item.sequence
            }
    }

    private func removeAcknowledged(_ entry: Entry) -> Bool {
        if entry.isInJournal, !removeFromJournal(id: entry.item.id) {
            return false
        }

        if let fileURL = entry.fileURL {
            do {
                try fileManager.removeItem(at: fileURL)
            } catch {
                return false
            }
        }
        return true
    }

    private func removeFromJournal(id: UUID) -> Bool {
        rewriteJournal(
            journalRecords().filter { record in
                record.item?.id != id
            }
        )
    }

    private func rewriteJournal(_ records: [JournalRecord]) -> Bool {
        if records.isEmpty {
            guard fileManager.fileExists(atPath: journalURL.path) else { return true }
            do {
                try fileManager.removeItem(at: journalURL)
                return true
            } catch {
                return false
            }
        }

        var data = Data()
        for record in records {
            data.append(0x0A)
            data.append(record.data)
            data.append(0x0A)
        }

        do {
            try data.write(to: journalURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func fileItems() -> [(Item, URL)] {
        guard let fileURLs = try? fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return [] }

        return fileURLs.compactMap { fileURL in
            guard
                fileURL.pathExtension == "json",
                let data = try? Data(contentsOf: fileURL),
                let item = try? JSONDecoder().decode(Item.self, from: data)
            else { return nil }
            return (item, fileURL)
        }
    }

    private func journalRecords() -> [JournalRecord] {
        guard let data = try? Data(contentsOf: journalURL) else { return [] }
        return data.split(separator: 0x0A).map { recordData in
            let data = Data(recordData)
            return JournalRecord(
                data: data,
                item: try? JSONDecoder().decode(Item.self, from: data)
            )
        }
    }

    private func maximumStoredSequence() -> UInt64 {
        let fileSequences = fileItems().map { $0.0.sequence }
        let journalSequences = journalRecords().compactMap { $0.item?.sequence }
        return (fileSequences + journalSequences).max() ?? 0
    }

    private func fileURL(for id: UUID) -> URL {
        directoryURL.appendingPathComponent(id.uuidString).appendingPathExtension("json")
    }

    private func scheduleRetry() {
        guard authenticatedUserID != nil, retryTask == nil else { return }
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 60)

        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.retryTask = nil
            await self?.flush()
        }
    }

    private func startNetworkMonitoring() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                await self?.flush()
            }
        }
        pathMonitor.start(queue: pathMonitorQueue)
    }

    private func startActiveMonitoring() {
        activeTask = Task { [weak self] in
            for await _ in NotificationCenter.default.notifications(
                named: UIApplication.didBecomeActiveNotification
            ) {
                guard !Task.isCancelled else { return }
                await self?.flush()
            }
        }
    }
}
