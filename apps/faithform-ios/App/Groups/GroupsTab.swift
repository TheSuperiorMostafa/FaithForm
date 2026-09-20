import SwiftUI
import FaithFormKit

struct GroupsTabView: View {
    @Bindable var model: GroupsModel
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
                HStack {
                    Text("Groups").font(theme.font(FaithFormTokens.Text.titleMedium))
                    Spacer()
                    Button { preferences = true } label: {
                        Image(systemName: "bell").font(.title3).frame(width: 44, height: 44)
                    }.accessibilityLabel("Messaging preferences")
                }.foregroundStyle(theme.palette.contentPrimary).padding(.horizontal, 20)
                FaithFormPillSwitcher(selection: $section, options: sections.map { .init($0, title: $0) }, accessibilityLabel: "Groups section")
                    .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 14)
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
                                if section == "My groups" { ConversationListSkeleton() } else { GroupListSkeleton() }
                            }
                            else if displayed.isEmpty {
                                GroupEmpty(symbol: "person.3", title: section == "My groups" ? "Your next connection starts here" : "No groups found", message: section == "My groups" ? "Explore groups and find a place that feels like you." : "Try a different name or category.")
                                if section == "My groups" { Button("Discover groups") { section = "Discover" }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity) }
                            } else {
                                ForEach(displayed, id: \.id) { group in
                                    NavigationLink(value: group.id) {
                                        if section == "My groups" { GroupConversationRow(group: group) }
                                        else { GroupCard(group: group) }
                                    }.buttonStyle(.plain)
                                }
                                if section == "Discover", model.nextCursor != nil {
                                    Button("Show more groups") { Task { await model.discover(query: query, type: category, more: true) } }.frame(maxWidth: .infinity).disabled(model.loading)
                                }
                            }
                        }.padding(.horizontal, 20).padding(.bottom, 30)
                    }.refreshable { await refresh() }
                }
            }
            .background(theme.palette.background)
            .foregroundStyle(theme.palette.contentPrimary)
            .navigationTitle("Groups")
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in GroupPage(model: model, groupId: id, initialGroup: (model.home?.items ?? []).first { $0.id == id } ?? model.discovered.first { $0.id == id }).toolbar(.visible, for: .navigationBar) }
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

struct GroupCard: View {
    let group: GroupSummary
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GroupCoverView(url: group.coverImageUrl, name: group.name).frame(height: 144).clipped()
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(group.type?.name ?? "Community").font(.caption2.weight(.semibold)).foregroundStyle(theme.palette.contentSecondary)
                    Spacer()
                    if group.membershipState == "requested" { GroupBadge(text: "Request sent") }
                    else if group.status == "archived" { GroupBadge(text: "Archived") }
                    else if group.membershipState == "member" { GroupBadge(text: "Your group") }
                    else if group.isYouth { GroupBadge(text: "Youth group") }
                    else if group.enrollment == "open" { GroupBadge(text: "Open to join") }
                }
                Text(group.name).font(.title3.weight(.semibold))
                Label("\(group.memberCount) members", systemImage: "person.2").font(.caption).foregroundStyle(theme.palette.contentSecondary)
                if let schedule = group.scheduleText { Label(schedule, systemImage: "calendar").font(.caption).foregroundStyle(theme.palette.contentSecondary) }
                if let event = group.nextEvent { Divider(); Label("Next: \(groupDate(event.startsAt))", systemImage: "arrow.up.right").font(.caption.weight(.medium)) }
            }.padding(18)
        }.background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 22)).clipShape(RoundedRectangle(cornerRadius: 22)).overlay(RoundedRectangle(cornerRadius: 22).stroke(theme.palette.divider.opacity(0.65), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
struct GroupCoverView: View {
    let url: String?; let name: String
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        ZStack {
            LinearGradient(colors: [theme.palette.brandAccent.opacity(0.2), theme.palette.brandAccent.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: "person.3.sequence").font(.system(size: 42, weight: .ultraLight)).foregroundStyle(theme.palette.contentSecondary.opacity(0.65))
            if let url, let imageURL = URL(string: url) { AsyncImage(url: imageURL) { image in image.resizable().scaledToFill() } placeholder: { Color.clear } }
        }.accessibilityHidden(true)
    }
}
struct GroupBadge: View {
    let text: String
    @Environment(\.faithformTheme) private var theme
    var body: some View { Text(text).font(.caption2.weight(.semibold)).foregroundStyle(theme.palette.contentSecondary).padding(.horizontal, 10).padding(.vertical, 6).background(theme.palette.surfaceSunken, in: Capsule()) }
}
struct GroupEmpty: View {
    let symbol: String; let title: String; let message: String
    var body: some View { VStack(spacing: 14) { Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(.secondary).padding(18).background(.quaternary, in: RoundedRectangle(cornerRadius: 22)); Text(title).font(.title3.weight(.semibold)); Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center) }.frame(maxWidth: .infinity).padding(.vertical, 35).padding(.horizontal, 12) }
}
struct GroupFeedback: View {
    @Bindable var model: GroupsModel
    var body: some View {
        if let error = model.error { Label(error, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.orange).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)).accessibilityAddTraits(.updatesFrequently) }
        else if let feedback = model.feedback { Label(feedback, systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(.green).padding(12).accessibilityAddTraits(.updatesFrequently) }
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


/// Compact rows put every joined group's conversation within a single tap.
struct GroupConversationRow: View {
    let group: GroupSummary
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        HStack(spacing: 14) {
            GroupCoverView(url: group.coverImageUrl, name: group.name)
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 18))
            VStack(alignment: .leading, spacing: 6) {
                Text(group.name).font(.headline).foregroundStyle(theme.palette.contentPrimary)
                Text(group.chat == nil ? "\(group.memberCount) members" : "Open conversation · \(group.memberCount) members")
                    .font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(theme.palette.contentSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 22))
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
    var body: some View {
        FaithFormCard {
            VStack(spacing: 16) {
                GroupEmpty(symbol: "wifi.exclamationmark", title: "Let’s try that again", message: message)
                Button("Try again", action: retry).buttonStyle(.borderedProminent)
            }.frame(maxWidth: .infinity).padding(.bottom, 12)
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
