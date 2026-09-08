import CoreText
import Foundation
import SwiftUI

/// Registers the bundled type with CoreText, once.
///
/// ## Why this exists at all
///
/// `UIAppFonts` in an Info.plist registers fonts shipped in the *app* bundle.
/// These ship in the **package** bundle, so nothing registers them for us and a
/// `Font.custom` lookup would silently fall back to San Francisco — which is
/// exactly the drift this file exists to end.
///
/// ## Why these families
///
/// Montserrat and Nunito are what the web app already loads (`--font-heading`
/// and `--font-sans`). The tokens used to name Fraunces and Inter, and the iOS
/// theme rendered headlines with `design: .serif`, so a member reading a church
/// on the phone saw serif headlines the website never had. Matching here is not
/// decoration; it is the difference between one product and two.
///
/// Both families are SIL OFL 1.1. The licences ship beside them in `Resources/Fonts`.
public enum FaithfulFonts {
    /// The PostScript names CoreText exposes after registration — not the file
    /// names, which are only how they are stored.
    public enum Name {
        public static let displaySemibold = "Montserrat-SemiBold"
        public static let displayBold = "Montserrat-Bold"
        public static let textRegular = "Nunito-Regular"
        public static let textSemibold = "Nunito-SemiBold"
    }

    private static let files = [
        "Montserrat-SemiBold",
        "Montserrat-Bold",
        "Nunito-Regular",
        "Nunito-SemiBold",
    ]

    /// True once the faces are registered *and* actually resolve.
    ///
    /// A lazy `static let` rather than a flag and a function: Swift runs this
    /// exactly once, on whichever thread asks first, with no lock of our own
    /// and no mutable global for strict concurrency to reject. Reading it is
    /// what performs the registration.
    ///
    /// A build where the resources did not make it into the bundle reports
    /// `false` and the theme degrades to the system font rather than rendering
    /// a face that is not there.
    public static let isAvailable: Bool = {
        for file in files {
            guard let url = Bundle.module.url(forResource: file, withExtension: "ttf")
                ?? Bundle.module.url(forResource: "Fonts/\(file)", withExtension: "ttf")
            else { continue }

            var error: Unmanaged<CFError>?
            // `.process` may already have registered these; "already registered"
            // is a success for our purposes, not a failure to report.
            _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
            error?.release()
        }

        // Proof rather than assumption: ask CoreText whether the face actually
        // resolves before letting the theme depend on it.
        #if canImport(UIKit)
        return UIFont(name: Name.textRegular, size: 12) != nil
        #else
        return (CTFontCopyPostScriptName(
            CTFontCreateWithName(Name.textRegular as CFString, 12, nil)
        ) as String) == Name.textRegular
        #endif
    }()

    /// Reads `isAvailable`, which is what triggers registration. Named for the
    /// intent so call sites do not look like they are discarding a value.
    public static func registerIfNeeded() { _ = isAvailable }

    /// The face for a role's family and weight.
    ///
    /// Only the four weights the token roles actually ask for are bundled, so
    /// anything heavier resolves to the bold cut rather than pulling a fifth
    /// file into the app for one label.
    static func faceName(isDisplay: Bool, weight: Font.Weight) -> String {
        let heavy = weight == .bold || weight == .heavy || weight == .black
        if isDisplay { return heavy ? Name.displayBold : Name.displaySemibold }
        let emphasised = heavy || weight == .semibold || weight == .medium
        return emphasised ? Name.textSemibold : Name.textRegular
    }
}
