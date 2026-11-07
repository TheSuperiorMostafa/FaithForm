import Foundation
import Observation

/// Pickup credentials live only for this screen's active lifetime.
@Observable @MainActor
public final class HouseholdPickupModel {
    public private(set) var data: KidsCheckInData?
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    private var generation = 0
    private let requestTimeout: Duration

    public init(requestTimeout: Duration = .seconds(15)) {
        self.requestTimeout = requestTimeout
    }

    public func clear() {
        generation &+= 1
        data = nil
        errorMessage = nil
        isLoading = false
    }

    /// All refresh triggers share one flight. A failed refresh also revokes
    /// previously displayed codes, since guardian access may have changed.
    public func load(api: APIClient, churchSlug: String) async {
        guard !isLoading, !Task.isCancelled else { return }
        generation &+= 1
        let requestGeneration = generation
        isLoading = true
        defer {
            if generation == requestGeneration { isLoading = false }
        }
        do {
            let timeout = requestTimeout
            let value = try await withThrowingTaskGroup(of: KidsCheckInData.self) { group in
                group.addTask {
                    let response = try await api.send("api/mobile/v1/checkin/\(churchSlug)/household", as: KidsCheckInData.self)
                    guard let value = response.value else {
                        throw APIError(code: .internalError, message: "Pickup codes are unavailable.")
                    }
                    return value
                }
                group.addTask {
                    try await Task.sleep(for: timeout)
                    throw APIError(code: .unavailable, message: "Pickup codes took too long to load.", retryable: true)
                }
                defer { group.cancelAll() }
                return try await group.next()!
            }
            try Task.checkCancellation()
            guard generation == requestGeneration else { return }
            data = value
            errorMessage = nil
        } catch {
            guard generation == requestGeneration else { return }
            if error.isCancellation { return }
            data = nil
            switch (error as? APIError)?.code {
            case .unauthenticated, .sessionExpired:
                errorMessage = "Please sign in again to see your pickup codes."
            case .forbidden, .blocked, .accountInactive, .notFound:
                errorMessage = "Pickup codes aren’t available for this account. Ask the check-in team to confirm your guardian access."
            default:
                errorMessage = "We couldn’t load your pickup codes. Try again in a moment. If this continues, ask the check-in team for help."
            }
        }
    }
}
