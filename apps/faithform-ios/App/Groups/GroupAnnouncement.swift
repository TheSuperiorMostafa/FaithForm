import SwiftUI
import FaithFormKit

/// Group leaders can send announcements to all members.
struct GroupAnnouncementView: View {
    @Bindable var model: GroupsModel
    let groupId: String
    let groupName: String
    
    @State private var title = ""
    @State private var message = ""
    @State private var sending = false
    @State private var sent = false
    @State private var recipientCount = 0
    @Environment(\.dismiss) private var dismiss
    
    private var path: String { "\(model.path)/\(groupId)/announcements" }
    private var canSend: Bool { !title.isEmpty && !message.isEmpty && !sending }
    
    var body: some View {
        NavigationStack {
            GroupPanelView("Send Announcement") {
                VStack(alignment: .leading, spacing: 16) {
                    if sent {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 48))
                                .foregroundStyle(.green)
                            Text("Announcement queued")
                                .font(.title2)
                                .fontWeight(.semibold)
                            Text("Queued for \(recipientCount) \(recipientCount == 1 ? "member" : "members")")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                        
                        Button("Done") { dismiss() }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Send a message to all members of \(groupName)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        
                        GroupFeedback(model: model)
                        TextField("Title", text: $title)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: title) { _, value in
                                if value.count > 100 { title = String(value.prefix(100)) }
                            }
                        
                        TextField("Message", text: $message, axis: .vertical)
                            .lineLimit(5...10)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: message) { _, value in
                                if value.count > 500 { message = String(value.prefix(500)) }
                            }
                        
                        Text("\(message.count)/500")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        HStack(spacing: 12) {
                            Button("Cancel") { dismiss() }
                                .buttonStyle(.bordered)
                            
                            Button("Send to Members") {
                                Task { await send() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!canSend)
                        }
                    }
                }
            }
            .navigationTitle("Group Announcement")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
    
    private func send() async {
        model.error = nil
        sending = true
        do {
            struct Response: Decodable, Sendable {
                let recipientCount: Int
            }
            let response: Response = try await model.send(path, body: [
                "title": title,
                "message": message
            ], as: Response.self)
            recipientCount = response.recipientCount
            sent = true
        } catch {
            model.error = GroupsModel.message(error)
        }
        sending = false
    }
}
