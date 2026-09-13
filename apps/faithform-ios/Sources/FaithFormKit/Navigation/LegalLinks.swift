import Foundation

/// The published legal pages, and the one sentence that links to two of them.
///
/// ## Why fixed, rather than this build's origin
///
/// Every other URL in the app is resolved against the environment it was built
/// for, so a staging build can never talk to production. These are the
/// exception on purpose: the Privacy Policy and Terms a person agrees to are
/// the published ones, at the address App Store Connect and Google Play list,
/// not whatever a development server on a laptop happens to serve. Reading them
/// is not talking to production — nothing is sent, and they open in the
/// person's own browser.
///
/// ## Why the browser
///
/// They open through `openURL`, in Safari, and never in a view inside the app:
/// a legal document someone agrees to should be the page anyone else can load,
/// with the address bar showing where it came from.
public enum LegalLinks {
    public static let privacyPolicy = URL(string: "https://faithform.io/privacy")!
    public static let termsOfService = URL(string: "https://faithform.io/terms")!
    /// Google Play requires this page; Apple requires the in-app action. The
    /// account screen offers both, so neither store's reviewer has to go looking.
    public static let accountDeletion = URL(string: "https://faithform.io/account-deletion")!

    /// "By continuing, you agree to FaithForm's Terms of Service and Privacy
    /// Policy." — with both names as tappable links.
    ///
    /// Built from a format string with the document names as arguments rather
    /// than by searching the sentence for them, so a translation that reorders
    /// the words, or spells the documents differently, still links the right
    /// words. Should anything about the markdown fail to parse, the plain
    /// sentence is returned: an unlinked notice is better than a missing one.
    public static func termsNotice() -> AttributedString {
        let terms = "[\(escaped(L.termsOfService))](\(termsOfService.absoluteString))"
        let privacy = "[\(escaped(L.privacyPolicy))](\(privacyPolicy.absoluteString))"
        let markdown = String(format: L.authTermsNoticeLinked, terms, privacy)
        return (try? AttributedString(markdown: markdown)) ?? AttributedString(L.authTermsNotice)
    }

    /// A document name must not be able to close its own link early.
    private static func escaped(_ text: String) -> String {
        text.replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
    }
}
