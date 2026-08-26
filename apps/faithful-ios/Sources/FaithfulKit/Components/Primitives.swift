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
            .font(theme.font(FaithfulTokens.Text.titleMedium))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(minHeight: FaithfulTokens.TouchTarget.recommended)
            .padding(.horizontal, FaithfulTokens.Spacing.lg)
            .background(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                    .fill(background)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                    .strokeBorder(border, lineWidth: theme.borderWidth)
            )
            // Pressed feedback is immediate; the scale is decoration on top of a
            // state that has already changed.
            .opacity(configuration.isPressed ? 0.88 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(theme.animation(FaithfulTokens.Motion.fast), value: configuration.isPressed)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .primary: return theme.palette.contentInverse
        case .secondary, .quiet: return theme.palette.contentPrimary
        case .destructive: return theme.palette.destructiveContent
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return theme.palette.brandPrimary
        case .secondary: return theme.palette.surface
        case .quiet: return .clear
        case .destructive: return theme.palette.destructive
        }
    }

    private var border: Color {
        switch kind {
        case .secondary: return theme.palette.borderStrong
        default: return .clear
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
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.lg, style: .continuous)
                    .fill(theme.palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.lg, style: .continuous)
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

    public init(title: String, explanation: String) {
        self.title = title
        self.explanation = explanation
    }

    public var body: some View {
        VStack(spacing: FaithfulTokens.Spacing.sm) {
            Text(title)
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(explanation)
                .font(theme.font(FaithfulTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .multilineTextAlignment(.center)
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
