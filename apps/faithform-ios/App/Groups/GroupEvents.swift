import SwiftUI
import FaithFormKit

struct GroupEventsView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: GroupsModel
    let detail: GroupDetail
    @State private var events: [GroupEventSummary] = []
    @State private var when = "upcoming"
    @State private var cursor: String?
    @State private var loaded = false
    @State private var adding = false
    @State private var loadError: String?
    @State private var loadingMore = false
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                GroupSectionHeading(eyebrow: "TIME TOGETHER", title: "Gatherings", subtitle: "Good company. Something to look forward to.")
                FaithFormPillSwitcher(selection: $when, options: [.init("upcoming", title: "Coming up"), .init("past", title: "Past")], accessibilityLabel: "Gatherings")
                if detail.capabilities.canManageEvents && !detail.isArchived {
                    Button { adding = true } label: {
                        Label("Plan a gathering", systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }.buttonStyle(.plain)
                        .foregroundStyle(theme.palette.contentOnAccent)
                        .background(theme.palette.brandAccent, in: Capsule())
                }
                if !loaded {
                    FaithFormCard { GroupEventsSkeleton() }
                } else if let loadError {
                    GroupRetryCard(message: loadError) { Task { await load() } }
                } else if events.isEmpty {
                    FaithFormCard {
                        GroupEmpty(symbol: "calendar.badge.plus", title: when == "upcoming" ? "Something to look forward to" : "Your time together", message: when == "upcoming" ? "When your next gathering is planned, you’ll find the details and RSVP here." : "Past gatherings will appear here after your first event.")
                    }
                } else {
                    ForEach(events, id: \.id) { event in
                        NavigationLink { GroupEventPageView(model: model, groupId: detail.group.id, eventId: event.id) } label: {
                            GroupEventCard(event: event)
                        }.buttonStyle(.plain)
                    }
                    if cursor != nil {
                        Button(loadingMore ? "Loading more…" : "More gatherings") { Task { await load(more: true) } }
                            .buttonStyle(.bordered).frame(maxWidth: .infinity).disabled(loadingMore)
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background.ignoresSafeArea())
        .foregroundStyle(theme.palette.contentPrimary)
        .refreshable { await load() }
        .task(id: when) { loaded = false; await load() }
        .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { GroupEventForm(model: model, groupId: detail.group.id) }
    }
    private func load(more: Bool = false) async {
        let requestedWhen = when
        if more { guard !loadingMore else { return }; loadingMore = true }
        defer { if more { loadingMore = false } }
        loadError = nil
        do {
            var query = ["when": requestedWhen]
            if more { query["cursor"] = cursor }
            let page = try await model.read("\(model.path)/\(detail.group.id)/events", query: query, as: GroupEventPage.self)
            try Task.checkCancellation()
            guard requestedWhen == when else { return }
            events = more ? events + page.items : page.items
            cursor = page.nextCursor; loaded = true
        } catch is CancellationError {} catch { if requestedWhen == when { loadError = GroupsModel.message(error); loaded = true } }
    }
}

struct GroupEventCard: View {
    let event: GroupEventSummary
    @Environment(\.faithformTheme) private var theme
    private var date: Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: event.startsAt) ?? ISO8601DateFormatter().date(from: event.startsAt)
    }
    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 4) {
                        if let date {
                            Text(date.formatted(.dateTime.month(.abbreviated))).font(.caption.weight(.bold)).textCase(.uppercase)
                            Text(date.formatted(.dateTime.day())).font(.title.weight(.semibold))
                        } else { Image(systemName: "calendar").font(.title2) }
                    }
                    .frame(width: 62, height: 72)
                    .foregroundStyle(theme.palette.brandAccent)
                    .background(theme.palette.surfaceSunken, in: RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 7) {
                        Text(event.title).font(.headline).foregroundStyle(theme.palette.contentPrimary)
                        Text(groupDate(event.startsAt)).font(.subheadline).foregroundStyle(theme.palette.contentSecondary)
                        if let location = event.locationName { Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(theme.palette.contentSecondary) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                Rectangle().fill(theme.palette.divider).frame(height: 1)
                HStack {
                    if event.isCancelled { GroupBadge(text: "Cancelled") }
                    else if event.rsvp == "going" { Label("You’re going", systemImage: "checkmark.circle.fill").foregroundStyle(theme.palette.brandAccent) }
                    else { Label("\(event.goingCount) going", systemImage: "person.2").foregroundStyle(theme.palette.contentSecondary) }
                    Spacer(minLength: 8)
                    Label("Details", systemImage: "chevron.right").foregroundStyle(theme.palette.contentSecondary)
                }.font(.caption.weight(.medium))
            }
        }.accessibilityElement(children: .combine)
    }
}

