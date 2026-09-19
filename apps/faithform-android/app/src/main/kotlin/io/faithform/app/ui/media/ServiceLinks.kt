package io.faithform.app.ui.media

import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.faithform.app.R
import io.faithform.app.contract.LinkedService
import io.faithform.app.sermons.PresentationClient
import io.faithform.app.storage.CachePartition

@Composable
internal fun RelatedServices(services: List<LinkedService>, onOpen: (LinkedService) -> Unit) {
    if (services.isEmpty()) return
    LazyRow {
        items(services, key = { "${it.kind}:${it.mediaId}" }) { service ->
            TextButton(onClick = { onOpen(service) }) {
                Text("${stringResource(if (service.kind == "live") R.string.media_watch_live else R.string.media_watch_recording)} · ${service.title}")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ServicePresentationSheet(
    client: PresentationClient,
    churchSlug: String,
    partition: CachePartition,
    presentationId: String,
    onClose: () -> Unit,
) {
    // A sheet leaves the player and its session mounted, so listening continues.
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        TextButton(onClick = onClose) { Text(stringResource(R.string.media_back_to_service)) }
        PresentationDetailHost(client, churchSlug, partition, presentationId, onClose, Modifier.fillMaxHeight(0.85f))
    }
}
