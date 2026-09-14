package io.faithform.app.ui.church

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

/** Church logo with monogram fallback — discovery, profile, and chooser. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun ChurchAvatar(
    logoUrl: String?,
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = FaithFormTokens.TouchTarget.recommended,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(theme.palette.surfaceSunken)
            .border(theme.borderWidth, theme.palette.border, shape)
            .semantics { invisibleToUser() },
        contentAlignment = Alignment.Center,
    ) {
        if (!logoUrl.isNullOrBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(logoUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                initials(name),
                style = MaterialTheme.typography.titleMedium,
                color = theme.palette.brandPrimary,
            )
        }
    }
}

/** Cover strip with logo for church profiles. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun ChurchHero(
    coverImageUrl: String?,
    logoUrl: String?,
    name: String,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 24.dp)
            .semantics { invisibleToUser() },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp)
                .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
                .background(theme.palette.brandPrimary.copy(alpha = 0.12f)),
        ) {
            if (!coverImageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current)
                        .data(coverImageUrl)
                        .crossfade(true)
                        .build(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        ChurchAvatar(
            logoUrl = logoUrl,
            name = name,
            size = 64.dp,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(FaithFormTokens.Spacing.base)
                .offset(y = 24.dp),
        )
    }
}

private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
    return if (parts.isEmpty()) {
        "?"
    } else {
        parts.mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("")
    }
}
