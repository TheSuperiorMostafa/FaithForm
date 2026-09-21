import SwiftUI
import FaithFormKit

struct GroupMembersView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: GroupsModel
    let detail: GroupDetail
    @State private var members: [GroupMember] = []
    @State private var cursor: String?
    @State private var loaded = false
    @State private var selected: GroupMember?
    @State private var confirming: GroupMember?
    @State private var search = ""
    @State private var loadError: String?
    @State private var loadingMore = false
    private var filteredMembers: [GroupMember] {
        members.filter { search.trimmingCharacters(in: .whitespaces).isEmpty || $0.name.localizedCaseInsensitiveContains(search.trimmingCharacters(in: .whitespaces)) }
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                GroupSectionHeading(eyebrow: "YOUR PEOPLE", title: "Better together", subtitle: "\(detail.group.memberCount) members. A place for every one of you.")
                FaithFormSearchField(placeholder: "Find someone in this group", text: $search, onSubmit: {})
                GroupFeedback(model: model)
                if !loaded { FaithFormCard { GroupPeopleSkeleton() } }
                else if let loadError { GroupRetryCard(message: loadError) { Task { await load() } } }
                else if filteredMembers.isEmpty {
                    FaithFormCard {
                        GroupEmpty(symbol: search.isEmpty ? "person.2" : "magnifyingglass", title: search.isEmpty ? "Your people will be here" : "No matches yet", message: search.isEmpty ? "Group members will appear here as they join." : (cursor == nil ? "Try another name." : "Try another name or load more members below."))
                    }
                } else {
                    ForEach(filteredMembers, id: \.membershipId) { member in
                        FaithFormCard {
                            HStack(spacing: 14) {
                                GroupMemberAvatar(name: member.name, url: member.avatarUrl)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(member.name).font(.headline).foregroundStyle(theme.palette.contentPrimary)
                                    Text(member.isYou ? "You · \(member.groupRole.capitalized)" : member.groupRole.capitalized)
                                        .font(.caption.weight(.medium)).foregroundStyle(theme.palette.contentSecondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                                // "Report or block" opens a sheet that needs
                                // both the person's chat id and the group's
                                // conversation; without the second it used to
                                // open empty, so it is offered only when the
                                // sheet can actually be built.
                                if !member.isYou && ((member.chatUserId != nil && detail.group.chat != nil) || detail.capabilities.canManageMembers || detail.capabilities.canManageRoles) {
                                    Menu {
                                        if member.chatUserId != nil && detail.group.chat != nil { Button("Report or block", systemImage: "shield") { selected = member } }
                                        if detail.capabilities.canManageMembers { Button("Remove from group", role: .destructive) { confirming = member } }
                                        if detail.capabilities.canManageRoles {
                                            ForEach(["member", "leader", "manager"], id: \.self) { role in if role != member.groupRole { Button("Make \(role)") { Task { await changeRole(member, role: role) } } } }
                                        }
                                    } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }.accessibilityLabel("Actions for \(member.name)")
                                }
                            }
                        }
                    }
                }
                if cursor != nil && loadError == nil {
                    Button(loadingMore ? "Loading more…" : "Load more members") { Task { await load(more: true) } }
                        .buttonStyle(.bordered).frame(maxWidth: .infinity).disabled(loadingMore)
                }
            }.padding(20).padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background.ignoresSafeArea())
        .foregroundStyle(theme.palette.contentPrimary)
        .navigationTitle("Members").navigationBarTitleDisplayMode(.inline)
        .task { await load() }.refreshable { await load() }
        .sheet(item: $selected) { member in if let userId = member.chatUserId, let cid = detail.group.chat?.cid { GroupSafetyView(model: model, cid: cid, userId: userId, name: member.name) } }
        .confirmationDialog("Remove this person?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if let member = confirming {
                Button("Remove from group", role: .destructive) { Task { await remove(member, ban: false) } }
                Button("Remove and prevent rejoining", role: .destructive) { Task { await remove(member, ban: true) } }
            }
        } message: { Text("They will lose access to the group and its conversation.") }
    }
    private func load(more: Bool = false) async {
        if more { guard !loadingMore else { return }; loadingMore = true }
        defer { if more { loadingMore = false } }
        loadError = nil
        do {
            let page = try await model.read("\(model.path)/\(detail.group.id)/members", query: more ? ["cursor": cursor ?? ""] : [:], as: GroupMemberPage.self)
            try Task.checkCancellation()
            members = more ? members + page.items : page.items
            cursor = page.nextCursor; loaded = true
        } catch is CancellationError {} catch { loadError = GroupsModel.message(error); loaded = true }
    }
    private func changeRole(_ member: GroupMember, role: String) async {
        await model.perform("Role updated.") { let _: GroupCommandResult = try await model.send("\(model.path)/\(detail.group.id)/members/\(member.membershipId)", method: .patch, body: SetGroupRoleRequest(groupRole: role), as: GroupCommandResult.self); await load() }
    }
    private func remove(_ member: GroupMember, ban: Bool) async {
        await model.perform("Member removed.") { let _: GroupCommandResult = try await model.send("\(model.path)/\(detail.group.id)/members/\(member.membershipId)/remove", body: RemoveGroupMemberRequest(ban: ban), as: GroupCommandResult.self); await load() }
    }
}
extension GroupMember: @retroactive Identifiable { public var id: String { membershipId } }

