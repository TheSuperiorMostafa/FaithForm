import Foundation
import Testing
@testable import FaithfulKit

@Suite("Contract decoding")
struct ContractTests {

    @Test("every bootstrap fixture decodes")
    func bootstrapFixtures() throws {
        for name in [
            "bootstrap-first-run",
            "bootstrap-multi-church",
            "bootstrap-blocked-relationship",
            "bootstrap-deletion-requested",
            "bootstrap-additive-unknown-fields",
        ] {
            let data = try Fixtures.data(name)
            let decoded = try JSONDecoder.faithful.decode(MobileSuccess<Bootstrap>.self, from: data)
            #expect(decoded.ok)
            #expect(decoded.meta.apiMajor == 1)
            #expect(!decoded.meta.requestId.isEmpty)
        }
    }

    @Test("a first-time account with no churches is a valid, renderable state")
    func firstRun() throws {
        let bootstrap = try JSONDecoder.faithful
            .decode(MobileSuccess<Bootstrap>.self, from: Fixtures.data("bootstrap-first-run"))
            .data
        #expect(bootstrap.relationships.isEmpty)
        #expect(bootstrap.profile.selectedChurchSlug == nil)
        #expect(bootstrap.profile.displayName == nil)
        #expect(bootstrap.profile.autoAttendanceConsent == .unset)
    }

    @Test("multi-church bootstrap keeps each relationship independent")
    func multiChurch() throws {
        let bootstrap = try JSONDecoder.faithful
            .decode(MobileSuccess<Bootstrap>.self, from: Fixtures.data("bootstrap-multi-church"))
            .data
        #expect(bootstrap.relationships.count == 2)
        #expect(bootstrap.relationships[0].state == .joined)
        #expect(bootstrap.relationships[1].state == .following)
        let allReadable = bootstrap.relationships.allSatisfy { $0.canReadPublishedContent }
        #expect(allReadable)
    }

    @Test("a blocked relationship cannot read published content")
    func blocked() throws {
        let bootstrap = try JSONDecoder.faithful
            .decode(MobileSuccess<Bootstrap>.self, from: Fixtures.data("bootstrap-blocked-relationship"))
            .data
        let relationship = try #require(bootstrap.relationships.first)
        #expect(relationship.state == .blocked)
        #expect(relationship.canReadPublishedContent == false)
    }

    @Test("unknown additive fields at any depth are ignored, not fatal")
    func additiveFields() throws {
        let decoded = try JSONDecoder.faithful
            .decode(MobileSuccess<Bootstrap>.self, from: Fixtures.data("bootstrap-additive-unknown-fields"))
        #expect(decoded.data.profile.displayName == "Sam")
        // A capability this build has never heard of is carried through as a
        // plain string rather than rejected.
        #expect(decoded.data.enabledCapabilities.contains("future_capability"))
    }

    @Test("an unrecognised enum value decodes to unknown rather than throwing")
    func forwardCompatibleEnums() throws {
        #expect(RelationshipState(rawValue: "some_future_state") == .unknown("some_future_state"))
        #expect(MobileErrorCode(rawValue: "some_future_code") == .unknown("some_future_code"))
        #expect(RelationshipState(rawValue: "joined") == .joined)
        // Round-trips: an unknown value keeps its wire representation.
        #expect(RelationshipState.unknown("x").rawValue == "x")
    }

    @Test("every error fixture maps to a typed error")
    func errorFixtures() throws {
        let expectations: [(String, MobileErrorCode, Bool)] = [
            ("error-validation", .invalidRequest, false),
            ("error-unauthenticated", .unauthenticated, false),
            ("error-session-expired", .sessionExpired, false),
            ("error-forbidden", .forbidden, false),
            ("error-blocked", .blocked, false),
            ("error-conflict", .conflict, false),
            ("error-rate-limited", .rateLimited, true),
            ("error-invitation-expired", .invitationExpired, false),
            ("error-stale-version", .staleVersion, false),
            ("error-client-unsupported", .clientVersionUnsupported, false),
            ("error-invalid-cursor", .invalidCursor, false),
            ("error-payload-too-large", .payloadTooLarge, false),
        ]

        for (name, expectedCode, retryable) in expectations {
            let data = try Fixtures.data(name)
            let error = APIClient.decodeFailure(from: data, requestId: nil, status: 400)
            #expect(error.code == expectedCode, "\(name)")
            #expect(error.retryable == retryable, "\(name)")
            #expect(error.requestId != nil, "\(name) must carry a correlation id")
        }
    }

