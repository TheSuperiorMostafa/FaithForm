import SwiftUI
import FaithFormKit

/// The conversation is the group's front door.
///
/// It pushes from the list like any other screen, and its title bar is the way
/// into the group itself — tapping it pushes group info, so the back button
/// there returns to the conversation instead of replacing it.
struct GroupChatScreen: View {
    @Bindable var model: GroupsModel
    let group: GroupSummary
    @Environment(\.faithformTheme) private var theme
    @State private var preferences = false

    private var readOnly: Bool {
        guard let chat = group.chat else { return true }
        return chat.state != "ready" || (chat.postingPolicy == "leaders" && group.groupRole == "member")
    }

    var body: some View {
        Group {
            if let chat = group.chat {
                GroupConversationView(model: model, cid: chat.cid, title: group.name, readOnly: readOnly)
            } else {
                GroupEmpty(symbol: "bubble.left.and.bubble.right", title: "No conversation yet", message: "This group's conversation isn't open. You'll find everything else in group info.")
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                NavigationLink(value: GroupRoute.info(groupId: group.id, fromChat: true)) {
                    HStack(spacing: 9) {
                        GroupAvatarView(url: group.coverImageUrl, name: group.name, size: 32)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(group.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text("\(group.memberCount) members")
                                .font(.caption2).foregroundStyle(theme.palette.contentSecondary)
                        }
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                    .foregroundStyle(theme.palette.contentPrimary)
                    .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
                    .contentShape(Rectangle())
                }
                .buttonStyle(GroupPressStyle())
                .accessibilityLabel("\(group.name), \(group.memberCount) members")
                .accessibilityHint("Opens group info, events and members")
                .accessibilityIdentifier("group-info-header")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { preferences = true } label: { Image(systemName: "bell") }
                    .accessibilityLabel("Group notifications")
            }
        }
        .sheet(isPresented: $preferences) { GroupPreferencesView(model: model, groupId: group.id) }
    }
}

/// Everything the group *is*: who it's for, when it meets, who leads it — plus
/// the doors to its gatherings and its people. Those two are separate screens,
/// not sections of this one.
struct GroupInfoScreen: View {
    @Bindable var model: GroupsModel
    let groupId: String
    /// Reached from the conversation, so the "Chat" tile pops back to it
    /// rather than stacking a second copy of the same conversation.
    var fromChat = false

    @Environment(\.faithformTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var detail: GroupDetail?
    @State private var confirmLeave = false
    @State private var joinMessage = ""
    @State private var asking = false
    @State private var invite: String?
    @State private var preferences = false
    @State private var editing = false

    var body: some View {
        Group {
            if let detail {
                ScrollView {
                    VStack(spacing: 22) {
                        hero(detail)
                        VStack(alignment: .leading, spacing: 22) {
                            GroupFeedback(model: model)
                            tiles(detail)
                            if let description = detail.description, !description.isEmpty {
                                GroupPanelView("About this group") {
                                    Text(description).font(.subheadline)
                                        .foregroundStyle(theme.palette.contentSecondary).lineSpacing(5)
                                }
                            }
                            meeting(detail)
                            if !detail.leaders.isEmpty { leaders(detail) }
                            manage(detail)
                            membershipButton(detail.group)
                        }
                        .padding(.horizontal, 20)
                    }
                    .padding(.bottom, 36)
                }
                .refreshable { await load() }
            } else if model.error != nil {
                GroupRetryCard(message: model.error ?? "") { Task { await load() } }.padding(20)
            } else {
                ScrollView { GroupDetailSkeleton().padding(20) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // The group's wash runs the full width of the screen and up behind the
        // title bar, so the header reads as one surface rather than stopping
        // at a seam under the navigation bar.
        .background(alignment: .top) {
            GroupAvatarBackdrop(url: detail?.group.coverImageUrl)
                .frame(height: 380)
                .ignoresSafeArea(edges: .top)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .foregroundStyle(theme.palette.contentPrimary)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationTitle(detail?.group.name ?? "Group")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if detail?.group.membershipState == "member" {
                    Button { preferences = true } label: { Image(systemName: "bell") }
                        .accessibilityLabel("Group notifications")
                }
            }
        }
        .sheet(isPresented: $editing) { if let detail { GroupEditView(model: model, detail: detail) { Task { await load() } } } }
        .sheet(isPresented: $preferences) { GroupPreferencesView(model: model, groupId: groupId) }
        .task { if detail == nil { await load() } }
        .confirmationDialog("Leave this group?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave group", role: .destructive) { Task { if let group = detail?.group, await model.changeMembership(group) { dismiss() } } }
        } message: { Text("You will lose access to this group's conversation. You can ask to join again later.") }
        .sheet(isPresented: $asking) {
            NavigationStack {
                Form {
                    Section("Say hello (optional)") { TextField("What brings you to this group?", text: $joinMessage, axis: .vertical).lineLimit(3...5) }
                    GroupFeedback(model: model)
                    Button("Send request") { Task { if let group = detail?.group, await model.changeMembership(group, message: joinMessage) { asking = false; await load() } } }.disabled(model.busy)
                }
                .navigationTitle("Ask to join")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { asking = false } } }
            }
        }
    }

