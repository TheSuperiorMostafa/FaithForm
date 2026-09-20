import SwiftUI

/// Loading placeholders that mirror the layout they stand in for.
///
/// The design rule is in `design/faithform/components.json`: a skeleton that
/// does not match what loads is a worse lie than a spinner. Bones use
/// `skeletonBase` / `skeletonSheen`, shimmer for 1.2s, and sit still when
/// Reduce Motion is on.

private let skeletonShimmerDuration: TimeInterval = 1.2

public extension View {
    /// A sheen that sweeps across the placeholder. Decorative: the layout
    /// already tells the eye where content will land.
    func skeletonShimmer(onDark: Bool = false) -> some View {
        modifier(SkeletonShimmerModifier(onDark: onDark))
    }
}

extension View {
    func skeletonAccessible() -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(L.mediaLoading)
    }
}

private struct SkeletonShimmerModifier: ViewModifier {
    @Environment(\.faithformTheme) private var theme
    let onDark: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if !theme.reduceMotion {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                        GeometryReader { geo in
                            let progress = timeline.date.timeIntervalSinceReferenceDate
                                .truncatingRemainder(dividingBy: skeletonShimmerDuration)
                                / skeletonShimmerDuration
                            let width = max(geo.size.width, 1)
                            let band = max(width * 0.42, 56)
                            let sheen = onDark
                                ? Color.white.opacity(0.28)
                                : theme.palette.skeletonSheen
                            LinearGradient(
                                colors: [sheen.opacity(0), sheen, sheen.opacity(0)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: band)
                            .offset(x: -band + CGFloat(progress) * (width + band))
                        }
                    }
                    .allowsHitTesting(false)
                }
            }
            .mask {
                content
            }
    }
}

/// A rounded bar or block occupying the space a line of type, a control, or
/// a poster will. Width is a fraction of the space the parent proposed, so a
/// bone in a `HStack` fills its slot and a bone in a column can sit short of
/// the trailing edge.
struct SkeletonBone: View {
    @Environment(\.faithformTheme) private var theme

    var height: CGFloat
    var widthFraction: CGFloat = 1
    var cornerRadius: CGFloat = FaithFormTokens.Radius.md
    var alignment: Alignment = .leading
    var fill: Color?

    var body: some View {
        let fraction = min(max(widthFraction, 0.12), 1)
        Color.clear
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .overlay {
                GeometryReader { geo in
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(fill ?? theme.palette.skeletonBase)
                        .frame(width: geo.size.width * fraction, height: height)
                        .frame(width: geo.size.width, height: height, alignment: alignment)
                }
            }
    }
}

struct SkeletonPoster: View {
    @Environment(\.faithformTheme) private var theme
    var cornerRadius: CGFloat = FaithFormTokens.Radius.lg
    var fill: Color?

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(fill ?? theme.palette.skeletonBase)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
    }
}

struct SkeletonSearchField: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        HStack(spacing: FaithFormTokens.Spacing.sm) {
            SkeletonBone(
                height: FaithFormTokens.Text.body.size,
                widthFraction: 0.42,
                cornerRadius: FaithFormTokens.Radius.pill
            )
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FaithFormTokens.Spacing.base)
        .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
        .background(Capsule().fill(theme.palette.surfaceSunken))
        .overlay {
            Capsule().strokeBorder(theme.palette.border, lineWidth: 1)
        }
    }
}

struct SkeletonAvatar: View {
    @Environment(\.faithformTheme) private var theme
    var size: CGFloat = FaithFormTokens.TouchTarget.recommended

    var body: some View {
        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
            .fill(theme.palette.skeletonBase)
            .frame(width: size, height: size)
    }
}

// MARK: - Shared cards

/// A church-row card: avatar, name, summary, place. Used by discovery so the
/// list does not reflow when results arrive.
public struct SkeletonCard: View {
    public init() {}

    public var body: some View {
        DiscoveryCardSkeleton()
    }
}

struct DiscoveryCardSkeleton: View {
    var body: some View {
        FaithFormCard {
            HStack(alignment: .top, spacing: FaithFormTokens.Spacing.base) {
                SkeletonAvatar()
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.62)
                    SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.92)
                    SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.48)
                    SkeletonBone(
                        height: 22,
                        widthFraction: 0.28,
                        cornerRadius: FaithFormTokens.Radius.pill
                    )
                }
            }
        }
    }
}

