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
    @Environment(\.faithformTheme) private var theme
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
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    Text(L.autoAttendanceIntroTitle)
                        .font(theme.font(FaithFormTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                    Text(L.autoAttendanceIntroBody)
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                FaithFormCard {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                        Text(L.autoAttendancePrivacyTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)

                        ForEach(Self.privacyPoints, id: \.self) { point in
                            PrivacyPoint(text: point)
                        }
                    }
                }

                VStack(spacing: FaithFormTokens.Spacing.md) {
                    Button(L.autoAttendanceContinue, action: onContinue)
                        .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                    Button(L.autoAttendanceNotNow, action: onNotNow)
                        .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
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
    @Environment(\.faithformTheme) private var theme
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: FaithFormTokens.Spacing.sm) {
            // Decorative: the sentence carries the meaning, so VoiceOver reads
            // the text and never announces a bullet.
            Circle()
                .fill(theme.palette.brandPrimary)
                .frame(width: 6, height: 6)
                .padding(.top, 7)
                .accessibilityHidden(true)

            Text(text)
                .font(theme.font(FaithFormTokens.Text.body))
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
    @Environment(\.faithformTheme) private var theme

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
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Spacer(minLength: FaithFormTokens.Spacing.xl)

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(message)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            VStack(spacing: FaithFormTokens.Spacing.md) {
                Button(action: onContinue) {
                    FaithFormWorkingLabel(actionTitle, working: isWorking)
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(isWorking)

                Button(L.autoAttendanceNotNow, action: onNotNow)
                    .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                    .disabled(isWorking)
            }
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithFormTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.palette.background)
    }
}

// MARK: - Status

/// Everything the status screen shows, as plain values.
///
/// Built from `AutomaticAttendanceModel.status`, or directly — which is what
/// lets a test render every state without a device.
public struct AutomaticAttendanceStatus: Equatable, Sendable {
    public var step: AutomaticAttendanceStep
    public var isEnabled: Bool
    public var monitoredRegionCount: Int
    public var watchedChurchNames: [String]
    public var churchName: String?
    public var churchBlocker: AutomaticAttendanceBlocker?
    public var notificationsOff: Bool
    public var nextService: AutomaticAttendanceModel.UpcomingService?
    public var lastCheckIn: AutomaticAttendanceModel.RecentCheckIn?
    public var pending: PendingArrival?
    public var isWorking: Bool
    public var now: Date

    public init(
        step: AutomaticAttendanceStep,
        isEnabled: Bool,
        monitoredRegionCount: Int = 0,
        watchedChurchNames: [String] = [],
        churchName: String? = nil,
        churchBlocker: AutomaticAttendanceBlocker? = nil,
        notificationsOff: Bool = false,
        nextService: AutomaticAttendanceModel.UpcomingService? = nil,
        lastCheckIn: AutomaticAttendanceModel.RecentCheckIn? = nil,
        pending: PendingArrival? = nil,
        isWorking: Bool = false,
        now: Date = Date()
    ) {
        self.step = step
        self.isEnabled = isEnabled
        self.monitoredRegionCount = monitoredRegionCount
        self.watchedChurchNames = watchedChurchNames
        self.churchName = churchName
        self.churchBlocker = churchBlocker
        self.notificationsOff = notificationsOff
        self.nextService = nextService
        self.lastCheckIn = lastCheckIn
        self.pending = pending
        self.isWorking = isWorking
        self.now = now
    }
}

extension AutomaticAttendanceModel {
    /// The status screen's values, now.
    public var status: AutomaticAttendanceStatus {
        AutomaticAttendanceStatus(
            step: step,
            isEnabled: isEnabled,
            monitoredRegionCount: monitoredRegionCount,
            watchedChurchNames: watchedChurchNames,
            churchName: selectedChurch?.name,
            churchBlocker: selectedChurchBlocker,
            // Only worth saying when a church may ask. Denied is the one
            // state in which the question can never be delivered.
            notificationsOff: notificationStatus == .denied,
            nextService: nextService,
            lastCheckIn: lastCheckIn,
            pending: pending,
            isWorking: isWorking,
            now: Date()
        )
    }
}

