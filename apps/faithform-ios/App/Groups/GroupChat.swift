import SwiftUI
import UniformTypeIdentifiers
import FaithFormKit
import StreamChat
import StreamChatSwiftUI
import StreamChatCommonUI

@MainActor final class GroupChatSession: ObservableObject {
    @Published private(set) var client: ChatClient?
    @Published private(set) var session: FaithFormKit.ChatSession?
    private var stream: StreamChatSwiftUI.StreamChat?
    private var connecting: Task<Void, Error>?
    private let appearance = Appearance()
    private var channels: [String: ChatChannelController] = [:]
    func updateTheme(_ theme: FaithFormTheme) { _ = groupChatAppearance(theme, appearance: appearance) }
    func connect(_ model: GroupsModel, theme: FaithFormTheme) async throws {
        updateTheme(theme)
        if client != nil { return }
        if let connecting { return try await connecting.value }
        let task = Task { @MainActor in
            let auth = try await model.send("\(model.messagingPath)/session", as: FaithFormKit.ChatSession.self)
            try Task.checkCancellation()
            var config = ChatClientConfig(apiKey: .init(auth.appKey)); config.isLocalStorageEnabled = false
            let chat = ChatClient(config: config)
            let tokens = GroupChatTokens(first: auth.userToken, api: model.api, route: "\(model.messagingPath)/session")
            do {
                try await chat.connectUser(userInfo: .init(id: auth.chatUserId), tokenProvider: { completion in
                    Task {
                        do { completion(.success(try await tokens.next())) }
                        catch { completion(.failure(error)) }
                    }
                })
                try Task.checkCancellation()
                self.stream = StreamChatSwiftUI.StreamChat(chatClient: chat, appearance: appearance, utils: Utils(messageListConfig: MessageListConfig(handleTabBarVisibility: false), composerConfig: ComposerConfig(isVoiceRecordingEnabled: false, maxAttachmentSize: 25 * 1024 * 1024), shouldSyncChannelControllerOnAppear: { $0.channel == nil }))
                self.session = auth; self.client = chat
            } catch { await chat.disconnect(); throw error }
        }
        connecting = task
        defer { connecting = nil }
        try await task.value
    }
    func channel(for cid: String) async throws -> ChatChannelController {
        if let cached = channels[cid] { return cached }
        guard let client else { throw APIError(code: .unavailable, message: "Reconnect to continue.") }
        let value = client.channelController(for: try ChannelId(cid: cid))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            value.synchronize { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        try Task.checkCancellation()
        guard self.client === client else { throw CancellationError() }
        channels[cid] = value
        return value
    }
    func disconnect() {
        channels.removeAll()
        connecting?.cancel(); connecting = nil
        let old = client; client = nil; session = nil; stream = nil
        Task { await old?.disconnect() }
    }
}

/// Reuse the bootstrap token once, then request fresh tokens only for SDK refreshes.
private actor GroupChatTokens {
    var first: String?
    let api: APIClient
    let route: String
    init(first: String, api: APIClient, route: String) { self.first = first; self.api = api; self.route = route }
    func next() async throws -> Token {
        if let first { self.first = nil; return try Token(rawValue: first) }
        let response = try await api.send(route, method: .post, as: FaithFormKit.ChatSession.self)
        guard let fresh = response.value else { throw APIError(code: .unauthenticated, message: "Sign in again to continue.") }
        return try Token(rawValue: fresh.userToken)
    }
}

struct SafetySelection: Identifiable { let id = UUID(); let cid: String; let userId: String; let name: String; let messageId: String }
@MainActor final class FaithFormChatFactory: ViewFactory {
    @Injected(\.chatClient) var chatClient
    var styles = RegularStyles()
    let readOnly: Bool
    /// Chat user ids this person has blocked. See `GroupsModel.blockedChatUserIds`.
    let blocked: Set<String>
    let report: (SafetySelection) -> Void
    /// `blocked` has no default on purpose: every place that builds a factory
    /// has to say what it knows, or a blocked person reappears in whichever
    /// surface forgot — which is how the direct-message list used to preview
    /// their last message while their messages were hidden in the group.
    init(readOnly: Bool, blocked: Set<String>, report: @escaping (SafetySelection) -> Void) {
        self.readOnly = readOnly; self.blocked = blocked; self.report = report; styles.composerPlacement = .docked
    }
    /// A blocked person's messages, hidden in place.
    ///
    /// The provider's block stops direct messages and nothing else, so this is
    /// what makes blocking mean the same thing inside a group. Hidden rather
    /// than removed: a gap where a message was is confusing, and the person who
    /// blocked them can still tell a conversation happened.
    @ViewBuilder func makeMessageItemView(options: MessageItemViewOptions) -> some View {
        if !options.message.isSentByCurrentUser, blocked.contains(options.message.author.id) {
            BlockedMessageRow()
        } else {
            MessageItemView(
                factory: self,
                channel: options.channel,
                message: options.message,
                width: options.width,
                showsAllInfo: options.showsAllInfo,
                shownAsPreview: options.shownAsPreview,
                isInThread: options.isInThread,
                isLast: options.isLast,
                scrolledId: options.scrolledId,
                quotedMessage: options.quotedMessage,
                onLongPress: options.onLongPress,
                viewModel: options.viewModel
            )
        }
    }
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
    /// "…is typing" names the person, so a blocked one is left out of it.
    @ViewBuilder func makeInlineTypingIndicatorView(options: TypingIndicatorViewOptions) -> some View {
        let typing = options.channel.currentlyTypingUsersFiltered(currentUserId: options.currentUserId)
        if !typing.isEmpty, typing.allSatisfy({ blocked.contains($0.id) }) {
            EmptyView()
        } else {
            TypingIndicatorView(
                users: Array(typing),
                typingText: options.channel.typingIndicatorString(currentUserId: options.currentUserId)
            )
        }
    }
    /// A quote carries the quoted person's words inside someone else's
    /// message, which is the one way a blocked person's content still reaches
    /// the screen once their own messages are hidden.
    @ViewBuilder func makeQuotedMessageView(options: QuotedMessageViewOptions) -> some View {
        if blocked.contains(options.quotedMessage.author.id) {
            Text("Quoted message hidden because you blocked this person.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(options.padding ?? EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
        } else {
            QuotedMessageView(
                factory: self,
                viewModel: QuotedMessageViewModel(
                    message: options.quotedMessage,
                    currentUser: chatClient.currentUserController().currentUser,
                    outgoing: options.outgoing
                ),
                padding: options.padding
            )
        }
    }
    @ViewBuilder func makeMessageComposerViewType(options: MessageComposerViewTypeOptions) -> some View {
        if readOnly { Text("This conversation is read-only.").font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding() }
        else {
            MessageComposerView(
                viewFactory: self,
                channelController: options.channelController,
                messageController: options.messageController,
                quotedMessage: options.quotedMessage,
                editedMessage: options.editedMessage,
                willSendMessage: options.willSendMessage
            )
        }
    }
    func makeChannelBarsVisibilityViewModifier(options: ChannelBarsVisibilityViewModifierOptions) -> some ViewModifier {
        FaithFormConversationBars(shouldShowNavigation: options.shouldShow)
    }
    func makeChannelLoadingView(options: ChannelLoadingViewOptions) -> some View {
        ConversationSkeleton()
    }
    func makeAttachmentPickerView(options: AttachmentPickerViewOptions) -> some View {
        GroupFilePicker(options: options)
    }
    func makeChannelHeaderViewModifier(options: ChannelHeaderViewModifierOptions) -> some ChatChannelHeaderViewModifier {
        FaithFormConversationHeader(channel: options.channel)
    }
    func makeChannelListHeaderViewModifier(options: ChannelListHeaderViewModifierOptions) -> some ChannelListHeaderViewModifier { FaithFormChatListHeader(title: options.title) }
}
/// What stands in for a blocked person's message.
struct BlockedMessageRow: View {
    var body: some View {
        Text("Message hidden because you blocked this person.")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 6)
            .padding(.horizontal, 16)
    }
}

/// The conversation owns its chrome, including while reactions are presented.
struct FaithFormConversationBars: ViewModifier {
    let shouldShowNavigation: Bool
    func body(content: Content) -> some View {
        content
            .toolbar(shouldShowNavigation ? .visible : .hidden, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
    }
}
struct FaithFormConversationHeader: ChatChannelHeaderViewModifier {
    let channel: ChatChannel
    func body(content: Content) -> some View { content }
}
struct FaithFormChatListHeader: ChannelListHeaderViewModifier {
    let title: String
    func body(content: Content) -> some View { content }
}

struct GroupConversationView: View {
    @Environment(\.faithformTheme) private var theme
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
                ChatChannelView(viewFactory: FaithFormChatFactory(readOnly: readOnly || session.session?.suspended == true, blocked: model.blockedChatUserIds, report: { safety = $0 }), channelController: controller)
            } else if failed { VStack { GroupEmpty(symbol: "bubble.left.and.bubble.right", title: "Let’s reconnect", message: "Messages are unavailable right now. Your group is still here."); Button("Try again") { retry += 1 } } }
            else { ConversationSkeleton() }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.palette.background)
        .toolbar(.hidden, for: .tabBar)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
        .task(id: "\(cid)|\(retry)") {
            do {
                failed = false
                try await session.connect(model, theme: theme)
                await model.loadBlocked()
                controller = try await session.channel(for: cid)
            }
            catch is CancellationError {} catch { failed = true }
        }
        .onChange(of: theme.palette.background) { _, _ in session.updateTheme(theme) }
        .onChange(of: theme.palette.brandAccent) { _, _ in session.updateTheme(theme) }
        .sheet(item: $safety) { selection in GroupSafetyView(model: model, cid: selection.cid, userId: selection.userId, name: selection.name, messageId: selection.messageId) }
    }
}
struct DirectSelection: Identifiable { let cid: String; let name: String; let readOnly: Bool; var id: String { cid } }
struct GroupMessagesView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: GroupsModel
    @EnvironmentObject private var session: GroupChatSession
    @State private var list: ChatChannelListController?
    @State private var compose = false
    @State private var selected: DirectSelection?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        VStack {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your conversations").font(.title3.weight(.semibold))
                    Text("A little encouragement goes a long way.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button { compose = true } label: { Image(systemName: "square.and.pencil").frame(width: 48, height: 48).foregroundStyle(theme.palette.contentOnAccent).background(theme.palette.brandAccent, in: Circle()) }.accessibilityLabel("New message")
            }.padding(.horizontal, 20).padding(.vertical, 12)
            if let list, session.client != nil {
                ChatChannelListView(viewFactory: FaithFormChatFactory(readOnly: false, blocked: model.blockedChatUserIds, report: { _ in }), channelListController: list, title: "Messages", onItemTap: { channel in selected = DirectSelection(cid: channel.cid.rawValue, name: channel.name ?? "Conversation", readOnly: channel.isFrozen) }, embedInNavigationView: false)
            } else if failed { GroupEmpty(symbol: "bubble.left", title: "Messages are taking a moment", message: "Please check your connection and try again."); Button("Try again") { retry += 1 } }
            else { ConversationListSkeleton().padding(20).frame(maxHeight: .infinity, alignment: .top) }
        }
        .task(id: retry) {
            do { failed = false; try await session.connect(model, theme: theme); guard let client = session.client, let auth = session.session else { return }; let query = ChannelListQuery(filter: .and([.equal(.type, to: .custom("ff_dm")), .equal(.team, to: auth.churchTeam), .containMembers(userIds: [auth.chatUserId])])); list = client.channelListController(query: query) }
            catch is CancellationError {} catch { failed = true }
        }
        .onChange(of: theme.palette.background) { _, _ in session.updateTheme(theme) }
        .onChange(of: theme.palette.brandAccent) { _, _ in session.updateTheme(theme) }
        .sheet(isPresented: $compose) { GroupContactsView(model: model, open: { selected = $0; compose = false }) }
        .navigationDestination(item: $selected) { selection in GroupConversationView(model: model, cid: selection.cid, title: selection.name, readOnly: selection.readOnly) }
    }
}
extension DirectSelection: Hashable {}
struct GroupContactsView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: GroupsModel
    let open: (DirectSelection) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var contacts: [MessagingContact] = []
    @State private var query = ""
    @State private var cursor: String?
    @State private var loading = true
    var body: some View {
        NavigationStack { List {
            FaithFormSearchField(placeholder: "Find someone", text: $query, onSubmit: {}).listRowSeparator(.hidden)
            GroupFeedback(model: model)
            if loading { GroupPeopleSkeleton().listRowSeparator(.hidden) }
            else if contacts.isEmpty { GroupEmpty(symbol: "person.crop.circle.badge.plus", title: "No people found", message: "Your church’s messaging settings decide who you can contact. Try another name.") }
            ForEach(contacts, id: \.chatUserId) { person in Button { Task { await start(person) } } label: { VStack(alignment: .leading, spacing: 6) { Text(person.name).font(.headline); if let context = person.context { Text(context).font(.caption).foregroundStyle(.secondary) } } }.disabled(model.busy) }
            if cursor != nil { Button("More people") { Task { await load(more: true) } } }
        }.listStyle(.plain).scrollContentBackground(.hidden).background(theme.palette.background).navigationTitle("New message").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }.task(id: query) { do { try await Task.sleep(for: .milliseconds(250)); try Task.checkCancellation(); await load() } catch {} } }
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