    // MARK: - Sections

    private func hero(_ detail: GroupDetail) -> some View {
        VStack(spacing: 16) {
            GroupAvatarView(url: detail.group.coverImageUrl, name: detail.group.name, size: 108)
                .shadow(color: theme.usesDecorativeShadow ? theme.palette.brandPrimary.opacity(0.18) : .clear, radius: 18, y: 8)
            VStack(spacing: 8) {
                Text(detail.group.name)
                    .font(theme.font(FaithFormTokens.Text.displayMedium))
                    .multilineTextAlignment(.center)
                Text(summaryLine(detail))
                    .font(.subheadline)
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
            }
            if !badges(detail).isEmpty {
                HStack(spacing: 8) { ForEach(badges(detail), id: \.self) { GroupBadge(text: $0) } }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 26)
    }

    private func tiles(_ detail: GroupDetail) -> some View {
        HStack(spacing: 12) {
            if detail.group.chat != nil && detail.group.membershipState == "member" {
                if fromChat {
                    Button { dismiss() } label: { GroupActionTile(symbol: "bubble.left.and.bubble.right.fill", title: "Chat", detail: "Back to messages") }
                        .buttonStyle(GroupPressStyle())
                } else {
                    NavigationLink(value: GroupRoute.chat(detail.group)) { GroupActionTile(symbol: "bubble.left.and.bubble.right.fill", title: "Chat", detail: "Open conversation") }
                        .buttonStyle(GroupPressStyle())
                }
            }
            NavigationLink(value: GroupRoute.events(detail)) {
                GroupActionTile(symbol: "calendar", title: "Events", detail: detail.upcomingEvents.isEmpty ? "Nothing planned" : "\(detail.upcomingEvents.count) coming up")
            }.buttonStyle(GroupPressStyle())
            if detail.capabilities.canViewMembers {
                NavigationLink(value: GroupRoute.members(detail)) {
                    GroupActionTile(symbol: "person.2.fill", title: "Members", detail: "\(detail.group.memberCount) people")
                }.buttonStyle(GroupPressStyle())
            }
        }
    }

    private func meeting(_ detail: GroupDetail) -> some View {
        GroupPanelView("When & where") {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(detail.schedules, id: \.text) { Label($0.text, systemImage: "calendar").font(.subheadline) }
                if let location = detail.location {
                    if let name = location.name { Label(name, systemImage: "mappin.and.ellipse").font(.subheadline) }
                    if let address = location.address { Text(address).font(.subheadline).foregroundStyle(theme.palette.contentSecondary) }
                    else if location.membersOnly { Text("The meeting address is shared with members.").font(.caption).foregroundStyle(theme.palette.contentSecondary) }
                    if let link = location.onlineMeetingUrl, let url = URL(string: link) { Link(destination: url) { Label("Join online meeting", systemImage: "video") }.font(.subheadline) }
                }
                if detail.schedules.isEmpty && detail.location == nil {
                    Text("Details will be shared soon.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                }
            }
        }
    }

    private func leaders(_ detail: GroupDetail) -> some View {
        GroupPanelView("Here to welcome you") {
            VStack(spacing: 14) {
                ForEach(detail.leaders, id: \.name) { leader in
                    HStack(spacing: 14) {
                        GroupMemberAvatar(name: leader.name, url: leader.avatarUrl)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(leader.name).font(.subheadline.weight(.semibold))
                            Text(leader.groupRole.capitalized).font(.caption).foregroundStyle(theme.palette.contentSecondary)
                        }
                        Spacer(minLength: 0)
                    }.accessibilityElement(children: .combine)
                }
            }
        }
    }

    @ViewBuilder private func manage(_ detail: GroupDetail) -> some View {
        let canManage = detail.capabilities.canEditDetails || detail.capabilities.canManageRequests || detail.capabilities.canInvite
        if canManage {
            GroupPanelView("Leader tools") {
                VStack(spacing: 4) {
                    if detail.capabilities.canEditDetails {
                        Button { editing = true } label: { GroupActionRow(symbol: "pencil", title: "Edit group details") }
                            .buttonStyle(GroupPressStyle())
                    }
                    if detail.capabilities.canManageRequests {
                        NavigationLink(value: GroupRoute.requests(groupId)) {
                            GroupActionRow(symbol: "person.badge.plus", title: "Join requests", detail: "\(detail.pendingRequestCount)")
                        }.buttonStyle(GroupPressStyle())
                    }
                    if detail.capabilities.canInvite {
                        Button { Task { await makeInvite() } } label: { GroupActionRow(symbol: "square.and.arrow.up", title: "Invite someone") }
                            .buttonStyle(GroupPressStyle()).disabled(model.busy)
                    }
                    if let invite, let url = URL(string: invite) {
                        ShareLink(item: url) { GroupActionRow(symbol: "link", title: "Share your invitation") }
                            .buttonStyle(GroupPressStyle())
                    }
                }
            }
        }
    }

    @ViewBuilder private func membershipButton(_ group: GroupSummary) -> some View {
        switch group.joinAction {
        case "join":
            Button { Task { _ = await model.changeMembership(group); await load() } } label: { primaryLabel("Join this group") }
                .buttonStyle(GroupPressStyle()).disabled(model.busy)
        case "request":
            Button { asking = true } label: { primaryLabel("Ask to join") }.buttonStyle(GroupPressStyle())
        case "cancel_request":
            VStack(spacing: 10) {
                Text("Your request is with the group leaders.").font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                Button("Cancel request") { Task { _ = await model.changeMembership(group); await load() } }.disabled(model.busy)
            }.frame(maxWidth: .infinity)
        case "leave":
            Button("Leave group", role: .destructive) { confirmLeave = true }
                .font(.subheadline).frame(maxWidth: .infinity, minHeight: FaithFormTokens.TouchTarget.minimum).padding(.top, 6)
        default:
            Text(group.joinAction == "full" ? "This group is currently full." : group.joinAction == "invitation_required" ? "Ask a leader for an invitation to join." : "This group isn't accepting members right now.")
                .font(.subheadline).foregroundStyle(theme.palette.contentSecondary).frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func primaryLabel(_ title: String) -> some View {
        Text(title).font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(theme.palette.contentOnAccent)
            .background(theme.palette.brandAccent, in: Capsule())
    }

    // MARK: - Content

    private func summaryLine(_ detail: GroupDetail) -> String {
        var parts = [detail.group.type?.name ?? "Community", "\(detail.group.memberCount) members"]
        if let schedule = detail.group.scheduleText { parts.append(schedule) }
        return parts.joined(separator: " · ")
    }

    private func badges(_ detail: GroupDetail) -> [String] {
        var values: [String] = []
        if detail.isArchived { values.append("Archived") }
        if detail.group.isYouth { values.append("Youth group") }
        if detail.group.membershipState == "member" { values.append("Your group") }
        else if detail.group.membershipState == "requested" { values.append("Request sent") }
        else if detail.group.enrollment == "open" { values.append("Open to join") }
        return values
    }

    // MARK: - Data

    private func load() async {
        do {
            let value = try await model.read("\(model.path)/\(groupId)", as: GroupDetail.self)
            try Task.checkCancellation()
            model.error = nil
            detail = value
        }
        catch is CancellationError {} catch { detail = nil; model.error = GroupsModel.message(error) }
    }

    private func makeInvite() async {
        await model.perform("Invitation ready to share.") {
            let result = try await model.send("\(model.path)/\(groupId)/invitations", as: GroupInvitation.self)
            invite = result.url
        }
    }
}