/// Matches `AnnouncementCard`: the banner at its generated shape, then the
/// date tile beside the title, time and place.
struct FeedCardSkeleton: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)

        VStack(alignment: .leading, spacing: 0) {
            Rectangle()
                .fill(theme.palette.skeletonBase)
                .aspectRatio(AnnouncementArtwork.aspectRatio, contentMode: .fit)
                .frame(maxWidth: .infinity)
            HStack(alignment: .top, spacing: FaithFormTokens.Spacing.md) {
                RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                    .fill(theme.palette.skeletonBase)
                    .frame(width: 52, height: 58)
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(height: FaithFormTokens.Text.titleLarge.size, widthFraction: 0.78)
                    SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.55)
                    SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.4)
                }
            }
            .padding(FaithFormTokens.Spacing.base)
        }
        .background(shape.fill(theme.palette.surface))
        .overlay(shape.strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline))
        .clipShape(shape)
    }
}

struct MediaCardSkeleton: View {
    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.82)
                SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.4)
                SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.68)
            }
        }
    }
}

struct PresentationCardSkeleton: View {
    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.38)
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.86)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.52)
            }
        }
    }
}

struct GivingFundCardSkeleton: View {
    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.48)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 1)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.7)
            }
        }
    }
}

struct GivingHistoryRowSkeleton: View {
    var body: some View {
        FaithFormCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                    SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.4)
                    SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.55)
                    SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.32)
                }
                Spacer(minLength: 0)
                SkeletonBone(
                    height: 22,
                    widthFraction: 0.18,
                    cornerRadius: FaithFormTokens.Radius.pill
                )
            }
        }
    }
}

struct SermonHubCardSkeleton: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                SkeletonPoster(fill: theme.palette.skeletonBase)
                VStack(spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(
                        height: 18,
                        widthFraction: 0.55,
                        alignment: .center,
                        fill: theme.palette.skeletonSheen.opacity(0.85)
                    )
                    SkeletonBone(
                        height: 12,
                        widthFraction: 0.22,
                        alignment: .center,
                        fill: theme.palette.skeletonSheen.opacity(0.7)
                    )
                }
                .padding(.horizontal, FaithFormTokens.Spacing.lg)
            }
            .clipped()

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.4)
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.84)
                SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.46)
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(
                        height: FaithFormTokens.TouchTarget.minimum - 8,
                        widthFraction: 1,
                        cornerRadius: FaithFormTokens.Radius.pill
                    )
                    SkeletonBone(
                        height: FaithFormTokens.TouchTarget.minimum - 8,
                        widthFraction: 1,
                        cornerRadius: FaithFormTokens.Radius.pill
                    )
                }
            }
            .padding(FaithFormTokens.Spacing.base)
        }
        .background(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
        )
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous))
    }
}

// MARK: - Screens

/// Home feed: a section header over banner cards, matching `HomeFeedView`.
struct FeedSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.24)
                .padding(.bottom, -FaithFormTokens.Spacing.md)
            ForEach(0..<3, id: \.self) { _ in FeedCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

struct DiscoveryResultsSkeleton: View {
    var body: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            ForEach(0..<3, id: \.self) { _ in DiscoveryCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

/// Matches the church info page: the cover edge to edge with the name over
/// it, the glass action bar overlapping it, then the highlight card and a
/// list card.
struct ChurchProfileSkeleton: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Rectangle()
                    .fill(theme.palette.skeletonBase)
                    .frame(maxWidth: .infinity)
                    .frame(height: 340)
                HStack(spacing: FaithFormTokens.Spacing.base) {
                    Circle()
                        .fill(theme.palette.skeletonSheen)
                        .frame(width: 76, height: 76)
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                        SkeletonBone(
                            height: FaithFormTokens.Text.displayLarge.size,
                            widthFraction: 0.82,
                            fill: theme.palette.skeletonSheen
                        )
                        SkeletonBone(
                            height: FaithFormTokens.Text.titleMedium.size,
                            widthFraction: 0.5,
                            fill: theme.palette.skeletonSheen
                        )
                    }
                }
                .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(.bottom, 28 + FaithFormTokens.Spacing.lg)
            }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                HStack(spacing: FaithFormTokens.Spacing.base) {
                    ForEach(0..<4, id: \.self) { _ in
                        VStack(spacing: FaithFormTokens.Spacing.sm) {
                            Circle()
                                .fill(theme.palette.skeletonBase)
                                .frame(width: 40, height: 40)
                            SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.7, alignment: .center)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(FaithFormTokens.Spacing.base)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(theme.palette.surface)
                )
                .padding(.top, -28)

                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(theme.palette.skeletonBase)
                    .frame(height: 132)

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.3)
                    FaithFormCard {
                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                            ForEach(0..<2, id: \.self) { _ in
                                HStack(spacing: FaithFormTokens.Spacing.md) {
                                    SkeletonAvatar(size: 44)
                                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                                        SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.6)
                                        SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.4)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

/// Sermons | slides hub: search, a month label, then thumbnail cards.
struct SermonListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            SkeletonSearchField()
            SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.3)
            ForEach(0..<2, id: \.self) { _ in SermonHubCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

struct MediaListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            FaithFormCard {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.22)
                    SkeletonBone(height: FaithFormTokens.Text.displayLarge.size, widthFraction: 0.7)
                    SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 0.5)
                    SkeletonBone(
                        height: FaithFormTokens.TouchTarget.recommended,
                        cornerRadius: FaithFormTokens.Radius.control
                    )
                }
            }
            SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.36)
            SkeletonSearchField()
            ForEach(0..<3, id: \.self) { _ in MediaCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

struct PresentationListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            SkeletonSearchField()
            ForEach(0..<4, id: \.self) { _ in PresentationCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

struct GivingHomeSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                SkeletonBone(height: FaithFormTokens.Text.displayLarge.size, widthFraction: 0.62)
                SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 0.78)
            }
            ForEach(0..<3, id: \.self) { _ in GivingFundCardSkeleton() }
            SkeletonBone(
                height: FaithFormTokens.TouchTarget.recommended,
                widthFraction: 0.4,
                cornerRadius: FaithFormTokens.Radius.control
            )
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

