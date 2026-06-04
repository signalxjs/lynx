import Foundation
import UIKit

/// `UITextView` subclass backing `<sigx-richtext>`.
///
/// Adds the pieces UITextView is missing for an input-style editor:
///  - a drawn placeholder (UITextView has none natively),
///  - intrinsic content-height reporting for auto-grow,
///  - hooks reserved for chip-aware deletion (P3).
final class RichTextView: UITextView {

    var placeholderText: String = "" {
        didSet { setNeedsDisplay() }
    }
    var placeholderColor: UIColor = .placeholderText {
        didSet { setNeedsDisplay() }
    }

    override var text: String! {
        didSet { setNeedsDisplay() }
    }

    override var attributedText: NSAttributedString! {
        didSet { setNeedsDisplay() }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        // Redraw on every edit so the placeholder hides/shows immediately.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textDidChangeNotification),
            name: UITextView.textDidChangeNotification,
            object: self
        )
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func textDidChangeNotification() {
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        guard text.isEmpty, !placeholderText.isEmpty else { return }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font ?? UIFont.systemFont(ofSize: 16),
            .foregroundColor: placeholderColor,
        ]
        let inset = CGPoint(
            x: textContainerInset.left + textContainer.lineFragmentPadding,
            y: textContainerInset.top
        )
        (placeholderText as NSString).draw(at: inset, withAttributes: attrs)
    }

    /// Intrinsic content height for the current width (auto-grow reporting).
    func contentHeight() -> CGFloat {
        let width = bounds.width > 0 ? bounds.width : UIScreen.main.bounds.width
        let size = sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return size.height.rounded(.up)
    }

    /// Visible line count derived from layout.
    func lineCount() -> Int {
        guard let font = font, font.lineHeight > 0 else { return 1 }
        let textHeight = contentHeight() - textContainerInset.top - textContainerInset.bottom
        return max(1, Int((textHeight / font.lineHeight).rounded()))
    }
}
