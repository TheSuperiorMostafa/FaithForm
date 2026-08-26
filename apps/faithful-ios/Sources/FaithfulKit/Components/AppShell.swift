import SwiftUI

/// The authenticated shell.
///
/// It shows exactly what the contract actually returns: who you are, which
/// churches you have a relationship with, and the account controls. There is no
/// tab for a feature that does not exist yet, and no placeholder row standing in
/// for content a later prompt will supply.
public struct AppShellView: View {
    @Environment(\.faithfulTheme) private var theme
    private let state: AppState
    private let registry: RouteRegistry
    private let onSignOut: @MainActor () -> Void
    private let onRequestDeletion: @MainActor () -> Void
    private let onRetry: @MainActor () -> Void

    public init(
        state: AppState,
        registry: RouteRegistry,
        onSignOut: @escaping @MainActor () -> Void,
        onRequestDeletion: @escaping @MainActor () -> Void,
        onRetry: @escaping @MainActor () -> Void
    ) {
        self.state = state
        self.registry = registry
        self.onSignOut = onSignOut
        self.onRequestDeletion = onRequestDeletion
        self.onRetry = onRetry
    }

    public var body: some View {
        NavigationStack {
            content
                .background(theme.palette.background)
                .navigationTitle(L.appName)
        }
        .faithfulTheme()
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            ProgressView()
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(Text(L.loadingAccount))

        case .signedOut:
            EmptyStateView(
                title: L.signInTitle,
                explanation: L.signInBody
            )

        case let .ready(bootstrap, isStale):
            ScrollView {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                    if isStale {
                        OfflineBanner(message: L.offlineCached)
                    }
                    profileCard(bootstrap)
                    churchesSection(bootstrap)
                    accountSection
                }
                .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
                .padding(.vertical, FaithfulTokens.Layout.screenPaddingVertical)
                .frame(maxWidth: FaithfulTokens.Layout.contentMaxWidth)
            }

        case .offlineNoCache:
            EmptyStateView(
                title: L.offlineTitle,
                explanation: L.offlineBody
            )

        case let .failed(message):
            VStack(spacing: FaithfulTokens.Spacing.base) {
                EmptyStateView(title: L.errorTitle, explanation: message)
                Button(L.tryAgain, action: onRetry)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal)
        }
    }

    private func profileCard(_ bootstrap: Bootstrap) -> some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                Text(bootstrap.profile.displayName ?? "Your account")
                    .font(theme.font(FaithfulTokens.Text.displayMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                if bootstrap.profile.status != .active {
                    StatusChip(statusText(bootstrap.profile.status), tone: .warning)
                }
            }
        }
    }

    @ViewBuilder
    private func churchesSection(_ bootstrap: Bootstrap) -> some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(L.yourChurches)
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.mutedContent)

            if bootstrap.relationships.isEmpty {
                EmptyStateView(
                    title: L.noChurchesTitle,
                    explanation: L.noChurchesBody
                )
            } else {
                ForEach(bootstrap.relationships, id: \.churchSlug) { relationship in
                    FaithfulCard {
                        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                            Text(relationship.churchName)
                                .font(theme.font(FaithfulTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                            StatusChip(
                                relationshipText(relationship.state),
                                tone: relationship.state == .blocked ? .danger : .neutral
                            )
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(L.account)
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.mutedContent)

            Button(L.signOut, action: onSignOut)
                .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))

            Button(L.deleteAccount, action: onRequestDeletion)
                .buttonStyle(FaithfulButtonStyle(kind: .destructive, theme: theme))
                .accessibilityHint(Text(L.deleteAccountHint))
        }
    }

    private func statusText(_ status: AccountStatus) -> String {
        switch status {
        case .active: return L.stateJoined
        case .deactivated: return L.stateLeft
        case .deletionRequested: return L.statePending
        case .deleted: return L.stateLeft
        case let .unknown(value): return value
        }
    }

    private func relationshipText(_ state: RelationshipState) -> String {
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
