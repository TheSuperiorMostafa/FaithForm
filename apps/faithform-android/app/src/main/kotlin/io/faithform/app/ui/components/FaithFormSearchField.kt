package io.faithform.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

/** Cream search field matching Discovery — sermons, slides, and past services. */
@Composable
fun FaithFormSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.pill)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(theme.palette.surfaceSunken, shape)
            .border(theme.borderWidth, theme.palette.border, shape)
            .heightIn(min = FaithFormTokens.TouchTarget.minimum)
            .padding(horizontal = FaithFormTokens.Spacing.base)
            .semantics { contentDescription = placeholder },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Search,
            contentDescription = null,
            tint = theme.mutedContent,
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
        )
        Box(
            modifier = Modifier
                .weight(1f)
                .padding(start = FaithFormTokens.Spacing.sm),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (value.isEmpty()) {
                Text(placeholder, color = theme.mutedContent, style = MaterialTheme.typography.bodyLarge)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = theme.palette.contentPrimary),
                cursorBrush = SolidColor(theme.palette.brandAccent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
