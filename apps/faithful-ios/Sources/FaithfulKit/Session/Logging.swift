import Foundation
import os

/// Privacy-safe logging.
///
/// The rule this enforces structurally: nothing that could carry a token, a
/// person, a message body, a coordinate or a payment detail is accepted as an
/// argument. Callers may log an event name, a request id, and a typed error
/// code — and nothing else. A logger that cannot be handed a secret cannot leak
/// one.
public struct FaithfulLog: Sendable {
    private let logger: Logger

    public init(category: String) {
        self.logger = Logger(subsystem: "io.faithform.faithful", category: category)
    }

    public func event(_ name: StaticString, requestId: String? = nil) {
        if let requestId {
            logger.info("\(name, privacy: .public) requestId=\(requestId, privacy: .public)")
        } else {
            logger.info("\(name, privacy: .public)")
        }
    }

    /// Only the typed code and the correlation id. Never the message, which may
    /// have been composed from server-supplied text.
    public func failure(_ code: MobileErrorCode, requestId: String? = nil) {
        logger.error(
            "failure code=\(code.rawValue, privacy: .public) requestId=\(requestId ?? "-", privacy: .public)"
        )
    }
}
