import Foundation

/// Reads the giving projections and starts gifts.
///
/// ## What is cached, and what is not
///
/// The **fund list** is cached under the caller's partition and revalidated with
/// its ETag, like every other projection: it is a church's published
/// configuration and it changes rarely.
///
/// **Nothing else is.** A donation session carries a client secret, a status is
/// the one thing where a stale answer is actively harmful, and a person's giving
/// history is not something to leave sitting in a cache on a shared device. All
/// three routes say `no-store`, and this client does not second-guess them.
public actor GivingClient {
    private let api: APIClient
    private let cache: PartitionedCache

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    // MARK: - Funds

    public func home(
        churchSlug: String,
        partition: CachePartition
    ) async throws -> GivingHome {
        let key = "giving.funds.\(churchSlug)"
        let cached = await cache.load(GivingHome.self, name: key, partition: partition)

        let response = try await api.send(
            "api/mobile/v1/giving/\(churchSlug)/funds",
            ifNoneMatch: cached?.etag,
            as: GivingHome.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.givingUnavailableBody)
        }
        try? await cache.store(
            CacheEntry(value: value, etag: response.etag, storedAt: Date()),
            name: key,
            partition: partition
        )
        return value
    }

    // MARK: - Giving

    /// Starts, or resumes, one logical donation.
    ///
    /// The attempt id is the client's, is persisted before this is called, and is
    /// re-sent unchanged after any interruption — which is what makes the server
    /// return the intent it already created rather than a second one.
    public func startDonation(_ attempt: DonationAttempt) async throws -> DonationSession {
        let response = try await api.send(
            "api/mobile/v1/giving/donate",
            method: .post,
            body: StartDonationRequest(
                churchSlug: attempt.churchSlug,
                fundId: attempt.fundID,
                amountCents: attempt.amountCents,
                clientAttemptId: attempt.clientAttemptID
            ),
            as: DonationSession.self
        )
        return try require(response.value)
    }

    /// What the **server** believes happened. Never cached.
    public func status(
        churchSlug: String,
        attemptID: String
    ) async throws -> DonationStatusResult {
        let response = try await api.send(
            "api/mobile/v1/giving/\(churchSlug)/status/\(attemptID)",
            as: DonationStatusResult.self
        )
        return try require(response.value)
    }

    public func history(
        churchSlug: String,
        before: String? = nil
    ) async throws -> GivingHistoryPage {
        var params: [String: String] = [:]
        if let before { params["before"] = before }
        let response = try await api.send(
            "api/mobile/v1/giving/\(churchSlug)/history",
            query: params,
            as: GivingHistoryPage.self
        )
        return try require(response.value)
    }

    public func receipt(
        churchSlug: String,
        attemptID: String
    ) async throws -> GivingReceipt {
        let response = try await api.send(
            "api/mobile/v1/giving/\(churchSlug)/receipt/\(attemptID)",
            as: GivingReceipt.self
        )
        return try require(response.value)
    }

    /// A response with no body where one was required.
    ///
    /// These routes are all `no-store`, so a 304 is impossible and a missing
    /// value means the transport failed in a way the decoder could not see.
    /// Reported rather than papered over with a default.
    private func require<T>(_ value: T?) throws -> T {
        guard let value else {
            throw APIError(code: .unavailable, message: L.givingUnavailableBody)
        }
        return value
    }
}
