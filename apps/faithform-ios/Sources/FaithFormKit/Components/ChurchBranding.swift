import SwiftUI

/// Church logo with monogram fallback — used on discovery, profile, and chooser.
public struct ChurchAvatar: View {
    @Environment(\.faithformTheme) private var theme
    private let logoUrl: String?
    private let name: String
    private let size: CGFloat

    public init(logoUrl: String?, name: String, size: CGFloat = FaithFormTokens.TouchTarget.recommended) {
        self.logoUrl = logoUrl
        self.name = name
        self.size = size
    }

    public var body: some View {
        Group {
            if let logoUrl, let url = URL(string: logoUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        monogram
                    }
                }
            } else {
                monogram
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: 1)
        }
        .accessibilityHidden(true)
    }

    private var monogram: some View {
        ZStack {
            theme.palette.surfaceSunken
            Text(initials)
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.brandPrimary)
        }
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? String(name.prefix(1)).uppercased() : letters.joined().uppercased()
    }
}

/// Full-bleed cover with logo overlay for church profiles.
public struct ChurchHero: View {
    @Environment(\.faithformTheme) private var theme
    private let coverImageUrl: String?
    private let logoUrl: String?
    private let name: String

    public init(coverImageUrl: String?, logoUrl: String?, name: String) {
        self.coverImageUrl = coverImageUrl
        self.logoUrl = logoUrl
        self.name = name
    }

    public var body: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let coverImageUrl, let url = URL(string: coverImageUrl) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case let .success(image):
                            image.resizable().scaledToFill()
                        default:
                            theme.palette.surfaceSunken
                        }
                    }
                } else {
                    theme.palette.brandPrimary.opacity(0.12)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 160)
            .clipped()

            ChurchAvatar(logoUrl: logoUrl, name: name, size: 64)
                .padding(FaithFormTokens.Spacing.base)
                .offset(y: 24)
        }
        .padding(.bottom, 24)
        .accessibilityHidden(true)
    }
}
