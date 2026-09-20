import SwiftUI
import FaithFormKit

/// Every group surface is a real push on the navigation stack.
///
/// Sections used to swap inside a single screen, so opening a group changed
/// its content with no transition and the system back button pointed at
/// whichever section happened to be showing. Routing them gives each screen
/// the standard slide animation and a back button that goes where the person
/// actually came from: list → chat → group info → events or members.
enum GroupRoute: Hashable {
    case chat(GroupSummary)
    case info(groupId: String, fromChat: Bool)
    case events(GroupDetail)
    case members(GroupDetail)
    case requests(String)

    /// A joined group opens straight into its conversation, because that is
    /// what people come back for. Everyone else meets the group first.
    static func opening(_ group: GroupSummary) -> GroupRoute {
        group.membershipState == "member" && group.chat != nil
            ? .chat(group)
            : .info(groupId: group.id, fromChat: false)
    }
}

@MainActor @ViewBuilder
func groupDestination(_ route: GroupRoute, model: GroupsModel) -> some View {
    switch route {
    case .chat(let group): GroupChatScreen(model: model, group: group)
    case .info(let groupId, let fromChat): GroupInfoScreen(model: model, groupId: groupId, fromChat: fromChat)
    case .events(let detail): GroupEventsView(model: model, detail: detail)
    case .members(let detail): GroupMembersView(model: model, detail: detail)
    case .requests(let groupId): GroupRequestsView(model: model, groupId: groupId)
    }
}

/// The group photo is a square logo everywhere it appears — the same crop in
/// a 40pt toolbar as in a 108pt header, so it never arrives stretched.
struct GroupAvatarView: View {
    let url: String?
    let name: String
    var size: CGFloat = 56
    var corner: CGFloat? = nil
    @Environment(\.faithformTheme) private var theme

    private var radius: CGFloat { corner ?? size * 0.3 }
    private var initials: String {
        let letters = name.split(whereSeparator: { $0 == " " || $0 == "-" }).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "•" : String(letters).uppercased()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.palette.brandAccent.opacity(0.32), theme.palette.brandAccentSoft.opacity(0.16)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(initials)
                .font(.system(size: size * 0.34, weight: .semibold, design: .rounded))
                .foregroundStyle(theme.palette.contentPrimary.opacity(0.75))
                .minimumScaleFactor(0.6)
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL, transaction: Transaction(animation: theme.animation(FaithFormTokens.Motion.standard))) { phase in
                    if let image = phase.image { image.resizable().scaledToFill().transition(.opacity) }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
        )
        .accessibilityHidden(true)
    }
}

/// The same square photo, blurred far past recognition, so a header reads as
/// the group's own colour without ever cropping the logo to a banner shape.
struct GroupAvatarBackdrop: View {
    let url: String?
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        ZStack {
            theme.palette.background
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { image in
                    image.resizable().scaledToFill().blur(radius: 48, opaque: false).opacity(0.38)
                } placeholder: { Color.clear }
            } else {
                LinearGradient(
                    colors: [theme.palette.brandAccent.opacity(0.18), theme.palette.background],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            LinearGradient(
                colors: [theme.palette.background.opacity(0.1), theme.palette.background],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// Rows and cards answer the finger before the push begins.
struct GroupPressStyle: ButtonStyle {
    @Environment(\.faithformTheme) private var theme
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(theme.animation(FaithFormTokens.Motion.fast), value: configuration.isPressed)
    }
}

/// One tile per destination, so events and members are places you go rather
/// than tabs buried inside the group's story.
struct GroupActionTile: View {
    let symbol: String
    let title: String
    var detail: String? = nil
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(theme.palette.brandAccent)
                .frame(width: 44, height: 44)
                .background(theme.palette.surfaceSunken, in: Circle())
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.contentPrimary)
            if let detail {
                Text(detail).font(.caption2).foregroundStyle(theme.palette.contentSecondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 104)
        .padding(.vertical, 12)
        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
        )
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(detail.map { "\(title), \($0)" } ?? title)
    }
}

/// A labelled row inside a card — used for the manage actions, which are
/// list-like and should not each become a differently shaped button.
struct GroupActionRow: View {
    let symbol: String
    let title: String
    var detail: String? = nil
    var isDestructive = false
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(isDestructive ? theme.palette.destructive : theme.palette.brandAccent)
                .frame(width: 34, height: 34)
                .background(theme.palette.surfaceSunken, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            Text(title)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(isDestructive ? theme.palette.destructive : theme.palette.contentPrimary)
            Spacer(minLength: 8)
            if let detail { Text(detail).font(.caption).foregroundStyle(theme.palette.contentSecondary) }
            Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(theme.palette.contentSecondary)
        }
        .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
