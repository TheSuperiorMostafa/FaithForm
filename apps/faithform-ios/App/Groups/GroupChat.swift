import SwiftUI
import UniformTypeIdentifiers
import FaithFormKit
import StreamChat
import StreamChatSwiftUI

@MainActor final class GroupChatSession: ObservableObject {
    @Published private(set) var client: ChatClient?
    @Published private(set) var session: FaithFormKit.ChatSession?
    private var stream: StreamChatSwiftUI.StreamChat?
    private var connecting: Task<Void, Error>?
    func connect(_ model: GroupsModel) async throws {
        if client != nil { return }
        if let connecting { return try await connecting.value }
        let task = Task { @MainActor in
            let auth = try await model.send("\(model.messagingPath)/session", as: FaithFormKit.ChatSession.self)
            try Task.checkCancellation()
            var config = ChatClientConfig(apiKey: .init(auth.appKey)); config.isLocalStorageEnabled = false
            let chat = ChatClient(config: config)
            let api = model.api; let route = "\(model.messagingPath)/session"
            do {
                try await chat.connectUser(userInfo: .init(id: auth.chatUserId), tokenProvider: { completion in
                    Task {
                        do { let response = try await api.send(route, method: .post, as: FaithFormKit.ChatSession.self); guard let fresh = response.value else { throw APIError(code: .unauthenticated, message: "Sign in again to continue.") }; completion(.success(try Token(rawValue: fresh.userToken))) }
                        catch { completion(.failure(error)) }
                    }
                })
                try Task.checkCancellation()
                self.stream = StreamChatSwiftUI.StreamChat(chatClient: chat, utils: Utils(composerConfig: ComposerConfig(isVoiceRecordingEnabled: false, maxAttachmentSize: 25 * 1024 * 1024)))
                self.session = auth; self.client = chat
            } catch { await chat.disconnect(); throw error }
        }
        connecting = task
        defer { connecting = nil }
        try await task.value
    }
    func disconnect() {
        connecting?.cancel(); connecting = nil
        let old = client; client = nil; session = nil; stream = nil
        Task { await old?.disconnect() }
    }
}

struct SafetySelection: Identifiable { let id = UUID(); let cid: String; let userId: String; let name: String; let messageId: String }
@MainActor final class FaithFormChatFactory: ViewFactory {
    @Injected(\.chatClient) var chatClient
    var styles = RegularStyles()
    let readOnly: Bool
    let report: (SafetySelection) -> Void
    init(readOnly: Bool, report: @escaping (SafetySelection) -> Void) { self.readOnly = readOnly; self.report = report }
    func makeMessageActionsView(options: MessageActionsViewOptions) -> some View {
        var actions = MessageAction.defaultActions(for: .init(message: options.message, channel: options.channel, onFinish: options.onFinish, onError: options.onError)).filter { ![MessageActionId.flag, MessageActionId.block, MessageActionId.unblock, MessageActionId.mute, MessageActionId.unmute].contains($0.id) }
        if !options.message.isSentByCurrentUser {
            actions.append(MessageAction(id: "faithform-safety", title: "Report or block", iconName: "shield", action: {
                options.onFinish(.init(message: options.message, identifier: "faithform-safety"))
                self.report(SafetySelection(cid: options.channel.cid.rawValue, userId: options.message.author.id, name: options.message.author.name ?? "this person", messageId: options.message.id))
            }, confirmationPopup: nil, isDestructive: false))
        }
        return MessageActionsView(messageActions: actions)
    }
    @ViewBuilder func makeMessageComposerViewType(options: MessageComposerViewTypeOptions) -> some View {
        if readOnly { Text("This conversation is read-only.").font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding() }
        else { DefaultViewFactory.shared.makeMessageComposerViewType(options: options) }
    }
    func makeAttachmentPickerView(options: AttachmentPickerViewOptions) -> some View {
        GroupFilePicker(options: options)
    }
    func makeChannelListHeaderViewModifier(options: ChannelListHeaderViewModifierOptions) -> some ChannelListHeaderViewModifier { FaithFormChatListHeader(title: options.title) }
}
struct FaithFormChatListHeader: ChannelListHeaderViewModifier {
    let title: String
    func body(content: Content) -> some View { content }
}

