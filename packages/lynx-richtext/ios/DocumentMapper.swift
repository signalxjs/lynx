import Foundation
import UIKit

/// RichDoc (JSON) ↔ NSAttributedString mapping for `<sigx-richtext>`.
///
/// ## Attribute scheme — custom attrs are the model, visuals are derived
///
/// Every model fact is stored as an explicit custom attribute
/// (`sigx.bold`, `sigx.italic`, `sigx.strike`, `sigx.code`, `sigx.link`,
/// `sigx.block`) on the text storage. Visual attributes (`.font`,
/// `.strikethroughStyle`, `.foregroundColor`, `.backgroundColor`) are
/// recomputed *from* the custom attrs. Readback therefore consults only the
/// custom attrs, which makes it unambiguous: a heading's bold font never
/// reads back as a `bold` span, because only `sigx.bold` produces one.
///
/// Custom attributes ride along with edits exactly like visual attributes
/// (UIKit moves attribute ranges on insert/delete and propagates them through
/// `typingAttributes`), which is what makes the "native storage is the source
/// of truth, JS reads it back" architecture work.
enum SigxAttr {
    static let bold = NSAttributedString.Key("sigx.bold")
    static let italic = NSAttributedString.Key("sigx.italic")
    static let strike = NSAttributedString.Key("sigx.strike")
    static let code = NSAttributedString.Key("sigx.code")
    static let link = NSAttributedString.Key("sigx.link")      // value: href String
    static let mention = NSAttributedString.Key("sigx.mention") // value: [String:String] {id, label, kind?}
    static let block = NSAttributedString.Key("sigx.block")    // value: [String:Any] {type, level?}

    /// The inline model keys (paragraph-level `block` is handled separately).
    static let inlineKeys: [(NSAttributedString.Key, String)] = [
        (bold, "bold"), (italic, "italic"), (strike, "strike"), (code, "code"),
    ]
}

struct RichTextTheme {
    var fontSize: CGFloat = 16
    var textColor: UIColor = .label
    var accentColor: UIColor = .systemBlue
    var placeholderColor: UIColor = .placeholderText

    /// Heading scale per level (MVP renders 1–3; 4–6 fall back to 1.1×).
    func headingFont(level: Int) -> UIFont {
        let (scale, weight): (CGFloat, UIFont.Weight) = {
            switch level {
            case 1: return (1.75, .bold)
            case 2: return (1.5, .bold)
            case 3: return (1.25, .semibold)
            default: return (1.1, .semibold)
            }
        }()
        return .systemFont(ofSize: (fontSize * scale).rounded(), weight: weight)
    }

    var baseFont: UIFont { .systemFont(ofSize: fontSize) }
    var codeFont: UIFont { .monospacedSystemFont(ofSize: (fontSize * 0.95).rounded(), weight: .regular) }
    var codeBackground: UIColor { UIColor.secondarySystemFill }
}

/// The pill drawn for an atomic mention chip.
///
/// A mention span covers exactly **one U+FFFC** code unit (the model
/// invariant — see `InlineSpanType` in `model/types.ts`); the attachment is
/// what makes that char render as a labeled pill. The label lives only in
/// `attrs` — it is never part of the document text. Because the chip is one
/// character, deletion and selection are naturally atomic: there is no
/// interior position a caret could land on.
final class MentionAttachment: NSTextAttachment {
    let chipAttrs: [String: String]

    init(attrs: [String: String], theme: RichTextTheme) {
        self.chipAttrs = attrs
        super.init(data: nil, ofType: nil)
        image = MentionAttachment.renderPill(label: attrs["label"] ?? "", theme: theme)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Baseline placement computed at layout time, proportional to the pill —
    /// independent of the host font (the attachment can't read the adjacent
    /// font here, so a fixed-font descender would misalign inside headings).
    public override func attachmentBounds(
        for textContainer: NSTextContainer?,
        proposedLineFragment lineFrag: CGRect,
        glyphPosition position: CGPoint,
        characterIndex charIndex: Int
    ) -> CGRect {
        let size = image?.size ?? .zero
        return CGRect(x: 0, y: -size.height * 0.2, width: size.width, height: size.height)
    }

    private static func renderPill(label: String, theme: RichTextTheme) -> UIImage {
        let font = UIFont.systemFont(ofSize: (theme.fontSize * 0.9).rounded(), weight: .medium)
        let text = "@\(label)" as NSString
        let textSize = text.size(withAttributes: [.font: font])
        let hPad: CGFloat = 6
        let vPad: CGFloat = 2
        let size = CGSize(
            width: ceil(textSize.width) + hPad * 2,
            height: ceil(textSize.height) + vPad * 2
        )
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            let rect = CGRect(origin: .zero, size: size)
            let path = UIBezierPath(roundedRect: rect, cornerRadius: size.height / 2)
            theme.accentColor.withAlphaComponent(0.15).setFill()
            path.fill()
            text.draw(
                at: CGPoint(x: hPad, y: vPad),
                withAttributes: [.font: font, .foregroundColor: theme.accentColor]
            )
        }
    }
}