struct GroupEventPageView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: GroupsModel
    let groupId: String; let eventId: String
    @State private var detail: GroupEventDetail?
    @State private var attendance = false
    @State private var editing = false
    @State private var cancel = false
    private var path: String { "\(model.path)/\(groupId)/events/\(eventId)" }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                GroupFeedback(model: model)
                if let detail {
                    GroupSectionHeading(eyebrow: "TIME TOGETHER", title: detail.event.title, subtitle: groupDate(detail.event.startsAt))
                    GroupPanelView("The details") {
                        VStack(alignment: .leading, spacing: 14) {
                            if let location = detail.event.locationName { Label(location, systemImage: "mappin.and.ellipse") }
                            if let address = detail.locationAddress { Text(address).foregroundStyle(theme.palette.contentSecondary) }
                            if let link = detail.onlineMeetingUrl, let url = URL(string: link) { Link(destination: url) { Label("Join online", systemImage: "video") } }
                            if let text = detail.description { Text(text).foregroundStyle(theme.palette.contentSecondary).lineSpacing(4) }
                            if detail.event.locationName == nil && detail.description == nil && detail.onlineMeetingUrl == nil { Text("More details will be shared by your group leaders.").foregroundStyle(theme.palette.contentSecondary) }
                        }.font(.subheadline)
                    }
                    if detail.event.isCancelled {
                        FaithFormCard { Label("This gathering has been cancelled.", systemImage: "calendar.badge.exclamationmark").foregroundStyle(theme.palette.contentSecondary) }
                    } else {
                        GroupPanelView("Will you be there?") {
                            VStack(spacing: 10) {
                                ForEach([("going", "I’ll be there", "checkmark.circle"), ("maybe", "Maybe", "questionmark.circle"), ("not_going", "Can’t make it", "xmark.circle")], id: \.0) { response in
                                    Button { Task { await rsvp(response.0) } } label: {
                                        HStack {
                                            Label(response.1, systemImage: response.2)
                                            Spacer()
                                            if detail.event.rsvp == response.0 { Image(systemName: "checkmark.circle.fill") }
                                        }.padding(14).frame(minHeight: 48)
                                            .background(theme.palette.surfaceSunken, in: RoundedRectangle(cornerRadius: 14))
                                            .foregroundStyle(detail.event.rsvp == response.0 ? theme.palette.brandAccent : theme.palette.contentPrimary)
                                    }.buttonStyle(.plain).disabled(model.busy)
                                        .accessibilityAddTraits(detail.event.rsvp == response.0 ? .isSelected : [])
                                }
                                Text("\(detail.rsvpCounts.going) going · \(detail.rsvpCounts.maybe) maybe")
                                    .font(.caption).foregroundStyle(theme.palette.contentSecondary).padding(.top, 4)
                            }
                        }
                        if detail.canTakeAttendance { Button("Take attendance", systemImage: "checklist") { attendance = true }.buttonStyle(.borderedProminent) }
                        if detail.canEdit {
                            HStack { Button("Edit gathering") { editing = true }; Spacer(); Button("Cancel gathering", role: .destructive) { cancel = true } }.font(.subheadline).padding(.vertical, 12)
                        }
                    }
                } else if model.error == nil { FaithFormCard { DetailSkeleton() } }
                else { GroupRetryCard(message: "The gathering couldn’t be loaded.") { Task { await load() } } }
            }.padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background.ignoresSafeArea())
        .foregroundStyle(theme.palette.contentPrimary)
        .navigationTitle("Gathering").navigationBarTitleDisplayMode(.inline)
        .task { await load() }.refreshable { await load() }
        .sheet(isPresented: $attendance) { GroupAttendanceView(model: model, path: path) }
        .sheet(isPresented: $editing, onDismiss: { Task { await load() } }) { GroupEventForm(model: model, groupId: groupId, existing: detail) }
        .confirmationDialog("Cancel this gathering?", isPresented: $cancel, titleVisibility: .visible) { Button("Cancel gathering", role: .destructive) { Task { await model.perform("Gathering cancelled.") { let _: GroupAck = try await model.send("\(path)/cancel", body: ["reason": "Cancelled by a group leader"], as: GroupAck.self); await load() } } } } message: { Text("Group members will be notified.") }
    }
    private func load() async { model.error = nil; do { detail = try await model.read(path, as: GroupEventDetail.self) } catch is CancellationError {} catch { model.error = GroupsModel.message(error) } }
    private func rsvp(_ value: String) async { await model.perform("Your response is saved.") { let _: GroupAck = try await model.send("\(path)/rsvp", method: .put, body: GroupEventRsvpRequest(response: value), as: GroupAck.self); await load() } }
}

struct GroupEventForm: View {
    @Environment(\.faithformTheme) private var theme
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
    @Environment(\.faithformTheme) private var theme
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
            } else if model.error == nil { GroupPeopleSkeleton().listRowSeparator(.hidden) }
            else { Button("Try again") { Task { await load() } } }
        }.navigationTitle("Who’s here?").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }.task { await load() } }
    }
    private func load() async { model.error = nil; do { let value = try await model.read("\(path)/attendance", as: GroupAttendanceSheet.self); sheet = value; selected = Set(value.entries.filter(\.present).map(\.membershipId)); guests = value.guestCount; first = value.firstTimeGuestCount; notes = value.notes ?? "" } catch is CancellationError {} catch { model.error = GroupsModel.message(error) } }
    private func save() async {
        if await model.perform("Attendance saved.", operation: {
            let _: GroupAttendanceSheet = try await model.send("\(path)/attendance", method: .put, body: SubmitGroupAttendanceRequest(presentMembershipIds: Array(selected), guestCount: guests, firstTimeGuestCount: first, notes: notes), key: key, as: GroupAttendanceSheet.self)
        }) { dismiss() }
    }
}
