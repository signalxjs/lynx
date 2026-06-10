package com.sigx.devclient

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Separates the reason (shown) from the stack (collapsible). Matches iOS. */
const val DETAIL_MARKER = "##SIGX_STACKTRACE##"

/**
 * React Native-style red error overlay with a LogBox-style multi-error pager.
 * Shows the reason by default with a "Show stacktrace" toggle; a `‹ N/M ›`
 * counter pages through accumulated errors, with Reload / Copy / Dismiss.
 * Mirrors iOS `DevErrorOverlay`.
 */
@Composable
fun ErrorOverlay(
    errors: List<String>,
    index: Int,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onDismiss: () -> Unit,
    onReload: () -> Unit
) {
    if (errors.isEmpty()) return
    val safeIndex = index.coerceIn(0, errors.size - 1)
    val current = errors[safeIndex]
    val context = LocalContext.current
    // Collapsed by default; reset whenever the shown error changes.
    var showStack by remember(safeIndex) { mutableStateOf(false) }

    val parts = current.split(DETAIL_MARKER, limit = 2)
    val reason = parts[0].trim()
    val details = parts.getOrNull(1)?.trim()

    fun copy(text: String, label: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Lynx error", text))
        Toast.makeText(context, label, Toast.LENGTH_SHORT).show()
    }

    fun stripped(s: String): String = s.split(DETAIL_MARKER).joinToString("\n\n") { it.trim() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFCC0000))
    ) {
        // Header + action bar are pinned; only the message/stack scrolls — so
        // the reason, the pager and the buttons are always reachable.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
        ) {
            // Header: title + pager
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Error", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.weight(1f))
                if (errors.size > 1) {
                    Text(
                        "‹",
                        color = if (safeIndex > 0) Color.White else Color(0x66FFFFFF),
                        fontSize = 24.sp,
                        modifier = Modifier.clickable(enabled = safeIndex > 0, onClick = onPrev).padding(horizontal = 8.dp)
                    )
                    Text(
                        "${safeIndex + 1}/${errors.size}",
                        color = Color.White,
                        fontSize = 15.sp,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        "›",
                        color = if (safeIndex < errors.size - 1) Color.White else Color(0x66FFFFFF),
                        fontSize = 24.sp,
                        modifier = Modifier.clickable(enabled = safeIndex < errors.size - 1, onClick = onNext).padding(horizontal = 8.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
            // Reason (shown) + collapsible stack — the only scrolling region.
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
            ) {
                Text(
                    reason,
                    color = Color(0xFFFFCCCC),
                    fontSize = 14.sp,
                    fontFamily = FontFamily.Monospace,
                    lineHeight = 20.sp
                )
                if (details != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        if (showStack) "▾ Hide stacktrace" else "▸ Show stacktrace",
                        color = Color.White,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable { showStack = !showStack }
                    )
                    if (showStack) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            details,
                            color = Color(0xD9FFCCCC),
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            lineHeight = 18.sp
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = onReload,
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFFCC0000))
                ) { Text("Reload", fontWeight = FontWeight.Bold) }
                Button(
                    onClick = { copy(stripped(current), "Copied") },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0x33FFFFFF), contentColor = Color.White)
                ) { Text("Copy") }
                if (errors.size > 1) {
                    Button(
                        onClick = {
                            val all = errors.mapIndexed { i, e -> "#${i + 1}\n${stripped(e)}" }.joinToString("\n\n———\n\n")
                            copy(all, "Copied all")
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0x33FFFFFF), contentColor = Color.White)
                    ) { Text("Copy all") }
                }
                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0x33FFFFFF), contentColor = Color.White)
                ) { Text("Dismiss") }
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
