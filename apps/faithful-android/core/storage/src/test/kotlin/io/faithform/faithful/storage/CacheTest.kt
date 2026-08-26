package io.faithform.faithful.storage

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheTest {

    private fun partition(
        environment: String = "production",
        account: String? = "account-1",
        church: String? = null,
        version: Int = 1
    ) = CachePartition(environment, account, church, version)

    @Test
    fun `a value stored in one partition is invisible in another`() = runTest {
        val cache = PartitionedCache()
        cache.store("bootstrap", partition(), "mine", 0)

        assertNull(cache.load("bootstrap", partition(account = "account-2")))
        assertNull(cache.load("bootstrap", partition(environment = "staging")))
        assertNull(cache.load("bootstrap", partition(church = "grace")))
        // Version change is what makes revocation bite.
        assertNull(cache.load("bootstrap", partition(version = 2)))
        assertEquals("mine", cache.load("bootstrap", partition()))
    }

    @Test
    fun `public and private data never share a partition`() = runTest {
        val cache = PartitionedCache()
        val anonymous = CachePartition.publicPartition("production")
        cache.store("churches", anonymous, "public", 0)
        cache.store("churches", partition(), "private", 0)

        assertTrue(anonymous.isPublic)
        assertEquals("public", cache.load("churches", anonymous))
        assertEquals("private", cache.load("churches", partition()))
    }

    @Test
    fun `revoking one church leaves other churches intact`() = runTest {
        val cache = PartitionedCache()
        cache.store("feed", partition(church = "grace"), "g", 0)
        cache.store("feed", partition(church = "river"), "r", 0)

        cache.purge(partition(church = "grace"))
        assertNull(cache.load("feed", partition(church = "grace")))
        assertEquals("r", cache.load("feed", partition(church = "river")))
    }

    @Test
    fun `sign-out clears every partition for that account`() = runTest {
        val cache = PartitionedCache()
        cache.store("x", partition(church = "grace", version = 1), "a", 0)
        cache.store("x", partition(church = "river", version = 4), "b", 0)
        cache.store("x", partition(account = "account-2"), "other", 0)
        cache.store("x", CachePartition.publicPartition("production"), "public", 0)

        cache.purgeAccount("production", "account-1")

        assertNull(cache.load("x", partition(church = "grace", version = 1)))
        assertNull(cache.load("x", partition(church = "river", version = 4)))
        assertNotNull(cache.load("x", partition(account = "account-2")))
        assertNotNull(cache.load("x", CachePartition.publicPartition("production")))
    }

    @Test
    fun `switching account leaves nothing private behind`() = runTest {
        val cache = PartitionedCache()
        cache.store("x", partition(), "a", 0)
        cache.store("x", partition(account = "account-2"), "b", 0)
        cache.store("x", CachePartition.publicPartition("production"), "public", 0)

        cache.purgeAllPrivate()
        assertEquals(1, cache.count())
        assertNotNull(cache.load("x", CachePartition.publicPartition("production")))
    }

    @Test
    fun `freshness distinguishes fresh stale and expired`() {
        val ttl = 300_000L
        val entry = CacheEntry("v", null, storedAtMillis = 0)
        assertEquals(Freshness.Fresh, entry.freshness(60_000, ttl))
        assertTrue(entry.freshness(600_000, ttl) is Freshness.Stale)
        assertEquals(Freshness.Expired, entry.freshness(4_000_000, ttl))
    }

    @Test
    fun `eviction is deterministic oldest first`() = runTest {
        val cache = PartitionedCache(maxEntries = 3)
        repeat(5) { index ->
            cache.store("item-$index", partition(), "v$index", index.toLong())
        }
        assertEquals(3, cache.count())
        assertNull(cache.load("item-0", partition()))
        assertNotNull(cache.load("item-4", partition()))
    }
}
