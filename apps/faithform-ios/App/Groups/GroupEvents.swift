import SwiftUI
import FaithFormKit

struct GroupEventsView: View {
    @Bindable var model: GroupsModel
    let detail: GroupDetail
    @State private var events: [GroupEventSummary] = []
    @State private var when = "upcoming"
    @State private var cursor: String?
    @State private var loaded = false
    @State private var adding = false
    var body: some View {
        VStack {
            Picker("Gatherings", selection: $when) { Text("Coming up").tag("upcoming"); Text("Past").tag("past") }.pickerStyle(.segmented).padding(.horizontal, 20)
            List {
                GroupFeedback(model: model)
                if detail.capabilities.canManageEvents && !detail.isArchived { Button { adding = true } label: { Label("Plan a gathering", systemImage: "plus.circle") } }
                if !loaded { ProgressView("Loading gatherings…") }
                else if events.isEmpty { GroupEmpty(symbol: "calendar", title: "Make time for each other", message: when == "upcoming" ? "Your next gathering will appear here when it’s planned." : "Past gatherings will appear here.") }
                ForEach(events, id: \.id) { event in
                    NavigationLink { GroupEventPageView(model: model, groupId: detail.group.id, eventId: event.id) } label: {
                        HStack(spacing: 15) {
                            Image(systemName: "calendar").font(.title2).padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 14))
                            VStack(alignment: .leading, spacing: 6) { Text(event.title).font(.headline); Text(groupDate(event.startsAt)).font(.caption).foregroundStyle(.secondary); if event.isCancelled { GroupBadge(text: "Cancelled") } else { Text("\(event.goingCount) going\(event.rsvp == "going" ? " · You’re in" : "")").font(.caption).foregroundStyle(.secondary) } }
                        }.padding(.vertical, 8)
                    }
                }
                if cursor != nil { Button("More gatherings") { Task { await load(more: true) } } }
            }.listStyle(.plain).refreshable { await load() }
        }.task(id: when) { loaded = false; await load() }
        .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { GroupEventForm(model: model, groupId: detail.group.id) }
    }
    private func load(more: Bool = false) async {
        do { var query = ["when": when]; if more { query["cursor"] = cursor }; let page = try await model.read("\(model.path)/\(detail.group.id)/events", query: query, as: GroupEventPage.self); events = more ? events + page.items : page.items; cursor = page.nextCursor; loaded = true }
        catch is CancellationError {} catch { model.error = GroupsModel.message(error); loaded = true }
    }
}

struct GroupEventPageView: View {
    @Bindable var model: GroupsModel
    let groupId: String; let eventId: String
    @State private var detail: GroupEventDetail?
    @State private var attendance = false
    @State private var editing = false
    @State private var cancel = false
    private var path: String { "\(model.path)/\(groupId)/events/\(eventId)" }
    var body: some View {
        List {
            GroupFeedback(model: model)
            if let detail {
                Section { Text(detail.event.title).font(.title2.weight(.semibold)); Label(groupDate(detail.event.startsAt), systemImage: "calendar"); if let location = detail.event.locationName { Label(location, systemImage: "mappin") }; if let address = detail.locationAddress { Text(address).foregroundStyle(.secondary) }; if let link = detail.onlineMeetingUrl, let url = URL(string: link) { Link("Join online", destination: url) }; if let text = detail.description { Text(text).font(.subheadline).foregroundStyle(.secondary) } }
                if detail.event.isCancelled { Text("This gathering has been cancelled.").foregroundStyle(.secondary) }
                else {
                    Section("Will you be there?") {
                        ForEach([("going", "I’ll be there", "checkmark.circle"), ("maybe", "Maybe", "questionmark.circle"), ("not_going", "Can’t make it", "xmark.circle")], id: \.0) { response in
                            Button { Task { await rsvp(response.0) } } label: { HStack { Label(response.1, systemImage: response.2); Spacer(); if detail.event.rsvp == response.0 { Image(systemName: "checkmark") } } }.disabled(model.busy)
                        }
                        Text("\(detail.rsvpCounts.going) going · \(detail.rsvpCounts.maybe) maybe").font(.caption).foregroundStyle(.secondary)
                    }
                    if detail.canTakeAttendance { Button("Take attendance", systemImage: "checklist") { attendance = true } }
                    if detail.canEdit { Button("Edit gathering") { editing = true }; Button("Cancel gathering", role: .destructive) { cancel = true } }
                }
            } else { ProgressView("Loading gathering…") }
        }.navigationTitle("Gathering").task { await load() }.refreshable { await load() }
        .sheet(isPresented: $attendance) { GroupAttendanceView(model: model, path: path) }
        .sheet(isPresented: $editing, onDismiss: { Task { await load() } }) { GroupEventForm(model: model, groupId: groupId, existing: detail) }
        .confirmationDialog("Cancel this gathering?", isPresented: $cancel, titleVisibility: .visible) { Button("Cancel gathering", role: .destructive) { Task { await model.perform("Gathering cancelled.") { let _: GroupAck = try await model.send("\(path)/cancel", body: ["reason": "Cancelled by a group leader"], as: GroupAck.self); await load() } } } } message: { Text("Group members will be notified.") }
    }
    private func load() async { do { detail = try await model.read(path, as: GroupEventDetail.self) } catch is CancellationError {} catch { model.error = GroupsModel.message(error) } }
    private func rsvp(_ value: String) async { await model.perform("Your response is saved.") { let _: GroupAck = try await model.send("\(path)/rsvp", method: .put, body: GroupEventRsvpRequest(response: value), as: GroupAck.self); await load() } }
}