struct GivingHistorySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            SkeletonBone(height: FaithFormTokens.Text.caption.size, widthFraction: 0.55)
            ForEach(0..<4, id: \.self) { _ in GivingHistoryRowSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

/// A stack of layout-matched cards for list screens that have not named their
/// own skeleton yet. Prefer a screen-specific placeholder at the call site.
public struct ContentSkeleton: View {
    private let count: Int

    public init(count: Int = 3) {
        self.count = count
    }

    public var body: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            ForEach(0..<count, id: \.self) { _ in DiscoveryCardSkeleton() }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

/// Notes or a recording: series, title, date, body, then a section.
public struct DetailSkeleton: View {
    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.34)
            SkeletonBone(height: FaithFormTokens.Text.titleLarge.size, widthFraction: 0.88)
            SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.4)
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 1)
                SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 0.96)
                SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 0.74)
            }
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.26)
                SkeletonBone(height: FaithFormTokens.Text.body.size, widthFraction: 0.58)
            }
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                SkeletonBone(height: FaithFormTokens.Text.label.size, widthFraction: 0.22)
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.7)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 1)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.82)
                SkeletonBone(height: FaithFormTokens.Text.titleMedium.size, widthFraction: 0.62)
                SkeletonBone(height: FaithFormTokens.Text.bodySmall.size, widthFraction: 0.9)
            }
        }
        .skeletonShimmer()
        .skeletonAccessible()
    }
}

/// Full-screen slide canvas: title, scripture, body, page index — the same
/// hierarchy `SlidePageView` draws once the deck arrives.
public struct SlideSkeleton: View {
    @Environment(\.faithformTheme) private var theme
    public init() {}

    public var body: some View {
        let bone = Color.white.opacity(0.22)

        VStack(spacing: 0) {
            Spacer(minLength: FaithFormTokens.Spacing.xxl)

            VStack(spacing: FaithFormTokens.Spacing.lg) {
                SkeletonBone(
                    height: 36,
                    widthFraction: 0.72,
                    alignment: .center,
                    fill: bone
                )
                SkeletonBone(
                    height: 22,
                    widthFraction: 0.44,
                    alignment: .center,
                    fill: Color.white.opacity(0.3)
                )
                VStack(spacing: FaithFormTokens.Spacing.sm) {
                    SkeletonBone(height: 20, widthFraction: 0.86, alignment: .center, fill: bone)
                    SkeletonBone(height: 20, widthFraction: 0.78, alignment: .center, fill: bone)
                    SkeletonBone(height: 20, widthFraction: 0.64, alignment: .center, fill: bone)
                }
                .padding(.top, FaithFormTokens.Spacing.sm)
            }
            .padding(.horizontal, FaithFormTokens.Spacing.xxl)

            Spacer(minLength: FaithFormTokens.Spacing.xl)

            SkeletonBone(
                height: 13,
                widthFraction: 0.14,
                alignment: .center,
                fill: Color.white.opacity(0.18)
            )
            .padding(.bottom, FaithFormTokens.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.brandPrimary)
        .skeletonShimmer(onDark: true)
        .skeletonAccessible()
    }
}

/// Mirrors the group section picker, cover, and overview details.
public struct GroupDetailSkeleton: View {
    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    SkeletonBone(height: 40, cornerRadius: FaithFormTokens.Radius.pill)
                }
            }
            SkeletonBone(height: 190, cornerRadius: 22)
            SkeletonBone(height: 24, widthFraction: 0.3)
            SkeletonBone(height: 34, widthFraction: 0.75)
            SkeletonBone(height: 16, widthFraction: 0.35)
            VStack(spacing: 8) {
                SkeletonBone(height: 16)
                SkeletonBone(height: 16, widthFraction: 0.92)
                SkeletonBone(height: 16, widthFraction: 0.64)
            }
            FaithFormCard {
                VStack(alignment: .leading, spacing: 16) {
                    SkeletonBone(height: 20, widthFraction: 0.45)
                    SkeletonBone(height: 16, widthFraction: 0.8)
                    SkeletonBone(height: 16, widthFraction: 0.6)
                }
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading your group")
    }
}

