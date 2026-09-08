import Foundation

/// The seam that lets every networking test run without a live server.
public protocol HTTPTransport: Sendable {
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    /// TLS validation is left entirely at its defaults on purpose: there is no
    /// pinning, no custom trust evaluation, and no exception list, so there is
    /// nothing here that could weaken it.
    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }
}

/// Deterministic transport for tests. Records what it was asked so a test can
/// assert on headers without a network.
public actor StubTransport: HTTPTransport {
    public struct Exchange: Sendable {
        public let status: Int
        public let body: Data
        public let headers: [String: String]

        public init(status: Int = 200, body: Data = Data(), headers: [String: String] = [:]) {
            self.status = status
            self.body = body
            self.headers = headers
        }
    }

    private var queued: [Exchange]
    public private(set) var received: [URLRequest] = []

    public init(_ queued: [Exchange]) { self.queued = queued }

    public func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        received.append(request)
        guard !queued.isEmpty else { throw URLError(.notConnectedToInternet) }
        let next = queued.removeFirst()
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: next.status,
            httpVersion: "HTTP/1.1",
            headerFields: next.headers
        )!
        return (next.body, response)
    }

    public func requestCount() -> Int { received.count }
    public func header(_ name: String, at index: Int) -> String? {
        received.indices.contains(index)
            ? received[index].value(forHTTPHeaderField: name)
            : nil
    }
}
