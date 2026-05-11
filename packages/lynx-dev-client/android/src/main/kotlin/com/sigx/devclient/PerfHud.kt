package com.sigx.devclient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lynx.tasm.LynxPerfMetric
import com.lynx.tasm.LynxView
import kotlinx.coroutines.delay

/**
 * Translucent performance overlay showing key Lynx rendering metrics.
 * Uses LynxView.forceGetPerf() to read timing data.
 */
@Composable
fun PerfHud(
    visible: Boolean,
    lynxView: LynxView?,
    modifier: Modifier = Modifier
) {
    if (!visible || lynxView == null) return

    var metrics by remember { mutableStateOf<LynxPerfMetric?>(null) }

    LaunchedEffect(lynxView) {
        while (true) {
            try {
                metrics = lynxView.forceGetPerf()
            } catch (_: Exception) {}
            delay(2000)
        }
    }

    Box(
        modifier = modifier
            .padding(8.dp)
            .background(Color(0xCC1E1E1E), RoundedCornerShape(8.dp))
            .padding(10.dp)
    ) {
        Column {
            Text(
                "sigx perf",
                color = Color(0xFF7C3AED),
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace
            )
            Spacer(modifier = Modifier.height(4.dp))

            metrics?.let { m ->
                PerfLine("TTI", m.tti)
                PerfLine("Layout", m.layout)
                PerfLine("JS Core", m.jsFinishLoadCore)
                PerfLine("JS App", m.jsFinishLoadApp)
                PerfLine("TASM Decode", m.tasmBinaryDecode)
                PerfLine("Render Page", m.renderPage)
                PerfLine("Diff Root", m.diffRootCreate)
                if (m.isHasActualFMP) {
                    PerfLine("FMP", m.actualFMPDuration)
                }
            } ?: Text(
                "Waiting for metrics...",
                color = Color(0xFF94A3B8),
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}

@Composable
private fun PerfLine(label: String, value: Double) {
    if (value <= 0) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            label,
            color = Color(0xFF94A3B8),
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace
        )
        Text(
            "%.1fms".format(value),
            color = when {
                value < 100 -> Color(0xFF22C55E)
                value < 300 -> Color(0xFFEAB308)
                else -> Color(0xFFEF4444)
            },
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace
        )
    }
}
