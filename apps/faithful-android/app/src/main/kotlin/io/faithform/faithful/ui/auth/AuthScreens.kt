package io.faithform.faithful.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.LocationOn
import io.faithform.faithful.ConfirmationPhase
import io.faithform.faithful.PendingChurchContext
import io.faithform.faithful.R
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme

/**
 * The signed-out journey: one landing screen, two doors.
 *
 * Same editorial shape as `WelcomeScreen` — a confident sentence, generous
 * space, and only the actions a person can actually take. The primary door is
 * creating an account, because the person most likely to be standing here has
 * never used FaithForm before. Mirrors the SwiftUI `AuthFlowView` state for
 * state, with Android-native navigation: system back pops the flow.
 */
private enum class AuthScreen { LANDING, CREATE_ACCOUNT, SIGN_IN, RESET }

@Composable
fun AuthFlow(
    viewModel: AuthViewModel,
    hasPendingInvitation: Boolean,
    confirmationPhase: ConfirmationPhase = ConfirmationPhase.Idle,
    churchContext: PendingChurchContext? = null,
    onClearChurchContext: (() -> Unit)? = null
) {
    var screen by rememberSaveable { mutableStateOf(AuthScreen.LANDING) }

    fun move(to: AuthScreen) {
        viewModel.resetForNewScreen()
        screen = to
    }

    BackHandler(enabled = screen != AuthScreen.LANDING) {
        move(if (screen == AuthScreen.RESET) AuthScreen.SIGN_IN else AuthScreen.LANDING)
    }

    when (screen) {
        AuthScreen.LANDING -> LandingScreen(
            hasPendingInvitation = hasPendingInvitation,
            confirmationPhase = confirmationPhase,
            churchContext = churchContext,
            onCreateAccount = { move(AuthScreen.CREATE_ACCOUNT) },
            onSignIn = { move(AuthScreen.SIGN_IN) },
            onClearChurchContext = onClearChurchContext
        )
        AuthScreen.CREATE_ACCOUNT -> CreateAccountScreen(
            viewModel = viewModel,
            churchContext = churchContext,
            onSwitchToSignIn = { move(AuthScreen.SIGN_IN) }
        )
        AuthScreen.SIGN_IN -> SignInScreen(
            viewModel = viewModel,
            onForgotPassword = { move(AuthScreen.RESET) }
        )
        AuthScreen.RESET -> ResetPasswordScreen(viewModel)
    }
}

@Composable
private fun LandingScreen(
    hasPendingInvitation: Boolean,
    confirmationPhase: ConfirmationPhase,
    churchContext: PendingChurchContext?,
    onCreateAccount: () -> Unit,
    onSignIn: () -> Unit,
    onClearChurchContext: (() -> Unit)?
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .safeDrawingPadding()
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.xxl))

        // A link that named a church replaces the product's own name with it.
        // Someone who scanned a bulletin QR code came for their church, not for
        // FaithForm, and the front door should say so.
        if (churchContext != null) {
            ChurchContextHeader(churchContext)
        } else {
            Text(
                stringResource(R.string.app_name),
                style = MaterialTheme.typography.displayLarge,
                color = theme.palette.contentPrimary
            )
            Text(
                stringResource(R.string.sign_in_body),
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentSecondary
            )
        }

        // The generic "you have an invitation" banner is redundant once the
        // header names the church the invitation is *for*.
        if (hasPendingInvitation && churchContext == null) {
            Text(
                stringResource(R.string.invitation_pending_banner),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
                    .padding(FaithfulTokens.Spacing.base)
            )
        }

        // A confirmation link lands here, on the front door, before any
        // screen was chosen. Both of its states are visible in place: the
        // exchange in progress, and the sentence when it could not finish.
        when (confirmationPhase) {
            is ConfirmationPhase.Working -> Text(
                stringResource(R.string.auth_confirming_email),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
                    .padding(FaithfulTokens.Spacing.base)
            )
            is ConfirmationPhase.Failed -> Text(
                stringResource(confirmationPhase.error.messageRes()),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.destructive,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
                    .padding(FaithfulTokens.Spacing.base)
            )
            is ConfirmationPhase.Idle -> Unit
        }

        Spacer(Modifier.weight(1f))

        Button(
            onClick = onCreateAccount,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.create_account)) }
        OutlinedButton(
            onClick = onSignIn,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) { Text(stringResource(R.string.sign_in)) }
        // A link can be forwarded, mistyped, or simply not meant for the person
        // holding it. Disowning the church has to be one tap away, or the
        // branding becomes a trap.
        if (churchContext != null && onClearChurchContext != null) {
            TextButton(onClick = onClearChurchContext, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.church_context_not_yours))
            }
        }
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.md))
    }
}

