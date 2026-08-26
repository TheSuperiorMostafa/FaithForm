import Foundation
import SwiftUI
import Testing
@testable import FaithfulKit

private actor FixedTokens: TokenProviding {
    private(set) var invalidated = 0
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async { invalidated += 1 }
    func invalidationCount() -> Int { invalidated }
}

@Suite("API client")
struct APIClientTests {

    private func client(
        _ exchanges: [StubTransport.Exchange],
        tokens: TokenProviding? = FixedTokens()
    ) -> (APIClient, StubTransport) {
        let transport = StubTransport(exchanges)
        let client = APIClient(
            configuration: .init(
                environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
                clientBuild: 42
            ),
            transport: transport,
            tokens: tokens
        )
        return (client, transport)
    }

    @Test("every request carries auth, client build and accept headers")
    func requestHeaders() async throws {
        let body = try Fixtures.data("health")
        let (api, transport) = client([.init(status: 200, body: body)])

        _ = try await api.send("api/mobile/v1/health", as: Health.self)

        #expect(await transport.header("Authorization", at: 0) == "Bearer test-token")
        #expect(await transport.header("X-FaithForm-Client-Build", at: 0) == "42")
        #expect(await transport.header("Accept", at: 0) == "application/json")
    }

    @Test("an anonymous request sends no Authorization header")
    func anonymousRequest() async throws {
        let (api, transport) = client([.init(status: 200, body: try Fixtures.data("health"))])
        _ = try await api.send("api/mobile/v1/health", authenticated: false, as: Health.self)
        #expect(await transport.header("Authorization", at: 0) == nil)
    }

    @Test("conditional requests send If-None-Match and surface 304 without a body")
    func conditionalRequest() async throws {
        let (api, transport) = client([
            .init(status: 304, headers: ["ETag": "\"abc\""])
        ])

        let response = try await api.send(
            "api/mobile/v1/account/bootstrap",
            ifNoneMatch: "\"abc\"",
            as: Bootstrap.self
        )

        #expect(response.notModified)
        #expect(response.value == nil)
        #expect(response.etag == "\"abc\"")
        #expect(await transport.header("If-None-Match", at: 0) == "\"abc\"")
    }

    @Test("a retryable command sends its idempotency key")
    func idempotencyHeader() async throws {
        let body = try Fixtures.data("sign-out")
        let (api, transport) = client([.init(status: 200, body: body)])

        _ = try await api.send(
            "api/mobile/v1/account/requests",
            method: .post,
            idempotencyKey: "abc-12345678",
            as: SignOutResult.self
        )

        #expect(await transport.header("Idempotency-Key", at: 0) == "abc-12345678")
    }

    @Test("a success response exposes its ETag and request id")
    func successMetadata() async throws {
        let (api, _) = client([
            .init(
                status: 200,
                body: try Fixtures.data("health"),
                headers: ["ETag": "\"v1\"", "X-Request-Id": "req-1"]
            )
        ])
        let response = try await api.send("api/mobile/v1/health", as: Health.self)
        #expect(response.etag == "\"v1\"")
        #expect(response.requestId == "req-1")
        #expect(response.value?.status == "ok")
    }

    @Test("a typed failure is thrown, carrying the server's request id")
    func typedFailure() async throws {
        // Two exchanges: one for the throws assertion, one to inspect.
        let blocked = try Fixtures.data("error-blocked")
        let (api, _) = client([
            .init(status: 403, body: blocked),
            .init(status: 403, body: blocked),
        ])

        await #expect(throws: APIError.self) {
            _ = try await api.send("api/mobile/v1/account/bootstrap", as: Bootstrap.self)
        }

        do {
            _ = try await api.send("api/mobile/v1/account/bootstrap", as: Bootstrap.self)
        } catch let error as APIError {
            #expect(error.code == .blocked)
            #expect(error.requestId == "3f1a0c9e-1b2d-4c5e-8f90-a1b2c3d4e5f6")
        }
    }

    @Test("a rejected token is invalidated exactly once")
    func invalidatesRejectedToken() async throws {
        let tokens = FixedTokens()
        let (api, _) = client(
            [.init(status: 401, body: try Fixtures.data("error-session-expired"))],
            tokens: tokens
        )
        _ = try? await api.send("api/mobile/v1/account/bootstrap", as: Bootstrap.self)
        #expect(await tokens.invalidationCount() == 1)
    }

    @Test("an unparseable body still becomes a safe typed error")
    func garbageBody() async throws {
        let (api, _) = client([.init(status: 500, body: Data("<html>oops</html>".utf8))])
        do {
            _ = try await api.send("api/mobile/v1/health", as: Health.self)
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.code == .unavailable)
            // Nothing from the raw body reaches what the person is shown.
            #expect(!error.displayMessage.contains("html"))
        }
    }

    @Test("a transport failure is reported as retryable, not as a crash")
    func transportFailure() async throws {
        let (api, _) = client([])
        do {
            _ = try await api.send("api/mobile/v1/health", as: Health.self)
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.retryable)
        }
    }
}

@Suite("Theme and accessibility")
struct ThemeTests {

    @Test("light and dark resolve different palettes")
    func palettes() {
        #expect(FaithfulTheme(colorScheme: .light).palette.background != FaithfulTheme(colorScheme: .dark).palette.background)
    }

    @Test("increased contrast thickens borders and promotes muted text")
    func increasedContrast() {
        let normal = FaithfulTheme(colorScheme: .light)
        let high = FaithfulTheme(colorScheme: .light, increaseContrast: true)

        #expect(high.borderWidth > normal.borderWidth)
        #expect(high.mutedContent == high.palette.contentSecondary)
        #expect(normal.mutedContent == normal.palette.contentMuted)
        // Decorative depth is dropped; separation comes from borders instead.
        #expect(normal.usesDecorativeShadow)
        #expect(!high.usesDecorativeShadow)
    }

    @Test("reduced motion shortens transitions without removing them")
    func reducedMotion() {
        let reduced = FaithfulTheme(colorScheme: .light, reduceMotion: true)
        #expect(reduced.reduceMotion)
        // The animation still exists — only its duration changes.
        _ = reduced.animation(FaithfulTokens.Motion.standard)
        #expect(FaithfulTokens.Motion.reducedMotionDuration < FaithfulTokens.Motion.standard)
    }

    @Test("touch targets meet both platform minimums")
    func touchTargets() {
        #expect(FaithfulTokens.TouchTarget.minimum >= 44)
        #expect(FaithfulTokens.TouchTarget.recommended >= 48)
    }

    @Test("generated tokens match the canonical version")
    func tokenVersion() {
        // Bumped by the generator; a mismatch means someone hand-edited the
        // generated file instead of the source of truth.
        #expect(FaithfulTokens.version == "1.0.0")
    }

    @Test("body typography is large enough to read")
    func typography() {
        #expect(FaithfulTokens.Text.body.size >= 16)
        #expect(FaithfulTokens.Text.caption.size >= 12)
        #expect(FaithfulTokens.Text.body.lineHeight > FaithfulTokens.Text.body.size)
    }
}