    @Test("a future error code degrades safely instead of crashing")
    func unknownErrorCode() throws {
        let error = APIClient.decodeFailure(
            from: try Fixtures.data("error-unknown-future-code"),
            requestId: nil,
            status: 400
        )
        #expect(error.code == .unknown("some_future_code"))
        #expect(!error.displayMessage.isEmpty)
    }

    @Test("validation failures carry field-level detail")
    func validationFields() throws {
        let error = APIClient.decodeFailure(
            from: try Fixtures.data("error-validation"),
            requestId: nil,
            status: 400
        )
        let fields = try #require(error.fields)
        #expect(fields.first?.field == "displayName")
    }

    @Test("rate limiting carries a retry delay")
    func retryAfter() throws {
        let error = APIClient.decodeFailure(
            from: try Fixtures.data("error-rate-limited"),
            requestId: nil,
            status: 429
        )
        #expect(error.retryAfterSeconds == 30)
        #expect(error.retryable)
    }

    @Test("a deprecation notice is readable without breaking decoding")
    func deprecation() throws {
        let failure = try JSONDecoder.faithful
            .decode(MobileFailure.self, from: Fixtures.data("error-with-deprecation"))
        let deprecation = try #require(failure.meta.deprecation)
        #expect(deprecation.replacement.contains("v2"))
    }

    @Test("pagination is cursor based and terminates")
    func pagination() throws {
        let first = try JSONDecoder.faithful
            .decode(MobileSuccess<RelationshipPage>.self, from: Fixtures.data("relationship-page-first"))
            .data
        #expect(first.nextCursor != nil)
        #expect(first.items.count == 1)

        let last = try JSONDecoder.faithful
            .decode(MobileSuccess<RelationshipPage>.self, from: Fixtures.data("relationship-page-last"))
            .data
        #expect(last.nextCursor == nil)
        #expect(last.items.isEmpty)
    }