@Composable
private fun CreateAccountScreen(
    viewModel: AuthViewModel,
    churchContext: PendingChurchContext?,
    onSwitchToSignIn: () -> Unit
) {
    val theme = LocalFaithfulTheme.current
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val name by viewModel.name.collectAsStateWithLifecycle()
    val email by viewModel.email.collectAsStateWithLifecycle()
    val password by viewModel.password.collectAsStateWithLifecycle()

    // "Join Grace Community" rather than "Create your account", when a link
    // said which church this is for.
    val title = when {
        phase is AuthUiPhase.CheckEmail -> stringResource(R.string.auth_check_email_title)
        churchContext != null ->
            stringResource(R.string.church_context_join_title, churchContext.churchName)
        else -> stringResource(R.string.auth_create_title)
    }

    AuthScaffold(title = title) {
        if (phase is AuthUiPhase.CheckEmail) {
            CheckEmailScreen(viewModel = viewModel, onSignIn = onSwitchToSignIn)
            return@AuthScaffold
        }

        AuthTextField(
            value = name,
            onValueChange = viewModel::updateName,
            label = stringResource(R.string.auth_name_label),
            hint = stringResource(R.string.auth_name_hint)
        )
        AuthTextField(
            value = email,
            onValueChange = viewModel::updateEmail,
            label = stringResource(R.string.auth_email_label),
            keyboardType = KeyboardType.Email
        )
        AuthTextField(
            value = password,
            onValueChange = viewModel::updatePassword,
            label = stringResource(R.string.auth_password_label),
            hint = stringResource(R.string.auth_password_hint),
            keyboardType = KeyboardType.Password,
            isPassword = true
        )

        (phase as? AuthUiPhase.Failed)?.let { AuthErrorText(it.error) }

        Text(
            stringResource(R.string.auth_terms_notice),
            style = MaterialTheme.typography.labelSmall,
            color = theme.mutedContent
        )

        Button(
            onClick = viewModel::createAccount,
            enabled = phase != AuthUiPhase.Working,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            if (phase == AuthUiPhase.Working) {
                CircularProgressIndicator(modifier = Modifier.heightIn(max = FaithfulTokens.Spacing.lg))
            } else {
                Text(stringResource(R.string.create_account))
            }
        }

        TextButton(onClick = onSwitchToSignIn, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_sign_in_title))
        }
    }
}

@Composable
private fun SignInScreen(viewModel: AuthViewModel, onForgotPassword: () -> Unit) {
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val email by viewModel.email.collectAsStateWithLifecycle()
    val password by viewModel.password.collectAsStateWithLifecycle()

    AuthScaffold(title = stringResource(R.string.auth_sign_in_title)) {
        AuthTextField(
            value = email,
            onValueChange = viewModel::updateEmail,
            label = stringResource(R.string.auth_email_label),
            keyboardType = KeyboardType.Email
        )
        AuthTextField(
            value = password,
            onValueChange = viewModel::updatePassword,
            label = stringResource(R.string.auth_password_label),
            keyboardType = KeyboardType.Password,
            isPassword = true
        )

        (phase as? AuthUiPhase.Failed)?.let { AuthErrorText(it.error) }

        Button(
            onClick = viewModel::signIn,
            enabled = phase != AuthUiPhase.Working,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            if (phase == AuthUiPhase.Working) {
                CircularProgressIndicator(modifier = Modifier.heightIn(max = FaithfulTokens.Spacing.lg))
            } else {
                Text(stringResource(R.string.sign_in))
            }
        }

        TextButton(onClick = onForgotPassword, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_forgot_password))
        }
    }
}

