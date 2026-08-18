import Foundation
import Network
import os
import UIKit

private struct CaptureQueueItem: Codable, Sendable {
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

    init(
        id: UUID,
        text: String,
        createdAt: Date,
        ownerID: String?,
        sequence: UInt64
    ) {
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

    func owned(by ownerID: String) -> CaptureQueueItem {
        CaptureQueueItem(
            id: id,
            text: text,
            createdAt: createdAt,
            ownerID: ownerID,
            sequence: sequence
        )
    }
}

private final class CaptureQueueStore: @unchecked Sendable {
    // The log makes enqueue and acknowledgement constant-time disk appends.
    // Enqueue appends synchronously so a kept thought is on disk before its
    // confirmation plays. Flush-side I/O runs off the main actor.
    private struct Record: Codable {
        enum Operation: String, Codable {
            case put
            case remove
        }

        let operation: Operation
        let item: CaptureQueueItem?
        let id: UUID?

        static func put(_ item: CaptureQueueItem) -> Record {
            Record(operation: .put, item: item, id: nil)
        }

        static func remove(_ id: UUID) -> Record {
            Record(operation: .remove, item: nil, id: id)
        }
    }

    private static let logName = "CaptureQueue.log"
    private static let legacySnapshotName = "CaptureQueue.items.json"
    private static let legacyJournalName = "CaptureQueue.journal"

    private let fileManager = FileManager()
    private let directoryURL: URL
    private let logURL: URL
    private let legacySnapshotURL: URL
    private let legacyJournalURL: URL
    private let lock = OSAllocatedUnfairLock()

    private var didLoad = false
    private var items: [CaptureQueueItem] = []
    private var lastSequence: UInt64 = 0
    private var recordCount = 0

    init(directoryURL: URL) {
        self.directoryURL = directoryURL
        logURL = directoryURL.appendingPathComponent(Self.logName)
        legacySnapshotURL = directoryURL.appendingPathComponent(Self.legacySnapshotName)
        legacyJournalURL = directoryURL.appendingPathComponent(Self.legacyJournalName)
    }

    func enqueue(text: String, ownerID: String?) {
        lock.withLock {
            loadIfNeeded()
            lastSequence += 1
            let item = CaptureQueueItem(
                id: UUID(),
                text: text,
                createdAt: .now,
                ownerID: ownerID,
                sequence: lastSequence
            )
            _ = append([.put(item)])
            items.append(item)
            compactIfNeeded()
        }
    }

    func adoptOrphanedItems(ownerID: String) -> Bool {
        lock.withLock {
            loadIfNeeded()
            let orphanedIDs = Set(items.lazy.filter { $0.ownerID == nil }.map(\.id))
            guard !orphanedIDs.isEmpty else { return true }

            let adopted = items.map { item in
                item.ownerID == nil ? item.owned(by: ownerID) : item
            }
            let records = adopted.filter { orphanedIDs.contains($0.id) }.map(Record.put)
            guard append(records) else { return false }
            items = adopted
            compactIfNeeded()
            return true
        }
    }

    func oldestItem(ownerID: String) -> CaptureQueueItem? {
        lock.withLock {
            loadIfNeeded()
            return items.first { $0.ownerID == ownerID }
        }
    }

    func acknowledge(id: UUID) -> Bool {
        lock.withLock {
            loadIfNeeded()
            guard let index = items.firstIndex(where: { $0.id == id }) else { return true }
            guard append([.remove(id)]) else { return false }
            items.remove(at: index)
            compactIfNeeded()
            return true
        }
    }

    private func loadIfNeeded() {
        guard !didLoad else { return }
        didLoad = true
        prepareDirectory()

        var entriesByID: [UUID: CaptureQueueItem] = [:]
        // The log is authoritative. Legacy formats are read once and deleted only
        // after their contents are folded into the log.
        replayLog(into: &entriesByID)

        if let snapshotItems = decodeItems(at: legacySnapshotURL) {
            for item in snapshotItems {
                merge(item, into: &entriesByID)
            }
        }

        let legacyFiles = legacyFileItems()
        for (item, _) in legacyFiles {
            merge(item, into: &entriesByID)
        }
        for item in legacyJournalItems() {
            merge(item, into: &entriesByID)
        }

        items = entriesByID.values.sorted(by: Self.precedes)
        lastSequence = items.map(\.sequence).max() ?? 0

        guard
            !legacyFiles.isEmpty
                || fileManager.fileExists(atPath: legacySnapshotURL.path)
                || fileManager.fileExists(atPath: legacyJournalURL.path)
        else { return }
        guard rewriteLog() else { return }

        for (_, url) in legacyFiles {
            try? fileManager.removeItem(at: url)
        }
        try? fileManager.removeItem(at: legacySnapshotURL)
        try? fileManager.removeItem(at: legacyJournalURL)
    }

    private func merge(
        _ item: CaptureQueueItem,
        into entriesByID: inout [UUID: CaptureQueueItem]
    ) {
        if let existing = entriesByID[item.id] {
            if existing.ownerID == nil, item.ownerID != nil {
                entriesByID[item.id] = item
            }
        } else {
            entriesByID[item.id] = item
        }
    }

    private func append(_ records: [Record]) -> Bool {
        guard !records.isEmpty else { return true }
        prepareDirectory()

        do {
            let data = try encoded(records)
            if fileManager.fileExists(atPath: logURL.path) {
                let handle = try FileHandle(forWritingTo: logURL)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: Data([0x0A]) + data)
                try handle.synchronize()
            } else {
                try data.write(
                    to: logURL,
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                )
            }
            recordCount += records.count
            return true
        } catch {
            return false
        }
    }

