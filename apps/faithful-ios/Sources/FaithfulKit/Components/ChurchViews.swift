import SwiftUI

/// The church profile someone reads before deciding to follow or join.
///
/// Editorial rather than dense: the church's own name and description lead,
/// then where and when it meets, then the one action worth taking. Only the
/// approved public projection is rendered — the contract carries nothing else.
public struct ChurchProfileView: View {
    @Environment(\.faithfulTheme) private var theme
    private let model: ChurchProfileModel
    private let slug: String
    private let onAcceptInvitation: @MainActor () -> Void

    public init(
        model: ChurchProfileModel,
        slug: String,
        onAcceptInvitation: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.slug = slug
        self.onAcceptInvitation = onAcceptInvitation
    }

    public var body: some View {
        ScrollView {
            content
                .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
                .padding(.vertical, FaithfulTokens.Spacing.base)
                .frame(maxWidth: FaithfulTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background)
        .refreshable { await model.refresh(slug: slug) }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VStack(spacing: FaithfulTokens.Spacing.md) {
                ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
            }
            .accessibilityLabel(Text(L.loadingAccount))

        case let .loaded(profile):
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                identity(profile)
                actionSection(profile)
                if !profile.campuses.isEmpty { campusSection(profile) }
                contactSection(profile)
            }

        case .notFound:
            // A hidden church and an unknown slug read identically here, on
            // purpose: the screen must not reveal which it was.
            EmptyStateView(title: L.noResultsTitle, explanation: L.noResultsBody)

        case .offline:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)

