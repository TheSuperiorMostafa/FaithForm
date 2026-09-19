package io.faithform.app.ui.groups

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import io.faithform.app.contract.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.Instant
import java.util.UUID

@Composable fun GroupEvents(store: GroupsStore, detail: GroupDetail) {
    var items by remember { mutableStateOf<List<GroupEventSummary>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var whenFilter by remember { mutableStateOf("upcoming") }
    var loaded by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) { try { val query = mutableMapOf("when" to whenFilter); if (more) cursor?.let { query["cursor"] = it }; val page = store.read<GroupEventPage>("${store.path}/${detail.group.id}/events", query); items = if (more) items + page.items else page.items; cursor = page.nextCursor; loaded = true } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e); loaded = true } }
    LaunchedEffect(whenFilter) { loaded = false; load() }
    selected?.let { eventId -> GroupEventDetails(store, detail.group.id, eventId, onBack = { selected = null; scope.launch { load() } }); return }
    if (adding) GroupEventForm(store, detail.group.id, onDismiss = { adding = false; scope.launch { load() } })
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { FilterChip(whenFilter == "upcoming", { whenFilter = "upcoming" }, label = { Text("Coming up") }); FilterChip(whenFilter == "past", { whenFilter = "past" }, label = { Text("Past") }) } }
        item { GroupFeedback(store) }
        if (detail.capabilities.canManageEvents && !detail.isArchived) item { OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add, null); Text("Plan a gathering") } }
        if (!loaded) item { CircularProgressIndicator() }
        else if (items.isEmpty()) item { GroupEmpty("Make time for each other", "Your group’s gatherings will appear here.", Icons.Outlined.CalendarMonth) }
        items(items, key = { it.id }) { event -> Surface(modifier = Modifier.fillMaxWidth().clickable { selected = event.id }) { Column(Modifier.padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(event.title, style = MaterialTheme.typography.titleMedium); Text(groupDate(event.startsAt), style = MaterialTheme.typography.bodySmall); if (event.isCancelled) GroupBadge("Cancelled") else Text("${event.goingCount} going${if (event.rsvp == "going") " · You’re in" else ""}", style = MaterialTheme.typography.bodySmall) } } }
        if (cursor != null) item { TextButton(onClick = { scope.launch { load(true) } }) { Text("More gatherings") } }
    }
}
@Composable fun GroupEventDetails(store: GroupsStore, groupId: String, eventId: String, onBack: () -> Unit) {
    var detail by remember(eventId) { mutableStateOf<GroupEventDetail?>(null) }
    var attendance by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf(false) }
    var cancel by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val path = "${store.path}/$groupId/events/$eventId"
    val uri = LocalUriHandler.current
    suspend fun load() { try { detail = store.read(path) } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } }
    LaunchedEffect(eventId) { load() }
    BackHandler(onBack = onBack)
    if (attendance) GroupAttendance(store, path, onDismiss = { attendance = false; scope.launch { load() } })
    if (edit) GroupEventForm(store, groupId, existing = detail, onDismiss = { edit = false; scope.launch { load() } })
    if (cancel) AlertDialog(onDismissRequest = { cancel = false }, title = { Text("Cancel this gathering?") }, text = { Text("Members will be notified.") }, dismissButton = { TextButton(onClick = { cancel = false }) { Text("Keep gathering") } }, confirmButton = { TextButton(onClick = { scope.launch { store.action("Gathering cancelled.") { store.send<JsonObject>("$path/cancel", buildJsonObject { put("reason", "Cancelled by a group leader") }); load() }; cancel = false } }, enabled = !store.busy) { Text("Cancel gathering") } })
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { TextButton(onClick = onBack) { Icon(Icons.Outlined.ChevronLeft, null); Text("All gatherings") } }
        item { GroupFeedback(store) }
        val d = detail
        if (d == null) item { CircularProgressIndicator() }
        else {
            item { Text(d.event.title, style = MaterialTheme.typography.headlineMedium); Text(groupDate(d.event.startsAt), style = MaterialTheme.typography.bodyMedium) }
            d.description?.let { item { Text(it) } }
            d.event.locationName?.let { item { Text(it) } }
            d.locationAddress?.let { item { Text(it) } }
            d.onlineMeetingUrl?.let { link -> item { TextButton(onClick = { uri.openUri(link) }) { Text("Join online") } } }
            if (d.event.isCancelled) item { GroupBadge("This gathering is cancelled") }
            else {
                item { GroupPanel("Will you be there?") { listOf("going" to "I’ll be there", "maybe" to "Maybe", "not_going" to "Can’t make it").forEach { (value, title) -> OutlinedButton(enabled = !store.busy, onClick = { scope.launch { store.action("Your response is saved.") { store.send<JsonObject>("$path/rsvp", buildJsonObject { put("response", value) }, "PUT"); load() } } }, modifier = Modifier.fillMaxWidth()) { Text(title); if (d.event.rsvp == value) { Spacer(Modifier.width(8.dp)); Icon(Icons.Outlined.Check, null) } } }; Text("${d.rsvpCounts.going} going · ${d.rsvpCounts.maybe} maybe", style = MaterialTheme.typography.bodySmall) } }
                if (d.canTakeAttendance) item { Button(onClick = { attendance = true }, modifier = Modifier.fillMaxWidth()) { Text("Take attendance") } }
                if (d.canEdit) item { Row { TextButton(onClick = { edit = true }) { Text("Edit gathering") }; TextButton(onClick = { cancel = true }) { Text("Cancel gathering") } } }
            }
        }
    }
}
@Composable fun GroupEventForm(store: GroupsStore, groupId: String, existing: GroupEventDetail? = null, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf(existing?.event?.title ?: "") }
    var location by remember { mutableStateOf(existing?.event?.locationName ?: "") }
    var notes by remember { mutableStateOf(existing?.description ?: "") }
    fun local(instant: String?) = instant?.let { runCatching { LocalDateTime.ofInstant(Instant.parse(it), ZoneId.systemDefault()).toString().take(16) }.getOrNull() }
    var start by remember { mutableStateOf(local(existing?.event?.startsAt) ?: LocalDateTime.now().plusDays(1).withSecond(0).withNano(0).toString()) }
    var end by remember { mutableStateOf(local(existing?.event?.endsAt) ?: LocalDateTime.now().plusDays(1).plusHours(1).withSecond(0).withNano(0).toString()) }
    GroupFormSheet(if (existing == null) "Plan a gathering" else "Edit gathering", onDismiss) {
        OutlinedTextField(title, { title = it.take(120) }, label = { Text("Gathering name") }, modifier = Modifier.fillMaxWidth())
        GroupDateTimeField("Starts", start) { start = it }
        GroupDateTimeField("Ends", end) { end = it }
        Text("Times are in ${ZoneId.systemDefault().id}.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(location, { location = it.take(200) }, label = { Text("Meeting place") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(notes, { notes = it.take(4000) }, label = { Text("What to know or bring") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        GroupFeedback(store)
        Button(enabled = !store.busy && title.isNotBlank(), onClick = { scope.launch { if (store.action("Gathering saved.") { val starts = LocalDateTime.parse(start).atZone(ZoneId.systemDefault()).toInstant(); val ends = LocalDateTime.parse(end).atZone(ZoneId.systemDefault()).toInstant(); require(ends > starts) { "Choose an end time after the start." }; store.send<JsonObject>("${store.path}/$groupId/events" + (existing?.let { "/${it.event.id}" } ?: ""), buildJsonObject { put("title", title); put("description", notes); put("startsAt", starts.toString()); put("endsAt", ends.toString()); put("timezone", ZoneId.systemDefault().id); put("locationName", location); put("locationAddress", existing?.locationAddress?.let(::JsonPrimitive) ?: JsonNull); put("onlineMeetingUrl", existing?.onlineMeetingUrl?.let(::JsonPrimitive) ?: JsonNull) }, if (existing == null) "POST" else "PATCH") }) onDismiss() } }, modifier = Modifier.fillMaxWidth()) { Text("Save gathering") }
    }
}
@Composable private fun GroupDateTimeField(title: String, value: String, onChange: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val current = runCatching { LocalDateTime.parse(value) }.getOrDefault(LocalDateTime.now())
    OutlinedButton(onClick = { android.app.DatePickerDialog(context, { _, year, month, day -> android.app.TimePickerDialog(context, { _, hour, minute -> onChange(LocalDateTime.of(year, month + 1, day, hour, minute).toString()) }, current.hour, current.minute, false).show() }, current.year, current.monthValue - 1, current.dayOfMonth).show() }, modifier = Modifier.fillMaxWidth()) { Text("$title: ${current.format(java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a"))}") }
}
@Composable fun GroupAttendance(store: GroupsStore, path: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var sheet by remember { mutableStateOf<GroupAttendanceSheet?>(null) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var guests by remember { mutableStateOf("0") }
    var first by remember { mutableStateOf("0") }
    var notes by remember { mutableStateOf("") }
    val key = remember { UUID.randomUUID().toString() }
    LaunchedEffect(path) { try { val s = store.read<GroupAttendanceSheet>("$path/attendance"); sheet = s; selected = s.entries.filter { it.present }.map { it.membershipId }.toSet(); guests = s.guestCount.toString(); first = s.firstTimeGuestCount.toString(); notes = s.notes ?: "" } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } }
    GroupFormSheet("Who’s here?", onDismiss) {
        GroupFeedback(store)
        val s = sheet
        if (s == null) CircularProgressIndicator()
        else {
            if (!s.canRecord) Text("Attendance is unavailable: ${s.lockedReason?.replace('_', ' ') ?: "closed"}.")
            Text("${selected.size} present", style = MaterialTheme.typography.titleMedium)
            TextButton(enabled = s.canRecord, onClick = { selected = if (selected.isEmpty()) s.entries.filter { it.recordable }.map { it.membershipId }.toSet() else emptySet() }) { Text(if (selected.isEmpty()) "Mark everyone present" else "Clear selection") }
            s.entries.forEach { entry -> Row(verticalAlignment = Alignment.CenterVertically) { Text(entry.name, modifier = Modifier.weight(1f)); Checkbox(entry.membershipId in selected, { checked -> selected = if (checked) selected + entry.membershipId else selected - entry.membershipId }, enabled = s.canRecord && entry.recordable && !store.busy) } }
            OutlinedTextField(guests, { guests = it.filter(Char::isDigit).take(4) }, label = { Text("Guests") }, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(first, { first = it.filter(Char::isDigit).take(4) }, label = { Text("First-time guests") }, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it.take(1000) }, label = { Text("Leader notes (optional)") }, modifier = Modifier.fillMaxWidth())
            Button(enabled = s.canRecord && !store.busy && (guests.toIntOrNull() ?: -1) in 0..1000 && (first.toIntOrNull() ?: -1) in 0..(guests.toIntOrNull() ?: 0), onClick = { scope.launch { if (store.action("Attendance saved.") { store.send<GroupAttendanceSheet>("$path/attendance", buildJsonObject { put("presentMembershipIds", JsonArray(selected.map(::JsonPrimitive))); put("guestCount", guests.toInt()); put("firstTimeGuestCount", first.toInt()); put("notes", notes) }, "PUT", key) }) onDismiss() } }, modifier = Modifier.fillMaxWidth()) { Text("Save attendance") }
        }
    }
}
