package io.faithform.app.ui.attendance

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.NoPhotography
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.faithform.app.R
import io.faithform.app.attendance.CheckInScannerUiState
import io.faithform.app.attendance.ScanBlock
import io.faithform.app.attendance.ScanPhase
import io.faithform.app.attendance.ShortCodeEntry
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.components.FaithFormPillOption
import io.faithform.app.ui.components.FaithFormPillSwitcher
import io.faithform.app.ui.components.FaithFormWorkingLabel

enum class CheckInMode {
    SCAN,
    CODE,
}

/**
 * The check-in scanner screen.
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
    val theme = LocalFaithFormTheme.current
    var selectedMode by remember { mutableStateOf(CheckInMode.SCAN) }
    val isBusy = state.isScanning || state.isSubmitting
    val isFinished = state.phase is ScanPhase.Finished

    var showsUnusedCharacterHint by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        // Modern Hero Header with Shield/Check Icon
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = theme.palette.brandAccent,
                modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
            )
            Text(
                text = stringResource(R.string.checkin_scan_title),
                style = MaterialTheme.typography.headlineMedium,
                color = theme.palette.contentPrimary,
            )
        }

        Text(
            text = stringResource(R.string.checkin_scan_intro_body),
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
        )

        // Segmented Mode Switcher: Scan Code vs Enter Code
        if (!isBusy && !isFinished) {
            FaithFormPillSwitcher(
                options = listOf(
                    FaithFormPillOption(CheckInMode.SCAN, stringResource(R.string.checkin_scan_button)),
                    FaithFormPillOption(CheckInMode.CODE, stringResource(R.string.checkin_scan_enter_code)),
                ),
                selected = selectedMode,
                onSelect = { selectedMode = it },
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Active State Dispatch
        when {
            state.phase is ScanPhase.RequestingPermission -> {
                FaithFormCard {
                    FaithFormWorkingLabel(
                        text = stringResource(R.string.checkin_scan_searching),
                        working = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }

            state.isScanning -> {
                FaithFormCard {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        preview()
                        FaithFormWorkingLabel(
                            text = stringResource(R.string.checkin_scan_searching),
                            working = true,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                        OutlinedButton(
                            onClick = onTryAgain,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(stringResource(R.string.checkin_scan_try_again))
                        }
                    }
                }
            }

            state.isSubmitting -> {
                FaithFormCard {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = FaithFormTokens.Spacing.xl),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        FaithFormWorkingLabel(
                            text = stringResource(R.string.checkin_scan_submitting),
                            working = true,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                }
            }

            isFinished -> {
                ResultCard(
                    isSuccess = state.isSuccess,
                    message = state.resultMessage.orEmpty(),
                    onDone = onDone,
                    onTryAgain = onTryAgain,
                )
            }

            state.phase is ScanPhase.Blocked -> {
                BlockCard(
                    block = (state.phase as ScanPhase.Blocked).block,
                    offersSettings = state.offersSettings,
                    offersRetry = state.offersRetryPermission,
                    onOpenSettings = onOpenSettings,
                    onRetry = onScan,
                )
                if (selectedMode == CheckInMode.CODE) {
                    TypedEntryCard(
                        code = state.typedCode,
                        canSubmit = state.canSubmitTypedCode,
                        showsUnusedHint = showsUnusedCharacterHint,
                        onCodeChange = { input ->
                            showsUnusedCharacterHint = ShortCodeEntry.showsUnusedCharacterHint(
                                input,
                                wasShowing = showsUnusedCharacterHint,
                            )
                            onTypedCodeChange(input)
                        },
                        onSubmit = onSubmitTypedCode,
                    )
                }
            }

            else -> {
                // Idle state: show based on selected segmented mode
                if (selectedMode == CheckInMode.SCAN) {
                    ScanHeroCard(onScan = onScan)
                } else {
                    TypedEntryCard(
                        code = state.typedCode,
                        canSubmit = state.canSubmitTypedCode,
                        showsUnusedHint = showsUnusedCharacterHint,
                        onCodeChange = { input ->
                            showsUnusedCharacterHint = ShortCodeEntry.showsUnusedCharacterHint(
                                input,
                                wasShowing = showsUnusedCharacterHint,
                            )
                            onTypedCodeChange(input)
                        },
                        onSubmit = onSubmitTypedCode,
                    )
                }
            }
        }
    }
}

@Composable
private fun ScanHeroCard(onScan: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    FaithFormCard {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
                    .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithFormTokens.Radius.lg)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                    modifier = Modifier.padding(FaithFormTokens.Spacing.base),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.QrCodeScanner,
                        contentDescription = null,
                        tint = theme.palette.brandPrimary,
                        modifier = Modifier.size(48.dp),
                    )
                    Text(
                        text = stringResource(R.string.checkin_scan_intro_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = stringResource(R.string.checkin_scan_privacy_note),
                        style = MaterialTheme.typography.bodySmall,
                        color = theme.palette.contentMuted,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            Button(
                onClick = onScan,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.Outlined.QrCodeScanner,
                    contentDescription = null,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                )
                Spacer(modifier = Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.checkin_scan_button))
            }
        }
    }
}

@Composable
private fun TypedEntryCard(
    code: String,
    canSubmit: Boolean,
    showsUnusedHint: Boolean,
    onCodeChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current

    FaithFormCard {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Edit,
                    contentDescription = null,
                    tint = theme.palette.brandAccent,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
                )
                Text(
                    text = stringResource(R.string.checkin_scan_code_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
            }

            Text(
                text = stringResource(R.string.checkin_scan_code_hint),
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.contentSecondary,
            )

            OutlinedTextField(
                value = code,
                onValueChange = onCodeChange,
                label = { Text(stringResource(R.string.checkin_scan_code_label)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                ),
                textStyle = TextStyle(
                    fontSize = 28.sp,
                    textAlign = TextAlign.Center,
                    letterSpacing = 4.sp,
                    color = theme.palette.contentPrimary,
                ),
                shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = theme.palette.surfaceSunken,
                    unfocusedContainerColor = theme.palette.surfaceSunken,
                    focusedBorderColor = theme.palette.brandAccent,
                    unfocusedBorderColor = theme.palette.border,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            AnimatedVisibility(
                visible = showsUnusedHint,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
                    modifier = Modifier.padding(top = FaithFormTokens.Spacing.xs),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.WarningAmber,
                        contentDescription = null,
                        tint = theme.palette.warning,
                        modifier = Modifier.size(FaithFormTokens.IconSize.sizeSmall),
                    )
                    Text(
                        text = stringResource(R.string.checkin_code_invalid_characters),
                        style = MaterialTheme.typography.bodySmall,
                        color = theme.palette.contentPrimary,
                    )
                }
            }

            Button(
                onClick = onSubmit,
                enabled = canSubmit,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                )
                Spacer(modifier = Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.checkin_scan_code_submit))
            }
        }
    }
}

@Composable
private fun ResultCard(
    isSuccess: Boolean,
    message: String,
    onDone: () -> Unit,
    onTryAgain: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current

    FaithFormCard {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = FaithFormTokens.Spacing.base)
                .semantics { liveRegion = LiveRegionMode.Assertive },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
        ) {
            Icon(
                imageVector = if (isSuccess) Icons.Outlined.CheckCircle else Icons.Outlined.Close,
                contentDescription = null,
                tint = if (isSuccess) theme.palette.success else theme.palette.destructive,
                modifier = Modifier.size(56.dp),
            )

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
            ) {
                Text(
                    text = if (isSuccess) stringResource(R.string.checkin_scan_title) else stringResource(R.string.error_title),
                    style = MaterialTheme.typography.titleLarge,
                    color = theme.palette.contentPrimary,
                )
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                    textAlign = TextAlign.Center,
                )
            }

            if (isSuccess) {
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

@Composable
private fun BlockCard(
    block: ScanBlock,
    offersSettings: Boolean,
    offersRetry: Boolean,
    onOpenSettings: () -> Unit,
    onRetry: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current

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

    FaithFormCard {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                Icon(
                    imageVector = Icons.Outlined.NoPhotography,
                    contentDescription = null,
                    tint = theme.palette.warning,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
                )
                Text(
                    text = stringResource(title),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
            }

            Text(
                text = stringResource(body),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
            )

            if (offersRetry) {
                OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.checkin_scan_try_again))
                }
            }
            if (offersSettings) {
                OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth()) {
                    Icon(
                        imageVector = Icons.Outlined.Settings,
                        contentDescription = null,
                        modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                    )
                    Spacer(modifier = Modifier.size(FaithFormTokens.Spacing.sm))
                    Text(stringResource(R.string.checkin_scan_open_settings))
                }
            }
        }
    }
}

/** The FaithForm canonical Card: surface background with hairline border and rounded corners. */
@Composable
private fun FaithFormCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.lg)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(theme.palette.surface, shape)
            .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, shape)
            .padding(FaithFormTokens.Spacing.lg),
    ) {
        content()
    }
}
