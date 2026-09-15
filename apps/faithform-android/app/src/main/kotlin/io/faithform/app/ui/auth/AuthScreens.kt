package io.faithform.app.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.content.Intent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Church
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.SmartDisplay
import io.faithform.app.ConfirmationPhase
import io.faithform.app.PendingChurchContext
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.church.ChurchAvatar
import io.faithform.app.ui.account.LegalLinks
import io.faithform.app.ui.account.openWebLink
import io.faithform.app.ui.brand.FaithFormMark
import io.faithform.app.ui.brand.rememberReducedMotion
import io.faithform.app.ui.components.FaithFormWorkingLabel

/**
 * The signed-out journey: one landing screen, then the doors that get someone in.
 *
 * Same editorial shape as `WelcomeScreen` — a confident sentence, generous
 * space, and only the actions a person can actually take. Invite-first: the
 * primary door is "I have a link", then create account, then sign in. Mirrors
 * the SwiftUI `AuthFlowView` state for state, with Android-native navigation:
 * system back pops the flow.
 */
private enum class AuthScreen { LANDING, CREATE_ACCOUNT, SIGN_IN, RESET, HAVE_LINK }

@Composable
fun AuthFlow(
    viewModel: AuthViewModel,
    hasPendingInvitation: Boolean,
    confirmationPhase: ConfirmationPhase = ConfirmationPhase.Idle,
    churchContext: PendingChurchContext? = null,
    onClearChurchContext: (() -> Unit)? = null,
    onHoldInvitation: ((raw: String, onDone: (ok: Boolean) -> Unit) -> Unit)? = null,
) {
    var screen by rememberSaveable { mutableStateOf(AuthScreen.LANDING) }
    // Held here rather than in the landing, which leaves composition whenever
    // another screen is pushed: back from sign-in must not replay the entrance.
    var landingEntrancePlayed by rememberSaveable { mutableStateOf(false) }

    fun move(to: AuthScreen) {
        viewModel.resetForNewScreen()
        screen = to
    }

    BackHandler(enabled = screen != AuthScreen.LANDING) {
        move(
            when (screen) {
                AuthScreen.RESET -> AuthScreen.SIGN_IN
                else -> AuthScreen.LANDING
            }
        )
    }

    when (screen) {
        AuthScreen.LANDING -> LandingScreen(
            hasPendingInvitation = hasPendingInvitation,
            confirmationPhase = confirmationPhase,
            churchContext = churchContext,
            onHaveLink = { move(AuthScreen.HAVE_LINK) },
            onCreateAccount = { move(AuthScreen.CREATE_ACCOUNT) },
            onSignIn = { move(AuthScreen.SIGN_IN) },
            onClearChurchContext = onClearChurchContext,
            playEntrance = !landingEntrancePlayed,
            onEntrancePlayed = { landingEntrancePlayed = true }
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
        AuthScreen.HAVE_LINK -> HaveLinkEntryScreen(
            onHoldInvitation = onHoldInvitation,
            onHeld = { move(AuthScreen.LANDING) }
        )
    }
}

@Composable
private fun LandingScreen(
    hasPendingInvitation: Boolean,
    confirmationPhase: ConfirmationPhase,
    churchContext: PendingChurchContext?,
    onHaveLink: () -> Unit,
    onCreateAccount: () -> Unit,
    onSignIn: () -> Unit,
    onClearChurchContext: (() -> Unit)?,
    playEntrance: Boolean,
    onEntrancePlayed: () -> Unit
) {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()

    // The page fades in once. A return from a pushed screen must not replay
    // it, so whether it has played is kept by `AuthFlow`, which stays composed
    // while the landing comes and goes.
    val entrance = remember { Animatable(if (playEntrance) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (!playEntrance) return@LaunchedEffect
        onEntrancePlayed()
        entrance.animateTo(
            targetValue = 1f,
            animationSpec = tween(
                if (reduceMotion) FaithFormTokens.Motion.REDUCED_MOTION_MS else FaithFormTokens.Motion.SLOW_MS,
                easing = LinearOutSlowInEasing
            )
        )
    }

    Box(Modifier.fillMaxSize()) {
        LandingBackdrop()

        Column(Modifier.fillMaxSize()) {
            // Scrolls only when it has to: a small phone, or a large font
            // scale. On a phone where it all fits it sits still.
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .windowInsetsPadding(
                        WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
                    )
                    .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(top = FaithFormTokens.Spacing.xl, bottom = FaithFormTokens.Spacing.lg)
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xl),
                    modifier = Modifier
                        .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                        .fillMaxWidth()
                        .graphicsLayer {
                            alpha = entrance.value
                            translationY = if (reduceMotion) 0f
                            else (1f - entrance.value) * FaithFormTokens.Spacing.md.toPx()
                        }
                ) {
                    // A link that named a church replaces the product's promise
                    // with that church. Someone who scanned a bulletin QR code
                    // came for their church, not for FaithForm, and the front
                    // door should say so — the mark stays, small, so they still
                    // know whose app this is.
                    if (churchContext != null) {
                        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)) {
                            LandingLockup(markHeight = FaithFormTokens.IconSize.sizeHero)
                            ChurchContextHeader(churchContext)
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)) {
                            LandingLockup(markHeight = FaithFormTokens.Spacing.xxl)
                            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
                                Text(
                                    stringResource(R.string.landing_headline),
                                    style = MaterialTheme.typography.displayLarge,
                                    color = theme.palette.contentPrimary,
                                    modifier = Modifier.semantics { heading() }
                                )
                                Text(
                                    stringResource(R.string.sign_in_body),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = theme.palette.contentSecondary
                                )
                            }
                        }
                    }

                    // The generic "you have an invitation" banner is redundant
                    // once the header names the church the invitation is *for*.
                    if (hasPendingInvitation && churchContext == null) {
                        LandingCard {
                            Text(
                                stringResource(R.string.invitation_pending_banner),
                                style = MaterialTheme.typography.bodyMedium,
                                color = theme.palette.contentSecondary
                            )
                        }
                    }

                    // A confirmation link lands here, on the front door, before
                    // any screen was chosen. Both of its states are visible in
                    // place: the exchange in progress, and the sentence when it
                    // could not finish. Above the feature list, so neither is
                    // ever scrolled out of view.
                    when (confirmationPhase) {
                        is ConfirmationPhase.Working -> LandingCard {
                            FaithFormWorkingLabel(
                                text = stringResource(R.string.auth_confirming_email),
                                working = true,
                                color = theme.palette.contentSecondary,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        is ConfirmationPhase.Failed -> LandingCard {
                            AuthErrorText(confirmationPhase.error)
                        }
                        is ConfirmationPhase.Idle -> Unit
                    }

                    LandingFeatures()
                }
            }

            LandingActions(
                churchContext = churchContext,
                hasPendingInvitation = hasPendingInvitation,
                onHaveLink = onHaveLink,
                onCreateAccount = onCreateAccount,
                onSignIn = onSignIn,
                onClearChurchContext = onClearChurchContext
            )
        }
    }
}

