package io.faithform.app.ui.groups

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.faithform.app.contract.*
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import kotlinx.serialization.serializer

/** Ephemeral state, owned by the selected account/church/authorization partition. */
class GroupsStore(val api: ApiClient, val slug: String) {
    val path = "api/mobile/v1/groups/$slug"
    val messagingPath = "api/mobile/v1/messaging/$slug"
    var home by mutableStateOf<MyGroups?>(null)
    var discovered by mutableStateOf<List<GroupSummary>>(emptyList())
    var filters by mutableStateOf<GroupFilters?>(null)
    var nextCursor by mutableStateOf<String?>(null)
    var loading by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var feedback by mutableStateOf<String?>(null)
    private var generation = 0

    suspend inline fun <reified T> read(route: String, query: Map<String, String> = emptyMap()): T =
        api.send(route, MobileSuccess.serializer(serializer<T>()), query = query).value
            ?: throw IllegalStateException("Please try again.")

    suspend inline fun <reified T> send(route: String, body: JsonObject? = null, method: String = "POST", key: String? = null): T =
        api.send(route, MobileSuccess.serializer(serializer<T>()), method = method, body = body?.toString(), idempotencyKey = key).value
            ?: throw IllegalStateException("Please try again.")

    suspend fun load() {
        loading = home == null; error = null
        try { home = read(path); filters = read("$path/filters") }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = message(e) }
        finally { loading = false }
    }
    suspend fun discover(query: String, category: String, more: Boolean = false) {
        val request = ++generation
        if (!more) loading = true
        error = null
        try {
            val params = mutableMapOf("q" to query, "type" to category, "limit" to "20")
            if (more) nextCursor?.let { params["cursor"] = it }
            val page = read<GroupDiscoveryPage>("$path/discover", params)
            if (generation == request) { discovered = (if (more) discovered + page.items else page.items).distinctBy { it.id }; nextCursor = page.nextCursor }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (generation == request) error = message(e) }
        finally { if (generation == request) loading = false }
    }
    suspend fun action(success: String, operation: suspend () -> Unit): Boolean {
        if (busy) return false
        busy = true; error = null; feedback = null
        return try { operation(); feedback = success; true }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = message(e); false }
        finally { busy = false }
    }
    suspend fun membership(group: GroupSummary, note: String = ""): Boolean = action(
        when (group.joinAction) { "leave" -> "You left the group."; "cancel_request" -> "Request cancelled."; "request" -> "Your request has been sent."; else -> "Welcome to the group!" },
    ) {
        val endpoint = if (group.joinAction in listOf("leave", "cancel_request")) "leave" else "join"
        val result = send<GroupJoinResult>("$path/${group.id}/$endpoint", buildJsonObject { put("message", note) })
        if (result.outcome !in listOf("joined", "already_member", "requested", "already_requested", "left", "request_cancelled", "not_member")) throw IllegalStateException(outcomeMessage(result.outcome))
        home = read(path)
    }
    companion object {
        fun message(error: Exception): String = if (error is ApiException || error is IllegalStateException) error.message ?: "Please try again." else "We couldn’t connect. Please try again."
        fun outcomeMessage(outcome: String) = when (outcome) {
            "full" -> "This group is full. Please check back or find another group."
            "closed" -> "This group isn’t accepting new members right now."
            "invitation_required", "invitation_invalid" -> "Ask a leader for a current invitation link."
            else -> "This action is no longer available. Refresh to see the latest details."
        }
    }
}
