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
/// ## After the hand-over
///
/// The system splash is mark-only — Android cannot draw a wordmark there, so
/// neither platform does. Once this view owns the frame the mark settles, the
/// name fades in under it, and a working label appears only if the load is
/// still going after a beat. Nothing loops: a pulse that never ends read as a
/// second loading screen. Reduce Motion and Increase Contrast keep the lockup
/// still and drop the decorative glow. Returning visits restore the last shell
/// from disk and skip this view entirely.
struct LaunchLoadingView: View {
    @Environment(\.faithformTheme) private var theme
    @State private var settled = false
    @State private var showWordmark = false
    @State private var showWorking = false

    /// Matches the launch image's point height exactly. Change one, change both.
    static let markHeight: CGFloat = 96
    static let settleScale: CGFloat = 0.94
    /// Brand dwell for a cold signed-in load with no snapshot. Reduce Motion skips it.
    static let dwellNanoseconds: UInt64 = 700_000_000
    static let workingDelayNanoseconds: UInt64 = 900_000_000

    var body: some View {
        ZStack {
            theme.palette.background

            VStack(spacing: FaithFormTokens.Spacing.lg) {
                ZStack {
                    if showsGlow {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        theme.palette.brandAccent.opacity(0.18),
                                        theme.palette.brandAccent.opacity(0)
                                    ],
                                    center: .center,
                                    startRadius: 0,
                                    endRadius: 90
                                )
                            )
                            .frame(width: 180, height: 180)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }

                    FaithFormMark()
                        .frame(height: Self.markHeight)
                        .scaleEffect(settled || theme.reduceMotion ? 1 : Self.settleScale)
                }

                Text(L.appName)
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .opacity(showWordmark || theme.reduceMotion ? 1 : 0)

                FaithFormWorkingLabel(L.loadingAccount, working: showWorking)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.mutedContent)
                    .opacity(showWorking ? 1 : 0)
                    .accessibilityHidden(!showWorking)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(L.loadingAccount))
        .onAppear { playEntrance() }
    }

    private var showsGlow: Bool {
        !theme.reduceMotion && !theme.increaseContrast
    }

    private func playEntrance() {
        if theme.reduceMotion {
            settled = true
            showWordmark = true
        } else {
            withAnimation(.easeOut(duration: FaithFormTokens.Motion.deliberate)) {
                settled = true
            }
            withAnimation(
                .easeOut(duration: FaithFormTokens.Motion.slow)
                    .delay(FaithFormTokens.Motion.fast)
            ) {
                showWordmark = true
            }
        }
        Task {
            try? await Task.sleep(nanoseconds: Self.workingDelayNanoseconds)
            showWorking = true
        }
    }
}
