package com.sigx.devclient

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * Dev-mode landing screen for sigx-lynx apps that ship without a bundled
 * `main.lynx.bundle`. Lets the user enter a dev-server URL by hand, scan a
 * QR code, or pick from recent URLs. The app template renders this when it
 * has no `EXTRA_DEV_URL` intent extra AND no `main.lynx.bundle` asset.
 *
 * `onSelectUrl` fires when the user picks a URL — the parent (template's
 * MainActivity) holds that in state and re-composes to render `DevLynxScreen`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevHomeScreen(
    onSelectUrl: (String) -> Unit,
) {
    val context = LocalContext.current
    val devSettings = remember { DevSettings(context) }
    var urlText by remember { mutableStateOf("") }
    var recentUrls by remember { mutableStateOf(devSettings.recentUrls) }
    var showQRScanner by remember { mutableStateOf(false) }

    fun connectToUrl(url: String) {
        val trimmed = url.trim()
        if (trimmed.isBlank()) return
        devSettings.addRecentUrl(trimmed)
        recentUrls = devSettings.recentUrls
        onSelectUrl(trimmed)
    }

    if (showQRScanner) {
        DevQRScanner(
            onCodeScanned = { code ->
                showQRScanner = false
                urlText = code
                connectToUrl(code)
            },
            onBack = { showQRScanner = false },
        )
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("sigx-lynx dev") },
                actions = {
                    IconButton(onClick = { showQRScanner = true }) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "Scan QR")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
        ) {
            OutlinedTextField(
                value = urlText,
                onValueChange = { urlText = it },
                label = { Text("Dev server URL") },
                placeholder = { Text("http://192.168.1.100:3000/main.lynx.bundle") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(
                    onGo = { connectToUrl(urlText) },
                ),
            )

            Spacer(modifier = Modifier.height(12.dp))

            Button(
                onClick = { connectToUrl(urlText) },
                modifier = Modifier.fillMaxWidth(),
                enabled = urlText.isNotBlank(),
            ) {
                Text("Connect")
            }

            Spacer(modifier = Modifier.height(24.dp))

            if (recentUrls.isNotEmpty()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Recent",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    TextButton(onClick = {
                        devSettings.clearRecentUrls()
                        recentUrls = emptyList()
                    }) {
                        Text("Clear")
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                LazyColumn {
                    items(recentUrls) { url ->
                        ListItem(
                            headlineContent = { Text(url, maxLines = 1) },
                            modifier = Modifier.clickable {
                                urlText = url
                                connectToUrl(url)
                            },
                            trailingContent = {
                                IconButton(onClick = {
                                    devSettings.removeRecentUrl(url)
                                    recentUrls = devSettings.recentUrls
                                }) {
                                    Icon(Icons.Default.Delete, contentDescription = "Remove")
                                }
                            },
                        )
                        HorizontalDivider()
                    }
                }
            } else {
                Spacer(modifier = Modifier.weight(1f))
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        "Enter a dev server URL or scan a QR code",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}
