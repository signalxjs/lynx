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
///  - hooks reserved for chip-aware deletion (P3).
public final class RichTextView: UITextView, UIGestureRecognizerDelegate {

    private let placeholderLabel = UILabel()

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

    @objc private func textDidChangeNotification() {
        refreshPlaceholder()
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
