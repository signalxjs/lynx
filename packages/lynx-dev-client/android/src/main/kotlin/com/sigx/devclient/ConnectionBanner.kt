package com.sigx.devclient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Thin top banner shown while the dev-server connection is down. Auto-hides
 * when the JS streamer reconnects (a server restart also reloads the app,
 * which clears it). Mirror of the iOS `ConnectionBanner`.
 */
@Composable
fun ConnectionBanner(connected: Boolean, modifier: Modifier = Modifier) {
    if (connected) return
    Text(
        "⚡ Disconnected from dev server — reconnecting…",
        modifier = modifier
            .fillMaxWidth()
            .background(Color(0xFFFF6B6B))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        fontFamily = FontFamily.Monospace,
        textAlign = TextAlign.Center,
    )
}
