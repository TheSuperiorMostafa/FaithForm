import SwiftUI

/// Cream pill search field matching Discovery — used on sermons, slides, and past services.
public struct FaithFormSearchField: View {
    @Environment(\.faithformTheme) private var theme
    private let placeholder: String
    @Binding private var text: String
    private let onSubmit: () -> Void
    private let onClear: (() -> Void)?

    public init(
        placeholder: String,
        text: Binding<String>,
        onSubmit: @escaping () -> Void,
        onClear: (() -> Void)? = nil
    ) {
        self.placeholder = placeholder
        self._text = text
        self.onSubmit = onSubmit
        self.onClear = onClear
    }

    public var body: some View {
        HStack(spacing: FaithFormTokens.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(theme.mutedContent)
                .accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentPrimary)
                .submitLabel(.search)
                .onSubmit(onSubmit)
                .onChange(of: text) { _, newValue in
                    if newValue.isEmpty { onClear?() }
                }
                .accessibilityLabel(Text(placeholder))
        }
        .padding(.horizontal, FaithFormTokens.Spacing.base)
        .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
        .background(Capsule().fill(theme.palette.surfaceSunken))
        .overlay {
            Capsule()
                .strokeBorder(theme.palette.border, lineWidth: 1)
        }
    }
}
