import SwiftUI
import ImageIO

/// What a poster looks like while it loads.
public enum PosterPhase {
    case loading
    case success(Image)
    case failure
}

/// A poster that is fetched once and then kept.
///
/// `AsyncImage` goes back to the network every time a card scrolls into view.
/// Announcement banners are 1–2 MB PNGs served `no-cache` — more than the
/// shared URL cache will hold for one response — so nothing was ever kept, and
/// opening an announcement fetched the same banner again and flashed a
/// placeholder at someone who had been looking at it a moment before. Decoded
/// posters now stay in memory, and the bytes stay on disk to be revalidated.
public struct PosterImage<Content: View>: View {
    private let url: URL
    private let content: (PosterPhase) -> Content

    @State private var bitmap: PosterBitmap?
    @State private var failed = false

    public init(url: URL, @ViewBuilder content: @escaping (PosterPhase) -> Content) {
        self.url = url
        self.content = content
        // Seeded synchronously, so a poster already on screen elsewhere is
        // drawn on the first frame rather than one frame later.
        _bitmap = State(initialValue: PosterImageStore.shared.cached(url))
    }

    public var body: some View {
        content(phase)
            .task(id: url) {
                if let hit = PosterImageStore.shared.cached(url) {
                    bitmap = hit
                    failed = false
                    return
                }
                let loaded = await PosterImageStore.shared.load(url)
                guard !Task.isCancelled else { return }
                bitmap = loaded
                failed = loaded == nil
            }
    }

    private var phase: PosterPhase {
        if let bitmap { return .success(Image(decorative: bitmap.image, scale: 1)) }
        return failed ? .failure : .loading
    }
}

/// A decoded poster. `CGImage` is immutable once made, so sharing it between
/// the loader and the views is safe.
final class PosterBitmap: @unchecked Sendable {
    let image: CGImage

    init(_ image: CGImage) {
        self.image = image
    }
}

/// Decoded posters in memory, the bytes on disk, one download per URL at a time.
final class PosterImageStore: @unchecked Sendable {
    static let shared = PosterImageStore()

    /// About 3 MB each at banner size, so a feed's worth without holding a
    /// month of them.
    private let memoryLimit = 16
    /// Banners are 1200 px wide; nothing on a phone draws them larger.
    private let maxPixelSize = 1600

    private let lock = NSLock()
    private var memory: [URL: PosterBitmap] = [:]
    private var recency: [URL] = []
    private var inFlight: [URL: Task<PosterBitmap?, Never>] = [:]
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 0, diskCapacity: 150 * 1024 * 1024)
        configuration.requestCachePolicy = .useProtocolCachePolicy
        session = URLSession(configuration: configuration)
    }

    func cached(_ url: URL) -> PosterBitmap? {
        lock.withLock { memory[url] }
    }

    func load(_ url: URL) async -> PosterBitmap? {
        let task: Task<PosterBitmap?, Never> = lock.withLock {
            if let running = inFlight[url] { return running }
            let session = self.session
            let maxPixelSize = self.maxPixelSize
            // Detached: downloading and decoding a 1 MB PNG does not belong on
            // whichever actor asked.
            let running = Task.detached(priority: .userInitiated) {
                await Self.fetch(url, session: session, maxPixelSize: maxPixelSize)
            }
            inFlight[url] = running
            return running
        }

        let result = await task.value
        lock.withLock {
            inFlight[url] = nil
            if let result { remember(result, for: url) }
        }
        return result
    }

    /// Call with the lock held.
    private func remember(_ bitmap: PosterBitmap, for url: URL) {
        memory[url] = bitmap
        recency.removeAll { $0 == url }
        recency.append(url)
        while recency.count > memoryLimit {
            memory[recency.removeFirst()] = nil
        }
    }

    private static func fetch(_ url: URL, session: URLSession, maxPixelSize: Int) async -> PosterBitmap? {
        guard
            let (data, response) = try? await session.data(from: url),
            (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true
        else { return nil }
        return decode(data, maxPixelSize: maxPixelSize)
    }

    static func decode(_ data: Data, maxPixelSize: Int) -> PosterBitmap? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return PosterBitmap(image)
    }
}
