import Foundation

/// Where the app is pointed. Chosen at build time; never editable in a release
/// build, and never carrying a secret — only an origin.
public struct APIEnvironment: Sendable, Hashable {
    public let key: String
    public let baseURL: URL

    public init(key: String, baseURL: URL) {
        self.key = key
        self.baseURL = baseURL
    }
}

public protocol TokenProviding: Actor {
    /// A currently-valid access token, refreshing once if needed.
    func validAccessToken() async throws -> String
    /// Called when the server rejects a token we believed was valid.
    func invalidate() async
}

/// The typed client for `/api/mobile/v1`.
///
/// Every request carries the client build so the server can refuse a build it
/// no longer supports, and every response is decoded through the shared
/// envelope so error handling is identical at every call site.
public actor APIClient {
    public struct Configuration: Sendable {
        public let environment: APIEnvironment
        public let clientBuild: Int
        public let timeout: TimeInterval

        public init(environment: APIEnvironment, clientBuild: Int, timeout: TimeInterval = 20) {
            self.environment = environment
            self.clientBuild = clientBuild
            self.timeout = timeout
        }
    }

    private let configuration: Configuration
    private let transport: HTTPTransport
    private let tokens: TokenProviding?

    public init(
        configuration: Configuration,
        transport: HTTPTransport,
        tokens: TokenProviding?
    ) {
        self.configuration = configuration
        self.transport = transport
        self.tokens = tokens
    }

    /// Resolves a server-relative path against this environment's origin.
    ///
    /// The media routes return a **relative** delivery URL on purpose: an
    /// absolute one would let a response point a player at an arbitrary host,
    /// and the client would have no way to tell a legitimate one from a
    /// substituted one. Resolving here means playback can only ever reach the
    /// origin this build was configured with.
    public func absoluteURL(for path: String) -> URL? {
        guard path.hasPrefix("/") else { return nil }
        return URL(string: path, relativeTo: configuration.environment.baseURL)?.absoluteURL
    }

    public enum Method: String, Sendable {
        case get = "GET", post = "POST", patch = "PATCH", put = "PUT", delete = "DELETE"
    }

    public struct Response<T: Decodable & Sendable>: Sendable {
        public let value: T?
        public let etag: String?
        /// True when the server answered 304 and `value` is intentionally nil.
        public let notModified: Bool
        public let requestId: String?
    }

    /// One request. `ifNoneMatch` enables conditional revalidation;
    /// `idempotencyKey` is required by the server for retryable commands.
    public func send<T: Decodable & Sendable>(
        _ path: String,
        method: Method = .get,
        body: (any Encodable & Sendable)? = nil,
        query: [String: String] = [:],
        ifNoneMatch: String? = nil,
        idempotencyKey: String? = nil,
        authenticated: Bool = true,
        as type: T.Type = T.self
    ) async throws -> Response<T> {
        var components = URLComponents(
            url: configuration.environment.baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else {
            throw APIError(code: .invalidRequest, message: "Bad request.")
        }

        var request = URLRequest(url: url, timeoutInterval: configuration.timeout)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(String(configuration.clientBuild), forHTTPHeaderField: "X-FaithForm-Client-Build")
        if let ifNoneMatch { request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match") }
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }

        if let body {
            request.httpBody = try JSONEncoder.faithful.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if authenticated {
            guard let tokens else {
                throw APIError(code: .unauthenticated, message: "Sign in to continue.")
            }
            let token = try await tokens.validAccessToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, http): (Data, HTTPURLResponse)
        do {
            (data, http) = try await transport.perform(request)
        } catch {
            throw APIError.transport(error)
        }

        let requestId = http.value(forHTTPHeaderField: "X-Request-Id")
        let etag = http.value(forHTTPHeaderField: "ETag")

        if http.statusCode == 304 {
            return Response(value: nil, etag: etag, notModified: true, requestId: requestId)
        }

        if (200..<300).contains(http.statusCode) {
            let decoded = try Self.decodeSuccess(T.self, from: data)
            return Response(value: decoded, etag: etag, notModified: false, requestId: requestId)
        }

        // A rejected token is worth clearing exactly once, so the next call
        // re-authenticates rather than replaying a credential we know is dead.
        let failure = Self.decodeFailure(from: data, requestId: requestId, status: http.statusCode)
        if failure.code == .unauthenticated || failure.code == .sessionExpired {
            await tokens?.invalidate()
        }
        throw failure
    }

    static func decodeSuccess<T: Decodable & Sendable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder.faithful.decode(MobileSuccess<T>.self, from: data).data
        } catch {
            throw APIError(code: .internalError, message: "FaithForm could not read the response.")
        }
    }

    static func decodeFailure(from data: Data, requestId: String?, status: Int) -> APIError {
        if let failure = try? JSONDecoder.faithful.decode(MobileFailure.self, from: data) {
            return APIError(
                code: failure.error.code,
                message: failure.error.message,
                retryable: failure.error.retryable,
                retryAfterSeconds: failure.error.retryAfterSeconds,
                requestId: failure.meta.requestId,
                fields: failure.error.fields
            )
        }
        // An unparseable error body must still become something safe and typed
        // rather than surfacing raw bytes.
        return APIError(
            code: status >= 500 ? .unavailable : .internalError,
            message: "Something went wrong.",
            retryable: status >= 500,
            requestId: requestId
        )
    }
}

/// Erases a heterogeneous body so `send` can stay generic over responses only.
struct AnyEncodable: Encodable {
    private let encodeTo: @Sendable (Encoder) throws -> Void
    init(_ wrapped: any Encodable & Sendable) {
        encodeTo = { encoder in try wrapped.encode(to: encoder) }
    }
    func encode(to encoder: Encoder) throws { try encodeTo(encoder) }
}

extension JSONDecoder {
    /// Tolerant by construction: no `.useDefaultKeys` surprises, no date
    /// strategy that would reject an instant the server considers valid.
    public static let faithful: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()
}

extension JSONEncoder {
    public static let faithful: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}
