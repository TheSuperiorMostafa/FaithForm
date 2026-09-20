import SwiftUI
import FaithFormKit

struct GroupInvitationView: View {
    let api: APIClient
    let token: String
    let joined: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var preview: GroupInvitationPreview?
    @State private var error: String?
    @State private var busy = false
    @State private var retry = 0
    @State private var accepted = false
    var body: some View {
        NavigationStack {
            ScrollView { VStack(alignment: .leading, spacing: 24) {
                if let preview {
                    ZStack {
                        GroupAvatarBackdrop(url: preview.coverImageUrl)
                        GroupAvatarView(url: preview.coverImageUrl, name: preview.groupName, size: 112)
                    }
                    .frame(height: 200).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    Text(accepted ? "Welcome to the group." : "There’s a place for you.").font(.largeTitle.bold())
                    Text(preview.groupName).font(.title2.bold())
                    Text("You’re invited to join \(preview.churchName)’s group. You’ll need to belong to this church in the app before joining.").foregroundStyle(.secondary)
                    if accepted { Button("Go to my groups") { joined(preview.churchSlug) }.buttonStyle(.borderedProminent) }
                    else { Button(busy ? "Joining…" : "Accept invitation") { Task { await accept() } }.buttonStyle(.borderedProminent).disabled(busy) }
                } else if error == nil { GroupDetailSkeleton() }
                if let error { Text(error).foregroundStyle(.red); if preview == nil { Button("Try again") { retry += 1 } } }
            }.padding(24) }.navigationTitle("You’re invited").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                .task(id: retry) { do { error = nil; let result = try await api.send("api/mobile/v1/group-invitations/preview", method: .post, body: GroupInvitationTokenRequest(token: token), as: GroupInvitationPreview.self); preview = result.value } catch is CancellationError {} catch { self.error = GroupsModel.message(error) } }
        }
    }
    private func accept() async {
        busy = true; error = nil; defer { busy = false }
        do {
            let result = try await api.send("api/mobile/v1/group-invitations/accept", method: .post, body: GroupInvitationTokenRequest(token: token), as: GroupJoinResult.self)
            guard let value = result.value, ["joined", "already_member"].contains(value.outcome) else { error = GroupsModel.outcomeMessage(result.value?.outcome ?? "unavailable"); return }
            accepted = true
        } catch is CancellationError {} catch { self.error = GroupsModel.message(error) }
    }
}
