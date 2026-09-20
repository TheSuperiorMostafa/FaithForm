package io.faithform.app.ui.account

import android.graphics.Bitmap
import android.graphics.Canvas as BitmapCanvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import coil.size.Scale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
fun ProfilePhotoControl(hasPhoto: Boolean, onSave: (ByteArray?, (Boolean) -> Unit) -> Unit) {
    val context = LocalContext.current
    var selectedUri by rememberSaveable { mutableStateOf<String?>(null) }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf(false) }
    var confirmRemoval by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) { selectedUri = uri.toString(); failed = false }
    }
    LaunchedEffect(selectedUri) {
        val uri = selectedUri ?: return@LaunchedEffect
        loading = true
        try {
            // Coil bounds decoding and applies EXIF orientation, including Android 8/9.
            val result = context.imageLoader.execute(ImageRequest.Builder(context)
                .data(Uri.parse(uri)).size(2048).scale(Scale.FIT).allowHardware(false)
                .memoryCachePolicy(CachePolicy.DISABLED).diskCachePolicy(CachePolicy.DISABLED).build())
            bitmap = (result.drawable as? BitmapDrawable)?.bitmap
            failed = bitmap == null
            if (failed) selectedUri = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failed = true; selectedUri = null
        } finally { loading = false }
    }
    Column {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TextButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !loading && !removing) {
                Text(if (hasPhoto) "Change photo" else "Add profile photo")
            }
            if (hasPhoto) TextButton(onClick = { confirmRemoval = true }, enabled = !loading && !removing) { Text("Remove") }
        }
        if (loading || removing) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (failed) Text("Your photo was not changed. Please try again.", color = MaterialTheme.colorScheme.error)
    }
    if (confirmRemoval) AlertDialog(
        onDismissRequest = { confirmRemoval = false }, title = { Text("Remove profile photo?") },
        confirmButton = { TextButton(onClick = {
            confirmRemoval = false; removing = true
            onSave(null) { ok -> removing = false; failed = !ok }
        }) { Text("Remove photo") } },
        dismissButton = { TextButton(onClick = { confirmRemoval = false }) { Text("Cancel") } },
    )
    bitmap?.let { source ->
        key(selectedUri) {
            ProfilePhotoCropper(source, onDismiss = { bitmap = null; selectedUri = null }, onSave = onSave)
        }
    }
}