/**
 * **The doors never scroll away.** Whatever the font scale, invite / create /
 * sign in stay pinned where a thumb already is, and the page above scrolls
 * beneath them.
 */
@Composable
private fun LandingActions(
    churchContext: PendingChurchContext?,
    hasPendingInvitation: Boolean,
    onHaveLink: () -> Unit,
    onCreateAccount: () -> Unit,
    onSignIn: () -> Unit,
    onClearChurchContext: (() -> Unit)?
) {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val showInviteDoor = churchContext == null && !hasPendingInvitation

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .fillMaxWidth()
            // Solid, so text scrolling beneath the buttons never shows through
            // them; the hairline says where the page ends and the doors begin.
            // Drawn before the insets are applied, so it runs under the
            // navigation bar.
            .background(theme.palette.background)
            .drawBehind {
                drawRect(
                    color = theme.palette.divider,
                    size = Size(size.width, FaithFormTokens.BorderWidth.hairline.toPx())
                )
            }
            .windowInsetsPadding(
                WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)
            )
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(top = FaithFormTokens.Spacing.base)
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                .fillMaxWidth()
        ) {
            if (showInviteDoor) {
                Button(
                    onClick = onHaveLink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                ) { Text(stringResource(R.string.have_invitation)) }
                OutlinedButton(
                    onClick = onCreateAccount,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                ) { Text(stringResource(R.string.create_account)) }
                TextButton(
                    onClick = onSignIn,
                    modifier = Modifier.fillMaxWidth()
                ) { Text(stringResource(R.string.sign_in)) }
            } else {
                Button(
                    onClick = onCreateAccount,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                ) { Text(stringResource(R.string.create_account)) }
                OutlinedButton(
                    onClick = onSignIn,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                ) { Text(stringResource(R.string.sign_in)) }
            }
            // A link can be forwarded, mistyped, or simply not meant for the
            // person holding it. Disowning the church has to be one tap away,
            // or the branding becomes a trap.
            if (churchContext != null && onClearChurchContext != null) {
                TextButton(onClick = onClearChurchContext, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.church_context_not_yours))
                }
            }

            // The documents a person is about to agree to, readable before they
            // tap either door rather than only on the form that asks for
            // consent. Each opens in the browser, never in the app.
            Row(
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.minimum)
            ) {
                for ((label, url) in listOf(
                    R.string.privacy_policy to LegalLinks.PRIVACY_POLICY,
                    R.string.terms_of_service to LegalLinks.TERMS,
                )) {
                    TextButton(
                        onClick = { openWebLink(context, url) },
                        colors = ButtonDefaults.textButtonColors(contentColor = theme.mutedContent)
                    ) {
                        Text(stringResource(label), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

/**
 * Holding an invitation before sign-in: paste, name the church, then create
 * or sign in on the branded landing. The token is not spent until a session
 * exists — same path a deep link takes when the person is signed out.
 */
@Composable
private fun HaveLinkEntryScreen(
    onHoldInvitation: ((raw: String, onDone: (ok: Boolean) -> Unit) -> Unit)?,
    onHeld: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    var raw by rememberSaveable { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val invalidMessage = stringResource(R.string.invitation_error_invalid)

    AuthScaffold(
        title = stringResource(R.string.invitation_title),
        subtitle = stringResource(R.string.invitation_body),
    ) {
        AuthTextField(
            value = raw,
            onValueChange = {
                raw = it
                errorMessage = null
            },
            label = stringResource(R.string.invitation_field_label),
            hint = stringResource(R.string.invitation_hint),
        )

        errorMessage?.let {
            Text(it, color = theme.palette.destructive, style = MaterialTheme.typography.bodyMedium)
        }

        Button(
            onClick = {
                val holder = onHoldInvitation
                if (holder == null) {
                    onHeld()
                    return@Button
                }
                working = true
                errorMessage = null
                holder(raw) { ok ->
                    working = false
                    if (ok) onHeld() else errorMessage = invalidMessage
                }
            },
            enabled = !working && raw.isNotBlank(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            if (working) {
                FaithFormWorkingLabel(
                    text = stringResource(R.string.have_link_continue),
                    working = true,
                )
            } else {
                Text(stringResource(R.string.have_link_continue))
            }
        }
    }
}

/**
 * The mark and the name, side by side.
 *
 * Read as one element: TalkBack hears "FaithForm" once, not a picture followed
 * by the same word.
 */
@Composable
private fun LandingLockup(markHeight: Dp) {
    val theme = LocalFaithFormTheme.current
    val name = stringResource(R.string.app_name)

    Row(
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clearAndSetSemantics { contentDescription = name }
    ) {
        FaithFormMark(Modifier.height(markHeight))
        Text(name, style = MaterialTheme.typography.titleLarge, color = theme.palette.contentPrimary)
    }
}

/**
 * What the app does, in three lines.
 *
 * One composition: feed, services, and giving — enough to promise the product
 * without a dense feature grid on the front door.
 */
@Composable
private fun LandingFeatures() {
    val theme = LocalFaithFormTheme.current
    val rows = listOf(
        Triple(Icons.Outlined.Campaign, R.string.landing_feed_title, R.string.landing_feed_body),
        Triple(Icons.Outlined.SmartDisplay, R.string.landing_watch_title, R.string.landing_watch_body),
        Triple(Icons.Outlined.FavoriteBorder, R.string.landing_give_title, R.string.landing_give_body),
    )

    LandingCard {
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base)) {
            for ((icon, title, detail) in rows) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics(mergeDescendants = true) {}
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(FaithFormTokens.TouchTarget.minimum)
                            .background(
                                theme.palette.brandAccent.copy(alpha = 0.16f),
                                RoundedCornerShape(FaithFormTokens.Radius.md)
                            )
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = theme.palette.brandPrimary,
                            modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium)
                        )
                    }
                    Column(
                        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            stringResource(title),
                            style = MaterialTheme.typography.titleMedium,
                            color = theme.palette.contentPrimary
                        )
                        Text(
                            stringResource(detail),
                            style = MaterialTheme.typography.bodyMedium,
                            color = theme.palette.contentSecondary
                        )
                    }
                }
            }
        }
    }
}

