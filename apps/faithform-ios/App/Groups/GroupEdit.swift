import SwiftUI
import FaithFormKit

struct GroupEditView: View {
    @Bindable var model: GroupsModel
    let detail: GroupDetail
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var description: String
    @State private var enrollment: String
    @State private var capacity: String
    @State private var location: String
    @State private var address: String
    @State private var meetingUrl: String
    @State private var posting: String
    @State private var roster: String
    @State private var photoURL: String?
    @State private var version: Int
    init(model: GroupsModel, detail: GroupDetail, saved: @escaping () -> Void) {
        _photoURL = State(initialValue: detail.group.coverImageUrl)
        _version = State(initialValue: detail.group.version)
        self.model = model; self.detail = detail; self.saved = saved
        _name = State(initialValue: detail.group.name); _description = State(initialValue: detail.description ?? "")
        _enrollment = State(initialValue: detail.group.enrollment); _capacity = State(initialValue: detail.group.capacity.map(String.init) ?? "")
        _location = State(initialValue: detail.location?.name ?? ""); _address = State(initialValue: detail.location?.address ?? "")
        _meetingUrl = State(initialValue: detail.location?.onlineMeetingUrl ?? ""); _posting = State(initialValue: detail.chatPosting ?? detail.group.chat?.postingPolicy ?? "everyone")
        _roster = State(initialValue: detail.memberListVisibility ?? "members")
    }
    var body: some View {
        NavigationStack { Form {
            Section("Group photo") {
                GroupCoverView(url: photoURL, name: name).frame(height: 160).clipped()
                BrandingPhotoControl(title: "group photo", aspect: 16 / 9, hasPhoto: photoURL != nil) { data in
                    await model.perform("Group photo saved.") {
                        let result = try await model.send("\(model.path)/\(detail.group.id)/photo", method: .put, body: BrandingPhotoBody(imageBase64: data?.base64EncodedString()), as: BrandingPhotoResult.self)
                        photoURL = result.url
                        let latest = try await model.read("\(model.path)/\(detail.group.id)", as: GroupDetail.self)
                        version = latest.group.version
                        saved()
                        await model.load()
                    }
                }.disabled(model.busy)
            }
            Section("Make people feel welcome") { TextField("Group name", text: $name); TextField("What’s your group about?", text: $description, axis: .vertical).lineLimit(3...8) }
            Section("Joining your group") {
                Picker("Who can join?", selection: $enrollment) { Text("Anyone can join").tag("open"); Text("Leader approval").tag("approval_required"); Text("By invitation").tag("invitation_only"); Text("Closed for now").tag("closed") }
                TextField("Member limit (leave blank for unlimited)", text: $capacity).keyboardType(.numberPad)
            }
            Section("When you get together") { TextField("Meeting place", text: $location); TextField("Address", text: $address); TextField("Online meeting link", text: $meetingUrl).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled() }
            Section("Conversation & privacy") {
                Picker("Who can post?", selection: $posting) { Text("All members").tag("everyone"); Text("Leaders only").tag("leaders") }
                Picker("Who can see the member list?", selection: $roster) { Text("All members").tag("members"); Text("Leaders only").tag("leaders") }
            }
            GroupFeedback(model: model)
        }.navigationTitle("Edit group").navigationBarTitleDisplayMode(.inline).toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button(model.busy ? "Saving…" : "Save") { Task {
                guard capacity.isEmpty || (Int(capacity).map { $0 > 0 } == true) else { model.error = "Enter a valid member limit or leave it blank."; return }
                if await model.perform("Group details saved.", operation: {
                    _ = try await model.send("\(model.path)/\(detail.group.id)", method: .patch, body: GroupEditBody(value: UpdateGroupDetailsRequest(expectedVersion: version, name: name, description: description, enrollment: enrollment, capacity: Int(capacity), locationName: location, locationAddress: address, onlineMeetingUrl: meetingUrl, chatPosting: posting, memberListVisibility: roster)), as: GroupDetail.self)
                }) { saved(); dismiss() }
            } }.disabled(model.busy || name.trimmingCharacters(in: .whitespaces).isEmpty) }
        } }
    }
}

private struct GroupEditBody: Encodable, Sendable {
    let value: UpdateGroupDetailsRequest
    enum CodingKeys: String, CodingKey { case expectedVersion, name, description, enrollment, capacity, locationName, locationAddress, onlineMeetingUrl, chatPosting, memberListVisibility }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(value.expectedVersion, forKey: .expectedVersion); try c.encode(value.name, forKey: .name)
        try c.encode(value.description, forKey: .description); try c.encode(value.enrollment, forKey: .enrollment)
        try c.encode(value.capacity, forKey: .capacity); try c.encode(value.locationName, forKey: .locationName)
        try c.encode(value.locationAddress, forKey: .locationAddress); try c.encode(value.onlineMeetingUrl, forKey: .onlineMeetingUrl)
        try c.encode(value.chatPosting, forKey: .chatPosting); try c.encode(value.memberListVisibility, forKey: .memberListVisibility)
    }
}