    @Test("health carries no provider or configuration detail")
    func health() throws {
        let raw = try #require(
            try JSONSerialization.jsonObject(with: Fixtures.data("health")) as? [String: Any]
        )
        let data = try #require(raw["data"] as? [String: Any])
        let serialized = String(data: try JSONSerialization.data(withJSONObject: data), encoding: .utf8) ?? ""
        for forbidden in ["supabase", "stripe", "postgres", "key", "secret", "url"] {
            #expect(!serialized.lowercased().contains(forbidden), "health leaks \(forbidden)")
        }
    }

    @Test("no fixture exposes a sensitive field name")
    func noSensitiveFields() throws {
        // Asserted against real JSON *keys*, not substrings: `weeklyEmail` is a
        // notification preference and must not be confused with an email
        // address. What matters is that no field is *named* for a credential,
        // an internal identifier, a contact detail, or a coordinate.
        let forbiddenKeys: Set<String> = [
            "accesstoken", "refreshtoken", "servicerole", "apikey", "secret",
            "clientsecret", "publishkey", "streamkey", "token",
            "memberid", "peopleid", "churchid", "accountid", "userid", "id",
            "email", "phone", "latitude", "longitude",
            "role", "featurepermissions", "stripecustomerid",
        ]
        // `id` is legitimate on an account request the person owns; everything
        // else in the set is unconditional.
        let allowedExceptions: Set<String> = ["id"]

        // The one place a coordinate is allowed, matched as a whole path.
        //
        // This guard exists to stop *a person's* data reaching a payload. A
        // campus centre is not that: it is a fact about a building the church
        // publishes itself, and neither Core Location nor GeofencingClient can
        // register a region without one. Scoping the exception to the exact
        // path keeps a latitude attached to an account, a member or an
        // attendance attempt failing — which is the case that matters.
        func isCampusGeometry(_ path: String) -> Bool {
            guard let range = path.range(of: #"^[^.]+\.data\.configuration\.regions\[[0-9]+\]\.(latitude|longitude)$"#,
                                         options: .regularExpression) else { return false }
            return range.lowerBound == path.startIndex && range.upperBound == path.endIndex
        }

        var exemptedPaths: [String] = []

        func walk(_ value: Any, path: String, fixture: String) {
            if let object = value as? [String: Any] {
                for (key, child) in object {
                    let normalized = key.lowercased()
                    let full = "\(path).\(key)"
                    if forbiddenKeys.contains(normalized), !allowedExceptions.contains(normalized) {
                        if isCampusGeometry(full) {
                            exemptedPaths.append(full)
                        } else {
                            Issue.record("fixture \(fixture) exposes field \(full)")
                        }
                    }
                    walk(child, path: full, fixture: fixture)
                }
            } else if let array = value as? [Any] {
                for (index, child) in array.enumerated() {
                    walk(child, path: "\(path)[\(index)]", fixture: fixture)
                }
            }
        }

        for name in try Fixtures.allNames() {
            let json = try JSONSerialization.jsonObject(with: try Fixtures.data(name))
            walk(json, path: name, fixture: name)
        }

        // Nothing outside a geofence configuration may rely on the carve-out.
        for path in exemptedPaths {
            #expect(path.hasPrefix("geofence-config-"), "unexpected geometry exemption at \(path)")
        }
        #expect(!exemptedPaths.isEmpty, "the geofence fixture should exercise the exemption")

        // And the exemption is narrow: a coordinate hung off anything else fails.
        #expect(!isCampusGeometry("f.data.configuration.regions[0].member.latitude"))
        #expect(!isCampusGeometry("f.data.account.latitude"))
        #expect(!isCampusGeometry("f.data.configuration.latitude"))
        #expect(isCampusGeometry("geofence-config-granted.data.configuration.regions[1].longitude"))
    }

    // -----------------------------------------------------------------------
    // Geofence configuration — the same bytes TypeScript and Kotlin decode
    // -----------------------------------------------------------------------

    @Test("a granted geofence configuration decodes with the geometry an OS region needs")
    func geofenceConfigurationDecodes() throws {
        let decoded = try JSONDecoder.faithful
            .decode(MobileSuccess<GeofenceConfigResponse>.self,
                    from: Fixtures.data("geofence-config-granted"))

        let configuration = try #require(decoded.data.configuration)
        #expect(configuration.churchSlug == "grace-community")
        #expect(configuration.regions.count == 2)

        let region = try #require(configuration.regions.first)
        #expect(region.regionId.hasPrefix("faithful.campus."))
        #expect(region.radiusMeters > 0)
        // A centre the OS can actually monitor.
        #expect(region.latitude != 0)
        #expect(region.longitude != 0)

        #expect(configuration.sources.geofence)
        #expect(configuration.requiresConfirmation)
        #expect(configuration.minDwellSeconds == 120)
    }

    @Test("the expiry lands on a predictable boundary, not on every request")
    func geofenceExpiryIsDeterministic() throws {
        let decoded = try JSONDecoder.faithful
            .decode(MobileSuccess<GeofenceConfigResponse>.self,
                    from: Fixtures.data("geofence-config-granted"))
        let configuration = try #require(decoded.data.configuration)

        // `expiresAt` is deterministic within an epoch-aligned 15-minute
        // bucket and the current window state. It still depends on `now` —
        // `now` picks the bucket — but it moves only at predictable boundaries
        // rather than on every request. That is what lets the ETag cover it,
        // which in turn is what stops a client revalidating an expired
        // configuration from being told "not modified" and never receiving a
        // new expiry.
        let boundaries = configuration.windows.flatMap { [$0.checkinOpensAt, $0.checkinClosesAt] }
        #expect(boundaries.contains(configuration.expiresAt))
    }

    @Test("a refused geofence configuration carries a reason and no geometry")
    func geofenceRefusalDecodes() throws {
        for name in ["geofence-config-refused-consent", "geofence-config-refused-link"] {
            let decoded = try JSONDecoder.faithful
                .decode(MobileSuccess<GeofenceConfigResponse>.self, from: Fixtures.data(name))

            #expect(decoded.data.configuration == nil)
            let reason = try #require(decoded.data.refusalReason)
            #expect(!reason.isEmpty)
            let message = try #require(decoded.data.message)
            #expect(!message.isEmpty)
        }
    }

    @Test("every attendance-result variant decodes")
    func attendanceResultsDecode() throws {
        let expected: [(String, AttendanceOutcome)] = [
            ("attendance-result-counted", .counted),
            ("attendance-result-already-counted", .alreadyCounted),
            ("attendance-result-pending", .pendingConfirmation),
            ("attendance-result-rejected", .rejected),
        ]

        for (name, outcome) in expected {
            let decoded = try JSONDecoder.faithful
                .decode(MobileSuccess<AttendanceResult>.self, from: Fixtures.data(name))
            #expect(decoded.data.outcome == outcome, "\(name) decoded as \(decoded.data.outcome)")
            #expect(!decoded.data.message.isEmpty)
        }
    }

    @Test("only a counted result carries a countedAt")
    func countedAtPresence() throws {
        for name in ["attendance-result-counted", "attendance-result-already-counted"] {
            let decoded = try JSONDecoder.faithful
                .decode(MobileSuccess<AttendanceResult>.self, from: Fixtures.data(name))
            #expect(decoded.data.countedAt != nil)
        }
        for name in ["attendance-result-pending", "attendance-result-rejected"] {
            let decoded = try JSONDecoder.faithful
                .decode(MobileSuccess<AttendanceResult>.self, from: Fixtures.data(name))
            #expect(decoded.data.countedAt == nil)
        }
    }

    @Test("a consent result carries the version to re-partition against")
    func consentResultDecodes() throws {
        let granted = try JSONDecoder.faithful
            .decode(MobileSuccess<AttendanceConsentResult>.self,
                    from: Fixtures.data("attendance-consent-granted"))
        let revoked = try JSONDecoder.faithful
            .decode(MobileSuccess<AttendanceConsentResult>.self,
                    from: Fixtures.data("attendance-consent-revoked"))

        #expect(granted.data.autoAttendanceConsent == "granted")
        #expect(revoked.data.autoAttendanceConsent == "revoked")
        // A withdrawal moves the version, which invalidates a cached decision.
        #expect(revoked.data.authorizationVersion > granted.data.authorizationVersion)
    }

    @Test("a rejection message is not a spoofing oracle")
    func rejectionIsOpaque() throws {
        let decoded = try JSONDecoder.faithful
            .decode(MobileSuccess<AttendanceResult>.self,
                    from: Fixtures.data("attendance-result-rejected"))
        let message = decoded.data.message.lowercased()
        for leak in ["metre", "meter", "radius", "distance", "accuracy", "dwell", "gps"] {
            #expect(!message.contains(leak), "rejection leaks \(leak)")
        }
    }

    @Test("the configuration carries no integrity field")
    func geofenceCarriesNoIntegrity() throws {
        // The HMAC `integrity` value was removed from the contract: the client
        // holds no key to verify it with, the server never accepted it back,
        // and TLS already authenticates the transport. A field that looks like
        // a security control but checks nothing is worse than no field.
        for name in ["geofence-config-granted",
                     "geofence-config-refused-consent",
                     "geofence-config-refused-link"] {
            let raw = String(data: try Fixtures.data(name), encoding: .utf8) ?? ""
            #expect(!raw.contains("integrity"), "\(name) still carries integrity")
        }
    }
}