/** The iPhone's `FaithFormCard`: the surface colour with a hairline edge. */
@Composable
private fun LandingCard(content: @Composable () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.surface, shape)
            .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, shape)
            .padding(FaithFormTokens.Spacing.base)
    ) { content() }
}

/**
 * The ground behind the front door: the page colour, warmed at the top by the
 * brand gold, with the mark set large and faint in the corner.
 *
 * Decoration only — hidden from TalkBack, edge to edge behind the system bars,
 * and the watermark is dropped under increased contrast, where anything behind
 * text should get out of the way.
 */
@Composable
private fun LandingBackdrop() {
    val theme = LocalFaithFormTheme.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .clearAndSetSemantics {}
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.5f)
                .background(
                    Brush.verticalGradient(
                        listOf(
                            theme.palette.brandAccent.copy(alpha = 0.14f),
                            theme.palette.background.copy(alpha = 0f)
                        )
                    )
                )
        )
        if (!theme.increaseContrast) {
            // Large and faint behind the top of the page, so the brand fills
            // the front door without competing with the headline over it.
            FaithFormMark(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 96.dp, y = (-24).dp)
                    .height(280.dp)
                    .graphicsLayer {
                        alpha = 0.05f
                        rotationZ = -8f
                    }
            )
        }
    }
}

