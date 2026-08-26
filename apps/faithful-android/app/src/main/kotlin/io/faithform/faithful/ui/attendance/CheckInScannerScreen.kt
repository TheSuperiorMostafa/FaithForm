package io.faithform.faithful.ui.attendance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.faithform.faithful.R
import io.faithform.faithful.attendance.CheckInScannerUiState
import io.faithform.faithful.attendance.ScanBlock
import io.faithform.faithful.attendance.ScanPhase
import io.faithform.faithful.design.FaithfulTokens

/**
 * The check-in scanner.
 *
 * Behavioural parity with the SwiftUI screen — same states, same order, same
 * rule that nothing here can raise a system dialog on its own — with Android's
 * one genuine difference made visible: a *re-askable* denial gets a "try again"
 * button that really does raise the dialog, where iOS would only ever offer
 * Settings.
 *
 * Every decision about which affordance appears is in
 * [CheckInScannerUiState], in `:core:attendance`, where it is tested.
 */
@Composable
fun CheckInScannerScreen(
    state: CheckInScannerUiState,
    onScan: () -> Unit,
    onTypedCodeChange: (String) -> Unit,
    onSubmitTypedCode: () -> Unit,
    onOpenSettings: () -> Unit,
    onDone: () -> Unit,
    onTryAgain: () -> Unit,
    modifier: Modifier = Modifier,
    preview: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        Text(
            text = stringResource(R.string.checkin_scan_intro_title),
            style = MaterialTheme.typography.headlineMedium,
        )
        Text(
            text = stringResource(R.string.checkin_scan_intro_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = stringResource(R.string.checkin_scan_privacy_note),
            style = MaterialTheme.typography.bodySmall,
        )

        if (state.isScanning) {
            preview()
            Row(
                horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                Text(stringResource(R.string.checkin_scan_searching))
            }
        }

        if (state.showsScanButton) {
            Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.checkin_scan_button))
            }
        }

        (state.phase as? ScanPhase.Blocked)?.let { blocked ->
            BlockCard(
                block = blocked.block,
                offersSettings = state.offersSettings,
                offersRetry = state.offersRetryPermission,
                onOpenSettings = onOpenSettings,
                onRetry = onScan,
            )
        }

        if (state.isSubmitting) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            ) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                Text(stringResource(R.string.checkin_scan_submitting))
            }
        }

        state.resultMessage?.let { message ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .padding(FaithfulTokens.Spacing.lg)
                        // Announced as it appears: someone holding a phone up at
                        // a screen is not looking at the phone.
                        .semantics { liveRegion = LiveRegionMode.Assertive },
                    verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
                ) {
                    Text(text = message, style = MaterialTheme.typography.titleMedium)
                    if (state.isSuccess) {
                        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.checkin_scan_done))
                        }
                    } else {
                        Button(onClick = onTryAgain, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.checkin_scan_try_again))
                        }
                    }
                }
            }
        }

        if (state.showsTypedEntry) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(FaithfulTokens.Spacing.lg),
                    verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
                ) {
                    Text(
                        text = stringResource(R.string.checkin_scan_code_title),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = stringResource(R.string.checkin_scan_code_hint),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedTextField(
                        value = state.typedCode,
                        onValueChange = onTypedCodeChange,
                        label = { Text(stringResource(R.string.checkin_scan_code_label)) },
                        singleLine = true,
                        // The alphabet has no lowercase, no vowels and no
                        // punctuation, so autocorrect can only fight the person.
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Ascii,
                            imeAction = ImeAction.Done,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        onClick = onSubmitTypedCode,
                        enabled = state.canSubmitTypedCode,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(R.string.checkin_scan_code_submit))
                    }
                }
            }
        }
    }
}

@Composable
private fun BlockCard(
    block: ScanBlock,
    offersSettings: Boolean,
    offersRetry: Boolean,
    onOpenSettings: () -> Unit,
    onRetry: () -> Unit,
) {
    val title = when (block) {
        ScanBlock.CAMERA_DENIED_CAN_ASK,
        ScanBlock.CAMERA_DENIED_PERMANENTLY -> R.string.checkin_scan_camera_denied_title
        ScanBlock.CAMERA_UNAVAILABLE -> R.string.checkin_scan_camera_unavailable_title
        ScanBlock.OFFLINE -> R.string.checkin_scan_offline_title
    }
    val body = when (block) {
        ScanBlock.CAMERA_DENIED_CAN_ASK,
        ScanBlock.CAMERA_DENIED_PERMANENTLY -> R.string.checkin_scan_camera_denied_body
        ScanBlock.CAMERA_UNAVAILABLE -> R.string.checkin_scan_camera_unavailable_body
        ScanBlock.OFFLINE -> R.string.checkin_scan_offline_body
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(FaithfulTokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
        ) {
            Text(text = stringResource(title), style = MaterialTheme.typography.titleMedium)
            Text(text = stringResource(body), style = MaterialTheme.typography.bodyMedium)

            if (offersRetry) {
                // Android will still show the dialog, so the honest action is
                // to ask again rather than to send someone to Settings.
                OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.checkin_scan_try_again))
                }
            }
            if (offersSettings) {
                OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.checkin_scan_open_settings))
                }
            }
        }
    }
}