/// Resolve chat surfaces from the same church palette as the surrounding app.
@MainActor private func groupChatAppearance(_ theme: FaithFormTheme, appearance: Appearance) -> Appearance {
    let colors = appearance.colorPalette
    let palette = theme.palette
    colors.accentPrimary = UIColor(palette.brandAccent)
    colors.brand400 = UIColor(palette.brandAccent)
    colors.brand500 = UIColor(palette.brandAccent)
    colors.textPrimary = UIColor(palette.contentPrimary)
    colors.textSecondary = UIColor(palette.contentSecondary)
    colors.textTertiary = UIColor(theme.mutedContent)
    colors.textOnAccent = UIColor(palette.contentOnAccent)
    colors.textLink = UIColor(palette.brandAccent)
    colors.backgroundCoreApp = UIColor(palette.background)
    colors.backgroundCoreElevation0 = UIColor(palette.background)
    colors.backgroundCoreElevation1 = UIColor(palette.background)
    colors.backgroundCoreElevation2 = UIColor(palette.surface)
    colors.backgroundCoreSurfaceDefault = UIColor(palette.surfaceSunken)
    colors.backgroundCoreSurfaceSubtle = UIColor(palette.surfaceSunken)
    colors.backgroundCoreSurfaceCard = UIColor(palette.surface)
    colors.borderCoreDefault = UIColor(palette.border)
    colors.borderCoreSubtle = UIColor(palette.divider)
    colors.chatBackgroundIncoming = UIColor(palette.surface)
    colors.chatBackgroundOutgoing = UIColor(palette.surfaceSunken)
    colors.chatBorderIncoming = UIColor(palette.border)
    colors.chatBorderOutgoing = UIColor(palette.border)
    colors.chatTextIncoming = UIColor(palette.contentPrimary)
    colors.chatTextOutgoing = UIColor(palette.contentPrimary)
    colors.navigationBarBackground = UIColor(palette.background)
    return appearance
}