struct GroupEventForm: View {
    @Bindable var model: GroupsModel
    let groupId: String
    var existing: GroupEventDetail? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var location = ""
    @State private var notes = ""
    @State private var starts = Date().addingTimeInterval(86400)
    @State private var ends = Date().addingTimeInterval(90000)
    var body: some View {
        NavigationStack { Form {
            Section("The essentials") { TextField("Gathering name", text: $title); DatePicker("Starts", selection: $starts); DatePicker("Ends", selection: $ends); Text("Times are in \(TimeZone.current.identifier).").font(.caption).foregroundStyle(.secondary) }
            Section("Make people feel at home") { TextField("Meeting place", text: $location); TextField("What to know or bring", text: $notes, axis: .vertical).lineLimit(3...6) }
            GroupFeedback(model: model)
            Button(existing == nil ? "Plan gathering" : "Save changes") { Task { await save() } }.disabled(model.busy || title.trimmingCharacters(in: .whitespaces).isEmpty || ends <= starts)
        }.navigationTitle(existing == nil ? "Plan a gathering" : "Edit gathering").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }.onAppear { if let existing { title = existing.event.title; location = existing.event.locationName ?? ""; notes = existing.description ?? ""; let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; starts = parser.date(from: existing.event.startsAt) ?? starts; ends = parser.date(from: existing.event.endsAt) ?? ends } } }
    }
    private func save() async {
        if await model.perform("Gathering saved.", operation: {
            let path = "\(model.path)/\(groupId)/events" + (existing.map { "/\($0.event.id)" } ?? "")
            let body = UpsertGroupEventRequest(title: title, description: notes, startsAt: starts.ISO8601Format(), endsAt: ends.ISO8601Format(), timezone: TimeZone.current.identifier, locationName: location, locationAddress: existing?.locationAddress, onlineMeetingUrl: existing?.onlineMeetingUrl)
            let _: GroupAck = try await model.send(path, method: existing == nil ? .post : .patch, body: body, as: GroupAck.self)
        }) { dismiss() }
    }
}

struct GroupAttendanceView: View {
    @Bindable var model: GroupsModel
    let path: String
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: GroupAttendanceSheet?
    @State private var selected: Set<String> = []
    @State private var guests = 0
    @State private var first = 0
    @State private var notes = ""
    @State private var key = UUID().uuidString
    var body: some View {
        NavigationStack { Form {
            GroupFeedback(model: model)
            if let sheet {
                if !sheet.canRecord { Text("Attendance is unavailable: \((sheet.lockedReason ?? "closed").replacingOccurrences(of: "_", with: " ")).").foregroundStyle(.secondary) }
                Section("\(selected.count) present") {
                    Button(selected.isEmpty ? "Mark everyone present" : "Clear selection") { selected = selected.isEmpty ? Set(sheet.entries.filter(\.recordable).map(\.membershipId)) : [] }.disabled(!sheet.canRecord)
                    ForEach(sheet.entries, id: \.membershipId) { entry in Toggle(entry.name, isOn: Binding(get: { selected.contains(entry.membershipId) }, set: { if $0 { selected.insert(entry.membershipId) } else { selected.remove(entry.membershipId) } })).disabled(!entry.recordable || !sheet.canRecord) }
                }
                Section("Guests") { Stepper("Guests: \(guests)", value: $guests, in: 0...1000); Stepper("First time: \(first)", value: $first, in: 0...guests); TextField("Leader notes (optional)", text: $notes, axis: .vertical) }.disabled(!sheet.canRecord)
                Button("Save attendance") { Task { await save() } }.disabled(!sheet.canRecord || model.busy || first > guests)
            } else { ProgressView("Loading attendance…") }
        }.navigationTitle("Who’s here?").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }.task { await load() } }
    }
    private func load() async { do { let value = try await model.read("\(path)/attendance", as: GroupAttendanceSheet.self); sheet = value; selected = Set(value.entries.filter(\.present).map(\.membershipId)); guests = value.guestCount; first = value.firstTimeGuestCount; notes = value.notes ?? "" } catch is CancellationError {} catch { model.error = GroupsModel.message(error) } }
    private func save() async {
        if await model.perform("Attendance saved.", operation: {
            let _: GroupAttendanceSheet = try await model.send("\(path)/attendance", method: .put, body: SubmitGroupAttendanceRequest(presentMembershipIds: Array(selected), guestCount: guests, firstTimeGuestCount: first, notes: notes), key: key, as: GroupAttendanceSheet.self)
        }) { dismiss() }
    }
}
