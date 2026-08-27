package io.faithform.faithful.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.faithful.network.AuthException
import io.faithform.faithful.network.SignUpOutcome
import io.faithform.faithful.network.SupabaseAuthClient
import io.faithform.faithful.network.SupabaseSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What went wrong, in terms a screen can translate to its own sentence.
 * Resources live in the UI layer; nothing here touches Android resources, so
 * the model runs under a plain JVM test.
 */
enum class AuthUiError {
    EMAIL_INVALID,
    PASSWORD_MISSING,
    WEAK_PASSWORD,
    INVALID_CREDENTIALS,
    ACCOUNT_EXISTS,
    EMAIL_NOT_CONFIRMED,
    RATE_LIMITED,
    OFFLINE,
    NOT_CONFIGURED,
    GENERIC
}

/** Every case is a real state: working disables the form, checkEmail is
 * signup's "confirm first" outcome, failed carries what to say. */
sealed interface AuthUiPhase {
    data object Idle : AuthUiPhase
    data object Working : AuthUiPhase
    data object CheckEmail : AuthUiPhase
    data class Failed(val error: AuthUiError) : AuthUiPhase
}

/**
 * Creating an account and signing in.
 *
 * Validates locally, calls the identity provider, and hands a finished
 * session to [onAuthenticated] — adopting it and reloading the app is the
 * composition root's job, not a form's. Cancelling is nothing more than
 * leaving: no state below this survives dismissal.
 */
class AuthViewModel(
    private val auth: SupabaseAuthClient?,
    private val onAuthenticated: (SupabaseSession, displayName: String?) -> Unit
) : ViewModel() {

    private val _name = MutableStateFlow("")
    val name: StateFlow<String> = _name.asStateFlow()

    private val _email = MutableStateFlow("")
    val email: StateFlow<String> = _email.asStateFlow()

    private val _password = MutableStateFlow("")
    val password: StateFlow<String> = _password.asStateFlow()

    private val _phase = MutableStateFlow<AuthUiPhase>(AuthUiPhase.Idle)
    val phase: StateFlow<AuthUiPhase> = _phase.asStateFlow()

    /** Set after a reset email was requested; the same sentence whether or not
     * the address has an account, so the form cannot test addresses. */
    private val _resetNoticeVisible = MutableStateFlow(false)
    val resetNoticeVisible: StateFlow<Boolean> = _resetNoticeVisible.asStateFlow()

    fun updateName(value: String) { _name.value = value }
    fun updateEmail(value: String) { _email.value = value }
    fun updatePassword(value: String) { _password.value = value }

    private fun trimmedEmail() = _email.value.trim()

    /** The one local rule worth having: don't send a request that cannot
     * possibly succeed. Everything subtler is the server's call. */
    private fun validate(forSignUp: Boolean): AuthUiError? {
        val email = trimmedEmail()
        if (email.isEmpty() || "@" !in email) return AuthUiError.EMAIL_INVALID
        if (_password.value.isEmpty()) return AuthUiError.PASSWORD_MISSING
        if (forSignUp && _password.value.length < 8) return AuthUiError.WEAK_PASSWORD
        return null
    }

    fun createAccount() {
        val client = auth ?: run {
            _phase.value = AuthUiPhase.Failed(AuthUiError.NOT_CONFIGURED)
            return
        }
        validate(forSignUp = true)?.let {
            _phase.value = AuthUiPhase.Failed(it)
            return
        }

        _phase.value = AuthUiPhase.Working
        viewModelScope.launch {
            try {
                when (val outcome = client.signUp(trimmedEmail(), _password.value)) {
                    is SignUpOutcome.Session -> {
                        onAuthenticated(outcome.session, _name.value.trim().ifEmpty { null })
                        _phase.value = AuthUiPhase.Idle
                    }
                    is SignUpOutcome.ConfirmationRequired -> {
                        _phase.value = AuthUiPhase.CheckEmail
                    }
                }
            } catch (error: AuthException) {
                _phase.value = AuthUiPhase.Failed(map(error))
            } catch (error: Exception) {
                _phase.value = AuthUiPhase.Failed(AuthUiError.GENERIC)
            }
        }
    }

    fun signIn() {
        val client = auth ?: run {
            _phase.value = AuthUiPhase.Failed(AuthUiError.NOT_CONFIGURED)
            return
        }
        validate(forSignUp = false)?.let {
            _phase.value = AuthUiPhase.Failed(it)
            return
        }

        _phase.value = AuthUiPhase.Working
        viewModelScope.launch {
            try {
                val session = client.signIn(trimmedEmail(), _password.value)
                onAuthenticated(session, null)
                _phase.value = AuthUiPhase.Idle
            } catch (error: AuthException) {
                _phase.value = AuthUiPhase.Failed(map(error))
            } catch (error: Exception) {
                _phase.value = AuthUiPhase.Failed(AuthUiError.GENERIC)
            }
        }
    }

    fun sendReset() {
        val client = auth ?: run {
            _phase.value = AuthUiPhase.Failed(AuthUiError.NOT_CONFIGURED)
            return
        }
        val email = trimmedEmail()
        if (email.isEmpty() || "@" !in email) {
            _phase.value = AuthUiPhase.Failed(AuthUiError.EMAIL_INVALID)
            return
        }

        _phase.value = AuthUiPhase.Working
        viewModelScope.launch {
            try {
                client.sendPasswordReset(email)
                _resetNoticeVisible.value = true
                _phase.value = AuthUiPhase.Idle
            } catch (error: AuthException) {
                _phase.value = AuthUiPhase.Failed(map(error))
            } catch (error: Exception) {
                _phase.value = AuthUiPhase.Failed(AuthUiError.GENERIC)
            }
        }
    }

    /** Moving between screens clears what no longer applies. The email is kept
     * — retyping it is pure friction — and the password never survives. */
    fun resetForNewScreen() {
        _password.value = ""
        _phase.value = AuthUiPhase.Idle
        _resetNoticeVisible.value = false
    }

    private fun map(error: AuthException): AuthUiError = when (error.kind) {
        AuthException.Kind.INVALID_CREDENTIALS -> AuthUiError.INVALID_CREDENTIALS
        AuthException.Kind.ACCOUNT_EXISTS -> AuthUiError.ACCOUNT_EXISTS
        AuthException.Kind.WEAK_PASSWORD -> AuthUiError.WEAK_PASSWORD
        AuthException.Kind.EMAIL_NOT_CONFIRMED -> AuthUiError.EMAIL_NOT_CONFIRMED
        AuthException.Kind.RATE_LIMITED -> AuthUiError.RATE_LIMITED
        AuthException.Kind.OFFLINE -> AuthUiError.OFFLINE
        AuthException.Kind.NOT_CONFIGURED -> AuthUiError.NOT_CONFIGURED
        AuthException.Kind.OTHER -> AuthUiError.GENERIC
    }
}
