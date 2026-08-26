import Foundation
import Testing

/// Locates the single shared fixture directory.
///
/// Resolved from `#filePath` rather than a bundled copy on purpose: TypeScript,
/// Swift and Kotlin must all decode *the same bytes*, so there is exactly one
/// copy of these files in the repository and no build step that could let the
/// three drift apart.
enum Fixtures {
    static let directory: URL = {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // FaithfulKitTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // faithful-ios
            .deletingLastPathComponent()   // apps
            .deletingLastPathComponent()   // repository root
            .appendingPathComponent("contracts/faithful/v1/fixtures")
    }()

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent("\(name).json"))
    }

    static func allNames() throws -> [String] {
        try FileManager.default
            .contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(5)) }
            .sorted()
    }
}
