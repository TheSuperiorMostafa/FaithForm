import SwiftUI

/// FaithForm's branded alternative to the platform segmented control.
///
/// The selection glides between equal-width choices while each choice remains
/// a real button with a full-size touch target. Colors come from the active
/// church theme, so this control changes with the rest of the white-label app.
public struct FaithFormPillSwitcher<Value: Hashable>: View {
    public struct Option: Identifiable {
        public let value: Value
        public let title: String

        public var id: Value { value }

        public init(_ value: Value, title: String) {
            self.value = value
            self.title = title
        }
    }

    @Environment(\.faithformTheme) private var theme
    @Binding private var selection: Value
    private let options: [Option]
    private let accessibilityLabel: String
    @Namespace private var selectionNamespace

    public init(
        selection: Binding<Value>,
        options: [Option],
        accessibilityLabel: String
    ) {
        _selection = selection
        self.options = options
        self.accessibilityLabel = accessibilityLabel
    }

    public var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                Button {
                    withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
                        selection = option.value
                    }
                } label: {
                    Text(option.title)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(
                            selection == option.value
                                ? theme.palette.contentOnAccent
                                : theme.palette.contentSecondary
                        )
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: FaithFormTokens.TouchTarget.minimum)
                        .contentShape(Rectangle())
                        .background {
                            if selection == option.value {
                                Capsule(style: .continuous)
                                    .fill(theme.palette.brandAccent)
                                    .matchedGeometryEffect(
                                        id: "faithform-pill-selection",
                                        in: selectionNamespace
                                    )
                                    .shadow(
                                        color: theme.usesDecorativeShadow
                                            ? theme.palette.brandPrimary.opacity(0.14)
                                            : .clear,
                                        radius: 4,
                                        y: 2
                                    )
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == option.value ? .isSelected : [])
            }
        }
        .padding(FaithFormTokens.Spacing.xs)
        .background(Capsule(style: .continuous).fill(theme.palette.surfaceSunken))
        .overlay {
            Capsule(style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
        }
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: selection)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
    }
}
