import SwiftUI
import FaithFormKit

/// What stands on screen while the account loads.
///
/// ## A continuation of the launch screen, not a new screen
///
/// `UILaunchScreen` in Info.plist draws `LaunchBackground` with the `LaunchMark`
/// asset centred at its natural 96-point height. This view draws the same ground
/// and the same mark at the same height in the same place, so the moment iOS
/// hands over to the app nothing moves. The large spinner it replaces arrived on
/// a different colour, which made launch look like two loading screens in a row.
///
/// ## Why no spinner at first
///
/// Most loads finish in well under a second, and a spinner that flashes for a
/// fraction of one reads as a glitch. The mark breathes instead; only a load that
/// is genuinely slow earns a small indicator beneath it, so a person on poor
/// signal can still tell the app has not frozen.
struct LaunchLoadingView: View {
    @Environment(\.faithformTheme) private var theme
    @State private var breathing = false
    @State private var showsIndicator = false

    /// Matches the launch image's point height exactly. Change one, change both.
    static let markHeight: CGFloat = 96
    static let indicatorDelay: Duration = .milliseconds(1200)

    var body: some View {
        ZStack {
            theme.palette.background

            FaithFormMark()
                .frame(height: Self.markHeight)
                // A slow, shallow pulse. Reduce Motion keeps the mark still; the
                // indicator below still says the app is working.
                .opacity(breathing && !theme.reduceMotion ? 0.72 : 1)
                .animation(
                    theme.reduceMotion
                        ? nil
                        : .easeInOut(duration: 1.1).repeatForever(autoreverses: true),
                    value: breathing
                )

            if showsIndicator {
                ProgressView()
                    .tint(theme.mutedContent)
                    .offset(y: Self.markHeight / 2 + FaithFormTokens.Spacing.xl)
                    .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(L.loadingAccount))
        .onAppear { breathing = true }
        .task {
            try? await Task.sleep(for: Self.indicatorDelay)
            guard !Task.isCancelled else { return }
            withAnimation(theme.animation(FaithFormTokens.Motion.standard)) { showsIndicator = true }
        }
    }
}
