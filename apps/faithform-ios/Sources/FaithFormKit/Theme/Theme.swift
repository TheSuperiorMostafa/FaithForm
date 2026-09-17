import SwiftUI

/// Resolves the canonical tokens against the current environment.
///
/// Every colour and metric the app draws comes from here, so a token change
/// regenerates into one place rather than being scattered across views.
public struct FaithFormTheme: Sendable {
    public let palette: FaithFormTokens.Palette
    public let reduceMotion: Bool
    public let increaseContrast: Bool

    public init(
        colorScheme: ColorScheme,
        reduceMotion: Bool = false,
        increaseContrast: Bool = false,
        appTheme: ChurchAppTheme? = nil
    ) {
        let base = colorScheme == .dark ? FaithFormTokens.dark : FaithFormTokens.light
        let brand = colorScheme == .dark ? appTheme?.dark : appTheme?.light
        self.palette = base.applying(brand)
        self.reduceMotion = reduceMotion
        self.increaseContrast = increaseContrast
    }

    /// High contrast raises border weight rather than changing hue, so the
    /// product still looks like itself.
    public var borderWidth: CGFloat {
        increaseContrast
            ? FaithFormTokens.BorderWidth.standard * 1.5
            : FaithFormTokens.BorderWidth.standard
    }

    /// Muted text is promoted to secondary under increased contrast — the one
    /// place where a token is deliberately swapped rather than restyled.
    public var mutedContent: Color {
        increaseContrast ? palette.contentSecondary : palette.contentMuted
    }

    /// Decorative depth is dropped under increased contrast; separation then
    /// comes from borders, which survive at any contrast setting.
    public var usesDecorativeShadow: Bool { !increaseContrast }

    /// Reduced motion shortens transitions; it never removes the state change
    /// itself, because the change is what carries the meaning.
    public func animation(_ duration: Double) -> Animation {
        .easeOut(duration: reduceMotion ? FaithFormTokens.Motion.reducedMotionDuration : duration)
    }

    public func font(_ role: FaithFormTokens.TextRole) -> Font {
        // `.custom(size:relativeTo:)` is what makes these roles scale with
        // Dynamic Type instead of being pinned at a fixed point size. The
        // previous `.system(...)` path did neither: it ignored the bundled
        // families *and* pinned every size.
        let textStyle: Font.TextStyle = role.isDisplay ? .largeTitle : .body

        FaithFormFonts.registerIfNeeded()
        guard FaithFormFonts.isAvailable else {
            // A build whose resources did not arrive still has to render. Sans
            // for both roles, because the web's headline face is Montserrat —
            // falling back to a serif would reintroduce exactly the mismatch
            // the bundled fonts exist to remove.
            return .system(size: role.size, weight: role.weight)
                .leading(.standard)
        }

        return .custom(
            FaithFormFonts.faceName(isDisplay: role.isDisplay, weight: role.weight),
            size: role.size,
            relativeTo: textStyle
        )
        .leading(.standard)
    }
}

private struct FaithFormThemeKey: EnvironmentKey {
    static let defaultValue = FaithFormTheme(colorScheme: .light)
}

extension EnvironmentValues {
    public var faithformTheme: FaithFormTheme {
        get { self[FaithFormThemeKey.self] }
        set { self[FaithFormThemeKey.self] = newValue }
    }
}

/// Installs the theme from the live environment so appearance, contrast and
/// motion preferences are honoured without any view reading them directly.
public struct FaithFormThemeProvider: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.legibilityWeight) private var legibilityWeight
    #endif

    private let appTheme: ChurchAppTheme?

    public init(appTheme: ChurchAppTheme? = nil) {
        self.appTheme = appTheme
    }

    public func body(content: Content) -> some View {
        content.environment(
            \.faithformTheme,
            FaithFormTheme(
                colorScheme: colorScheme,
                reduceMotion: reduceMotion,
                increaseContrast: {
                    #if os(iOS)
                    return legibilityWeight == .bold
                    #else
                    return false
                    #endif
                }(),
                appTheme: appTheme
            )
        )
    }
}

extension View {
    public func faithformTheme(_ appTheme: ChurchAppTheme? = nil) -> some View {
        modifier(FaithFormThemeProvider(appTheme: appTheme))
    }
}

private extension FaithFormTokens.Palette {
    func applying(_ brand: AppThemePalette?) -> Self {
        guard let brand else { return self }
        return Self(
            brandPrimary: Color(hex: brand.primary),
            brandAccent: Color(hex: brand.accent),
            brandAccentSoft: Color(hex: brand.accentSoft),
            background: background,
            surface: surface,
            surfaceRaised: surfaceRaised,
            surfaceSunken: surfaceSunken,
            surfaceInverse: surfaceInverse,
            contentPrimary: contentPrimary,
            contentSecondary: contentSecondary,
            contentMuted: contentMuted,
            contentInverse: contentInverse,
            contentOnAccent: Color(hex: brand.onAccent),
            border: border,
            borderStrong: borderStrong,
            divider: divider,
            destructive: destructive,
            destructiveContent: destructiveContent,
            success: success,
            successContent: successContent,
            warning: warning,
            warningContent: warningContent,
            live: live,
            liveContent: liveContent,
            focusRing: Color(hex: brand.accent),
            overlayScrim: overlayScrim,
            skeletonBase: skeletonBase,
            skeletonSheen: skeletonSheen
        )
    }
}

private extension Color {
    init(hex: String) {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255,
            opacity: 1
        )
    }
}