@Composable
private fun ProfilePhotoCropper(source: Bitmap, onDismiss: () -> Unit, onSave: (ByteArray?, (Boolean) -> Unit) -> Unit) {
    var zoom by rememberSaveable { mutableFloatStateOf(1f) }
    var x by rememberSaveable { mutableFloatStateOf(0f) }
    var y by rememberSaveable { mutableFloatStateOf(0f) }
    var turns by rememberSaveable { mutableIntStateOf(0) }
    val image = remember(source, turns) {
        if (turns == 0) source else Bitmap.createBitmap(source, 0, 0, source.width, source.height,
            Matrix().apply { postRotate(turns * 90f) }, true)
    }
    var working by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var adjustments by rememberSaveable { mutableStateOf(false) }
    fun reset() { zoom = 1f; x = 0f; y = 0f }
    LaunchedEffect(exporting) {
        if (!exporting) return@LaunchedEffect
        try {
            val data = withContext(Dispatchers.Default) { cropProfilePhoto(image, zoom, x, y) }
            onSave(data) { ok -> working = false; if (ok) onDismiss() else failed = true }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            working = false; failed = true
        } finally { exporting = false }
    }
    Dialog(onDismissRequest = { if (!working) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = onDismiss, enabled = !working) { Text("Cancel") }
                    Button(onClick = { working = true; failed = false; exporting = true }, enabled = !working) { Text("Save") }
                }
                Text("Edit profile photo", style = MaterialTheme.typography.headlineSmall)
                Text("Drag to reposition. Pinch or use the slider to zoom.")
                val currentZoom by rememberUpdatedState(zoom)
                val currentX by rememberUpdatedState(x)
                val currentY by rememberUpdatedState(y)
                Canvas(Modifier.fillMaxWidth().aspectRatio(1f)
                    .semantics { contentDescription = "Profile photo crop preview. Use the controls below to adjust." }
                    .pointerInput(image, working) {
                        if (!working) detectTransformGestures { _, pan, factor, _ ->
                            val next = (currentZoom * factor).coerceIn(1f, 4f)
                            val scale = max(size.width.toFloat() / image.width, size.height.toFloat() / image.height) * next
                            x = (currentX + pan.x / max(1f, (image.width * scale - size.width) / 2)).coerceIn(-1f, 1f)
                            y = (currentY + pan.y / max(1f, (image.height * scale - size.height) / 2)).coerceIn(-1f, 1f)
                            zoom = next
                        }
                    }) {
                    val side = size.width
                    val scale = max(side / image.width, side / image.height) * zoom
                    val width = image.width * scale; val height = image.height * scale
                    clipRect {
                        drawImage(image.asImageBitmap(), dstOffset = IntOffset(
                            ((side - width) / 2 + x * (width - side) / 2).roundToInt(),
                            ((side - height) / 2 + y * (height - side) / 2).roundToInt()),
                            dstSize = IntSize(width.roundToInt(), height.roundToInt()))
                        val mask = Path().apply {
                            fillType = PathFillType.EvenOdd
                            addRect(androidx.compose.ui.geometry.Rect(Offset.Zero, Size(side, side)))
                            addOval(androidx.compose.ui.geometry.Rect(Offset.Zero, Size(side, side)))
                        }
                        drawPath(mask, Color.Black.copy(alpha = 0.6f))
                        drawCircle(Color.White, radius = side / 2 - 1.dp.toPx(), style = Stroke(2.dp.toPx()))
                    }
                }
                Text("Zoom")
                Slider(zoom, { zoom = it }, valueRange = 1f..4f, enabled = !working, modifier = Modifier.semantics { contentDescription = "Zoom" })
                TextButton(onClick = { adjustments = !adjustments }) { Text("Adjust position") }
                if (adjustments) {
                    Text("Horizontal position")
                    Slider(x, { x = it }, valueRange = -1f..1f, enabled = !working, modifier = Modifier.semantics { contentDescription = "Horizontal position" })
                    Text("Vertical position")
                    Slider(y, { y = it }, valueRange = -1f..1f, enabled = !working, modifier = Modifier.semantics { contentDescription = "Vertical position" })
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { turns = (turns + 1) % 4; reset() }, enabled = !working) { Text("Rotate") }
                    TextButton(onClick = { reset() }, enabled = !working) { Text("Reset") }
                }
                Text("Your profile photo is visible to people you interact with in FaithForm.", style = MaterialTheme.typography.bodySmall)
                if (working) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Saving photo…") }
                if (failed) Text("Could not save your photo. Your crop is ready to try again.", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

internal fun cropProfilePhoto(image: Bitmap, zoom: Float, x: Float, y: Float): ByteArray {
    val side = 512f
    val scale = max(side / image.width, side / image.height) * zoom.coerceIn(1f, 4f)
    val width = image.width * scale; val height = image.height * scale
    val left = (side - width) / 2 + x.coerceIn(-1f, 1f) * (width - side) / 2
    val top = (side - height) / 2 + y.coerceIn(-1f, 1f) * (height - side) / 2
    val output = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
    return try {
        BitmapCanvas(output).apply {
            drawColor(android.graphics.Color.WHITE)
            drawBitmap(image, null, RectF(left, top, left + width, top + height), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        }
        ByteArrayOutputStream().use { stream ->
            check(output.compress(Bitmap.CompressFormat.JPEG, 85, stream))
            stream.toByteArray()
        }
    } finally { output.recycle() }
}
