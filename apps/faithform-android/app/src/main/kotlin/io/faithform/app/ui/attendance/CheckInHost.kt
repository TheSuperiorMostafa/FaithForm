package io.faithform.app.ui.attendance

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.faithform.app.attendance.ApiCheckInSubmitter
import io.faithform.app.attendance.CameraPermissionRequester
import io.faithform.app.attendance.CameraXScanner
import io.faithform.app.attendance.CheckInScanCoordinator
import io.faithform.app.attendance.CheckInScannerUiState
import io.faithform.app.attendance.ScanPhase
import io.faithform.app.attendance.ShortCodeEntry
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.network.ApiClient
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

/**
 * The Check in tab: the scanner screen, wired to a real camera and the real
 * attendance route.
 *
 * **Opening this tab starts nothing.** The camera is untouched and no dialog is
 * raised until the person taps "Scan the code" — `CheckInScanCoordinator` is
 * the only thing that can ask, and it asks only from [CheckInScanCoordinator.beginScanning].
 * The typed code works without any permission at all.
 *
 * The scanner and coordinator are built per composition, bound to this
 * screen's lifecycle owner, and the camera is released the moment the tab goes
 * away. A rotation rebuilds them and returns the screen to its idle state; the
 * typed code survives.
 */
@Composable
fun CheckInTab(
    api: ApiClient,
    cameraPermission: CameraPermissionRequester,
    showsCodeCheckIn: Boolean,
    automaticCheckInContent: (@Composable (Modifier) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    if (!showsCodeCheckIn) {
        automaticCheckInContent?.invoke(modifier)
        return
    }

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    val scanner = remember(lifecycleOwner, cameraPermission) {
        CameraXScanner(
            context = context.applicationContext,
            lifecycleOwner = lifecycleOwner,
            canAskAgain = cameraPermission::canAskAgain,
            requestFromSystem = cameraPermission::request,
        )
    }
    val coordinator = remember(scanner) { CheckInScanCoordinator(scanner, ApiCheckInSubmitter(api)) }

    var phase by remember(coordinator) { mutableStateOf<ScanPhase>(ScanPhase.Idle) }
    var typedCode by rememberSaveable { mutableStateOf("") }

    DisposableEffect(coordinator) {
        // The analyser runs on CameraX's executor and must return at once; the
        // decoded string is handed to a coroutine here, never processed there.
        coordinator.onCodeFromAnalyser = { code ->
            scope.launch { phase = coordinator.handleScanned(code) }
        }
        onDispose {
            coordinator.onCodeFromAnalyser = {}
            // The composition's scope is already cancelled; releasing the
            // camera must still happen, so it gets a scope of its own.
            MainScope().launch { scanner.stop() }
        }
    }

    CheckInScannerScreen(
        state = CheckInScannerUiState(phase = phase, typedCode = typedCode),
        onScan = {
            // Shown at once, before the dialog and before CameraX has finished
            // starting — which can take several seconds the first time — so the
            // button disappears on tap instead of looking as if nothing happened.
            phase = ScanPhase.RequestingPermission
            scope.launch { phase = coordinator.beginScanning() }
        },
        onTypedCodeChange = { typedCode = ShortCodeEntry.normalise(it) },
        onSubmitTypedCode = { scope.launch { phase = coordinator.submitTypedCode(typedCode) } },
        onOpenSettings = {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        },
        onDone = {
            phase = ScanPhase.Idle
            typedCode = ""
        },
        onTryAgain = { phase = ScanPhase.Idle },
        modifier = modifier,
        preview = {
            AndroidView(
                factory = { viewContext ->
                    PreviewView(viewContext).also { view ->
                        scanner.previewUseCase.setSurfaceProvider(view.surfaceProvider)
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(3f / 4f)
                    .clip(RoundedCornerShape(FaithFormTokens.Radius.lg)),
            )
        },
        footer = { automaticCheckInContent?.invoke(Modifier) },
    )
}