/// A full-height conversation with message bubbles and a bottom composer.
public struct ConversationSkeleton: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            ViewThatFits(in: .vertical) {
                bubbles
                SkeletonBone(height: 54, widthFraction: 0.65)
            }
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                SkeletonAvatar(size: 36)
                SkeletonBone(height: 44, cornerRadius: FaithFormTokens.Radius.pill)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading your conversation")
    }

    private var bubbles: some View {
        VStack(spacing: 18) {
            ForEach(0..<4, id: \.self) { index in
                SkeletonBone(
                    height: index.isMultiple(of: 2) ? 64 : 44,
                    widthFraction: index.isMultiple(of: 2) ? 0.76 : 0.58,
                    cornerRadius: 18,
                    alignment: index.isMultiple(of: 2) ? .leading : .trailing
                )
            }
        }
    }
}


public struct ConversationListSkeleton: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 24) {
            ForEach(0..<5, id: \.self) { _ in
                HStack(spacing: 12) {
                    SkeletonAvatar(size: 48)
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBone(height: 18, widthFraction: 0.55)
                        SkeletonBone(height: 14, widthFraction: 0.9)
                    }
                }
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading your messages")
    }
}


public struct GroupListSkeleton: View {
    @Environment(\.faithformTheme) private var theme
    public init() {}

    public var body: some View {
        VStack(spacing: 18) {
            ForEach(0..<3, id: \.self) { _ in
                VStack(spacing: 0) {
                    SkeletonBone(height: 144, cornerRadius: 0)
                    VStack(alignment: .leading, spacing: 12) {
                        SkeletonBone(height: 14, widthFraction: 0.3)
                        SkeletonBone(height: 22, widthFraction: 0.7)
                        SkeletonBone(height: 14, widthFraction: 0.4)
                        SkeletonBone(height: 14, widthFraction: 0.6)
                    }
                    .padding(18)
                }
                .background(theme.palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 22))
            }
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading your groups")
    }
}

public struct GroupPeopleSkeleton: View {
    public init() {}
    public var body: some View {
        GroupRowsSkeleton(label: "Loading people", avatar: true, rowHeight: 44, count: 6)
    }
}

public struct GroupEventsSkeleton: View {
    public init() {}
    public var body: some View {
        GroupRowsSkeleton(label: "Loading gatherings", avatar: false, rowHeight: 60, count: 4)
    }
}

public struct GroupPreferencesSkeleton: View {
    public init() {}
    public var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<4, id: \.self) { _ in
                FaithFormCard {
                    HStack(spacing: 14) {
                        SkeletonAvatar(size: 28)
                        VStack(alignment: .leading, spacing: 8) {
                            SkeletonBone(height: 18, widthFraction: 0.55)
                            SkeletonBone(height: 14, widthFraction: 0.85)
                        }
                        SkeletonAvatar(size: 22)
                    }
                    .frame(minHeight: 44)
                }
            }
            SkeletonBone(height: 52, cornerRadius: FaithFormTokens.Radius.pill)
        }
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading notification preferences")
    }
}

private struct GroupRowsSkeleton: View {
    let label: String
    let avatar: Bool
    let rowHeight: CGFloat
    let count: Int
    var body: some View {
        VStack(spacing: 24) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(spacing: 14) {
                    if avatar { SkeletonAvatar(size: rowHeight) }
                    else { SkeletonBone(height: rowHeight, cornerRadius: 14).frame(width: rowHeight) }
                    VStack(alignment: .leading, spacing: 8) {
                        SkeletonBone(height: 18, widthFraction: 0.65)
                        SkeletonBone(height: 14, widthFraction: 0.45)
                        if !avatar { SkeletonBone(height: 12, widthFraction: 0.3) }
                    }
                }
            }
        }
        .padding(.vertical, 12)
        .skeletonShimmer()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}