@Composable
private fun CreateAccountScreen(
    viewModel: AuthViewModel,
    churchContext: PendingChurchContext?,
    onSwitchToSignIn: () -> Unit
) {
    val theme = LocalFaithFormTheme.current
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

    AuthScaffold(
        title = title,
        subtitle = if (phase is AuthUiPhase.CheckEmail) null
        else stringResource(R.string.auth_create_body),
        churchContext = churchContext.takeUnless { phase is AuthUiPhase.CheckEmail },
    ) {
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

        TermsNotice()

        Button(
            onClick = viewModel::createAccount,
            enabled = phase != AuthUiPhase.Working,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.create_account),
                working = phase == AuthUiPhase.Working,
            )
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

    AuthScaffold(
        title = stringResource(R.string.auth_sign_in_title),
        subtitle = stringResource(R.string.auth_sign_in_body),
    ) {
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
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.sign_in),
                working = phase == AuthUiPhase.Working,
            )
        }

        TextButton(onClick = onForgotPassword, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_forgot_password))
        }
    }
}

@Composable
private fun ResetPasswordScreen(viewModel: AuthViewModel) {
    val theme = LocalFaithFormTheme.current
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val email by viewModel.email.collectAsStateWithLifecycle()
    val noticeVisible by viewModel.resetNoticeVisible.collectAsStateWithLifecycle()

    AuthScaffold(
        title = stringResource(R.string.auth_reset_title),
        subtitle = stringResource(R.string.auth_reset_body),
    ) {
        AuthTextField(
            value = email,
            onValueChange = viewModel::updateEmail,
            label = stringResource(R.string.auth_email_label),
            keyboardType = KeyboardType.Email
        )

        if (noticeVisible) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = theme.palette.success,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium)
                )
                Text(
                    stringResource(R.string.auth_reset_sent),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary
                )
            }
        }

        (phase as? AuthUiPhase.Failed)?.let { AuthErrorText(it.error) }

        Button(
            onClick = viewModel::sendReset,
            enabled = phase != AuthUiPhase.Working && !noticeVisible,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.auth_reset_send),
                working = phase == AuthUiPhase.Working,
            )
        }
    }
}

/**
 * Shared chrome for every signed-out form: brand atmosphere stays visible so
 * Create, Sign in, Have link, and Reset feel like FaithForm — not empty sheets.
 */
@Composable
private fun AuthScaffold(
    title: String,
    subtitle: String? = null,
    churchContext: PendingChurchContext? = null,
    content: @Composable () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    Box(modifier = Modifier.fillMaxSize()) {
        LandingBackdrop()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(top = FaithFormTokens.Spacing.lg, bottom = FaithFormTokens.Spacing.xl)
                .widthIn(max = FaithFormTokens.Layout.contentMaxWidth),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
        ) {
            LandingLockup(markHeight = FaithFormTokens.IconSize.sizeLarge)
            churchContext?.let { ChurchContextHeader(it) }
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                Text(
                    title,
                    style = MaterialTheme.typography.displayMedium,
                    color = theme.palette.contentPrimary,
                    modifier = Modifier.semantics { heading() }
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodyLarge,
                        color = theme.palette.contentSecondary
                    )
                }
            }
            content()
        }
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
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.control)
    Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
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
            shape = shape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = theme.palette.surface,
                unfocusedContainerColor = theme.palette.surface,
                disabledContainerColor = theme.palette.surface,
                focusedIndicatorColor = theme.palette.brandAccent,
                unfocusedIndicatorColor = theme.palette.border,
                cursorColor = theme.palette.brandPrimary,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                .border(theme.borderWidth, theme.palette.border, shape)
        )
        hint?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
        }
    }
}