/// Where automatic check-in currently stands, and what to do about it.
///
/// Every blocked state is a real one the system can produce, and each carries
/// its own explanation and its own action — a Settings link only where Settings
/// would actually help, and "Turn off" whenever the feature is on, including
/// when it cannot run.
///
/// Not a scroll view: the Check in tab places it inside its own.
public struct AutomaticAttendanceStatusView: View {
    @Environment(\.faithformTheme) private var theme

    private let status: AutomaticAttendanceStatus
    private let onSetUp: @MainActor () -> Void
    private let onResumeSetup: @MainActor () -> Void
    private let onConfirm: @MainActor () -> Void
    private let onDisable: @MainActor () -> Void
    private let onOpenSettings: @MainActor () -> Void

    public init(
        status: AutomaticAttendanceStatus,
        onSetUp: @escaping @MainActor () -> Void,
        onResumeSetup: @escaping @MainActor () -> Void,
        onConfirm: @escaping @MainActor () -> Void,
        onDisable: @escaping @MainActor () -> Void,
        onOpenSettings: @escaping @MainActor () -> Void
    ) {
        self.status = status
        self.onSetUp = onSetUp
        self.onResumeSetup = onResumeSetup
        self.onConfirm = onConfirm
        self.onDisable = onDisable
        self.onOpenSettings = onOpenSettings
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            header
            if let pending = status.pending, status.isEnabled {
                PendingArrivalCard(
                    pending: pending,
                    now: status.now,
                    isWorking: status.isWorking,
                    onConfirm: onConfirm
                )
            }
            if status.notificationsOff, status.isEnabled {
                notificationsCard
            }
            details
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var header: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    StatusChip(chipText, tone: chipTone)
                    Spacer()
                }

