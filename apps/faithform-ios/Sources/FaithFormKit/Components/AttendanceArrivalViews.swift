import SwiftUI

/// "Are you at Grace Community?" — the arrival, as the first thing on Home.
///
/// Three states, and the card always says which one it is in:
///
/// - **Counting down.** A ring fills and the time left ticks, so staying put
///   visibly does something. A card that only said "stay a moment" read
///   exactly like one that was stuck.
/// - **Waiting for check-in to open.** An early arrival shows the clock time
///   instead of a ring measuring out most of an hour.
/// - **Ready.** The ring gives way to "Check in", with a tap of haptics, so the
///   moment it is due is the moment it is obvious.
///
/// Draws whatever `now` it is given and holds no timer of its own: the model's
/// `holdOpenWhilePending()` advances the clock, which keeps every state here
/// reachable from a preview or a test at a fixed instant.
public struct AttendanceArrivalCard: View {
    @Environment(\.faithformTheme) private var theme

    private let pending: PendingArrival
    private let churchName: String
    private let logoUrl: String?
    private let now: Date
    private let isWorking: Bool
    private let onConfirm: @MainActor () -> Void
    private let onDecline: @MainActor () -> Void

    public init(
        pending: PendingArrival,
        churchName: String? = nil,
        logoUrl: String? = nil,
        now: Date,
        isWorking: Bool,
        onConfirm: @escaping @MainActor () -> Void,
        onDecline: @escaping @MainActor () -> Void
    ) {
        self.pending = pending
        // The page's own church name wins over the one stored with the
        // arrival: that one was saved for a notification shown with no account
        // loaded, and can be missing.
        let name = (churchName ?? pending.churchName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        self.churchName = name
        self.logoUrl = logoUrl
        self.now = now
        self.isWorking = isWorking
        self.onConfirm = onConfirm
        self.onDecline = onDecline
    }

    private enum Phase: Equatable {
        case counting(remaining: TimeInterval, progress: Double)
        case later(Date)
        case ready
        case finishing
    }

    private var phase: Phase {
        if pending.canConfirm(now: now) { return .ready }
        if pending.isTicking(now: now), let remaining = pending.secondsRemaining(now: now) {
            // An automatic arrival at zero is being submitted, not waiting on
            // anyone — say so rather than show a ring stuck at full.
            if remaining <= 0, !pending.needsPersonConfirmation { return .finishing }
            return .counting(remaining: remaining, progress: pending.progress(now: now))
        }
        if let at = pending.promptAt, !pending.isQueued { return .later(at) }
        return .finishing
    }

    private var isReady: Bool { phase == .ready }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.base) {
            header

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                Text(AttendanceNotificationContent.arrivalTitle(churchName: churchName))
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }

            middle
                .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))

            actions
        }
        .padding(FaithFormTokens.Spacing.lg - FaithFormTokens.Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)
                .strokeBorder(
                    isReady ? theme.palette.brandAccent.opacity(0.7) : theme.palette.border,
                    lineWidth: isReady ? FaithFormTokens.BorderWidth.standard : FaithFormTokens.BorderWidth.hairline
                )
        )
        .shadow(
            color: theme.usesDecorativeShadow
                ? theme.palette.brandPrimary.opacity(isReady ? 0.16 : 0.08)
                : .clear,
            radius: 16,
            y: 6
        )
        .animation(theme.animation(FaithFormTokens.Motion.slow), value: isReady)
        .sensoryFeedback(.success, trigger: isReady) { _, ready in ready }
    }

    // MARK: - Pieces

    private var header: some View {
        HStack(spacing: FaithFormTokens.Spacing.sm) {
            ArrivalBeacon(active: !isReady)
            Text(L.autoAttendanceArrivalEyebrow.uppercased())
                .font(theme.font(FaithFormTokens.Text.label))
                .tracking(0.8)
                .foregroundStyle(theme.palette.brandPrimary)
            Spacer(minLength: 0)
            if !churchName.isEmpty {
                ChurchAvatar(logoUrl: logoUrl, name: churchName, size: 32)
            }
        }
    }

    @ViewBuilder
    private var middle: some View {
        switch phase {
        case let .counting(remaining, progress):
            HStack(alignment: .center, spacing: FaithFormTokens.Spacing.base) {
                CountdownRing(remaining: remaining, progress: progress)
                Text(
                    pending.needsPersonConfirmation
                        ? L.autoAttendanceArrivalWaitingCaption
                        : L.autoAttendanceArrivalAutomaticCaption
                )
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }

        case let .later(at):
            Label {
                Text(String(format: L.autoAttendanceArrivalWaitingUntil, at.formatted(date: .omitted, time: .shortened)))
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "clock")
                    .foregroundStyle(theme.palette.brandAccent)
            }

        case .ready:
            Text(L.autoAttendanceArrivalReadyCaption)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

        case .finishing:
            FaithFormWorkingLabel(
                pending.isQueued ? L.autoAttendanceOfflineBody : L.autoAttendanceChecking,
                working: !pending.isQueued
            )
            .font(theme.font(FaithFormTokens.Text.bodySmall))
            .foregroundStyle(theme.palette.contentSecondary)
        }
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: FaithFormTokens.Spacing.sm) {
            if isReady {
                Button(action: onConfirm) {
                    Label {
                        FaithFormWorkingLabel(L.autoAttendancePromptActionCheckIn, working: isWorking)
                    } icon: {
                        Image(systemName: "checkmark.circle.fill")
                    }
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(isWorking)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            // Offered in every state: someone who drove past, or left early,
            // should be able to say so rather than wait to be asked.
            Button(L.autoAttendanceArrivalDecline, action: onDecline)
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                .disabled(isWorking)
        }
    }

    private var background: some View {
        ZStack(alignment: .topTrailing) {
            theme.palette.surface
            // A warm wash from the corner the church's logo sits in — enough
            // to lift this above the feed without competing with a live hero.
            RadialGradient(
                colors: [
                    theme.palette.brandAccentSoft.opacity(isReady ? 0.30 : 0.18),
                    theme.palette.brandAccentSoft.opacity(0),
                ],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 280
            )
        }
    }
}

// MARK: - Countdown ring

/// The time left, inside a ring that fills as the wait passes.
///
/// Minutes and seconds in tabular figures, rolling rather than flickering, and
/// read to VoiceOver as a sentence — "1 minute, 47 seconds left" — instead of
/// as punctuation.
struct CountdownRing: View {
    @Environment(\.faithformTheme) private var theme
    let remaining: TimeInterval
    let progress: Double

    private let size: CGFloat = 68
    private let line: CGFloat = 6

    var body: some View {
        ZStack {
            Circle()
                .stroke(theme.palette.surfaceSunken, lineWidth: line)
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(
                    AngularGradient(
                        colors: [theme.palette.brandAccentSoft, theme.palette.brandAccent],
                        center: .center,
                        startAngle: .degrees(0),
                        endAngle: .degrees(360 * max(0.001, progress))
                    ),
                    style: StrokeStyle(lineWidth: line, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(theme.animation(FaithFormTokens.Motion.deliberate), value: progress)

            Text(Self.clock(remaining))
                .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(theme.palette.contentPrimary)
                .contentTransition(.numericText(countsDown: true))
                .animation(theme.animation(FaithFormTokens.Motion.standard), value: Int(remaining.rounded(.up)))
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: L.autoAttendanceArrivalTimeLeft, Self.spoken(remaining)))
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// "1:47". Rounded up, so the ring never reads 0:00 while a second is
    /// still left.
    static func clock(_ remaining: TimeInterval) -> String {
        let total = Int(remaining.rounded(.up))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    static func spoken(_ remaining: TimeInterval) -> String {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = remaining >= 60 ? [.minute, .second] : [.second]
        return formatter.string(from: remaining.rounded(.up)) ?? clock(remaining)
    }
}

// MARK: - Beacon

/// A small location dot with a soft pulse while the phone is waiting — the
/// visual "we know you're here". Still under Reduce Motion.
private struct ArrivalBeacon: View {
    @Environment(\.faithformTheme) private var theme
    let active: Bool
    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(theme.palette.brandAccent.opacity(0.35))
                .frame(width: 18, height: 18)
                .scaleEffect(pulsing && active && !theme.reduceMotion ? 1.35 : 0.8)
                .opacity(pulsing && active && !theme.reduceMotion ? 0 : 1)
            Circle()
                .fill(theme.palette.brandAccent)
                .frame(width: 8, height: 8)
        }
        .frame(width: 18, height: 18)
        .animation(
            active && !theme.reduceMotion
                ? .easeOut(duration: 1.4).repeatForever(autoreverses: false)
                : .default,
            value: pulsing
        )
        .onAppear { pulsing = true }
        .accessibilityHidden(true)
    }
}
