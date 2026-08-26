import SwiftUI

/// The automatic-attendance experience.
///
/// One screen per step, in the order the person meets them. Nothing here can
/// raise an operating-system prompt on its own: each view reports an intent
/// upward, and `AutomaticAttendanceModel` is the only thing that asks. That is
/// what makes "never prompt at launch" a property of the structure rather than
/// a rule someone has to remember.

// MARK: - Introduction

/// What automatic check-in is, before anything is requested.
///
/// The privacy explanation is on this screen rather than behind a link, because
/// a person deciding whether to share their location deserves to read what
/// happens to it in the same breath as the offer.
public struct AutomaticAttendanceIntroView: View {
    @Environment(\.faithfulTheme) private var theme
    private let onContinue: @MainActor () -> Void
    private let onNotNow: @MainActor () -> Void

    public init(
        onContinue: @escaping @MainActor () -> Void,
        onNotNow: @escaping @MainActor () -> Void
    ) {
        self.onContinue = onContinue
        self.onNotNow = onNotNow
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                    Text(L.autoAttendanceIntroTitle)
                        .font(theme.font(FaithfulTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                    Text(L.autoAttendanceIntroBody)
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                FaithfulCard {
                    VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                        Text(L.autoAttendancePrivacyTitle)
                            .font(theme.font(FaithfulTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)

                        ForEach(Self.privacyPoints, id: \.self) { point in
                            PrivacyPoint(text: point)
                        }
                    }
                }

                VStack(spacing: FaithfulTokens.Spacing.md) {
                    Button(L.autoAttendanceContinue, action: onContinue)
                        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                    Button(L.autoAttendanceNotNow, action: onNotNow)
                        .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
                }
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
    }

    static var privacyPoints: [String] {
        [
            L.autoAttendancePrivacyPointOne,
            L.autoAttendancePrivacyPointTwo,
            L.autoAttendancePrivacyPointThree,
            L.autoAttendancePrivacyPointFour,
        ]
    }
}

private struct PrivacyPoint: View {
    @Environment(\.faithfulTheme) private var theme
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: FaithfulTokens.Spacing.sm) {
            // Decorative: the sentence carries the meaning, so VoiceOver reads
            // the text and never announces a bullet.
            Circle()
                .fill(theme.palette.brandPrimary)
                .frame(width: 6, height: 6)
                .padding(.top, 7)
                .accessibilityHidden(true)

            Text(text)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Permission education

/// Why a location permission is needed, shown *before* the OS prompt.
///
/// Used for both steps. Deliberately one component: the foreground and
/// background explanations differ in copy, not in structure, and having two
/// near-identical views would let them drift.
public struct LocationPermissionEducationView: View {
    @Environment(\.faithfulTheme) private var theme

    private let title: String
    private let message: String
    private let actionTitle: String
    private let isWorking: Bool
    private let onContinue: @MainActor () -> Void
    private let onNotNow: @MainActor () -> Void

    public init(
        title: String,
        message: String,
        actionTitle: String,
        isWorking: Bool = false,
        onContinue: @escaping @MainActor () -> Void,
        onNotNow: @escaping @MainActor () -> Void
    ) {
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.isWorking = isWorking
        self.onContinue = onContinue
        self.onNotNow = onNotNow
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Spacer(minLength: FaithfulTokens.Spacing.xl)

            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(title)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(message)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            VStack(spacing: FaithfulTokens.Spacing.md) {
                Button(action: onContinue) {
                    if isWorking {
                        ProgressView().tint(theme.palette.contentInverse)
                    } else {
                        Text(actionTitle)
                    }
                }
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                .disabled(isWorking)

                Button(L.autoAttendanceNotNow, action: onNotNow)
                    .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
                    .disabled(isWorking)
            }
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithfulTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.palette.background)
    }
}

// MARK: - Readiness

/// Where automatic check-in currently stands, and what to do about it.
///
/// Every blocked state is a real one the system can produce, and each carries
/// its own explanation and its own action — a Settings link only where Settings
/// would actually help.
public struct AutomaticAttendanceStatusView: View {
    @Environment(\.faithfulTheme) private var theme

    private let step: AutomaticAttendanceStep
    private let monitoredRegionCount: Int
    private let recent: AutomaticAttendanceModel.RecentCheckIn?
    private let isWorking: Bool
    private let onSetUp: @MainActor () -> Void
    private let onDisable: @MainActor () -> Void
    private let onOpenSettings: @MainActor () -> Void

    public init(
        step: AutomaticAttendanceStep,
        monitoredRegionCount: Int,
        recent: AutomaticAttendanceModel.RecentCheckIn?,
        isWorking: Bool,
        onSetUp: @escaping @MainActor () -> Void,
        onDisable: @escaping @MainActor () -> Void,
        onOpenSettings: @escaping @MainActor () -> Void
    ) {
        self.step = step
        self.monitoredRegionCount = monitoredRegionCount
        self.recent = recent
        self.isWorking = isWorking
        self.onSetUp = onSetUp
        self.onDisable = onDisable
        self.onOpenSettings = onOpenSettings
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                header
                if let recent { RecentCheckInCard(recent: recent) }
                actions
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
    }

    @ViewBuilder
    private var header: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                HStack(spacing: FaithfulTokens.Spacing.sm) {
                    StatusChip(chipText, tone: chipTone)
                    Spacer()
                }

                Text(title)
                    .font(theme.font(FaithfulTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)

                Text(explanation)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if case .ready = step, monitoredRegionCount > 0 {
                    Text(
                        monitoredRegionCount == 1
                            ? String(format: L.autoAttendanceWatching, monitoredRegionCount)
                            : String(format: L.autoAttendanceWatchingPlural, monitoredRegionCount)
                    )
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
                }
            }
        }
        // One announcement rather than four fragments, so VoiceOver reads the
        // state as a sentence.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(L.autoAttendanceStatusLabel): \(title). \(explanation)")
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: FaithfulTokens.Spacing.md) {
            switch step {
            case .ready:
                Button(L.autoAttendanceDisable, action: onDisable)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                    .disabled(isWorking)

            case .notStarted, .introduction, .foregroundEducation, .backgroundEducation:
                Button(L.autoAttendanceEnable, action: onSetUp)
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                    .disabled(isWorking)

            case .requestingConsent:
                ProgressView()
                    .accessibilityLabel(L.autoAttendanceChecking)

            case .blocked(let blocker):
                if blocker.isRecoverableInSettings {
                    Button(L.autoAttendanceOpenSettings, action: onOpenSettings)
                        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                }
                // A restricted device, a church that has not enabled the
                // feature, or a missing People link are all states the person
                // cannot fix here — so no button is offered that would do
                // nothing.
            }
        }
    }

    private var chipText: String {
        switch step {
        case .ready: return L.autoAttendanceReadyTitle
        case .requestingConsent: return L.autoAttendanceChecking
        case .blocked: return L.autoAttendanceOffTitle
        default: return L.autoAttendanceOffTitle
        }
    }

    private var chipTone: StatusChip.Tone {
        switch step {
        case .ready: return .success
        case .blocked: return .warning
        default: return .neutral
        }
    }

    private var title: String {
        switch step {
        case .ready: return L.autoAttendanceReadyTitle
        case .requestingConsent: return L.autoAttendanceChecking
        case .blocked(let blocker): return Self.title(for: blocker)
        default: return L.autoAttendanceOffTitle
        }
    }

    private var explanation: String {
        switch step {
        case .ready: return L.autoAttendanceReadyBody
        case .requestingConsent: return L.autoAttendanceReadyBody
        case .blocked(let blocker): return Self.explanation(for: blocker)
        default: return L.autoAttendanceOffBody
        }
    }

    /// Exposed so a test can assert every blocker has real, distinct copy —
    /// and that none of them falls through to a generic message.
    public static func title(for blocker: AutomaticAttendanceBlocker) -> String {
        switch blocker {
        case .locationDenied: return L.autoAttendanceDeniedTitle
        case .locationRestricted: return L.autoAttendanceRestrictedTitle
        case .locationServicesOff: return L.autoAttendanceServicesOffTitle
        case .needsAlwaysAuthorization: return L.autoAttendanceAlwaysTitle
        case .reducedAccuracy: return L.autoAttendanceAccuracyTitle
        case .monitoringUnavailable: return L.autoAttendanceUnavailableTitle
        case .noPeopleLink: return L.autoAttendanceNoLinkTitle
        case .consentMissing: return L.autoAttendanceConsentMissingTitle
        case .churchDisabled: return L.autoAttendanceChurchDisabledTitle
        case .noCampus: return L.autoAttendanceNoCampusTitle
        case .unavailable: return L.autoAttendanceOfflineTitle
        }
    }

    public static func explanation(for blocker: AutomaticAttendanceBlocker) -> String {
        switch blocker {
        case .locationDenied: return L.autoAttendanceDeniedBody
        case .locationRestricted: return L.autoAttendanceRestrictedBody
        case .locationServicesOff: return L.autoAttendanceServicesOffBody
        case .needsAlwaysAuthorization: return L.autoAttendanceAlwaysBody
        case .reducedAccuracy: return L.autoAttendanceAccuracyBody
        case .monitoringUnavailable: return L.autoAttendanceUnavailableBody
        case .noPeopleLink: return L.autoAttendanceNoLinkBody
        case .consentMissing: return L.autoAttendanceConsentMissingBody
        case .churchDisabled: return L.autoAttendanceChurchDisabledBody
        case .noCampus: return L.autoAttendanceNoCampusBody
        case .unavailable: return L.autoAttendanceOfflineBody
        }
    }
}

/// The most recent server verdict.
///
/// Shown only when the server actually returned one. `already_counted` reads as
/// a success and not as an error, because it is one — someone was counted at
/// the door a moment before their phone noticed.
private struct RecentCheckInCard: View {
    @Environment(\.faithfulTheme) private var theme
    let recent: AutomaticAttendanceModel.RecentCheckIn

    var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                Text(L.autoAttendanceRecentTitle)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)

                Text(
                    String(
                        format: recent.wasAlreadyCounted
                            ? L.autoAttendanceRecentAlready
                            : L.autoAttendanceRecentCounted,
                        recent.occurrenceLabel
                    )
                )
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