@Composable
private fun ResetPasswordScreen(viewModel: AuthViewModel) {
    val theme = LocalFaithfulTheme.current
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val email by viewModel.email.collectAsStateWithLifecycle()
    val noticeVisible by viewModel.resetNoticeVisible.collectAsStateWithLifecycle()

    AuthScaffold(title = stringResource(R.string.auth_reset_title)) {
        Text(
            stringResource(R.string.auth_reset_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary
        )

        AuthTextField(
            value = email,
            onValueChange = viewModel::updateEmail,
            label = stringResource(R.string.auth_email_label),
            keyboardType = KeyboardType.Email
        )

        if (noticeVisible) {
            Text(
                stringResource(R.string.auth_reset_sent),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary
            )
        }

        (phase as? AuthUiPhase.Failed)?.let { AuthErrorText(it.error) }

        Button(
            onClick = viewModel::sendReset,
            enabled = phase != AuthUiPhase.Working && !noticeVisible,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            if (phase == AuthUiPhase.Working) {
                CircularProgressIndicator(modifier = Modifier.heightIn(max = FaithfulTokens.Spacing.lg))
            } else {
                Text(stringResource(R.string.auth_reset_send))
            }
        }
    }
}

@Composable
private fun AuthScaffold(title: String, content: @Composable () -> Unit) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.lg))
        Text(
            title,
            style = MaterialTheme.typography.displayMedium,
            color = theme.palette.contentPrimary
        )
        content()
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.xl))
    }
}

@Composable
private fun AuthTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    hint: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false
) {
    val theme = LocalFaithfulTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = theme.mutedContent
        )
        TextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            visualTransformation = if (isPassword) PasswordVisualTransformation()
            else androidx.compose.ui.text.input.VisualTransformation.None,
            shape = RoundedCornerShape(FaithfulTokens.Radius.md),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = theme.palette.surfaceSunken,
                unfocusedContainerColor = theme.palette.surfaceSunken,
                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
            ),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        )
        hint?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
        }
    }
}

@Composable
private fun AuthErrorText(error: AuthUiError) {
    val theme = LocalFaithfulTheme.current
    Text(
        stringResource(error.messageRes()),
        style = MaterialTheme.typography.bodyMedium,
        color = theme.palette.destructive
    )
}

internal fun AuthUiError.messageRes(): Int = when (this) {
    AuthUiError.EMAIL_INVALID -> R.string.auth_error_email_invalid
    AuthUiError.PASSWORD_MISSING -> R.string.auth_error_password_missing
    AuthUiError.WEAK_PASSWORD -> R.string.auth_error_weak_password
    AuthUiError.INVALID_CREDENTIALS -> R.string.auth_error_invalid_credentials
    AuthUiError.ACCOUNT_EXISTS -> R.string.auth_error_account_exists
    AuthUiError.EMAIL_NOT_CONFIRMED -> R.string.auth_error_email_unconfirmed
    AuthUiError.RATE_LIMITED -> R.string.auth_error_rate_limited
    AuthUiError.OFFLINE -> R.string.auth_error_offline
    AuthUiError.NOT_CONFIGURED -> R.string.auth_error_unconfigured
    AuthUiError.LINK_EXPIRED -> R.string.auth_error_link_expired
    AuthUiError.LINK_INVALID -> R.string.auth_error_link_invalid
    AuthUiError.GENERIC -> R.string.auth_error_generic
}

/**
 * The church a link named, at the top of the signed-out screens.
 *
 * The logo is deliberately *not* fetched: this app has no image pipeline at
 * all, and adding one for a 48dp glyph would be a dependency in exchange for a
 * detail. The name is what carries the recognition, and the glyph is honest
 * about being a placeholder rather than a broken image.
 */
