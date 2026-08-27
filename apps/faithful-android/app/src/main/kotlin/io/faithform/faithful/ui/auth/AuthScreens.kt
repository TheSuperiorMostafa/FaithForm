package io.faithform.faithful.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.faithful.ConfirmationPhase
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
    confirmationPhase: ConfirmationPhase = ConfirmationPhase.Idle
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
            onCreateAccount = { move(AuthScreen.CREATE_ACCOUNT) },
            onSignIn = { move(AuthScreen.SIGN_IN) }
        )
        AuthScreen.CREATE_ACCOUNT -> CreateAccountScreen(
            viewModel = viewModel,
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
    onCreateAccount: () -> Unit,
    onSignIn: () -> Unit
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

        if (hasPendingInvitation) {
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
        Spacer(Modifier.heightIn(min = FaithfulTokens.Spacing.md))
    }
}

@Composable
private fun CreateAccountScreen(viewModel: AuthViewModel, onSwitchToSignIn: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val name by viewModel.name.collectAsStateWithLifecycle()
    val email by viewModel.email.collectAsStateWithLifecycle()
    val password by viewModel.password.collectAsStateWithLifecycle()

    AuthScaffold(title = stringResource(R.string.auth_create_title)) {
        if (phase is AuthUiPhase.CheckEmail) {
            io.faithform.faithful.ui.discovery.EmptyState(
                stringResource(R.string.auth_check_email_title),
                stringResource(R.string.auth_check_email_body)
            )
            Button(
                onClick = onSwitchToSignIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
            ) { Text(stringResource(R.string.auth_sign_in_title)) }
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
