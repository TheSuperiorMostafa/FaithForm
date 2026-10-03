package io.faithform.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.faithform.app.design.LocalFaithFormTheme

/** The loaded card and its skeleton share identical action geometry and static labels. */
@Composable
internal fun SermonActionButton(
    label: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val theme = LocalFaithFormTheme.current
    FaithFormButton(
        onClick = onClick, enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (primary) theme.palette.contentPrimary else theme.palette.surface,
            contentColor = if (primary) theme.palette.background else theme.palette.contentPrimary,
            disabledContainerColor = if (primary) theme.palette.contentPrimary else theme.palette.surface,
            disabledContentColor = if (primary) theme.palette.background else theme.palette.contentPrimary,
        ),
        border = if (primary) null else BorderStroke(theme.borderWidth, theme.palette.border),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
        modifier = modifier.heightIn(min = 48.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.size(8.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
    }
}
