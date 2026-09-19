package io.faithform.app.ui.groups

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.app.contract.*
import io.getstream.chat.android.client.ChatClient
import io.getstream.chat.android.client.token.TokenProvider
import io.getstream.chat.android.models.*
import io.getstream.chat.android.state.plugin.config.StatePluginConfig
import io.getstream.chat.android.state.plugin.factory.StreamStatePluginFactory
import io.getstream.chat.android.compose.ui.theme.ChatTheme
import io.getstream.chat.android.compose.ui.theme.ChatComponentFactory
import io.getstream.chat.android.compose.state.messageoptions.MessageOptionItemState
import io.getstream.chat.android.compose.ui.messages.MessagesScreen
import io.getstream.chat.android.compose.ui.messages.composer.MessageComposer
import io.getstream.chat.android.compose.viewmodel.messages.MessagesViewModelFactory
import io.getstream.chat.android.compose.viewmodel.messages.MessageComposerViewModel
import io.getstream.chat.android.compose.viewmodel.messages.MessageListViewModel
import io.getstream.chat.android.ui.common.state.messages.MessageAction
import io.getstream.chat.android.ui.common.state.messages.Flag
import io.getstream.chat.android.client.api.models.QueryChannelsRequest
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.io.File

/** In-memory chat state. A church/account change destroys the connection and its temporary uploads. */
class GroupChatConnection {
    var client by mutableStateOf<ChatClient?>(null); private set
    var session by mutableStateOf<ChatSession?>(null); private set
    private val mutex = Mutex()
    private var disposed = false
    val uploadFiles = mutableListOf<File>()
    suspend fun connect(store: GroupsStore, context: Context): ChatClient = mutex.withLock {
        client?.let { return@withLock it }
        check(!disposed)
        val auth = store.send<ChatSession>("${store.messagingPath}/session")
        val chat = ChatClient.Builder(auth.appKey, context.applicationContext)
            .withPlugins(StreamStatePluginFactory(config = StatePluginConfig(), appContext = context.applicationContext)).build()
        try {
            val result = chat.connectUser(User(id = auth.chatUserId), object : TokenProvider {
                override fun loadToken(): String = runBlocking { store.send<ChatSession>("${store.messagingPath}/session").userToken }
            }).await()
            if (result.isFailure) throw IllegalStateException("Messages couldn’t connect. Please try again.")
            currentCoroutineContext().ensureActive(); check(!disposed)
            session = auth; client = chat; chat
        } catch (e: Exception) { chat.disconnect(flushPersistence = true).enqueue(); throw e }
    }
    fun disconnect() { disposed = true; client?.disconnect(flushPersistence = true)?.enqueue(); client = null; session = null; uploadFiles.forEach { it.delete() }; uploadFiles.clear() }
}
private data class SafetyTarget(val userId: String, val name: String, val messageId: String? = null)
private class ChannelModels : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }

