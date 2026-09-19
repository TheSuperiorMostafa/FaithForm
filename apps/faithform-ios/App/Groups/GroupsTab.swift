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
                Picker("Groups section", selection: $section) { ForEach(sections, id: \.self) { Text($0).tag($0) } }
                    .pickerStyle(.segmented).padding(.horizontal, 20).padding(.bottom, 14)
                if section == "Messages" {
                    GroupMessagesView(model: model)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            if section == "My groups" {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("LIFE TOGETHER").font(.system(size: 10, weight: .bold)).tracking(2).foregroundStyle(theme.palette.brandAccent)
                                    Text("You belong here.").font(.system(size: 29, weight: .semibold, design: .rounded))
                                    Text("Familiar faces. Meaningful conversations. A place to grow, together.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary).lineSpacing(3)
                                }.padding(.vertical, 12)
                            } else {
                                Text("Find your people.").font(.system(size: 28, weight: .semibold, design: .rounded)).padding(.top, 12)
                                Text("There’s a place for you in this community.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                                TextField("Search for a group…", text: $query).textFieldStyle(.roundedBorder).accessibilityLabel("Search groups")
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
                            if model.loading { ProgressView("Finding your community…").frame(maxWidth: .infinity).padding(40) }
                            else if displayed.isEmpty {
                                GroupEmpty(symbol: "person.3", title: section == "My groups" ? "Your next connection starts here" : "No groups found", message: section == "My groups" ? "Explore groups and find a place that feels like you." : "Try a different name or category.")
                                if section == "My groups" { Button("Discover groups") { section = "Discover" }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity) }
                            } else {
                                ForEach(displayed, id: \.id) { group in
                                    NavigationLink(value: group.id) { GroupCard(group: group) }.buttonStyle(.plain)
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
            .navigationTitle("Groups")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { preferences = true } label: { Image(systemName: "slider.horizontal.3") }.accessibilityLabel("Messaging preferences") } }
            .navigationDestination(for: String.self) { id in GroupPage(model: model, groupId: id) }
            .sheet(isPresented: $preferences) { GroupPreferencesView(model: model) }
            .task { await model.load() }
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
    private func groupFilter(_ title: String, id: String) -> some View { Button(title) { category = id }.font(.caption.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 9).background(category == id ? theme.palette.brandAccent.opacity(0.18) : theme.palette.surface, in: Capsule()).foregroundStyle(theme.palette.contentPrimary) }
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
    var body: some View { Text(text).font(.system(size: 10, weight: .semibold)).padding(.horizontal, 9).padding(.vertical, 5).background(Color.primary.opacity(0.05), in: Capsule()) }
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