enum DocumentMapper {

    // MARK: - JSON → storage

    /// Parse a JSON RichDoc and build the fully attributed string.
    /// Returns nil for unparseable input (caller keeps current content).
    static func parse(json: String, theme: RichTextTheme) -> (NSAttributedString, version: Int)? {
        guard let data = json.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let text = obj["text"] as? String else { return nil }

        let version = obj["v"] as? Int ?? 0
        let result = NSMutableAttributedString(string: text)
        let full = NSRange(location: 0, length: result.length)
        let clampUpper = result.length

        // Model attrs: inline spans.
        if let spans = obj["spans"] as? [[String: Any]] {
            for span in spans {
                guard let start = span["start"] as? Int, let end = span["end"] as? Int,
                      let type = span["type"] as? String else { continue }
                let s = max(0, min(start, clampUpper))
                let e = max(s, min(end, clampUpper))
                guard e > s else { continue }
                let range = NSRange(location: s, length: e - s)
                let attrs = span["attrs"] as? [String: String]
                switch type {
                case "bold": result.addAttribute(SigxAttr.bold, value: true, range: range)
                case "italic": result.addAttribute(SigxAttr.italic, value: true, range: range)
                case "strike": result.addAttribute(SigxAttr.strike, value: true, range: range)
                case "code": result.addAttribute(SigxAttr.code, value: true, range: range)
                case "link": result.addAttribute(SigxAttr.link, value: attrs?["href"] ?? "", range: range)
                case "mention":
                    result.addAttribute(SigxAttr.mention, value: attrs ?? [:], range: range)
                    // The chip invariant: the span covers exactly one U+FFFC
                    // AND carries a usable payload. Attach the pill renderer
                    // when it holds; a non-conforming span keeps the model
                    // attr (round-trips) but renders as its literal text —
                    // never shift offsets during parse, never draw an
                    // empty/"@"-only pill for invalid mention data.
                    if range.length == 1,
                       (result.string as NSString).character(at: range.location) == 0xFFFC,
                       let chipAttrs = attrs, chipUsable(chipAttrs) {
                        result.addAttribute(
                            .attachment,
                            value: MentionAttachment(attrs: chipAttrs, theme: theme),
                            range: range
                        )
                    }
                default: break
                }
            }
        }

        // Model attrs: blocks (snapped to paragraph ranges defensively).
        if let blocks = obj["blocks"] as? [[String: Any]] {
            let ns = result.string as NSString
            for block in blocks {
                guard let start = block["start"] as? Int, let end = block["end"] as? Int,
                      let type = block["type"] as? String, type != "paragraph" else { continue }
                let s = max(0, min(start, clampUpper))
                let e = max(s, min(end, clampUpper))
                let snapped = ns.paragraphRange(for: NSRange(location: s, length: max(0, e - s)))
                var value: [String: Any] = ["type": type]
                if let level = block["level"] as? Int { value["level"] = level }
                if let checked = block["checked"] as? Bool { value["checked"] = checked }
                if snapped.length >= 0 { result.addAttribute(SigxAttr.block, value: value, range: snapped) }
            }
        }

        refreshVisuals(result, range: full, theme: theme)
        return (result, version)
    }

    // MARK: - Visual derivation

    /// Recompute visual attributes from the custom model attrs over `range`.
    static func refreshVisuals(_ storage: NSMutableAttributedString, range: NSRange, theme: RichTextTheme) {
        guard range.length > 0 || storage.length == 0 else {
            applyBaseVisuals(storage, range: range, theme: theme)
            return
        }
        applyBaseVisuals(storage, range: range, theme: theme)
    }

