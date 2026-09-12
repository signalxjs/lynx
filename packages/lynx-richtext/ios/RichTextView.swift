import Foundation
import UIKit

/// `UITextView` subclass backing `<sigx-richtext>`.
///
/// Adds the pieces UITextView is missing for an input-style editor:
///  - a placeholder (label subview — custom `draw(_:)` is avoided on purpose:
///    it forces the TextKit-1 compatibility path on iOS 16+ and interferes
///    with the editing machinery),
///  - a tap-to-focus fallback recognizer (`cancelsTouchesInView = false`,
///    recognizes simultaneously) so focus works even when an ancestor
///    gesture system swallows the raw touch,
///  - intrinsic content-height reporting for auto-grow,
///  - chip-aware backspace (`deleteBackward` selects the whole mention chip
///    before deleting — defensive: a 1-char attachment deletes atomically by
///    default, this guarantees it stays that way),
///  - `boundary-keys` mode (block editors): the keys that cross the block's
///    edge are reported through `onBoundaryKey` instead of acted on —
///    Backspace at 0 (`deleteBackward`), the hardware keys via `pressesBegan`
///    (forward delete at the end, arrows off the first/last line or at the
///    edges, Tab, Escape, Return). The soft keyboard's Return is caught by
///    the delegate (`shouldChangeTextIn` with "\n"). Same table as the web
///    element's `boundaryKeyFor` and Android's `RichEditText` — keep in step.
public final class RichTextView: UITextView, UIGestureRecognizerDelegate {

    private let placeholderLabel = UILabel()

    /// Single-block mode: see the class doc. Set from the `boundary-keys` prop.
    public var boundaryKeys = false
    /// Fired in `boundaryKeys` mode with the key name and the selection at the time.
    var onBoundaryKey: ((String, NSRange) -> Void)?

    /// Tap landed on a task line's checkbox gutter — the line's paragraph
    /// range (the checkbox itself is draw-only; see `SigxLayoutManager`).
    var onCheckboxToggle: ((NSRange) -> Void)?

    public var placeholderText: String = "" {
        didSet {
            placeholderLabel.text = placeholderText
            refreshPlaceholder()
        }
    }
    public var placeholderColor: UIColor = .placeholderText {
        didSet { placeholderLabel.textColor = placeholderColor }
    }

    public override var text: String! {
        didSet { refreshPlaceholder() }
    }

    public override var attributedText: NSAttributedString! {
        didSet { refreshPlaceholder() }
    }

    public override var font: UIFont? {
        didSet { placeholderLabel.font = font }
    }