@Composable
private fun AuthErrorText(error: AuthUiError) {
    val theme = LocalFaithFormTheme.current
    Text(
        stringResource(error.messageRes()),
        style = MaterialTheme.typography.bodyMedium,
        color = theme.palette.destructive
    )
}

internal fun AuthUiError.messageRes(): Int = when (this) {
    AuthUiError.NAME_MISSING -> R.string.auth_error_name_missing
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
 */
@Composable
private fun ChurchContextHeader(context: PendingChurchContext) {
    val theme = LocalFaithFormTheme.current

    Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically
        ) {
            ChurchAvatar(
                logoUrl = context.logoUrl,
                name = context.churchName,
                size = FaithFormTokens.TouchTarget.recommended + FaithFormTokens.Spacing.base,
            )
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
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
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val address by viewModel.confirmationEmail.collectAsStateWithLifecycle()
    val resent by viewModel.resendNoticeVisible.collectAsStateWithLifecycle()
    val resending by viewModel.isResending.collectAsStateWithLifecycle()
    val resendError by viewModel.resendError.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                // Composed from tokens rather than a magic 80: the hero glyph
                // plus two steps of padding on each side.
                .size(FaithFormTokens.IconSize.sizeHero + FaithFormTokens.Spacing.xl * 2)
                .background(theme.palette.surface, CircleShape)
                .border(theme.borderWidth, theme.palette.border, CircleShape)
        ) {
            Icon(
                Icons.Outlined.MarkEmailUnread,
                contentDescription = null,
                tint = theme.palette.brandPrimary,
                modifier = Modifier.size(FaithFormTokens.IconSize.sizeHero)
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)
        ) {
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
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = theme.palette.success,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeSmall)
                )
                Text(
                    stringResource(R.string.auth_check_email_resent),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.success
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
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended)
            ) {
                Icon(
                    Icons.Outlined.MarkEmailUnread,
                    contentDescription = null,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium)
                )
                Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.auth_check_email_open_mail))
            }
        }

        OutlinedButton(
            onClick = viewModel::resendConfirmation,
            enabled = !resending,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.auth_check_email_resend),
                working = resending,
            )
        }

        TextButton(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_sign_in_title))
        }
        TextButton(onClick = viewModel::startOver, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_check_email_change_address))
        }
    }
}

/**
 * "By continuing, you agree to FaithForm's Terms of Service and Privacy
 * Policy." — with both names as real links.
 *
 * A notice that names two documents a person cannot open is not agreement to
 * anything; Google Play also expects the privacy policy to be reachable from the
 * place data is first collected, which is this form. The links open in the
 * browser, never in the app, and each is announced to TalkBack as a link.
 */
@Composable
private fun TermsNotice() {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val terms = stringResource(R.string.terms_of_service)
    val privacy = stringResource(R.string.privacy_policy)
    val sentence = stringResource(R.string.auth_terms_notice_linked, terms, privacy)
    val linkStyle = TextLinkStyles(
        style = SpanStyle(color = theme.palette.brandPrimary, textDecoration = TextDecoration.Underline)
    )

    // The two names are substituted into the sentence, so they appear in it
    // verbatim whatever the language; their positions are where the links go.
    val links = listOf(
        Triple(sentence.indexOf(terms), terms, LegalLinks.TERMS),
        Triple(sentence.indexOf(privacy), privacy, LegalLinks.PRIVACY_POLICY),
    ).filter { it.first >= 0 }.sortedBy { it.first }

    val text = buildAnnotatedString {
        var cursor = 0
        for ((start, label, url) in links) {
            if (start < cursor) continue
            append(sentence.substring(cursor, start))
            withLink(LinkAnnotation.Url(url, linkStyle) { openWebLink(context, url) }) { append(label) }
            cursor = start + label.length
        }
        append(sentence.substring(cursor))
    }

    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = theme.mutedContent
    )
}