struct GroupConversationView: View {
    @Bindable var model: GroupsModel
    let cid: String; let title: String
    var readOnly = false
    @EnvironmentObject private var session: GroupChatSession
    @State private var controller: ChatChannelController?
    @State private var safety: SafetySelection?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        Group {
            if let controller, session.client != nil {
                ChatChannelView(viewFactory: FaithFormChatFactory(readOnly: readOnly || session.session?.suspended == true, report: { safety = $0 }), channelController: controller)
            } else if failed { VStack { GroupEmpty(symbol: "bubble.left.and.bubble.right", title: "Let’s reconnect", message: "Messages are unavailable right now. Your group is still here."); Button("Try again") { retry += 1 } } }
            else { ProgressView("Connecting your conversation…") }
        }.navigationTitle(title)
        .task(id: "\(cid)|\(retry)") {
            do { failed = false; try await session.connect(model); guard let client = session.client else { return }; let value = client.channelController(for: try ChannelId(cid: cid)); try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in value.synchronize { error in if let error { continuation.resume(throwing: error) } else { continuation.resume() } } }; try Task.checkCancellation(); controller = value }
            catch is CancellationError {} catch { failed = true }
        }
        .sheet(item: $safety) { selection in GroupSafetyView(model: model, cid: selection.cid, userId: selection.userId, name: selection.name, messageId: selection.messageId) }
    }
}
struct DirectSelection: Identifiable { let cid: String; let name: String; let readOnly: Bool; var id: String { cid } }
struct GroupMessagesView: View {
    @Bindable var model: GroupsModel
    @EnvironmentObject private var session: GroupChatSession
    @State private var list: ChatChannelListController?
    @State private var compose = false
    @State private var selected: DirectSelection?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        VStack {
            HStack { Text("A little encouragement goes a long way.").font(.caption).foregroundStyle(.secondary); Spacer(); Button { compose = true } label: { Image(systemName: "square.and.pencil").frame(width: 44, height: 44) }.accessibilityLabel("New message") }.padding(.horizontal, 20)
            if let list, session.client != nil {
                ChatChannelListView(viewFactory: FaithFormChatFactory(readOnly: false, report: { _ in }), channelListController: list, title: "Messages", onItemTap: { channel in selected = DirectSelection(cid: channel.cid.rawValue, name: channel.name ?? "Conversation", readOnly: channel.isFrozen) }, embedInNavigationView: false)
            } else if failed { GroupEmpty(symbol: "bubble.left", title: "Messages are taking a moment", message: "Please check your connection and try again."); Button("Try again") { retry += 1 } }
            else { ProgressView("Connecting messages…").frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .task(id: retry) {
            do { failed = false; try await session.connect(model); guard let client = session.client, let auth = session.session else { return }; let query = ChannelListQuery(filter: .and([.equal(.type, to: .custom("ff_dm")), .equal(.team, to: auth.churchTeam), .containMembers(userIds: [auth.chatUserId])])); list = client.channelListController(query: query) }
            catch is CancellationError {} catch { failed = true }
        }
        .sheet(isPresented: $compose) { GroupContactsView(model: model, open: { selected = $0; compose = false }) }
        .navigationDestination(item: $selected) { selection in GroupConversationView(model: model, cid: selection.cid, title: selection.name, readOnly: selection.readOnly) }
    }
}
extension DirectSelection: Hashable {}
struct GroupContactsView: View {
    @Bindable var model: GroupsModel
    let open: (DirectSelection) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var contacts: [MessagingContact] = []
    @State private var query = ""
    @State private var cursor: String?
    @State private var loading = true
    var body: some View {
        NavigationStack { List {
            GroupFeedback(model: model)
            if loading { ProgressView("Finding people…") }
            else if contacts.isEmpty { GroupEmpty(symbol: "person.crop.circle.badge.plus", title: "No people found", message: "Your church’s messaging settings decide who you can contact. Try another name.") }
            ForEach(contacts, id: \.chatUserId) { person in Button { Task { await start(person) } } label: { VStack(alignment: .leading, spacing: 6) { Text(person.name).font(.headline); if let context = person.context { Text(context).font(.caption).foregroundStyle(.secondary) } } }.disabled(model.busy) }
            if cursor != nil { Button("More people") { Task { await load(more: true) } } }
        }.navigationTitle("New message").searchable(text: $query, prompt: "Find someone").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }.task(id: query) { do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation(); await load() } catch {} } }
    }
    private func load(more: Bool = false) async {
        do { var params = ["q": query]; if more { params["cursor"] = cursor }; let page = try await model.read("\(model.messagingPath)/contacts", query: params, as: MessagingContactPage.self); try Task.checkCancellation(); contacts = more ? contacts + page.items : page.items; cursor = page.nextCursor; loading = false }
        catch is CancellationError {} catch { model.error = GroupsModel.message(error); loading = false }
    }
    private func start(_ person: MessagingContact) async {
        await model.perform("") { let channel = try await model.send("\(model.messagingPath)/direct", body: StartDirectMessageRequest(chatUserId: person.chatUserId), as: DirectConversation.self); guard channel.state != "pending" else { throw APIError(code: .invalidRequest, message: "Your conversation is being prepared. Please try again in a moment.") }; open(.init(cid: channel.cid, name: person.name, readOnly: channel.state != "ready")) }
    }
}

/// Uses the system document picker; no photo-library or microphone permission.
struct GroupFilePicker: View {
    let options: AttachmentPickerViewOptions
    @State private var choosing = false
    @State private var error: String?
    var body: some View {
        VStack(spacing: 16) {
            if options.isDisplayed {
                Button("Choose a photo, video, or document", systemImage: "paperclip") { choosing = true }
                    .buttonStyle(.bordered).padding()
                if let error { Text(error).font(.caption).foregroundStyle(.red) }
            }
        }
        .frame(height: options.isDisplayed ? 110 : 0)
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.image, .movie, .pdf], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): options.onFilesPicked(urls)
            case .failure: error = "That file couldn’t be opened. Please try another."
            }
        }
    }
}
