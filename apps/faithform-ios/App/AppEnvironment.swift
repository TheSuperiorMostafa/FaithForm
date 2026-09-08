import Foundation
import FaithFormKit

/// Where this build points, read once at launch from the bundle.
///
/// ## Why it fails closed
///
/// The origin comes from the `.xcconfig` for the configuration being built, and
/// **Staging and Release ship with it empty**. That is deliberate. A build whose
/// origin is missing does not fall back to production: it produces
/// `.unconfigured`, the app shows a state that says so, and the developer sees
/// exactly which key is absent.
///
/// The usual default is the other way round — a fallback to production — and it
/// is the reason staging builds end up writing to real churches. A build that
/// refuses to start is a bad afternoon; a staging build silently talking to
/// production is a bad year.
enum AppEnvironmentLoadResult {
    case configured(APIEnvironment, clientBuild: Int, allowsDebugControls: Bool)
    /// Which key was missing or unusable. Names the key, never a value.
    case unconfigured(reason: String)
}

enum AppEnvironmentLoader {
    /// Reads the environment from a bundle's Info dictionary.
    ///
    /// Takes the dictionary rather than reading `Bundle.main` directly so a test
    /// can drive every failure without building three apps.
    static func load(from info: [String: Any]) -> AppEnvironmentLoadResult {
        guard let key = string(info["FaithFormEnvironmentKey"]), !key.isEmpty else {
            return .unconfigured(reason: "FaithFormEnvironmentKey is not set")
        }

        guard let origin = string(info["FaithFormAPIOrigin"]), !origin.isEmpty else {
            return .unconfigured(reason: "FaithFormAPIOrigin is not set for \(key)")
        }

        guard let url = URL(string: origin), let scheme = url.scheme?.lowercased() else {
            return .unconfigured(reason: "FaithFormAPIOrigin is not a URL")
        }

        // A production or staging build talking over cleartext is a
        // configuration mistake, not a preference. Only a development build may.
        if scheme != "https" && key != "development" {
            return .unconfigured(reason: "FaithFormAPIOrigin must be https in \(key)")
        }
        if scheme != "https" && scheme != "http" {
            return .unconfigured(reason: "FaithFormAPIOrigin must be http or https")
        }

        // A build number that cannot be read is not defaulted: the server
        // refuses builds it no longer supports, and guessing one would make an
        // unsupported build look supported.
        guard let build = Int(string(info["FaithFormClientBuild"]) ?? ""), build > 0 else {
            return .unconfigured(reason: "FaithFormClientBuild is not a positive integer")
        }

        return .configured(
            APIEnvironment(key: key, baseURL: url),
            clientBuild: build,
            // Anything other than an explicit YES is NO. A misspelled value must
            // not switch developer affordances on in a build going to a church.
            allowsDebugControls: (string(info["FaithFormAllowDebugControls"]) ?? "NO") == "YES"
        )
    }

    private static func string(_ value: Any?) -> String? {
        guard let value = value as? String else { return nil }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
