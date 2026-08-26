import Foundation

/// The wire envelope, mirrored from `lib/mobile/v1/envelope.ts`.
///
/// Decoding is deliberately tolerant: `Meta` and every DTO ignore fields they
/// do not know, so a server that adds one cannot break a build already on a
/// phone. That tolerance is verified by a fixture containing unknown fields at
/// three nesting levels.
public struct MobileSuccess<Data: Decodable & Sendable>: Decodable, Sendable {
    public let ok: Bool
    public let data: Data
    public let meta: Meta
}

public struct MobileFailure: Decodable, Sendable {
    public let ok: Bool
    public let error: ErrorBody
    public let meta: Meta
}

/// A failure that already carries a server-assigned request id.
///
/// The id is the only thing worth quoting in a support conversation, so it is
/// part of the error type rather than something the call site has to remember
/// to thread through.
public struct APIError: Error, Sendable {
    public let code: MobileErrorCode
    public let message: String
    public let retryable: Bool
    public let retryAfterSeconds: Int?
    public let requestId: String?
    public let fields: [FieldIssue]?

    public init(
        code: MobileErrorCode,
        message: String,
        retryable: Bool = false,
        retryAfterSeconds: Int? = nil,
        requestId: String? = nil,
        fields: [FieldIssue]? = nil
    ) {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retryAfterSeconds = retryAfterSeconds
        self.requestId = requestId
        self.fields = fields
    }

    /// What the person is shown. Never a code, never a server internal.
    public var displayMessage: String { message }

    public static func transport(_ underlying: Error) -> APIError {
        APIError(
            code: .unavailable,
            message: "Faithful could not reach the server.",
            retryable: true
        )
    }

    public static let offline = APIError(
        code: .unavailable,
        message: "You appear to be offline.",
        retryable: true
    )
}
