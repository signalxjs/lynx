package com.sigx.devclient

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

data class DevMenuActions(
    val onReload: () -> Unit,
    val onChangeUrl: (String) -> Unit,
    val onGoHome: (() -> Unit)? = null,
    val onTogglePerfHud: () -> Unit,
    val onToggleLogBox: () -> Unit,
    val onToggleInspector: () -> Unit,
    val currentUrl: String,
    val perfHudEnabled: Boolean,
    val logBoxEnabled: Boolean,
    val inspectorEnabled: Boolean,
    /** Optional list of native module names to display. */
    val nativeModules: List<String> = emptyList()
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevMenu(
    visible: Boolean,
    onDismiss: () -> Unit,
    actions: DevMenuActions
) {
    if (!visible) return

    val context = LocalContext.current
    var showUrlInput by remember { mutableStateOf(false) }
    var newUrl by remember(actions.currentUrl) { mutableStateOf(actions.currentUrl) }
    val sheetState = rememberModalBottomSheetState()

    ModalBottomSheet(
        onDismissRequest = {
            showUrlInput = false
            onDismiss()
        },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 32.dp)
        ) {
            Text(
                "sigx Dev Menu",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.primary
            )

            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

            // Reload
            DevMenuItem(
                icon = Icons.Default.Refresh,
                label = "Reload",
                subtitle = "Full reload of current bundle"
            ) {
                actions.onReload()
                onDismiss()
            }

            // Change Server URL
            DevMenuItem(
                icon = Icons.Default.Edit,
                label = "Change Dev Server",
                subtitle = if (showUrlInput) null else actions.currentUrl
            ) {
                showUrlInput = !showUrlInput
            }

            if (showUrlInput) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = newUrl,
                        onValueChange = { newUrl = it },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        label = { Text("Server URL") },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Uri,
                            imeAction = ImeAction.Go
                        ),
                        keyboardActions = KeyboardActions(
                            onGo = {
                                actions.onChangeUrl(newUrl)
                                showUrlInput = false
                                onDismiss()
                            }
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    FilledTonalButton(onClick = {
                        actions.onChangeUrl(newUrl)
                        showUrlInput = false
                        onDismiss()
                    }) {
                        Text("Go")
                    }
                }
            }

            // Copy URL
            DevMenuItem(
                icon = Icons.Default.Share,
                label = "Copy URL",
                subtitle = "Copy current server URL to clipboard"
            ) {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("Dev Server URL", actions.currentUrl))
                Toast.makeText(context, "URL copied", Toast.LENGTH_SHORT).show()
                onDismiss()
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

            // Performance HUD toggle
            DevMenuToggleItem(
                icon = Icons.Default.Info,
                label = "Performance HUD",
                enabled = actions.perfHudEnabled
            ) {
                actions.onTogglePerfHud()
                onDismiss()
            }

            // LogBox toggle
            DevMenuToggleItem(
                icon = Icons.Default.Warning,
                label = "LogBox",
                enabled = actions.logBoxEnabled
            ) {
                actions.onToggleLogBox()
                onDismiss()
            }

            // Element Inspector toggle
            DevMenuToggleItem(
                icon = Icons.Default.List,
                label = "Element Inspector",
                enabled = actions.inspectorEnabled
            ) {
                actions.onToggleInspector()
                onDismiss()
            }

            // Native Modules info (if provided)
            if (actions.nativeModules.isNotEmpty()) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                DevMenuItem(
                    icon = Icons.Default.Build,
                    label = "Native Modules (${actions.nativeModules.size})",
                    subtitle = actions.nativeModules.joinToString(", ")
                ) {
                    Toast.makeText(
                        context,
                        "Available: ${actions.nativeModules.joinToString(", ")}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }

            // Go Home (optional)
            if (actions.onGoHome != null) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                DevMenuItem(
                    icon = Icons.Default.Home,
                    label = "Go Home",
                    subtitle = "Return to URL input screen"
                ) {
                    actions.onGoHome!!()
                    onDismiss()
                }
            }
        }
    }
}

@Composable
private fun DevMenuItem(
    icon: ImageVector,
    label: String,
    subtitle: String? = null,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1
                )
            }
        }
    }
}

@Composable
private fun DevMenuToggleItem(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.width(16.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        Switch(
            checked = enabled,
            onCheckedChange = { onToggle() }
        )
    }
}