    public override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)

        isEditable = true
        isSelectable = true
        isUserInteractionEnabled = true

        placeholderLabel.textColor = placeholderColor
        placeholderLabel.numberOfLines = 1
        placeholderLabel.isUserInteractionEnabled = false
        addSubview(placeholderLabel)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textDidChangeNotification),
            name: UITextView.textDidChangeNotification,
            object: self
        )

        // Focus fallback: Lynx's root gesture handling can swallow raw
        // touches before UITextView's internal tap recognizers run. This
        // recognizer runs alongside everything (`cancelsTouchesInView=false`,
        // simultaneous with all) and only acts when the view isn't already
        // first responder.
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleFocusTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        addGestureRecognizer(tap)

        // Checkbox taps: runs alongside everything like the focus tap (the
        // caret may also move to the tapped line — harmless); the action
        // itself gates on the tap hitting a task line's gutter.
        let checkboxTap = UITapGestureRecognizer(target: self, action: #selector(handleCheckboxTap(_:)))
        checkboxTap.cancelsTouchesInView = false
        checkboxTap.delegate = self
        addGestureRecognizer(checkboxTap)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        return true
    }

    @objc private func handleFocusTap(_ recognizer: UITapGestureRecognizer) {
        guard isEditable, !isFirstResponder else { return }
        if becomeFirstResponder() {
            // Place the caret at the tap location.
            let point = recognizer.location(in: self)
            if let position = closestPosition(to: point) {
                selectedTextRange = textRange(from: position, to: position)
            }
        } else {
            NSLog("[SigxRichText] becomeFirstResponder refused (editable=\(isEditable), window=\(window != nil))")
        }
    }

    @objc private func handleCheckboxTap(_ recognizer: UITapGestureRecognizer) {
        guard let paragraph = taskParagraph(at: recognizer.location(in: self)) else { return }
        onCheckboxToggle?(paragraph)
    }

    /// Paragraph range of the task line whose checkbox gutter contains the
    /// point, or nil. Gated tightly — a task-typed line, its **first** visual
    /// line, and an x inside the reserved gutter — so normal text editing is
    /// never affected.
    private func taskParagraph(at point: CGPoint) -> NSRange? {
        guard let storage = attributedText, storage.length > 0 else { return nil }
        // `point` comes from `location(in: self)` — a scroll view's own
        // coordinate space is its *content* space (bounds.origin ==
        // contentOffset), so scrolling is already accounted for; only the
        // container inset needs subtracting (same convention the focus tap's
        // `closestPosition(to:)` relies on).
        let inContainer = CGPoint(
            x: point.x - textContainerInset.left,
            y: point.y - textContainerInset.top
        )
        guard inContainer.x >= 0, inContainer.x <= BlockMetrics.listGutter else { return nil }
        let glyphIndex = layoutManager.glyphIndex(for: inContainer, in: textContainer)
        let frag = layoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: nil)
        guard inContainer.y >= frag.minY, inContainer.y <= frag.maxY else { return nil }
        let charIndex = layoutManager.characterIndexForGlyph(at: glyphIndex)
        guard charIndex < storage.length else { return nil }
        let para = (storage.string as NSString).paragraphRange(for: NSRange(location: charIndex, length: 0))
        guard para.length > 0,
              let block = storage.attribute(SigxAttr.block, at: para.location, effectiveRange: nil) as? [String: Any],
              (block["type"] as? String) == "task" else { return nil }
        // Markers (and their tap target) live on the paragraph's first line.
        let firstGlyph = layoutManager.glyphRange(forCharacterRange: para, actualCharacterRange: nil).location
        let firstFrag = layoutManager.lineFragmentRect(forGlyphAt: firstGlyph, effectiveRange: nil)
        guard abs(firstFrag.minY - frag.minY) < 0.5 else { return nil }
        return para
    }

    @objc private func textDidChangeNotification() {
        refreshPlaceholder()
    }

    /// Backspace immediately after a mention chip removes the whole chip.
    /// Expanding the selection (instead of editing the storage directly)
    /// keeps the edit on the normal user pipeline — delegate callbacks,
    /// undo, and the change event all fire as for any keystroke.
    public override func deleteBackward() {
        let range = selectedRange
        if boundaryKeys, range.length == 0, range.location == 0, markedTextRange == nil {
            onBoundaryKey?("Backspace", range)
            return
        }
        // Gate on the chip invariant (the char IS the U+FFFC), not just the
        // mention attr — a non-conforming mention span covers regular text,
        // where forcing a 1-unit deletion could split a surrogate pair.
        if range.length == 0, range.location > 0,
           let storage = attributedText, storage.length >= range.location,
           (storage.string as NSString).character(at: range.location - 1) == 0xFFFC,
           storage.attribute(SigxAttr.mention, at: range.location - 1, effectiveRange: nil) != nil {
            selectedRange = NSRange(location: range.location - 1, length: 1)
        }
        super.deleteBackward()
    }

    /// Hardware-keyboard boundary keys (iOS 13.4+). Consumed presses never
    /// reach UIKit's default handling.
    public override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        guard boundaryKeys, markedTextRange == nil, #available(iOS 13.4, *) else {
            super.pressesBegan(presses, with: event)
            return
        }
        var consumed = Set<UIPress>()
        for press in presses {
            guard let key = press.key, let name = boundaryKeyName(for: key) else { continue }
            onBoundaryKey?(name, selectedRange)
            consumed.insert(press)
        }
        let rest = presses.subtracting(consumed)
        if !rest.isEmpty { super.pressesBegan(rest, with: event) }
    }

    public override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        // Presses consumed in `pressesBegan` must not end in UIKit either.
        if boundaryKeys, #available(iOS 13.4, *) {
            let rest = presses.filter { press in
                guard let key = press.key else { return true }
                return boundaryKeyName(for: key) == nil
            }
            if !rest.isEmpty { super.pressesEnded(rest, with: event) }
            return
        }
        super.pressesEnded(presses, with: event)
    }

    /// The boundary key a hardware press maps to, or nil when the view keeps it.
    @available(iOS 13.4, *)
    private func boundaryKeyName(for key: UIKey) -> String? {
        let flags = key.modifierFlags
        let mod = flags.contains(.command) || flags.contains(.control) || flags.contains(.alternate)
        let shift = flags.contains(.shift)
        let range = selectedRange
        let collapsed = range.length == 0
        let length = attributedText?.length ?? 0
        switch key.keyCode {
        case .keyboardReturnOrEnter, .keypadEnter:
            return mod ? nil : (shift ? "Shift-Enter" : "Enter")
        case .keyboardDeleteOrBackspace:
            // `deleteBackward` handles it (and the soft keyboard with it).
            return nil
        case .keyboardDeleteForward:
            return collapsed && range.location == length && !mod ? "Delete" : nil
        case .keyboardUpArrow:
            return !mod && !shift && caretOnEdgeLine(first: true) ? "ArrowUp" : nil
        case .keyboardDownArrow:
            return !mod && !shift && caretOnEdgeLine(first: false) ? "ArrowDown" : nil
        case .keyboardLeftArrow:
            return collapsed && range.location == 0 && !mod && !shift ? "ArrowLeft" : nil
        case .keyboardRightArrow:
            return collapsed && range.location == length && !mod && !shift ? "ArrowRight" : nil
        case .keyboardTab:
            return mod ? nil : (shift ? "Shift-Tab" : "Tab")
        case .keyboardEscape:
            return "Escape"
        default:
            return nil
        }
    }

    /// Whether the caret's line fragment is the first / last one (true for an empty view).
    private func caretOnEdgeLine(first: Bool) -> Bool {
        let length = attributedText?.length ?? 0
        guard length > 0 else { return true }
        let location = selectedRange.location + selectedRange.length
        let charIndex = min(max(location, 0), length - 1)
        layoutManager.ensureLayout(for: textContainer)
        let glyph = layoutManager.glyphIndexForCharacter(at: charIndex)
        let line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
        let used = layoutManager.usedRect(for: textContainer)
        return first ? line.minY <= used.minY + 0.5 : line.maxY >= used.maxY - 0.5
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        let x = textContainerInset.left + textContainer.lineFragmentPadding
        let y = textContainerInset.top
        let width = max(0, bounds.width - x * 2)
        placeholderLabel.frame = CGRect(
            x: x,
            y: y,
            width: width,
            height: placeholderLabel.font?.lineHeight ?? 20
        )
    }

    private func refreshPlaceholder() {
        placeholderLabel.isHidden = !(text?.isEmpty ?? true) || placeholderText.isEmpty
    }

    /// Intrinsic content height for the current width (auto-grow reporting).
    public func contentHeight() -> CGFloat {
        let width = bounds.width > 0 ? bounds.width : UIScreen.main.bounds.width
        let size = sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return size.height.rounded(.up)
    }

    /// Visible line count derived from layout.
    public func lineCount() -> Int {
        guard let font = font, font.lineHeight > 0 else { return 1 }
        let textHeight = contentHeight() - textContainerInset.top - textContainerInset.bottom
        return max(1, Int((textHeight / font.lineHeight).rounded()))
    }
}