    private func rewriteLog() -> Bool {
        prepareDirectory()
        do {
            if items.isEmpty {
                if fileManager.fileExists(atPath: logURL.path) {
                    try fileManager.removeItem(at: logURL)
                }
                recordCount = 0
                return true
            }

            let data = try encoded(items.map(Record.put))
            try data.write(
                to: logURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            recordCount = items.count
            return true
        } catch {
            return false
        }
    }

    private func compactIfNeeded() {
        guard recordCount > max(128, items.count * 3) else { return }
        _ = rewriteLog()
    }

    private func encoded(_ records: [Record]) throws -> Data {
        let encoder = JSONEncoder()
        var data = Data()
        for record in records {
            data.append(try encoder.encode(record))
            data.append(0x0A)
        }
        return data
    }

    private func prepareDirectory() {
        try? fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true
        )
    }

    private func decodeItems(at url: URL) -> [CaptureQueueItem]? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([CaptureQueueItem].self, from: data)
    }

    private func replayLog(into entriesByID: inout [UUID: CaptureQueueItem]) {
        guard let data = try? Data(contentsOf: logURL) else { return }
        for recordData in data.split(separator: 0x0A) {
            guard let record = try? JSONDecoder().decode(Record.self, from: Data(recordData))
            else { continue }
            recordCount += 1
            switch record.operation {
            case .put:
                if let item = record.item {
                    entriesByID[item.id] = item
                }
            case .remove:
                if let id = record.id {
                    entriesByID.removeValue(forKey: id)
                }
            }
        }
    }

    private func legacyFileItems() -> [(CaptureQueueItem, URL)] {
        guard
            let fileURLs = try? fileManager.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
        else { return [] }

        return fileURLs.compactMap { fileURL in
            guard fileURL.pathExtension == "json",
                fileURL != legacySnapshotURL,
                let data = try? Data(contentsOf: fileURL),
                let item = try? JSONDecoder().decode(CaptureQueueItem.self, from: data)
            else { return nil }
            return (item, fileURL)
        }
    }

    private func legacyJournalItems() -> [CaptureQueueItem] {
        guard let data = try? Data(contentsOf: legacyJournalURL) else { return [] }
        return data.split(separator: 0x0A).compactMap { recordData in
            try? JSONDecoder().decode(CaptureQueueItem.self, from: Data(recordData))
        }
    }

    private static func precedes(
        _ left: CaptureQueueItem,
        _ right: CaptureQueueItem
    ) -> Bool {
        if left.sequence == right.sequence {
            return left.id.uuidString < right.id.uuidString
        }
        return left.sequence < right.sequence
    }
}

@MainActor
final class CaptureQueue {
    typealias Sender = @MainActor @Sendable (String) async throws -> String

    private static let appGroup = "group.com.srinivasib.drft"
    private static let directoryName = "CaptureQueue"

    private let store: CaptureQueueStore
    private let send: Sender
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(
        label: "com.srinivasib.drft.capture-queue.network"
    )

    private var authenticatedUserID: String?
    private var isFlushing = false
    private var flushAgain = false
    private var retryDelay: Int64 = 1
    private var retryTask: Task<Void, Never>?
    private var activeTask: Task<Void, Never>?

    init(
        deploymentUrl: String,
        fileManager: FileManager = .default,
        send: @escaping Sender
    ) {
        let directoryURL = Self.makeDirectoryURL(
            deploymentUrl: deploymentUrl,
            fileManager: fileManager
        )
        store = CaptureQueueStore(directoryURL: directoryURL)
        self.send = send

        startNetworkMonitoring()
        startActiveMonitoring()
    }

    func enqueue(text: String, ownerID: String?) {
        store.enqueue(text: text, ownerID: ownerID)
        Task { [weak self] in
            await self?.flush()
        }
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

            guard let ownerID = authenticatedUserID else { break }
            if !(await offMain { [store] in
                store.adoptOrphanedItems(ownerID: ownerID)
            }) {
                scheduleRetry()
                isFlushing = false
                return
            }
            while authenticatedUserID == ownerID,
                let item = await offMain({ [store] in
                    store.oldestItem(ownerID: ownerID)
                })
            {
                do {
                    _ = try await send(item.text)
                    guard authenticatedUserID == ownerID else {
                        flushAgain = authenticatedUserID != nil
                        break
                    }
                    guard await offMain({ [store] in
                        store.acknowledge(id: item.id)
                    }) else {
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

    private func offMain<T: Sendable>(
        _ work: @escaping @Sendable () -> T
    ) async -> T {
        await Task.detached(priority: .utility, operation: work).value
    }

    private static func makeDirectoryURL(
        deploymentUrl: String,
        fileManager: FileManager
    ) -> URL {
        let deploymentID = URL(string: deploymentUrl)?.host ?? "default"

        let baseURL: URL
        if let groupURL = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) {
            baseURL = groupURL
        } else if let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first {
            baseURL = applicationSupport.appendingPathComponent("drft", isDirectory: true)
        } else {
            baseURL = fileManager.temporaryDirectory
                .appendingPathComponent("drft", isDirectory: true)
        }

        return
            baseURL
            .appendingPathComponent(directoryName, isDirectory: true)
            .appendingPathComponent(deploymentID, isDirectory: true)
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
