package io.faithform.app.ui.onboarding

import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.faithform.app.attendance.CameraXScanner
import io.faithform.app.navigation.InvitationLink
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvitationQrButton(onToken: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(false) }
    val permission = io.faithform.app.attendance.LocalCameraPermissionRequester.current
    val requestScope = rememberCoroutineScope()
    TextButton(onClick = { requestScope.launch {
        val granted = permission.request()
        open = granted; denied = !granted
    } }) { Text("Scan invitation QR code") }
    if (denied) Text("Camera access is off. Enable it in Settings or paste your invitation link.")
    if (open) ModalBottomSheet(onDismissRequest = { open = false }) {
        val context = LocalContext.current
        val lifecycle = LocalLifecycleOwner.current
        val scope = rememberCoroutineScope()
        val scanner = remember(lifecycle) { CameraXScanner(context.applicationContext, lifecycle, permission::canAskAgain, permission::request) }
        var message by remember { mutableStateOf("Point your camera at your church’s invitation QR code.") }
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(message)
            AndroidView(factory = { PreviewView(it).also { view -> scanner.previewUseCase.setSurfaceProvider(view.surfaceProvider) } }, modifier = Modifier.fillMaxWidth().height(320.dp))
            TextButton(onClick = { open = false }) { Text("Done") }
        }
        LaunchedEffect(scanner) {
            try {
                scanner.start { value ->
                    InvitationLink.token(value)?.let { token -> scope.launch { if (open) { onToken(token); open = false } } }
                }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (_: Exception) { message = "We couldn’t start the camera. You can still paste your invitation link." }
        }
        DisposableEffect(scanner) { onDispose { MainScope().launch { scanner.stop() } } }
    }
}