        case let .failed(message):
            VStack(spacing: FaithfulTokens.Spacing.base) {
                EmptyStateView(title: L.errorTitle, explanation: message)
                Button(L.tryAgain) { Task { await model.refresh(slug: slug) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
        }
    }

    private func identity(_ profile: ChurchProfile) -> some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
            Text(profile.name)
                .font(theme.font(FaithfulTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)

            if let tagline = profile.tagline, !tagline.isEmpty {
                Text(tagline)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.brandAccent)
            }

            if let summary = profile.publicSummary, !summary.isEmpty {
                Text(summary)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let state = profile.relationshipState {
                StatusChip(
                    Self.stateLabel(state),
                    tone: state == .blocked ? .danger : .neutral
                )
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func actionSection(_ profile: ChurchProfile) -> some View {
        let action = ChurchProfileModel.action(for: profile)

        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
            switch action {
            case .follow:
                Button(L.followChurch) { Task { await model.follow(slug: slug) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                    .disabled(model.isActing)

            case .joinImmediately:
                Button(L.joinChurch) { Task { await model.requestJoin(slug: slug) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                    .disabled(model.isActing)

            case .requestToJoin:
                Button(L.requestToJoin) { Task { await model.requestJoin(slug: slug) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                    .disabled(model.isActing)

            case .invitationRequired:
                Text(L.inviteOnlyExplainer)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                Button(L.acceptInvitation, action: onAcceptInvitation)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))

            case .pending:
                // A pending request does not stop someone following along.
                Text(L.pendingExplainer)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

            case .leave:
                Button(L.leaveChurch) { Task { await model.leave(slug: slug) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                    .disabled(model.isActing)

            case .unavailable:
                Text(L.blockedBody)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
            }

            if let error = model.actionError {
                Text(error)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.destructive)
            }
        }
    }

    private func campusSection(_ profile: ChurchProfile) -> some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(L.whereWeMeet)
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.mutedContent)

            ForEach(profile.campuses, id: \.slug) { campus in
                FaithfulCard {
                    VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                        HStack(spacing: FaithfulTokens.Spacing.sm) {
                            Text(campus.name)
                                .font(theme.font(FaithfulTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                            if campus.isPrimary { StatusChip(L.mainCampus) }
                        }

                        if let address = Self.addressLine(campus) {
                            Text(address)
                                .font(theme.font(FaithfulTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.contentSecondary)
                        }

                        // Service times are shown in the campus's own zone —
                        // "10am" means the church's ten, not the reader's.
                        ForEach(
                            profile.serviceTimes.filter { $0.campusSlug == campus.slug },
                            id: \.label
                        ) { service in
                            Text(Self.serviceLine(service))
                                .font(theme.font(FaithfulTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.brandAccent)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func contactSection(_ profile: ChurchProfile) -> some View {
        let rows: [(String, String)] = [
            profile.website.map { (L.websiteLabel, $0) },
            profile.phone.map { (L.phoneLabel, $0) },
            profile.email.map { (L.emailLabel, $0) },
        ].compactMap { $0 }

        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                Text(L.getInTouch)
                    .font(theme.font(FaithfulTokens.Text.label))
                    .foregroundStyle(theme.mutedContent)

                ForEach(rows, id: \.0) { label, value in
                    HStack {
                        Text(label)
                            .font(theme.font(FaithfulTokens.Text.caption))
                            .foregroundStyle(theme.mutedContent)
                        Spacer()
                        Text(value)
                            .font(theme.font(FaithfulTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentPrimary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    static func addressLine(_ campus: PublicCampus) -> String? {
        let parts = [campus.addressLine1, campus.city, campus.state, campus.postalCode]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// `dayOfWeek` is 0-based from Sunday, matching `church_service_times`.
    static func serviceLine(_ service: PublicServiceTime) -> String {
        let days = [
            L.sunday, L.monday, L.tuesday, L.wednesday,
            L.thursday, L.friday, L.saturday,
        ]
        let index = min(max(service.dayOfWeek, 0), 6)
        // Times arrive as HH:mm:ss; the seconds are never meaningful here.
        let time = String(service.startTime.prefix(5))
        return "\(days[index]) \(time) · \(service.label)"
    }

    static func stateLabel(_ state: RelationshipState) -> String {
        switch state {
        case .following: return L.stateFollowing
        case .pending: return L.statePending
        case .joined: return L.stateJoined
        case .left: return L.stateLeft
        case .blocked: return L.stateBlocked
        case let .unknown(value): return value
        }
    }
}

/// Choosing between the churches an account belongs to.
///
/// Presented as a sheet: switching church is a context change, not a
/// destination, and it should return you to where you were.
public struct ChurchChooserView: View {
    @Environment(\.faithfulTheme) private var theme
    private let model: ChurchChooserModel
    private let onSelected: @MainActor (ChurchChooserModel.SwitchResult) -> Void
    private let onAddAnother: @MainActor () -> Void

    public init(
        model: ChurchChooserModel,
        onSelected: @escaping @MainActor (ChurchChooserModel.SwitchResult) -> Void,
        onAddAnother: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.onSelected = onSelected
        self.onAddAnother = onAddAnother
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.base) {
            Text(L.chooseChurchTitle)
                .font(theme.font(FaithfulTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)

            content

            Button(L.addAnotherChurch, action: onAddAnother)
                .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
        }
        .padding(FaithfulTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
        .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ForEach(0..<2, id: \.self) { _ in SkeletonCard() }

        case let .loaded(churches):
            ScrollView {
                VStack(spacing: FaithfulTokens.Spacing.md) {
                    ForEach(churches, id: \.slug) { church in
                        row(church)
                    }
                }
            }

        case .empty:
            EmptyStateView(title: L.noChurchesTitle, explanation: L.noChurchesBody)

        case .offline:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)

        case let .failed(message):
            EmptyStateView(title: L.errorTitle, explanation: message)
        }
    }

    private func row(_ church: ChooserChurch) -> some View {
        // A blocked church is shown so its absence is not mysterious, but it
        // cannot be selected.
        let selectable = church.state != .blocked && church.state != .left
        let isSelected = church.slug == model.selectedSlug

        return Button {
            Task {
                if let result = await model.select(slug: church.slug) {
                    onSelected(result)
                }
            }
        } label: {
            FaithfulCard {
                HStack {
                    VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                        Text(church.name)
                            .font(theme.font(FaithfulTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                        StatusChip(
                            ChurchProfileView.stateLabel(church.state),
                            tone: church.state == .blocked ? .danger : .neutral
                        )
                    }
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark")
                            .foregroundStyle(theme.palette.brandAccent)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!selectable)
        .opacity(selectable ? 1 : 0.5)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
