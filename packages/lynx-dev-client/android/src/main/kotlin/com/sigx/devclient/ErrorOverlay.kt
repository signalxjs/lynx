package com.sigx.devclient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * React Native-style red screen error overlay.
 * Shows error message and stack trace with dismiss/reload actions.
 */
@Composable
fun ErrorOverlay(
    error: String?,
    onDismiss: () -> Unit,
    onReload: () -> Unit
) {
    if (error == null) return

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFCC0000))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "Error",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                error,
                color = Color(0xFFFFCCCC),
                fontSize = 14.sp,
                fontFamily = FontFamily.Monospace,
                lineHeight = 20.sp
            )
            Spacer(modifier = Modifier.height(24.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = onReload,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White,
                        contentColor = Color(0xFFCC0000)
                    )
                ) {
                    Text("Reload", fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0x33FFFFFF),
                        contentColor = Color.White
                    )
                ) {
                    Text("Dismiss")
                }
            }
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                "sigx dev client -- shake device or press Menu to open dev tools",
                color = Color(0x99FFFFFF),
                fontSize = 11.sp
            )
        }
    }
}
