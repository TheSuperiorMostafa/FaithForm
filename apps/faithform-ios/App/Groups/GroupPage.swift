import SwiftUI
import FaithFormKit

struct GroupPage: View {
    @Bindable var model: GroupsModel
    let groupId: String
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var detail: GroupDetail?
    @State private var section = "Overview"
    @State private var confirmLeave = false
    @State private var joinMessage = ""
    @State private var asking = false
    @State private var invite: String?
    @State private var preferences = false
    @State private var editing = false
    var body: some View {
        Group {
            if let detail {
                VStack(spacing: 0) {
                    FaithFormPillSwitcher(selection: $section, options: groupSections(detail).map { .init($0, title: $0) }, accessibilityLabel: "Group section")
                        .padding(.horizontal, 20).padding(.vertical, 12)
                    if section == "Chat", let chat = detail.group.chat {
                        GroupConversationView(model: model, cid: chat.cid, title: detail.group.name, readOnly: chat.state != "ready" || (chat.postingPolicy == "leaders" && detail.group.groupRole == "member"))
                    } else if section == "Members" {
                        GroupMembersView(model: model, detail: detail)
                    } else if section == "Events" {
                        GroupEventsView(model: model, detail: detail)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 22) {
                                GroupCoverView(url: detail.group.coverImageUrl, name: detail.group.name).frame(height: 190).clipShape(RoundedRectangle(cornerRadius: 22))
                                HStack { GroupBadge(text: detail.group.type?.name ?? "Community"); if detail.isArchived { GroupBadge(text: "Archived") }; if detail.group.isYouth { GroupBadge(text: "Youth group") } }
                                Text(detail.group.name).font(.system(size: 30, weight: .semibold, design: .rounded))
                                Label("\(detail.group.memberCount) members", systemImage: "person.2").font(.subheadline).foregroundStyle(.secondary)
                                GroupFeedback(model: model)
                                if let description = detail.description { Text(description).font(.body).foregroundStyle(theme.palette.contentSecondary).lineSpacing(5) }
                                GroupPanelView("When & where") {
                                    VStack(alignment: .leading, spacing: 14) {
                                        ForEach(detail.schedules, id: \.text) { Label($0.text, systemImage: "calendar").font(.subheadline) }
                                        if let location = detail.location {
                                            if let name = location.name { Label(name, systemImage: "mappin.and.ellipse").font(.subheadline) }
                                            if let address = location.address { Text(address).font(.subheadline).foregroundStyle(.secondary) }
                                            else if location.membersOnly { Text("The meeting address is shared with members.").font(.caption).foregroundStyle(.secondary) }
                                            if let link = location.onlineMeetingUrl, let url = URL(string: link) { Link("Join online meeting", destination: url) }
                                        }
                                        if detail.schedules.isEmpty && detail.location == nil { Text("Details will be shared soon.").font(.subheadline).foregroundStyle(.secondary) }
                                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                                }
                                if !detail.leaders.isEmpty {
                                    GroupPanelView("Here to welcome you") { ForEach(detail.leaders, id: \.name) { leader in HStack { Image(systemName: "person.crop.circle.fill").foregroundStyle(theme.palette.brandAccent); Text(leader.name).font(.subheadline); Spacer(); Text(leader.groupRole.capitalized).font(.caption).foregroundStyle(.secondary) }.padding(.vertical, 8) } }
                                }
                                if detail.capabilities.canEditDetails { Button("Edit group details") { editing = true }.buttonStyle(.bordered) }
                                if detail.capabilities.canManageRequests { NavigationLink { GroupRequestsView(model: model, groupId: groupId) } label: { Label("Join requests (\(detail.pendingRequestCount))", systemImage: "person.badge.plus") }.buttonStyle(.bordered) }
                                if detail.capabilities.canInvite { Button { Task { await makeInvite() } } label: { Label("Invite someone", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered).disabled(model.busy) }
                                if let invite, let url = URL(string: invite) { ShareLink(item: url) { Label("Share your invitation", systemImage: "link") }.buttonStyle(.borderedProminent) }
                                membershipButton(detail.group)
                            }.padding(20)
                        }.refreshable { await load() }
                    }
                }
            } else if model.error != nil { VStack { GroupFeedback(model: model); Button("Try again") { Task { await load() } } }.padding() }
            else { ProgressView("Opening your group…") }
        }
        .background(theme.palette.background)
            .foregroundStyle(theme.palette.contentPrimary)
        .navigationTitle(detail?.group.name ?? "Group").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { if detail?.group.membershipState == "member" { Button { preferences = true } label: { Image(systemName: "bell") }.accessibilityLabel("Group notifications") } } }
        .sheet(isPresented: $editing) { if let detail { GroupEditView(model: model, detail: detail) { Task { await load() } } } }
        .sheet(isPresented: $preferences) { GroupPreferencesView(model: model, groupId: groupId) }
        .task { await load() }
        .confirmationDialog("Leave this group?", isPresented: $confirmLeave, titleVisibility: .visible) { Button("Leave group", role: .destructive) { Task { if let group = detail?.group, await model.changeMembership(group) { dismiss() } } } } message: { Text("You will lose access to this group’s conversation. You can ask to join again later.") }
        .sheet(isPresented: $asking) { NavigationStack { Form { Section("Say hello (optional)") { TextField("What brings you to this group?", text: $joinMessage, axis: .vertical).lineLimit(3...5) }; GroupFeedback(model: model); Button("Send request") { Task { if let group = detail?.group, await model.changeMembership(group, message: joinMessage) { asking = false; await load() } } }.disabled(model.busy) }.navigationTitle("Ask to join").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { asking = false } } } } }
    }
    private func groupSections(_ detail: GroupDetail) -> [String] {
        ["Overview"] + (detail.group.chat != nil ? ["Chat"] : []) + ["Events"] + (detail.capabilities.canViewMembers ? ["Members"] : [])
    }
    @ViewBuilder private func membershipButton(_ group: GroupSummary) -> some View {
        switch group.joinAction {
        case "join": Button("Join this group") { Task { _ = await model.changeMembership(group); await load() } }.buttonStyle(.borderedProminent).disabled(model.busy)
        case "request": Button("Ask to join") { asking = true }.buttonStyle(.borderedProminent)
        case "cancel_request": VStack(alignment: .leading, spacing: 10) { Text("Your request is with the group leaders.").font(.subheadline).foregroundStyle(.secondary); Button("Cancel request") { Task { _ = await model.changeMembership(group); await load() } }.disabled(model.busy) }
        case "leave": Button("Leave group", role: .destructive) { confirmLeave = true }.font(.subheadline).padding(.top, 10)
        default: Text(group.joinAction == "full" ? "This group is currently full." : group.joinAction == "invitation_required" ? "Ask a leader for an invitation to join." : "This group isn’t accepting members right now.").font(.subheadline).foregroundStyle(.secondary)
        }
    }
    private func load() async {
        do { detail = try await model.read("\(model.path)/\(groupId)", as: GroupDetail.self) }
        catch is CancellationError {} catch { detail = nil; model.error = GroupsModel.message(error) }
    }
    private func makeInvite() async {
        await model.perform("Invitation ready to share.") { let result = try await model.send("\(model.path)/\(groupId)/invitations", as: GroupInvitation.self); invite = result.url }
    }
}
