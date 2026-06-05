import Foundation
import UIKit

/// Shared geometry for block decorations — the paragraph-style indents
/// (`DocumentMapper.applyBaseVisuals`), the drawing (`SigxLayoutManager`),
/// and the checkbox hit-testing (`RichTextView`) must all agree on where the
/// gutter is.
enum BlockMetrics {
    /// Leading gutter reserved for list markers (bullet / number / checkbox).
    static let listGutter: CGFloat = 28
    /// Leading inset for blockquotes (bar + breathing room).
    static let quoteGutter: CGFloat = 16
    /// Leading inset for code blocks.
    static let codeInset: CGFloat = 8
    /// Task checkbox square, vertically centered in the first line fragment.
    static let checkboxSize: CGFloat = 15

    static func indent(for type: String) -> CGFloat {
        switch type {
        case "bullet", "ordered", "task": return listGutter
        case "blockquote": return quoteGutter
        case "codeBlock": return codeInset
        default: return 0
        }
    }
}

/// Layout manager backing `RichTextView` — all **draw-only** block
/// decorations live here: list markers (bullet dot / ordered number / task
/// checkbox), the blockquote bar, and the code-block full-width background.
///
/// The markers are never part of the text (they can't be edited and never
/// leak into serialization); they are painted into the leading gutter that
/// `applyBaseVisuals` reserves via paragraph-style indents, keyed entirely
/// off the `sigx.block` model attribute at each paragraph start (the same
/// walk `DocumentMapper.encode` does). Ordered numbers are computed from the
/// run position at draw time — never stored — so renumbering on insert/delete
/// is automatic; `level` on the run's first paragraph carries a non-1 start.
///
/// A subclass (not a `UITextView.draw` override) keeps the drawing inside
/// TextKit's own pipeline — see the note in `RichTextView` about the
/// TextKit-1 compatibility path. The stack is built around this class in
/// `SigxRichTextUI.createView`, so it is installed from birth.
final class SigxLayoutManager: NSLayoutManager {

    /// Captured by the owning UI on creation and on every theme change.
    var theme = RichTextTheme()

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, storage.length > 0,
              let container = textContainers.first else { return }

