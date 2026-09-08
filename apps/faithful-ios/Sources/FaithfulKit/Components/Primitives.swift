import SwiftUI

/// The primitives named in `design/faithful/components.json`.
///
/// Each one reads its metrics from the generated tokens, so a token change
/// moves the whole app rather than one screen. Layout and behaviour are native
/// SwiftUI — nothing here is shared with the Android implementation beyond the
/// specification they both follow.

public struct FaithfulButtonStyle: ButtonStyle {
    public enum Kind: Sendable { case primary, secondary, quiet, destructive }

    private let kind: Kind
    private let theme: FaithfulTheme

    public init(kind: Kind, theme: FaithfulTheme) {
        self.kind = kind
        self.theme = theme
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            // Icon-and-text labels lay out like the web's, which sets an 8px
            // gap and a 20px glyph on every button. A plain `Text` label is
            // untouched by this.
            .labelStyle(FaithfulButtonLabelStyle())
            .font(theme.font(FaithfulTokens.Text.titleMedium))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(minHeight: FaithfulTokens.TouchTarget.recommended)
            .padding(.horizontal, FaithfulTokens.Spacing.lg)
            .background(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.control, style: .continuous)
                    .fill(background)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.control, style: .continuous)
                    .strokeBorder(border, lineWidth: theme.borderWidth)
            )
            .shadow(
                // The web's primary carries `shadow-sm`; the quiet and outline
                // variants carry none, and neither should lift off the page.
                color: shadowColor,
                radius: FaithfulTokens.Elevation.raised.blur,
                y: FaithfulTokens.Elevation.raised.y
            )
            // Pressed feedback is immediate; the scale is decoration on top of a
            // state that has already changed.
            .opacity(configuration.isPressed ? 0.88 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(theme.animation(FaithfulTokens.Motion.fast), value: configuration.isPressed)
            .contentShape(Rectangle())
    }

    /// Navy text on gold, not white.
    ///
    /// The web writes this pair as `bg-accent text-accent-foreground`, which
    /// resolves to white on gold at 2.46:1 — below the 4.5:1 AA needs. The
    /// tokens already carry the accessible answer in `contentOnAccent`, at
    /// 5.55:1, so the identity matches the web and the contrast does not.
    private var foreground: Color {
        switch kind {
        case .primary: return theme.palette.contentOnAccent
        case .secondary, .quiet: return theme.palette.contentPrimary
        case .destructive: return theme.palette.destructiveContent
        }
    }

    /// Gold, matching the web's primary call to action.
    ///
    /// This was `brandPrimary` — navy — which made every mobile CTA the one
    /// colour the website reserves for surfaces and text, and left gold used
    /// nowhere a person actually presses.
    private var background: Color {
        switch kind {
        case .primary: return theme.palette.brandAccent
        case .secondary: return theme.palette.background
        case .quiet: return .clear
        case .destructive: return theme.palette.destructive
        }
    }

    /// The outline variant is `border-primary/45` on the web: the brand navy,
    /// softened, rather than a neutral grey that belongs to no palette.
    private var border: Color {
        switch kind {
        case .secondary: return theme.palette.brandPrimary.opacity(0.45)
        default: return .clear
        }
    }

    private var shadowColor: Color {
        guard theme.usesDecorativeShadow else { return .clear }
        switch kind {
        case .primary, .destructive:
            return theme.palette.brandPrimary.opacity(FaithfulTokens.Elevation.raised.opacity)
        case .secondary, .quiet:
            return .clear
        }
    }
}

/// Icon beside title, at the web's proportions.
///
/// Kept as a `LabelStyle` rather than a bespoke button view so every existing
/// `Button("…")` call site is unchanged and only the ones that adopt `Label`
/// gain an icon.
struct FaithfulButtonLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: FaithfulTokens.Spacing.sm) {
            configuration.icon
                .font(.system(size: FaithfulTokens.IconSize.sizeMedium, weight: .semibold))
            configuration.title
        }
    }
}

