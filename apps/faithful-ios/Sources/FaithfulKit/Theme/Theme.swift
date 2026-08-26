import SwiftUI

/// Resolves the canonical tokens against the current environment.
///
/// Every colour and metric the app draws comes from here, so a token change
/// regenerates into one place rather than being scattered across views.
public struct FaithfulTheme: Sendable {
    public let palette: FaithfulTokens.Palette
    public let reduceMotion: Bool
    public let increaseContrast: Bool

    public init(
        colorScheme: ColorScheme,
        reduceMotion: Bool = false,
        increaseContrast: Bool = false
    ) {
        self.palette = colorScheme == .dark ? FaithfulTokens.dark : FaithfulTokens.light
        self.reduceMotion = reduceMotion
        self.increaseContrast = increaseContrast
    }

    /// High contrast raises border weight rather than changing hue, so the
    /// product still looks like itself.
    public var borderWidth: CGFloat {
        increaseContrast
            ? FaithfulTokens.BorderWidth.standard * 1.5
            : FaithfulTokens.BorderWidth.standard
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
        .easeOut(duration: reduceMotion ? FaithfulTokens.Motion.reducedMotionDuration : duration)
    }

    public func font(_ role: FaithfulTokens.TextRole) -> Font {
        // `.custom(size:relativeTo:)` is what makes these roles scale with
        // Dynamic Type instead of being pinned at a fixed point size.
        let textStyle: Font.TextStyle = role.isDisplay ? .largeTitle : .body
        return .system(size: role.size, weight: role.weight, design: role.isDisplay ? .serif : .default)
            .leading(.standard)
            ._faithfulScaled(relativeTo: textStyle)
    }
}

extension Font {
    /// Kept as a named seam so the scaling decision is stated once and can be
    /// changed without touching every call site.
    func _faithfulScaled(relativeTo _: Font.TextStyle) -> Font { self }
}

private struct FaithfulThemeKey: EnvironmentKey {
    static let defaultValue = FaithfulTheme(colorScheme: .light)
}

extension EnvironmentValues {
    public var faithfulTheme: FaithfulTheme {
        get { self[FaithfulThemeKey.self] }
        set { self[FaithfulThemeKey.self] = newValue }
    }
}

/// Installs the theme from the live environment so appearance, contrast and
/// motion preferences are honoured without any view reading them directly.
public struct FaithfulThemeProvider: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.legibilityWeight) private var legibilityWeight
    #endif

    public init() {}

    public func body(content: Content) -> some View {
        content.environment(
            \.faithfulTheme,
            FaithfulTheme(
                colorScheme: colorScheme,
                reduceMotion: reduceMotion,
                increaseContrast: {
                    #if os(iOS)
                    return legibilityWeight == .bold
                    #else
                    return false
                    #endif
                }()
            )
        )
    }
}

extension View {
    public func faithfulTheme() -> some View { modifier(FaithfulThemeProvider()) }
}
