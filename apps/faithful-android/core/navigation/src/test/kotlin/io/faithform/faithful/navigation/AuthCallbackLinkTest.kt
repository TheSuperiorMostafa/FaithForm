package io.faithform.faithful.navigation

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives the parser with the shared contract vectors, so this platform cannot
 * quietly accept a link iOS or the web suite refuses — or the other way round.
 * The file is resolved from the repository, not copied into resources: all
 * three languages read the exact same bytes and cannot drift.
 */
private val contractFile: File =
    File("../../../../contracts/faithful/v1/auth-callback.json").canonicalFile

private val contract = Json.parseToJsonElement(contractFile.readText()).jsonObject

private fun vectors(name: String) =
    contract["vectors"]!!.jsonObject[name]!!.jsonArray.map { it.jsonObject }

class AuthCallbackLinkTest {

    @Test
    fun `contract document resolves`() {
        assertTrue("contract not found at ${contractFile.path}", contractFile.isFile)
    }

    @Test
    fun `the constants this app registers are the contract's, verbatim`() {
        val faithful = contract["faithful"]!!.jsonObject
        assertEquals(faithful["scheme"]!!.jsonPrimitive.content, AuthCallbackLink.SCHEME)
        assertEquals(faithful["host"]!!.jsonPrimitive.content, AuthCallbackLink.HOST)
        assertEquals(faithful["path"]!!.jsonPrimitive.content, AuthCallbackLink.PATH)
        assertEquals(faithful["canonical"]!!.jsonPrimitive.content, AuthCallbackLink.CANONICAL)
    }

    @Test
    fun `every accepted vector yields exactly its code`() {
        for (vector in vectors("accepted")) {
            val url = vector["url"]!!.jsonPrimitive.content
            val expected = vector["code"]!!.jsonPrimitive.content
            assertEquals(
                url,
                AuthCallbackLink.Outcome.Code(expected),
                AuthCallbackLink.parse(url)
            )
        }
    }

    @Test
    fun `every failure vector is a visible failure state, never an exchange`() {
        for (vector in vectors("failures")) {
            val url = vector["url"]!!.jsonPrimitive.content
            val reason = when (vector["reason"]!!.jsonPrimitive.content) {
                "expired" -> AuthCallbackLink.FailureReason.EXPIRED
                else -> AuthCallbackLink.FailureReason.INVALID
            }
            assertEquals(
                url,
                AuthCallbackLink.Outcome.Failure(reason),
                AuthCallbackLink.parse(url)
            )
        }
    }

    @Test
    fun `every rejected vector is not an auth callback at all`() {
        for (vector in vectors("rejected")) {
            val url = vector["url"]!!.jsonPrimitive.content
            assertNull(url, AuthCallbackLink.parse(url))
        }
    }

    @Test
    fun `unparseable strings are rejected, not thrown`() {
        assertNull(AuthCallbackLink.parse("not a url at all"))
        assertNull(AuthCallbackLink.parse(""))
        assertNull(AuthCallbackLink.parse("faithful://"))
    }
}