public struct FaithfulCard<Content: View>: View {
    @Environment(\.faithfulTheme) private var theme
    private let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        content
            .padding(FaithfulTokens.Spacing.base)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                    .fill(theme.palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                    .strokeBorder(theme.palette.border, lineWidth: FaithfulTokens.BorderWidth.hairline)
            )
            .shadow(
                color: theme.usesDecorativeShadow
                    ? theme.palette.brandPrimary.opacity(FaithfulTokens.Elevation.card.opacity)
                    : .clear,
                radius: FaithfulTokens.Elevation.card.blur,
                y: FaithfulTokens.Elevation.card.y
            )
    }
}

public struct StatusChip: View {
    public enum Tone: Sendable { case neutral, live, success, warning, danger }

    @Environment(\.faithfulTheme) private var theme
    private let text: String
    private let tone: Tone

    public init(_ text: String, tone: Tone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        Text(text)
            .font(theme.font(FaithfulTokens.Text.label))
            .foregroundStyle(foreground)
            .padding(.horizontal, FaithfulTokens.Spacing.sm)
            .padding(.vertical, FaithfulTokens.Spacing.xs)
            .background(Capsule().fill(background))
            // Read as part of the surrounding row rather than as its own control.
            .accessibilityHidden(false)
    }

    private var background: Color {
        switch tone {
        case .neutral: return theme.palette.surfaceSunken
        case .live: return theme.palette.live
        case .success: return theme.palette.success
        case .warning: return theme.palette.warning
        case .danger: return theme.palette.destructive
        }
    }

    private var foreground: Color {
        switch tone {
        case .neutral: return theme.palette.contentSecondary
        case .live: return theme.palette.liveContent
        case .success: return theme.palette.successContent
        case .warning: return theme.palette.warningContent
        case .danger: return theme.palette.destructiveContent
        }
    }
}

/// Says why a screen is empty and what would fill it. Never invented rows.
public struct EmptyStateView: View {
    @Environment(\.faithfulTheme) private var theme
    private let title: String
    private let explanation: String
    private let symbol: String?

    /// `symbol` is an SF Symbol name. It is optional and purely decorative —
    /// the title and explanation still carry the whole message for VoiceOver,
    /// which is why the glyph is hidden from it.
    public init(title: String, explanation: String, symbol: String? = nil) {
        self.title = title
        self.explanation = explanation
        self.symbol = symbol
    }

    public var body: some View {
        VStack(spacing: FaithfulTokens.Spacing.md) {
            if let symbol {
                ZStack {
                    Circle()
                        .fill(theme.palette.brandAccent.opacity(0.14))
                        .frame(
                            width: FaithfulTokens.IconSize.sizeHero + FaithfulTokens.Spacing.lg * 2,
                            height: FaithfulTokens.IconSize.sizeHero + FaithfulTokens.Spacing.lg * 2
                        )
                    Image(systemName: symbol)
                        .font(.system(size: FaithfulTokens.IconSize.sizeLarge, weight: .medium))
                        .foregroundStyle(theme.palette.brandPrimary)
                }
                .accessibilityHidden(true)
            }

            VStack(spacing: FaithfulTokens.Spacing.sm) {
                Text(title)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(explanation)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(FaithfulTokens.Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}

/// Cached content stays readable underneath; this only labels it.
public struct OfflineBanner: View {
    @Environment(\.faithfulTheme) private var theme
    private let message: String

    public init(message: String) { self.message = message }

    public var body: some View {
        HStack(spacing: FaithfulTokens.Spacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: FaithfulTokens.IconSize.sizeSmall))
            Text(message)
                .font(theme.font(FaithfulTokens.Text.bodySmall))
        }
        .foregroundStyle(theme.palette.warningContent)
        .padding(FaithfulTokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                .fill(theme.palette.warning)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(message))
    }
}