struct GroupRequestsView: View {
    @Bindable var model: GroupsModel
    let groupId: String
    @State private var requests: [GroupJoinRequestItem] = []
    @State private var loaded = false
    @State private var cursor: String?
    var body: some View {
        List {
            GroupFeedback(model: model)
            if !loaded { GroupPeopleSkeleton().listRowSeparator(.hidden) }
            if loaded && requests.isEmpty { GroupEmpty(symbol: "checkmark.circle", title: "All caught up", message: "New requests to join this group will appear here.") }
            ForEach(requests, id: \.requestId) { request in
                VStack(alignment: .leading, spacing: 12) {
                    Text(request.name).font(.headline)
                    if let message = request.message { Text(message).font(.subheadline).foregroundStyle(.secondary) }
                    HStack { Button("Decline") { Task { await decide(request, decision: "decline") } }.buttonStyle(.bordered); Button("Welcome in") { Task { await decide(request, decision: "approve") } }.buttonStyle(.borderedProminent) }.disabled(model.busy)
                }.padding(.vertical, 8)
            }
            if cursor != nil { Button("More requests") { Task { await load(more: true) } } }
        }.navigationTitle("Join requests").task { await load() }.refreshable { await load() }
    }
    private func load(more: Bool = false) async {
        do { let page = try await model.read("\(model.path)/\(groupId)/requests", query: more ? ["cursor": cursor ?? ""] : [:], as: GroupJoinRequestPage.self); requests = more ? requests + page.items : page.items; cursor = page.nextCursor; loaded = true }
        catch is CancellationError {} catch { model.error = GroupsModel.message(error); loaded = true }
    }
    private func decide(_ request: GroupJoinRequestItem, decision: String) async {
        await model.perform(decision == "approve" ? "Welcome to the group!" : "Request declined.") {
            let result = try await model.send("\(model.path)/\(groupId)/requests/\(request.requestId)", body: DecideGroupRequest(decision: decision), as: GroupCommandResult.self)
            guard ["approved", "declined", "already_decided"].contains(result.outcome) else { throw APIError(code: .invalidRequest, message: GroupsModel.outcomeMessage(result.outcome)) }
            await load()
        }
    }
}
struct GroupAck: Decodable, Sendable {}