@Composable fun GroupConversation(store: GroupsStore, connection: GroupChatConnection, cid: String, readOnly: Boolean = false, onBack: () -> Unit) {
    val context = LocalContext.current
    var ready by remember(cid) { mutableStateOf(false) }
    var failed by remember(cid) { mutableStateOf(false) }
    var retry by remember(cid) { mutableIntStateOf(0) }
    var safety by remember(cid) { mutableStateOf<SafetyTarget?>(null) }
    val owner = remember(cid) { ChannelModels() }
    DisposableEffect(owner) { onDispose { owner.viewModelStore.clear() } }
    LaunchedEffect(cid, retry) { try { failed = false; connection.connect(store, context); ready = true } catch (e: CancellationException) { throw e } catch (_: Exception) { failed = true } }
    safety?.let { target -> GroupSafety(store, cid, target.userId, target.name, target.messageId) { safety = null } }
    if (ready && connection.client != null) {
        val factory = remember(cid) { MessagesViewModelFactory(context, channelId = cid) }
        val components = remember(cid) { object : ChatComponentFactory {
            @Composable override fun MessageMenuCenterContent(modifier: Modifier, message: Message, messageOptions: List<MessageOptionItemState>, onMessageAction: (MessageAction) -> Unit, ownCapabilities: Set<String>) {
                Column(modifier) {
                    super.MessageMenuCenterContent(Modifier, message, messageOptions.filter { it.action !is Flag }, onMessageAction, ownCapabilities)
                    if (message.user.id != connection.session?.chatUserId) TextButton(onClick = { safety = SafetyTarget(message.user.id, message.user.name.ifBlank { "this person" }, message.id) }, modifier = Modifier.fillMaxWidth()) { Text("Report or block") }
                }
            }
        } }
        CompositionLocalProvider(LocalViewModelStoreOwner provides owner) {
            ChatTheme(componentFactory = components) {
                MessagesScreen(viewModelFactory = factory, onBackPressed = onBack,
                    onUserAvatarClick = { user -> if (user.id != connection.session?.chatUserId) safety = SafetyTarget(user.id, user.name.ifBlank { "this person" }) },
                    bottomBarContent = {
                        if (readOnly || connection.session?.suspended == true) Text("This conversation is read-only.", modifier = Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodySmall)
                        else GroupComposer(store, connection, factory)
                    })
            }
        }
    } else if (failed) Column { GroupEmpty("Let’s reconnect", "Messages are unavailable right now. Your group is still here."); TextButton(onClick = { retry++ }) { Text("Try again") } }
    else Box(Modifier.fillMaxSize()) { CircularProgressIndicator(Modifier.padding(32.dp)) }
}

@Composable private fun GroupComposer(store: GroupsStore, connection: GroupChatConnection, factory: MessagesViewModelFactory) {
    val composer: MessageComposerViewModel = viewModel(factory = factory)
    val messages: MessageListViewModel = viewModel(factory = factory)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preparing by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            preparing = true
            try {
                val attachment = withContext(Dispatchers.IO) {
                    val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                    val file = File.createTempFile("group-upload-", ".${android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "bin"}", context.cacheDir)
                    try {
                        context.contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { output ->
                            val buffer = ByteArray(8192); var total = 0
                            while (true) { val n = input.read(buffer); if (n < 0) break; total += n; require(total <= 25 * 1024 * 1024) { "Please choose a file smaller than 25 MB." }; output.write(buffer, 0, n) }
                        } } ?: error("This file couldn’t be opened.")
                        connection.uploadFiles.add(file)
                        Attachment(type = when { mime.startsWith("image/") -> "image"; mime.startsWith("video/") -> "video"; else -> "file" }, mimeType = mime, upload = file, name = "Attachment.${file.extension}")
                    } catch (e: Exception) { file.delete(); throw e }
                }
                composer.addSelectedAttachments(listOf(attachment))
            } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } finally { preparing = false }
        }
    }
    Column {
        GroupFeedback(store)
        MessageComposer(viewModel = composer, onCancelAction = { messages.dismissAllMessageActions(); composer.dismissMessageActions() },
            integrations = { IconButton(enabled = !preparing, onClick = { picker.launch(arrayOf("image/*", "video/*", "application/pdf")) }) { Icon(Icons.Outlined.AttachFile, "Attach a photo, video, or PDF") } },
            trailingContent = { state -> TextButton(enabled = !preparing && (state.inputValue.isNotBlank() || state.attachments.isNotEmpty()), onClick = { composer.sendMessage(composer.buildNewMessage(state.inputValue, state.attachments)) }) { Text("Send") } })
    }
}

