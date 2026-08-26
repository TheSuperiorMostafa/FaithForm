package io.faithform.faithful.ui.attendance

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.faithform.faithful.R
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.attendance.AutomaticAttendanceUiState
import io.faithform.faithful.design.LocalFaithfulTheme

/**
 * The automatic-attendance experience.
 *
 * Behavioural parity with the SwiftUI screens — same steps, same order, same
 * rule that nothing here can raise a system dialog on its own — but Android
 * where the platform differs. The clearest example is the background step: on
 * API 30+ there is no dialog to raise, so this screen offers a Settings action
 * rather than a button that would appear to do nothing.
 */

// ---------------------------------------------------------------------------
// Introduction
// ---------------------------------------------------------------------------

@Composable
fun AutomaticAttendanceIntroScreen(
    onContinue: () -> Unit,
    onNotNow: () -> Unit,
) {
    val theme = LocalFaithfulTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithfulTokens.TouchTarget.recommended)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithfulTokens.Spacing.xl))

        Text(
            text = stringResource(R.string.auto_attendance_intro_title),
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary,
        )
        Text(
            text = stringResource(R.string.auto_attendance_intro_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary,
        )

        // The privacy explanation sits on the same screen as the offer, not
        // behind a link: someone deciding whether to share their location
        // deserves to read what happens to it in the same breath.
        Card {
            Column(
                modifier = Modifier.padding(FaithfulTokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
            ) {
                Text(
                    text = stringResource(R.string.auto_attendance_privacy_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
                PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_one))
                PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_two))
                PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_three))
                PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_four))
            }
        }

        Button(onClick = onContinue, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_continue))
        }
        TextButton(onClick = onNotNow, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_not_now))
        }

        Spacer(Modifier.size(FaithfulTokens.Spacing.xl))
    }
}

@Composable
private fun PrivacyPoint(text: String) {
    val theme = LocalFaithfulTheme.current
    Row(
        horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        // Decorative: the sentence carries the meaning, so TalkBack reads the
        // text and never announces a bullet.
        Spacer(
            Modifier
                .padding(top = 7.dp)
                .size(6.dp)
                .clip(CircleShape)
                .background(theme.palette.brandPrimary)
                .clearAndSetSemantics { },
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary,
        )
    }
}

// ---------------------------------------------------------------------------
// Permission education
// ---------------------------------------------------------------------------

/**
 * Why a location permission is needed, shown *before* the system dialog.
 *
 * One component for both steps: the foreground and background explanations
 * differ in copy, not in structure, and two near-identical screens would drift.
 *
 * [actionLabel] is supplied by the caller because on API 30+ the background
 * step's button opens Settings rather than a dialog, and the label has to say
 * so honestly.
 */
@Composable
fun LocationPermissionEducationScreen(
    title: String,
    body: String,
    actionLabel: String,
    isWorking: Boolean,
    onContinue: () -> Unit,
    onNotNow: () -> Unit,
) {
    val theme = LocalFaithfulTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithfulTokens.TouchTarget.recommended)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithfulTokens.Spacing.xxl))

        Text(text = title, style = MaterialTheme.typography.displayLarge, color = theme.palette.contentPrimary)
        Text(text = body, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentSecondary)

        Spacer(Modifier.weight(1f))

        Button(onClick = onContinue, enabled = !isWorking, modifier = fill) {
            if (isWorking) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .size(20.dp)
                        .semantics {
                            contentDescription = actionLabel
                        },
                )
            } else {
                Text(actionLabel)
            }
        }
        TextButton(onClick = onNotNow, enabled = !isWorking, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_not_now))
        }

        Spacer(Modifier.size(FaithfulTokens.Spacing.xl))
    }
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** Where automatic check-in stands, and what — if anything — to do about it. */
@Composable
fun AutomaticAttendanceStatusScreen(
    state: AutomaticAttendanceUiState,
    onSetUp: () -> Unit,
    onDisable: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val theme = LocalFaithfulTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithfulTokens.TouchTarget.recommended)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithfulTokens.Spacing.lg))

        Card {
            Column(
                modifier = Modifier
                    .padding(FaithfulTokens.Spacing.lg)
                    // One announcement rather than three fragments, so TalkBack
                    // reads the state as a sentence.
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${state.title}. ${state.explanation}"
                    },
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
            ) {
                Text(
                    text = state.title,
                    style = MaterialTheme.typography.titleLarge,
                    color = theme.palette.contentPrimary,
                )
                Text(
                    text = state.explanation,
                    style = MaterialTheme.typography.bodyLarge,
                    color = theme.palette.contentSecondary,
                )
                if (state.isReady && state.monitoredRegionCount > 0) {
                    Text(
                        text = if (state.monitoredRegionCount == 1) {
                            stringResource(R.string.auto_attendance_watching, 1)
                        } else {
                            stringResource(
                                R.string.auto_attendance_watching_plural,
                                state.monitoredRegionCount,
                            )
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = theme.palette.contentSecondary,
                    )
                }
            }
        }

        // Only shown when the server actually returned a verdict. Never a local
        // guess, and `already_counted` reads as success because it is one.
        state.recentCheckIn?.let { recent ->
            Card {
                Column(
                    modifier = Modifier
                        .padding(FaithfulTokens.Spacing.lg)
                        .semantics(mergeDescendants = true) { },
                    verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                ) {
                    Text(
                        text = stringResource(R.string.auto_attendance_recent_title),
                        style = MaterialTheme.typography.labelSmall,
                        color = theme.palette.contentSecondary,
                    )
                    Text(
                        text = if (recent.alreadyCounted) {
                            stringResource(R.string.auto_attendance_recent_already, recent.label)
                        } else {
                            stringResource(R.string.auto_attendance_recent_counted, recent.label)
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                    )
                }
            }
        }

        when {
            state.isWorking -> CircularProgressIndicator(
                modifier = Modifier.semantics {
                    contentDescription = state.title
                },
            )

            state.isReady -> OutlinedButton(onClick = onDisable, modifier = fill) {
                Text(stringResource(R.string.auto_attendance_disable))
            }

            state.canOpenSettings -> Button(onClick = onOpenSettings, modifier = fill) {
                Text(stringResource(R.string.auto_attendance_open_settings))
            }

            state.canSetUp -> Button(onClick = onSetUp, modifier = fill) {
                Text(stringResource(R.string.auto_attendance_enable))
            }
            // Otherwise no button: a restricted device, a church that has not
            // enabled the feature, and a missing People link are all states the
            // person cannot fix from here, and offering a control that would do
            // nothing wastes their time.
        }

        Spacer(Modifier.size(FaithfulTokens.Spacing.xl))
    }
}