        let charRange = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        let ns = storage.string as NSString
        // Ordered numbering is positional: the backward run walk happens once
        // per visible run, then increments paragraph-to-paragraph within this
        // pass (long lists would otherwise pay O(n²) on every redraw).
        var runNumber = 0
        var runEnd = -1
        var location = charRange.location
        while location < NSMaxRange(charRange) && location < storage.length {
            let para = ns.paragraphRange(for: NSRange(location: location, length: 0))
            defer { location = max(NSMaxRange(para), location + 1) }
            guard para.length > 0,
                  let block = storage.attribute(SigxAttr.block, at: para.location, effectiveRange: nil) as? [String: Any],
                  let type = block["type"] as? String else { continue }

            let glyphs = glyphRange(forCharacterRange: para, actualCharacterRange: nil)
            guard glyphs.length > 0 else { continue }
            // Vertical extent of the whole paragraph (all wrapped fragments)…
            let paraRect = boundingRect(forGlyphRange: glyphs, in: container).offsetBy(dx: origin.x, dy: origin.y)
            // …and of just its first fragment (where markers sit).
            let firstFrag = lineFragmentRect(forGlyphAt: glyphs.location, effectiveRange: nil)
                .offsetBy(dx: origin.x, dy: origin.y)

            switch type {
            case "codeBlock":
                // Full container width — adjacent code lines merge into one
                // visual block (no paragraph spacing between them).
                theme.codeBackground.setFill()
                UIRectFillUsingBlendMode(
                    CGRect(x: origin.x, y: paraRect.minY, width: container.size.width, height: paraRect.height),
                    .normal
                )
            case "blockquote":
                // Leading bar spanning every line of the quote.
                theme.textColor.withAlphaComponent(0.3).setFill()
                UIRectFillUsingBlendMode(
                    CGRect(x: origin.x + 2, y: paraRect.minY, width: 3, height: paraRect.height),
                    .normal
                )
            case "bullet":
                theme.textColor.setFill()
                let r: CGFloat = 2.5
                let center = CGPoint(x: origin.x + 12, y: firstFrag.midY)
                UIBezierPath(ovalIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)).fill()
            case "ordered":
                let number = para.location == runEnd
                    ? runNumber + 1
                    : orderedNumber(for: para, storage: storage, ns: ns)
                runNumber = number
                runEnd = NSMaxRange(para)
                let label = "\(number)." as NSString
                let font = UIFont.monospacedDigitSystemFont(ofSize: theme.fontSize, weight: .regular)
                let size = label.size(withAttributes: [.font: font])
                // Right-aligned against the text edge, with a small gap.
                let x = origin.x + BlockMetrics.listGutter - 6 - size.width
                let baseline = baselineY(forGlyphAt: glyphs.location, origin: origin)
                label.draw(
                    at: CGPoint(x: x, y: baseline - font.ascender),
                    withAttributes: [.font: font, .foregroundColor: theme.textColor]
                )
            case "task":
                let checked = (block["checked"] as? Bool) ?? false
                drawCheckbox(checked: checked, firstFrag: firstFrag, originX: origin.x)
            default:
                break
            }
        }
    }

    /// 1-based number for an `ordered` paragraph, derived from its position
    /// in the run of consecutive ordered paragraphs (walking backwards until
    /// a non-ordered paragraph). The run's first paragraph may carry a non-1
    /// start in `level`.
    private func orderedNumber(for paragraph: NSRange, storage: NSTextStorage, ns: NSString) -> Int {
        var count = 1
        var start = (storage.attribute(SigxAttr.block, at: paragraph.location, effectiveRange: nil)
            as? [String: Any])?["level"] as? Int ?? 0
        var cursor = paragraph.location
        while cursor > 0 {
            let prev = ns.paragraphRange(for: NSRange(location: cursor - 1, length: 0))
            guard prev.length > 0,
                  let block = storage.attribute(SigxAttr.block, at: prev.location, effectiveRange: nil) as? [String: Any],
                  (block["type"] as? String) == "ordered" else { break }
            count += 1
            start = block["level"] as? Int ?? 0
            cursor = prev.location
        }
        return (start > 0 ? start : 1) + count - 1
    }

    /// Baseline of a glyph's line, in drawing coordinates.
    private func baselineY(forGlyphAt glyphIndex: Int, origin: CGPoint) -> CGFloat {
        let frag = lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: nil)
        // `location(forGlyphAt:)` is relative to the line fragment origin and
        // its y is the baseline offset.
        return origin.y + frag.minY + location(forGlyphAt: glyphIndex).y
    }

    private func drawCheckbox(checked: Bool, firstFrag: CGRect, originX: CGFloat) {
        let size = BlockMetrics.checkboxSize
        let rect = CGRect(x: originX + 4, y: firstFrag.midY - size / 2, width: size, height: size)
        let path = UIBezierPath(roundedRect: rect, cornerRadius: 3)
        if checked {
            theme.accentColor.setFill()
            path.fill()
            let check = UIBezierPath()
            check.move(to: CGPoint(x: rect.minX + size * 0.25, y: rect.midY))
            check.addLine(to: CGPoint(x: rect.minX + size * 0.45, y: rect.midY + size * 0.2))
            check.addLine(to: CGPoint(x: rect.minX + size * 0.78, y: rect.midY - size * 0.22))
            check.lineWidth = 1.8
            check.lineCapStyle = .round
            check.lineJoinStyle = .round
            UIColor.white.setStroke()
            check.stroke()
        } else {
            theme.textColor.withAlphaComponent(0.6).setStroke()
            path.lineWidth = 1.5
            path.stroke()
        }
    }
}
