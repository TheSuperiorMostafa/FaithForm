import SwiftUI

/// Church logo with monogram fallback — used on discovery, the tab headers and
/// the church info page.
public struct ChurchAvatar: View {
    public enum Style: Sendable {
        /// A rounded square, as in lists and headers.
        case rounded
        /// A circle inside a ring of the page colour, lifted by a soft shadow —
        /// the logo sitting on a church's cover.
        case ringed(ring: CGFloat)
    }

    @Environment(\.faithformTheme) private var theme
    private let logoUrl: String?
    private let name: String
    private let size: CGFloat
    private let style: Style

    public init(
        logoUrl: String?,
        name: String,
        size: CGFloat = FaithFormTokens.TouchTarget.recommended,
        style: Style = .rounded
    ) {
        self.logoUrl = logoUrl
        self.name = name
        self.size = size
        self.style = style
    }

    public var body: some View {
        switch style {
        case .rounded:
            artwork
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                        .strokeBorder(theme.palette.border, lineWidth: 1)
                }
                .accessibilityHidden(true)

        case let .ringed(ring):
            artwork
                .frame(width: size - ring * 2, height: size - ring * 2)
                .clipShape(Circle())
                .padding(ring)
                .background(Circle().fill(theme.palette.surface))
                .shadow(color: .black.opacity(0.28), radius: 10, y: 4)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var artwork: some View {
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

    private var monogram: some View {
        ZStack {
            theme.palette.surfaceSunken
            Text(initials)
                .font(theme.font(monogramRole))
                .foregroundStyle(theme.palette.brandPrimary)
        }
    }

    private var monogramRole: FaithFormTokens.TextRole {
        if size <= 32 { return FaithFormTokens.Text.caption }
        if size >= 64 { return FaithFormTokens.Text.titleLarge }
        return FaithFormTokens.Text.titleMedium
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? String(name.prefix(1)).uppercased() : letters.joined().uppercased()
    }
}

/// The immersive top of a church page: the church's cover running edge to
/// edge — under the navigation bar — with whatever sits over its lower edge.
///
/// Pulled down, the cover stretches with the pull and scales to fill it;
/// scrolled up, it drifts at a slower rate than the page (a gentle parallax,
/// switched off under Reduce Motion). Both come from the hero's own position
/// in the scroll view, so nothing outside it has to track the scroll.
///
/// Wants to sit at the very top of a `ScrollView` that ignores the top safe
/// area. Content is laid out bottom-leading and should allow for the bars it
/// runs under; `minHeight` gives the cover room when the content is short.
public struct ChurchHero<Content: View>: View {
    private let coverImageUrl: String?
    private let minHeight: CGFloat
    private let content: Content

    public init(
        coverImageUrl: String?,
        minHeight: CGFloat = 340,
        @ViewBuilder content: () -> Content
    ) {
        self.coverImageUrl = coverImageUrl
        self.minHeight = minHeight
        self.content = content()
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .bottomLeading)
            .background { ChurchCover(coverImageUrl: coverImageUrl) }
    }
}

/// The stretching, parallaxing cover behind `ChurchHero`.
struct ChurchCover: View {
    @Environment(\.faithformTheme) private var theme
    let coverImageUrl: String?

    /// How much slower than the page the cover moves as it scrolls away.
    private static let parallax: CGFloat = 0.4

    var body: some View {
        GeometryReader { geometry in
            let top = geometry.frame(in: .scrollView).minY
            let stretch = max(top, 0)
            let drift = theme.reduceMotion ? 0 : max(-top, 0) * Self.parallax
            let size = CGSize(width: geometry.size.width, height: geometry.size.height + stretch)

            artwork
                .frame(width: size.width, height: size.height)
                .offset(y: drift)
                .frame(width: size.width, height: size.height)
                .clipped()
                .overlay { scrims }
                .offset(y: -stretch)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var artwork: some View {
        if let coverImageUrl, let url = URL(string: coverImageUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                case let .success(image):
                    image.resizable().scaledToFill()
                default:
                    ChurchBrandBackdrop()
                }
            }
        } else {
            ChurchBrandBackdrop()
        }
    }

    /// Dark at the bottom so white type over any photograph stays readable,
    /// and a lighter band at the top for the status bar and back button.
    private var scrims: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0), location: 0.3),
                    .init(color: .black.opacity(0.38), location: 0.62),
                    .init(color: .black.opacity(0.78), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.42), location: 0),
                    .init(color: .black.opacity(0), location: 0.32),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .allowsHitTesting(false)
    }
}

/// What a church without a cover photograph shows: its own brand colours as a
/// rich gradient — deep primary, lit from one corner by the accent — with a
/// soft glow and a faint dot pattern so the hero still has depth.
struct ChurchBrandBackdrop: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        let primary = theme.palette.brandPrimary
        let accent = theme.palette.brandAccent
        ZStack {
            gradient(primary: primary, accent: accent)

            // The accent as light falling from the top corner, and a little
            // brightness where it lands.
            RadialGradient(
                colors: [accent.opacity(0.5), accent.opacity(0)],
                center: UnitPoint(x: 0.92, y: 0.04),
                startRadius: 0,
                endRadius: 300
            )
            RadialGradient(
                colors: [Color.white.opacity(0.16), Color.white.opacity(0)],
                center: UnitPoint(x: 0.82, y: 0.1),
                startRadius: 0,
                endRadius: 170
            )

            Canvas { context, size in
                let spacing: CGFloat = 18
                let dot: CGFloat = 1.6
                var y: CGFloat = spacing / 2
                var row = 0
                while y < size.height {
                    var x: CGFloat = row.isMultiple(of: 2) ? spacing / 2 : spacing
                    while x < size.width {
                        context.fill(
                            Path(ellipseIn: CGRect(x: x, y: y, width: dot, height: dot)),
                            with: .color(.white.opacity(0.12))
                        )
                        x += spacing
                    }
                    y += spacing
                    row += 1
                }
            }
        }
    }

    @ViewBuilder
    private func gradient(primary: Color, accent: Color) -> some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            // Blended perceptually, so primary and accent meet in a colour of
            // their own rather than the grey a straight mix of opposites gives.
            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 0.5], [0.6, 0.45], [1, 0.5],
                    [0, 1], [0.5, 1], [1, 1],
                ],
                colors: [
                    primary.mix(with: .white, by: 0.06), primary, primary.mix(with: accent, by: 0.7),
                    primary.mix(with: .black, by: 0.2), primary, primary.mix(with: accent, by: 0.25),
                    primary.mix(with: .black, by: 0.5), primary.mix(with: .black, by: 0.4), primary.mix(with: .black, by: 0.3),
                ],
                smoothsColors: true,
                colorSpace: .perceptual
            )
        } else {
            LinearGradient(
                colors: [primary.opacity(0.9), primary, Color.black.opacity(0.9)],
                startPoint: .topTrailing,
                endPoint: .bottomLeading
            )
            .background(primary)
        }
    }
}