                Text(title)
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(explanation)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if case .ready = status.step, !status.watchedChurchNames.isEmpty {
                    Text(String(format: L.autoAttendanceWatchingChurches, Self.list(status.watchedChurchNames)))
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if case .ready = status.step, status.monitoredRegionCount > 0 {
                    Text(
                        status.monitoredRegionCount == 1
                            ? String(format: L.autoAttendanceWatching, status.monitoredRegionCount)
                            : String(format: L.autoAttendanceWatchingPlural, status.monitoredRegionCount)
                    )
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
                }

                if status.isEnabled, let blocker = status.churchBlocker, case .ready = status.step {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                        Text(String(format: L.autoAttendanceNotAtThisChurch, status.churchName ?? L.autoAttendanceYourChurch))
                            .font(theme.font(FaithFormTokens.Text.label))
                            .foregroundStyle(theme.palette.contentPrimary)
                        Text(Self.explanation(for: blocker))
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        // One announcement rather than fragments, so VoiceOver reads the state
        // as a sentence.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(L.autoAttendanceStatusLabel): \(title). \(explanation)")
    }

    private var notificationsCard: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(L.autoAttendanceNotificationsOffTitle)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(L.autoAttendanceNotificationsOffBody)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(L.autoAttendanceOpenSettings, action: onOpenSettings)
                    .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
            }
        }
    }

    @ViewBuilder
    private var details: some View {
        if status.isEnabled, status.nextService != nil || status.lastCheckIn != nil {
            FaithFormCard {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    if let next = status.nextService {
                        DetailRow(
                            caption: nil,
                            text: next.isOpen
                                ? String(format: L.autoAttendanceServiceOpen, next.label)
                                : String(format: L.autoAttendanceNextService, Self.describe(next))
                        )
                    }
                    if let recent = status.lastCheckIn {
                        DetailRow(
                            caption: L.autoAttendanceRecentTitle,
                            text: String(
                                format: recent.wasAlreadyCounted
                                    ? L.autoAttendanceRecentAlready
                                    : L.autoAttendanceRecentCounted,
                                Self.describe(recent)
                            )
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            switch status.step {
            case .ready:
                disableButton

            case .notStarted, .introduction, .foregroundEducation, .backgroundEducation, .notificationEducation:
                Button(L.autoAttendanceEnable, action: onSetUp)
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                    .disabled(status.isWorking)

            case .requestingConsent:
                FaithFormWorkingLabel(L.autoAttendanceSaving, working: true)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .accessibilityLabel(L.autoAttendanceSaving)

            case .blocked(let blocker):
                if blocker.isRecoverableInSettings {
                    Button(L.autoAttendanceOpenSettings, action: onOpenSettings)
                        .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                } else if blocker.isRecoverableInSetup {
                    Button(L.autoAttendanceContinueSetup, action: onResumeSetup)
                        .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                }
                // A restricted device, a church that has not enabled the
                // feature, or a missing People link are states the person
                // cannot fix here — so no button is offered that would do
                // nothing. Turning it off always does something.
                if status.isEnabled {
                    disableButton
                }
            }
        }
    }

    private var disableButton: some View {
        Button(L.autoAttendanceDisable, action: onDisable)
            .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            .disabled(status.isWorking)
    }

    private var chipText: String {
        switch status.step {
        case .ready: return L.autoAttendanceOn
        case .requestingConsent: return L.autoAttendanceSaving
        default: return status.isEnabled ? L.autoAttendanceOn : L.autoAttendanceOff
        }
    }

    private var chipTone: StatusChip.Tone {
        switch status.step {
        case .ready: return .success
        case .blocked: return status.isEnabled ? .warning : .neutral
        default: return .neutral
        }
    }

    private var title: String {
        switch status.step {
        case .ready: return L.autoAttendanceReadyTitle
        case .requestingConsent: return L.autoAttendanceSaving
        case .blocked(let blocker): return Self.title(for: blocker)
        default: return L.autoAttendanceOffTitle
        }
    }

    private var explanation: String {
        switch status.step {
        case .ready: return L.autoAttendanceReadyBody
        case .requestingConsent: return L.autoAttendanceIntroBody
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
        case .locationNotRequested: return L.autoAttendanceNeedsPermissionTitle
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
        case .locationNotRequested: return L.autoAttendanceNeedsPermissionBody
        }
    }

    static func list(_ names: [String]) -> String {
        ListFormatter.localizedString(byJoining: names)
    }

    static func describe(_ service: AutomaticAttendanceModel.UpcomingService) -> String {
        guard let startsAt = service.startsAt else { return service.label }
        let when = startsAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        return "\(service.label), \(when)"
    }

    static func describe(_ recent: AutomaticAttendanceModel.RecentCheckIn) -> String {
        let when = recent.countedAt.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        return "\(recent.occurrenceLabel), \(when)"
    }
}

private struct DetailRow: View {
    @Environment(\.faithformTheme) private var theme
    let caption: String?
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
            if let caption {
                Text(caption)
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
            Text(text)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// An arrival waiting on a verdict.
///
/// Says what happens next and offers "Check in" only when the church asks and
/// the moment has come — never an encouraging state that reads as done.
private struct PendingArrivalCard: View {
    @Environment(\.faithformTheme) private var theme
    let pending: PendingArrival
    let now: Date
    let isWorking: Bool
    let onConfirm: @MainActor () -> Void

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                Text(AttendanceNotificationContent.arrivalTitle(churchName: pending.churchName ?? ""))
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if pending.canConfirm(now: now) {
                    Button(action: onConfirm) {
                        FaithFormWorkingLabel(L.autoAttendancePromptActionCheckIn, working: isWorking)
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                    .disabled(isWorking)
                } else {
                    Text(
                        pending.isQueued
                            ? L.autoAttendanceOfflineBody
                            : pending.needsPersonConfirmation
                                ? L.autoAttendancePendingWaitingBody
                                : L.autoAttendancePendingAutomaticBody
                    )
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// The most recent server verdict.
///
/// Shown only when the server actually returned one. `already_counted` reads as
/// a success and not as an error, because it is one — someone was counted at
/// the door a moment before their phone noticed.
public struct AutomaticAttendanceRecentView: View {
    @Environment(\.faithformTheme) private var theme
    private let recent: AutomaticAttendanceModel.RecentCheckIn

    public init(recent: AutomaticAttendanceModel.RecentCheckIn) {
        self.recent = recent
    }

    public var body: some View {
        DetailRow(
            caption: L.autoAttendanceRecentTitle,
            text: String(
                format: recent.wasAlreadyCounted ? L.autoAttendanceRecentAlready : L.autoAttendanceRecentCounted,
                AutomaticAttendanceStatusView.describe(recent)
            )
        )
    }
}

// MARK: - The whole journey

/// Setup and status in one place: the introduction, consent, each permission
/// explained before its prompt, then where it stands.
///
/// Shown from the Check in tab and from Account, in a sheet. Nothing here
/// raises a prompt on its own — every button reports an intent to the model,
/// which is the only thing that asks.
public struct AutomaticAttendanceFlowView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: AutomaticAttendanceModel
    private let onOpenSettings: @MainActor () -> Void
    private let onClose: @MainActor () -> Void

    public init(
        model: AutomaticAttendanceModel,
        onOpenSettings: @escaping @MainActor () -> Void,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.onOpenSettings = onOpenSettings
        self.onClose = onClose
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.palette.background)
            .task(id: model.pending?.promptAt) {
                // An open screen is execution time of its own.
                await model.holdOpenUntilDue()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.step {
        case .introduction:
            AutomaticAttendanceIntroView(
                onContinue: { Task { await model.acceptIntroduction() } },
                onNotNow: {
                    Task {
                        await model.notNow()
                        onClose()
                    }
                }
            )

        case .requestingConsent:
            VStack(spacing: FaithFormTokens.Spacing.md) {
                FaithFormWorkingLabel(L.autoAttendanceSaving, working: true)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
            .accessibilityElement(children: .combine)

        case .foregroundEducation:
            LocationPermissionEducationView(
                title: L.autoAttendanceForegroundTitle,
                message: L.autoAttendanceForegroundBody,
                actionTitle: L.autoAttendanceContinue,
                isWorking: model.isWorking,
                onContinue: { Task { await model.requestForegroundPermission() } },
                onNotNow: {
                    Task {
                        await model.notNow()
                        onClose()
                    }
                }
            )

        case .backgroundEducation:
            LocationPermissionEducationView(
                title: L.autoAttendanceBackgroundTitle,
                message: L.autoAttendanceBackgroundBody,
                actionTitle: L.autoAttendanceContinue,
                isWorking: model.isWorking,
                onContinue: { Task { await model.requestBackgroundPermission() } },
                onNotNow: {
                    Task {
                        await model.notNow()
                        onClose()
                    }
                }
            )

        case .notificationEducation:
            LocationPermissionEducationView(
                title: L.autoAttendanceNotificationTitle,
                message: L.autoAttendanceNotificationBody,
                actionTitle: L.autoAttendanceContinue,
                isWorking: model.isWorking,
                onContinue: { Task { await model.requestNotificationPermission() } },
                // Location is already given; this only skips notifications.
                onNotNow: { Task { await model.notNow() } }
            )

        case .notStarted, .ready, .blocked:
            ScrollView {
                AutomaticAttendanceStatusView(
                    status: model.status,
                    onSetUp: { model.begin() },
                    onResumeSetup: { Task { await model.resumeSetup() } },
                    onConfirm: { Task { await model.confirmCheckIn() } },
                    onDisable: { Task { await model.disable() } },
                    onOpenSettings: onOpenSettings
                )
                .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(.vertical, FaithFormTokens.Spacing.xl)
            }
        }
    }
}
