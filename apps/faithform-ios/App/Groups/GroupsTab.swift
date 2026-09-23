import SwiftUI
import FaithFormKit

struct GroupsTabView: View {
    var root: RootModel? = nil
    @Bindable var model: GroupsModel
    var isStale: Bool = false
    @StateObject private var chat = GroupChatSession()
    @Environment(\.faithformTheme) private var theme
    @State private var section = "My groups"
    @State private var query = ""
    @State private var category = ""
    @State private var preferences = false
    private var sections: [String] { model.home?.directMessagesEnabled == true ? ["My groups", "Discover", "Messages"] : ["My groups", "Discover"] }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                FaithFormPillSwitcher(selection: $section, options: sections.map { .init($0, title: $0) }, accessibilityLabel: "Groups section")
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.vertical, FaithFormTokens.Spacing.sm)
                if section == "Messages" {
                    GroupMessagesView(model: model)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            if section == "My groups" {
                                if model.home?.items.isEmpty == true {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("LIFE TOGETHER").font(.system(size: 10, weight: .bold)).tracking(2).foregroundStyle(theme.palette.brandAccent)
                                        Text("You belong here.").font(.system(size: 29, weight: .semibold, design: .rounded))
                                        Text("Familiar faces. Meaningful conversations. A place to grow, together.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary).lineSpacing(3)
                                    }.padding(.vertical, 12)
                                }
                            } else {
                                Text("Find your people.").font(.system(size: 28, weight: .semibold, design: .rounded)).padding(.top, 12)
                                Text("There’s a place for you in this community.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                                FaithFormSearchField(placeholder: "Search groups", text: $query, onSubmit: {})
                                if let filters = model.filters, !filters.types.isEmpty {
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack {
                                            groupFilter("All groups", id: "")
                                            ForEach(filters.types, id: \.id) { groupFilter($0.name, id: $0.id) }
                                        }
                                    }
                                }
                            }
                            GroupFeedback(model: model)
                            if model.loading {
                                if section == "My groups" { MyGroupListSkeleton() } else { GroupListSkeleton() }
                            }
                            else if displayed.isEmpty {
                                FaithFormCard {
                                    VStack(spacing: 16) {
                                        GroupEmpty(
                                            symbol: section == "My groups" ? "person.3" : "magnifyingglass",
                                            title: section == "My groups" ? "Your next connection starts here" : "No groups found",
                                            message: section == "My groups" ? "Explore groups and find a place that feels like you." : "Try a different name or category."
                                        )
                                        if section == "My groups" {
                                            Button {
                                                section = "Discover"
                                            } label: {
                                                Label("Discover groups", systemImage: "sparkles")
                                            }
                                            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                                            .padding(.horizontal, 4)
                                            .padding(.bottom, 6)
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                            } else {
                                ForEach(displayed, id: \.id) { group in
                                    NavigationLink(value: GroupRoute.opening(group)) {
                                        if section == "My groups" { GroupConversationRow(group: group) }
                                        else { GroupCard(group: group) }
                                    }.buttonStyle(GroupPressStyle())
                                }
                                if section == "Discover", model.nextCursor != nil {
                                    Button("Show more groups") { Task { await model.discover(query: query, type: category, more: true) } }.frame(maxWidth: .infinity).disabled(model.loading)
                                }
                            }
                        }.padding(.horizontal, 20).padding(.bottom, 30)
                    }.refreshable { await refresh() }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .foregroundStyle(theme.palette.contentPrimary)
            .navigationTitle("Groups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        if let church = root?.selectedChurch {
                            ChurchAvatar(logoUrl: church.logoUrl, name: church.churchName, size: 28)
                            Text(church.churchName)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .lineLimit(1)
                        } else {
                            Text("Groups")
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { preferences = true } label: {
                        Image(systemName: "bell")
                    }
                    .foregroundStyle(theme.palette.contentPrimary)
                    .accessibilityLabel("Messaging preferences")
                }
            }
            .navigationDestination(for: GroupRoute.self) { route in
                groupDestination(route, model: model)
            }
            .sheet(isPresented: $preferences) { GroupPreferencesView(model: model) }
            .task { await model.load() }
            .task(id: model.home?.messagingAvailable) {
                if model.home?.messagingAvailable == true {
                    try? await chat.connect(model, theme: theme)
                }
            }
            .task(id: "\(section)|\(query)|\(category)") {
                if section == "Discover" {
                    do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation(); await model.discover(query: query, type: category) } catch {}
                }
            }
            .onChange(of: model.home?.directMessagesEnabled) { _, enabled in if enabled != true && section == "Messages" { section = "My groups" } }
        }.environmentObject(chat).onDisappear { chat.disconnect() }
    }
    private var displayed: [GroupSummary] { section == "Discover" ? model.discovered : model.home?.items ?? [] }
    private func refresh() async { await model.load(); if section == "Discover" { await model.discover(query: query, type: category) } }
    private func groupFilter(_ title: String, id: String) -> some View { Button(title) { category = id }.font(.caption.weight(.semibold)).padding(.horizontal, 14).frame(minHeight: 44).background(category == id ? theme.palette.brandAccent : theme.palette.surfaceSunken, in: Capsule()).foregroundStyle(category == id ? theme.palette.contentOnAccent : theme.palette.contentSecondary).accessibilityAddTraits(category == id ? .isSelected : []) }
}