struct GroupPreferencesView: View {
    @Bindable var model: GroupsModel
    var groupId: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var level = "all"
    @State private var blocked: [ChatBlockedPerson] = []
    @State private var loaded = false
    /// Assumed on until asked, so the note below never flashes for someone who
    /// has already allowed them.
    @State private var systemNotifications: NotificationAuthorization = .authorized
    @Environment(\.faithformTheme) private var theme
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "bell.badge").font(.system(size: 26, weight: .medium))
                            .foregroundStyle(theme.palette.brandAccent)
                            .frame(width: 56, height: 56)
                            .background(theme.palette.surfaceSunken, in: RoundedRectangle(cornerRadius: 18))
                        Text("Stay close. On your terms.").font(theme.font(FaithFormTokens.Text.titleMedium))
                        Text("Choose what reaches you. Every conversation will still be here when you’re ready.")
                            .font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                        // Saving a choice that nothing can deliver is how a
                        // setting comes to look broken. If this iPhone has not
                        // allowed notifications, say so here — the choice is
                        // still worth making, and it takes effect as soon as it
                        // can be acted on.
                        if systemNotifications == .notDetermined || systemNotifications == .denied {
                            Text("Notifications are off for FaithForm on this iPhone. Turn them on in Account › Notifications, and what you choose here starts arriving.")
                                .font(.caption)
                                .foregroundStyle(theme.palette.contentSecondary)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(theme.palette.surfaceSunken, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
                    if loaded {
                        VStack(spacing: 10) {
                            if groupId != nil { preference("default", title: "Use church preference", subtitle: "Follow your overall messaging setting.", symbol: "slider.horizontal.3") }
                            preference("all", title: "All messages", subtitle: "Keep up with every conversation.", symbol: "bubble.left.and.bubble.right")
                            preference("mentions", title: "Mentions only", subtitle: "Only when someone mentions you.", symbol: "at")
                            preference(groupId == nil ? "off" : "muted", title: "Nothing for now", subtitle: "A little quiet. Catch up in the app.", symbol: "bell.slash")
                        }
                        Button { Task { await save() } } label: {
                            HStack { Text(model.busy ? "Saving…" : "Save preference").font(.headline) }
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .foregroundStyle(theme.palette.contentOnAccent)
                                .background(theme.palette.brandAccent, in: Capsule())
                        }.buttonStyle(.plain).disabled(model.busy)
                        if groupId == nil {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("People you’ve blocked").font(.subheadline.weight(.semibold))
                                if blocked.isEmpty { Text("No blocked people").font(.subheadline).foregroundStyle(theme.palette.contentSecondary) }
                                ForEach(blocked, id: \.chatUserId) { person in
                                    HStack { Text(person.name); Spacer(); Button("Unblock") { Task { await unblock(person) } }.disabled(model.busy) }
                                }
                            }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                                .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 20))
                        }
                    } else if model.error == nil { GroupPreferencesSkeleton() }
                    else { Button("Try again") { Task { await load() } } }
                    GroupFeedback(model: model)
                }.padding(24)
            }.background(theme.palette.background)
                .navigationTitle("Notifications").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                .task {
                    systemNotifications = await SystemNotificationAuthorizer().status()
                    await load()
                }
        }.tint(theme.palette.brandAccent).presentationDragIndicator(.visible).presentationCornerRadius(28)
    }
    private func preference(_ value: String, title: String, subtitle: String, symbol: String) -> some View {
        Button { level = value } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol).font(.title3).frame(width: 28).foregroundStyle(theme.palette.brandAccent)
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(theme.palette.contentPrimary)
                    Text(subtitle).font(.caption).foregroundStyle(theme.palette.contentSecondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: level == value ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(level == value ? theme.palette.brandAccent : theme.palette.contentSecondary)
            }.padding(16).frame(minHeight: 76)
                .background(level == value ? theme.palette.surfaceSunken : theme.palette.surface, in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(level == value ? theme.palette.brandAccent : theme.palette.border, lineWidth: theme.borderWidth))
        }.buttonStyle(.plain).disabled(model.busy).accessibilityElement(children: .combine)
            .accessibilityAddTraits(level == value ? .isSelected : [])
    }
    private func load() async {
        model.error = nil
        do { let prefs = try await model.read("\(model.messagingPath)/preferences", as: MessagingPreferences.self); level = groupId.map { id in prefs.groups.first { $0.groupId == id }?.level ?? "default" } ?? prefs.level; let list = try await model.read("\(model.messagingPath)/blocks", as: ChatBlockList.self); blocked = list.items; model.applyBlocked(list); loaded = true }
        catch is CancellationError {} catch { model.error = GroupsModel.message(error) }
    }
    private func save() async {
        if await model.perform("Preference saved.", operation: {
            if let groupId { let _: GroupAck = try await model.send("\(model.path)/\(groupId)/notifications", method: .put, body: SetGroupNotificationRequest(level: level), as: GroupAck.self) }
            else { let _: MessagingPreferences = try await model.send("\(model.messagingPath)/preferences", method: .put, body: SetMessagingLevelRequest(level: level), as: MessagingPreferences.self) }
        }) { dismiss() }
    }
    private func unblock(_ person: ChatBlockedPerson) async {
        await model.perform("Person unblocked.") { let response = try await model.api.send("\(model.messagingPath)/blocks", method: .delete, query: ["chatUserId": person.chatUserId], as: ChatBlockList.self); if let list = response.value { blocked = list.items; model.applyBlocked(list) } }
    }
}

struct GroupSafetyView: View {
    @Bindable var model: GroupsModel
    let cid: String; let userId: String; let name: String
    var messageId: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var reason = "inappropriate"
    @State private var details = ""
    @State private var confirmBlock = false
    var body: some View {
        NavigationStack { Form {
            Section { Text("Help keep this a welcoming space. Reports go privately to your church’s moderation team and to FaithForm, and objectionable content is acted on within 24 hours.").font(.subheadline).foregroundStyle(.secondary) }
            Section("Report \(name)") {
                Picker("Reason", selection: $reason) { ForEach(["spam", "harassment", "hate", "sexual", "violence", "self_harm", "inappropriate", "other"], id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ").capitalized).tag($0) } }
                TextField("Anything else we should know?", text: $details, axis: .vertical).lineLimit(3...5)
                Button("Send confidential report") { Task { await report() } }.disabled(model.busy)
            }
            Section { Button("Block this person", role: .destructive) { confirmBlock = true }.disabled(model.busy) } footer: { Text("Neither of you will be able to message the other directly, and their messages are hidden in the groups you share. You can unblock them in your messaging preferences.") }
            GroupFeedback(model: model)
        }.navigationTitle("Report or block").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        .confirmationDialog("Block \(name)?", isPresented: $confirmBlock, titleVisibility: .visible) { Button("Block person", role: .destructive) { Task { if await model.perform("Person blocked.", operation: { let list: ChatBlockList = try await model.send("\(model.messagingPath)/blocks", body: ChatBlockRequest(chatUserId: userId), as: ChatBlockList.self); model.applyBlocked(list) }) { dismiss() } } } }
        }
    }
    private func report() async { if await model.perform("Thank you. Your report has been received.", operation: { let _: ChatReportResult = try await model.send("\(model.messagingPath)/reports", body: ChatReportRequest(cid: cid, messageId: messageId, reportedChatUserId: userId, reason: reason, details: String(details.prefix(1000))), as: ChatReportResult.self) }) { dismiss() } }
}