@Composable
private fun ChurchContextHeader(context: PendingChurchContext) {
    val theme = LocalFaithfulTheme.current

    Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(FaithfulTokens.TouchTarget.recommended + FaithfulTokens.Spacing.base)
                    .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
                    .border(
                        FaithfulTokens.BorderWidth.hairline,
                        theme.palette.border,
                        RoundedCornerShape(FaithfulTokens.Radius.lg)
                    )
            ) {
                Icon(
                    Icons.Filled.LocationOn,
                    contentDescription = null,
                    tint = theme.palette.brandPrimary,
                    modifier = Modifier.size(FaithfulTokens.IconSize.sizeLarge)
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
                Text(
                    stringResource(
                        if (context.isInvitation) R.string.church_context_invited
                        else R.string.church_context_continue
                    ),
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.mutedContent
                )
                Text(
                    context.churchName,
                    style = MaterialTheme.typography.titleLarge,
                    color = theme.palette.contentPrimary
                )
            }
        }

        Text(
            stringResource(
                if (context.isInvitation) R.string.church_context_invited_body
                else R.string.church_context_continue_body
            ),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary
        )
    }
}

/**
 * What stands between creating an account and using it.
 *
 * A confirmation wall is the highest-abandonment screen in any signup, and the
 * reason is nearly always the same: the email has not arrived and the screen
 * offers nothing to do about it. So this one names the exact address, says how
 * long to wait, and puts the three real ways forward on it — open the mail app,
 * send it again, or use a different address — instead of a single button back
 * to a sign-in that cannot work yet.
 */
@Composable
private fun CheckEmailScreen(viewModel: AuthViewModel, onSignIn: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    val context = LocalContext.current
    val address by viewModel.confirmationEmail.collectAsStateWithLifecycle()
    val resent by viewModel.resendNoticeVisible.collectAsStateWithLifecycle()
    val resending by viewModel.isResending.collectAsStateWithLifecycle()
    val resendError by viewModel.resendError.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                // Composed from tokens rather than a magic 80: the hero glyph
                // plus two steps of padding on each side.
                .size(FaithfulTokens.IconSize.sizeHero + FaithfulTokens.Spacing.xl * 2)
                .background(theme.palette.surface, CircleShape)
        ) {
            Icon(
                Icons.Filled.Email,
                contentDescription = null,
                tint = theme.palette.brandPrimary,
                modifier = Modifier.size(FaithfulTokens.IconSize.sizeHero)
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)
        ) {
            Text(
                stringResource(R.string.auth_check_email_title),
                style = MaterialTheme.typography.titleLarge,
                color = theme.palette.contentPrimary
            )
            Text(
                stringResource(R.string.auth_check_email_sent_to, address),
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentSecondary,
                textAlign = TextAlign.Center
            )
            Text(
                stringResource(R.string.auth_check_email_body),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                textAlign = TextAlign.Center
            )
        }

        Text(
            stringResource(R.string.auth_check_email_hint),
            style = MaterialTheme.typography.labelSmall,
            color = theme.mutedContent,
            textAlign = TextAlign.Center
        )

        if (resent) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = theme.palette.successContent,
                    modifier = Modifier.size(FaithfulTokens.IconSize.sizeSmall)
                )
                Text(
                    stringResource(R.string.auth_check_email_resent),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.successContent
                )
            }
        }

        resendError?.let { AuthErrorText(it) }

        // Straight to the inbox, through the OS rather than a hardcoded app:
        // whichever mail client the person actually uses answers this intent.
        // Resolved before it is offered, so the button is never a no-op.
        val mail = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_EMAIL)
        if (mail.resolveActivity(context.packageManager) != null) {
            Button(
                onClick = {
                    context.startActivity(mail.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
            ) { Text(stringResource(R.string.auth_check_email_open_mail)) }
        }

        OutlinedButton(
            onClick = viewModel::resendConfirmation,
            enabled = !resending,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            if (resending) {
                CircularProgressIndicator(
                    modifier = Modifier.heightIn(max = FaithfulTokens.Spacing.lg)
                )
            } else {
                Text(stringResource(R.string.auth_check_email_resend))
            }
        }

        TextButton(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_sign_in_title))
        }
        TextButton(onClick = viewModel::startOver, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_check_email_change_address))
        }
    }
}