/// Discovery cards lead with the group's square photo rather than a cropped
/// banner, so the logo arrives at the shape it was uploaded in.
struct GroupCard: View {
    let group: GroupSummary
    @Environment(\.faithformTheme) private var theme
    private var badge: String? {
        if group.membershipState == "requested" { return "Request sent" }
        if group.status == "archived" { return "Archived" }
        if group.membershipState == "member" { return "Your group" }
        if group.isYouth { return "Youth group" }
        if group.enrollment == "open" { return "Open to join" }
        return nil
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                GroupAvatarView(url: group.coverImageUrl, name: group.name, size: 64)
                VStack(alignment: .leading, spacing: 6) {
                    Text(group.type?.name ?? "Community")
                        .font(.caption2.weight(.semibold)).tracking(0.6).textCase(.uppercase)
                        .foregroundStyle(theme.palette.brandAccent)
                    Text(group.name).font(.title3.weight(.semibold)).lineLimit(2)
                    Text("\(group.memberCount) members")
                        .font(.caption).foregroundStyle(theme.palette.contentSecondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                if let badge { GroupBadge(text: badge) }
            }
            if let summary = group.summary, !summary.isEmpty {
                Text(summary).font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                    .lineLimit(2).lineSpacing(3)
            }
            if group.scheduleText != nil || group.locationName != nil || group.nextEvent != nil {
                Rectangle().fill(theme.palette.divider).frame(height: 1)
                VStack(alignment: .leading, spacing: 8) {
                    if let schedule = group.scheduleText { Label(schedule, systemImage: "calendar") }
                    if let place = group.locationName { Label(place, systemImage: "mappin.and.ellipse") }
                    if let event = group.nextEvent { Label("Next: \(groupDate(event.startsAt))", systemImage: "sparkles") }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(theme.palette.contentSecondary)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(theme.palette.border, lineWidth: theme.borderWidth))
        .shadow(color: theme.usesDecorativeShadow ? theme.palette.brandPrimary.opacity(0.06) : .clear, radius: 10, y: 4)
        .accessibilityElement(children: .combine)
    }
}
struct GroupBadge: View {
    let text: String
    @Environment(\.faithformTheme) private var theme
    var body: some View { Text(text).font(.caption2.weight(.semibold)).foregroundStyle(theme.palette.contentSecondary).padding(.horizontal, 10).padding(.vertical, 6).background(theme.palette.surfaceSunken, in: Capsule()) }
}
struct GroupEmpty: View {
    let symbol: String
    let title: String
    let message: String
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(theme.palette.brandAccent.opacity(0.12))
                    .frame(width: 64, height: 64)
                Image(systemName: symbol)
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(theme.palette.brandAccent)
            }
            .accessibilityHidden(true)

            VStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
            .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .accessibilityElement(children: .combine)
    }
}
struct GroupFeedback: View {
    @Bindable var model: GroupsModel
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        if let error = model.error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.orange).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)).accessibilityAddTraits(.updatesFrequently) }
        else if let feedback = model.feedback {
            Label(feedback, systemImage: "bell.badge.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.palette.contentPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(theme.palette.surfaceSunken, in: Capsule())
                .overlay(Capsule().strokeBorder(theme.palette.border, lineWidth: theme.borderWidth))
                .accessibilityAddTraits(.updatesFrequently)
                .task(id: feedback) {
                    try? await Task.sleep(for: .seconds(3))
                    guard !Task.isCancelled else { return }
                    model.feedback = nil
                }
        }
    }
}
func groupDate(_ raw: String) -> String {
    let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = parser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return raw }
    return date.formatted(date: .abbreviated, time: .shortened)
}

struct GroupPanelView<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.faithformTheme) private var theme
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            content
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(theme.palette.border, lineWidth: theme.borderWidth))
    }
}


/// One tap from the list to the conversation, with the group's own square
/// photo so a row is recognisable before its name is read.
struct GroupConversationRow: View {
    let group: GroupSummary
    @Environment(\.faithformTheme) private var theme
    private var subtitle: String {
        var parts = ["\(group.memberCount) members"]
        if let schedule = group.scheduleText { parts.append(schedule) }
        else if group.chat != nil { parts.append("Tap to chat") }
        return parts.joined(separator: " · ")
    }
    var body: some View {
        HStack(spacing: 14) {
            GroupAvatarView(url: group.coverImageUrl, name: group.name, size: 60)
            VStack(alignment: .leading, spacing: 5) {
                Text(group.name).font(.headline).foregroundStyle(theme.palette.contentPrimary).lineLimit(1)
                Text(subtitle)
                    .font(.subheadline).foregroundStyle(theme.palette.contentSecondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: group.chat == nil ? "chevron.right" : "bubble.left.and.bubble.right.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(group.chat == nil ? theme.palette.contentSecondary : theme.palette.brandAccent)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(theme.palette.border, lineWidth: theme.borderWidth))
        .accessibilityElement(children: .combine)
    }
}


struct GroupSectionHeading: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(eyebrow).font(.caption2.weight(.bold)).tracking(2).foregroundStyle(theme.palette.brandAccent)
            Text(title).font(theme.font(FaithFormTokens.Text.titleLarge)).foregroundStyle(theme.palette.contentPrimary)
            Text(subtitle).font(.subheadline).foregroundStyle(theme.palette.contentSecondary).lineSpacing(3)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
    }
}

struct GroupRetryCard: View {
    let message: String
    let retry: () -> Void
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        FaithFormCard {
            VStack(spacing: 16) {
                GroupEmpty(symbol: "wifi.exclamationmark", title: "Let’s try that again", message: message)
                Button("Try again", action: retry)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                    .padding(.horizontal, 4)
                    .padding(.bottom, 6)
            }.frame(maxWidth: .infinity)
        }
    }
}

struct GroupMemberAvatar: View {
    let name: String
    let url: String?
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        ZStack {
            Circle().fill(theme.palette.surfaceSunken)
            Text(name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased())
                .font(.headline).foregroundStyle(theme.palette.brandAccent)
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
            }
        }.frame(width: 48, height: 48).clipShape(Circle()).accessibilityHidden(true)
    }
}