@Composable fun GroupMessages(store: GroupsStore, connection: GroupChatConnection) {
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    var channels by remember { mutableStateOf<List<Channel>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var selected by remember { mutableStateOf<Channel?>(null) }
    var newConversation by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var direct by remember { mutableStateOf<DirectConversation?>(null) }
    val activeCid = direct?.cid ?: selected?.cid
    if (activeCid != null) { GroupConversation(store, connection, activeCid, direct?.let { it.state != "ready" } ?: (selected?.frozen == true), onBack = { direct = null; selected = null; refresh++ }); return }
    if (newConversation) GroupContacts(store, onDismiss = { newConversation = false }, open = { direct = it; newConversation = false })
    LaunchedEffect(refresh) {
        try {
            loading = true; val client = connection.connect(store, context); val auth = connection.session!!
            val result = client.queryChannels(QueryChannelsRequest(filter = Filters.and(Filters.eq("type", "ff_dm"), Filters.eq("team", auth.churchTeam), Filters.`in`("members", listOf(auth.chatUserId))), offset = 0, limit = 30)).await()
            if (result.isSuccess) channels = result.getOrThrow() else error("Messages couldn’t load. Please try again.")
        } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } finally { loading = false }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Your conversations", style = MaterialTheme.typography.titleLarge); IconButton(onClick = { newConversation = true }) { Icon(Icons.Outlined.Edit, "New message") } }; Text("A little encouragement goes a long way.", style = MaterialTheme.typography.bodyMedium); GroupFeedback(store) }
        if (loading) item { CircularProgressIndicator() }
        else if (channels.isEmpty()) item { GroupEmpty("Start a conversation", "Send a little encouragement to someone in your community.") }
        items(channels, key = { it.cid }) { channel -> Surface(shape = MaterialTheme.shapes.large, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth().clickable { selected = channel }) { Column(Modifier.padding(18.dp)) { Text(channel.name.ifBlank { channel.members.filter { it.user.id != connection.session?.chatUserId }.joinToString { it.user.name }.ifBlank { "Conversation" } }, style = MaterialTheme.typography.titleMedium); Text(channel.messages.lastOrNull()?.text?.take(120) ?: "Say hello", maxLines = 2, style = MaterialTheme.typography.bodyMedium); if (channel.unreadCount ?: 0 > 0) Text("${channel.unreadCount} new", style = MaterialTheme.typography.labelMedium) } } }
        item { TextButton(onClick = { refresh++ }) { Text("Refresh messages") } }
    }
}
@Composable private fun GroupContacts(store: GroupsStore, onDismiss: () -> Unit, open: (DirectConversation) -> Unit) {
    var query by remember { mutableStateOf("") }; var people by remember { mutableStateOf<List<MessagingContact>>(emptyList()) }; var cursor by remember { mutableStateOf<String?>(null) }; var loading by remember { mutableStateOf(true) }; val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) { try { val args = mutableMapOf("q" to query); if (more) cursor?.let { args["cursor"] = it }; val page = store.read<MessagingContactPage>("${store.messagingPath}/contacts", args); people = if (more) people + page.items else page.items; cursor = page.nextCursor } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } finally { loading = false } }
    LaunchedEffect(query) { delay(250); load() }
    GroupFormSheet("New message", onDismiss) {
        OutlinedTextField(query, { query = it }, label = { Text("Find someone") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        GroupFeedback(store)
        if (loading) CircularProgressIndicator() else if (people.isEmpty()) GroupEmpty("No people found", "Your church’s messaging settings decide who you can contact. Try another name.")
        people.forEach { person -> TextButton(enabled = !store.busy, onClick = { scope.launch { store.action("") { val channel = store.send<DirectConversation>("${store.messagingPath}/direct", buildJsonObject { put("chatUserId", person.chatUserId) }); if (channel.state == "pending") error("Your conversation is being prepared. Please try again in a moment."); open(channel) } } }, modifier = Modifier.fillMaxWidth()) { Column(Modifier.fillMaxWidth()) { Text(person.name, style = MaterialTheme.typography.titleMedium); person.context?.let { Text(it, style = MaterialTheme.typography.bodySmall) } } } }
        if (cursor != null) TextButton(onClick = { scope.launch { load(true) } }) { Text("More people") }
    }
}