    private static func applyBaseVisuals(_ storage: NSMutableAttributedString, range: NSRange, theme: RichTextTheme) {
        guard range.location != NSNotFound, range.length > 0 else { return }

        storage.enumerateAttributes(in: range, options: []) { attrs, sub, _ in
            var font = theme.baseFont
            var color = theme.textColor
            var background: UIColor? = nil
            var strike = false
            var underline = false

            // Block style first (heading fonts), then inline modifiers on top.
            if let block = attrs[SigxAttr.block] as? [String: Any],
               let type = block["type"] as? String, type == "heading" {
                font = theme.headingFont(level: block["level"] as? Int ?? 1)
            }

            // `code` is terminal (mirrors the markdown serializer, where
            // computeRuns drops every mark but `link` inside a code span):
            // bold/italic/strike never render inside a code run, so the
            // field can't show styling that serialization would discard.
            let isCode = attrs[SigxAttr.code] != nil
            if isCode {
                font = theme.codeFont
                background = theme.codeBackground
            }

            var traits = font.fontDescriptor.symbolicTraits
            if !isCode, attrs[SigxAttr.bold] != nil { traits.insert(.traitBold) }
            if !isCode, attrs[SigxAttr.italic] != nil { traits.insert(.traitItalic) }
            if traits != font.fontDescriptor.symbolicTraits,
               let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
                font = UIFont(descriptor: descriptor, size: font.pointSize)
            }

            if !isCode, attrs[SigxAttr.strike] != nil { strike = true }
            if attrs[SigxAttr.link] != nil {
                color = theme.accentColor
                underline = true
            }

            storage.addAttribute(.font, value: font, range: sub)
            storage.addAttribute(.foregroundColor, value: color, range: sub)
            if let background {
                storage.addAttribute(.backgroundColor, value: background, range: sub)
            } else {
                storage.removeAttribute(.backgroundColor, range: sub)
            }
            storage.addAttribute(
                .strikethroughStyle,
                value: strike ? NSUnderlineStyle.single.rawValue : 0,
                range: sub
            )
            storage.addAttribute(
                .underlineStyle,
                value: underline ? NSUnderlineStyle.single.rawValue : 0,
                range: sub
            )
        }
    }

    /// A chip is renderable only with a usable payload — an id-less or
    /// label-less mention must not draw a pill (same rule as insertChip).
    static func chipUsable(_ attrs: [String: String]) -> Bool {
        return !(attrs["id"] ?? "").isEmpty && !(attrs["label"] ?? "").isEmpty
    }

    /// Rebuild chip pill images after a theme change (font size / accent) —
    /// attachments capture their look at creation time. Gated by the same
    /// conformance rules as `parse` so invalid mentions never gain a pill.
    static func refreshMentionAttachments(_ storage: NSMutableAttributedString, theme: RichTextTheme) {
        guard storage.length > 0 else { return }
        let full = NSRange(location: 0, length: storage.length)
        storage.enumerateAttribute(SigxAttr.mention, in: full, options: []) { value, range, _ in
            guard let attrs = value as? [String: String],
                  chipUsable(attrs),
                  range.length == 1,
                  (storage.string as NSString).character(at: range.location) == 0xFFFC else { return }
            storage.addAttribute(
                .attachment,
                value: MentionAttachment(attrs: attrs, theme: theme),
                range: range
            )
        }
    }

    // MARK: - Storage → JSON (readback)

    /// Read the model back out of the live storage. Native is authoritative
    /// for live text — this runs after every edit to build event payloads.
    static func encode(_ storage: NSAttributedString, version: Int) -> String {
        let text = storage.string
        var spans: [[String: Any]] = []
        var blocks: [[String: Any]] = []
        let full = NSRange(location: 0, length: storage.length)

        if storage.length > 0 {
            for (key, name) in SigxAttr.inlineKeys {
                storage.enumerateAttribute(key, in: full, options: []) { value, range, _ in
                    guard value != nil else { return }
                    spans.append(["start": range.location, "end": range.location + range.length, "type": name])
                }
            }
            storage.enumerateAttribute(SigxAttr.link, in: full, options: []) { value, range, _ in
                guard let href = value as? String else { return }
                spans.append([
                    "start": range.location, "end": range.location + range.length,
                    "type": "link", "attrs": ["href": href],
                ])
            }
            storage.enumerateAttribute(SigxAttr.mention, in: full, options: []) { value, range, _ in
                guard let attrs = value as? [String: String] else { return }
                spans.append([
                    "start": range.location, "end": range.location + range.length,
                    "type": "mention", "attrs": attrs,
                ])
            }

            // Blocks: walk paragraphs, take the block attr at each paragraph start.
            let ns = text as NSString
            var location = 0
            while location < ns.length {
                let para = ns.paragraphRange(for: NSRange(location: location, length: 0))
                if let block = storage.attribute(SigxAttr.block, at: para.location, effectiveRange: nil) as? [String: Any],
                   let type = block["type"] as? String {
                    var entry: [String: Any] = [
                        "start": para.location,
                        "end": para.location + para.length,
                        "type": type,
                    ]
                    if let level = block["level"] as? Int { entry["level"] = level }
                    if let checked = block["checked"] as? Bool { entry["checked"] = checked }
                    blocks.append(entry)
                }
                if para.length == 0 { break }
                location = para.location + para.length
            }
        }

        spans.sort {
            let a0 = $0["start"] as? Int ?? 0, b0 = $1["start"] as? Int ?? 0
            if a0 != b0 { return a0 < b0 }
            let a1 = $0["end"] as? Int ?? 0, b1 = $1["end"] as? Int ?? 0
            if a1 != b1 { return a1 < b1 }
            return ($0["type"] as? String ?? "") < ($1["type"] as? String ?? "")
        }

        let doc: [String: Any] = ["text": text, "spans": spans, "blocks": blocks, "v": version]
        guard let data = try? JSONSerialization.data(withJSONObject: doc),
              let json = String(data: data, encoding: .utf8) else {
            return "{\"text\":\"\",\"spans\":[],\"blocks\":[],\"v\":\(version)}"
        }
        return json
    }
}
