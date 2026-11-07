import SwiftUI
import FaithFormKit

/// Every group member can tell the team when they can serve.
struct GroupAvailabilityView: View {
    @Bindable var model: GroupsModel
    let groupId: String
    @State private var availability = ""
    @State private var loaded = false
    @State private var failed = false

    private var path: String { "\(model.path)/\(groupId)/availability" }
    var body: some View {
        GroupPanelView("Your availability") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Tell your team when you can serve. Group leaders can see your answer.")
                    .font(.subheadline)
                if !loaded {
                    if failed {
                        Button("Try loading availability again") { Task { await load() } }
                    } else { ProgressView("Loading availability…") }
                } else {
                    TextField("For example, Sundays except the first Sunday", text: $availability, axis: .vertical)
                        .lineLimit(3...5)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: availability) { _, value in
                            if value.count > 500 { availability = String(value.prefix(500)) }
                        }
                    Button("Save availability") {
                        Task {
                            await model.perform("Your availability is saved.") {
                                let saved: GroupAvailability = try await model.send(path, method: .put, body: GroupAvailability(availability: availability), as: GroupAvailability.self)
                                availability = saved.availability
                            }
                        }
                    }.buttonStyle(.borderedProminent).disabled(model.busy)
                }
            }
        }
        .task(id: groupId) { await load() }
    }
    private func load() async {
        failed = false
        do {
            availability = try await model.read(path, as: GroupAvailability.self).availability
            loaded = true
        } catch is CancellationError {} catch { failed = true }
    }
}
