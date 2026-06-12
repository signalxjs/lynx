import Foundation
import UIKit
import Lynx

/// Native UI for the `<sigx-richtext>` JSX element — an attributed-text input.
///
/// Registered via the autolinker (`signalx-module.json` → `ios.uiComponents`).
///
/// Prop surface (v1): `value` (initial-only JSON RichDoc), `placeholder`,
/// `editable`, `min-height`, `max-height`, `font-size`, `text-color`,
/// `accent-color`, `placeholder-color`, `confirm-type`, `auto-focus`.
///
/// Events: `bindchange` (full RichDoc readback + isComposing),
/// `bindselection` (range + active formats + caret rect),
/// `bindheightchange`, `bindfocus`, `bindblur`.
///
/// UI methods: `setDocument`, `getDocument`, `toggleFormat`, `setBlockType`,
/// `insertText`, `insertChip`, `setSelectionRange`, `focus`, `blur`.
///
/// ### IME / echo contract (mirrors lynx-runtime's input `setValue` rules)
/// 1. Every user edit bumps `localVersion`; `bindchange` carries it inside the doc.
/// 2. `setDocument` with a structurally-identical doc is a silent no-op.
/// 3. `setDocument` with `v < localVersion` is dropped; current state is re-emitted.
/// 4. `setDocument` during an active IME composition is dropped (re-emit) —
///    replacing the storage mid-composition corrupts CJK/emoji input.
// Not `@objc` at class level — LynxUI is an ObjC lightweight generic (see
// SigxWebViewUI for the long-form rationale); member-level @objc still bridges.
public class SigxRichTextUI: LynxUI<RichTextView> {

    private static let kUIMethodSuccess: Int32 = 0
    private static let kUIMethodUnknown: Int32 = 1

    private var theme = RichTextTheme()
    private var localVersion = 0
    private var userHasEdited = false
    private var minHeight: CGFloat = 0
    private var maxHeight: CGFloat = 0
    private var lastReportedHeight: CGFloat = -1
    /// Guards delegate re-entry while this class mutates the storage itself.
    fileprivate var isProgrammaticEdit = false
    /// Last non-collapsed selection — toolbar taps can collapse the live
    /// selection before the command invoke arrives; format commands fall
    /// back to this (cleared whenever the text mutates).
    fileprivate var lastNonCollapsedSelection: NSRange? = nil

    private lazy var textDelegate = SigxRichTextDelegate(owner: self)

    // MARK: - LynxUI overrides

    public override func createView() -> RichTextView? {
        // Explicit TextKit-1 stack so the custom layout manager (draw-only
        // block decorations — list markers, quote bar, code background) is
        // installed from birth; swapping a layout manager in later is
        // unsupported.
        let storage = NSTextStorage()
        let layoutManager = SigxLayoutManager()
        layoutManager.theme = theme
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        // Zero out the default 5pt fragment padding so the gutter geometry
        // (BlockMetrics indents, marker drawing, checkbox hit-testing) all
        // share one coordinate system anchored at the container edge.
        container.lineFragmentPadding = 0
        layoutManager.addTextContainer(container)

        let view = RichTextView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), textContainer: container)
        view.delegate = textDelegate
        view.backgroundColor = .clear
        view.isScrollEnabled = true
        view.alwaysBounceVertical = false
        view.font = theme.baseFont
        view.textColor = theme.textColor
        view.tintColor = theme.accentColor
        // Tight insets — the JS side owns outer padding via styles.
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.onCheckboxToggle = { [weak self] paragraph in self?.toggleTask(at: paragraph) }
        return view
    }

    // MARK: - Prop registration

    @objc public class func propSetterLookUp() -> NSArray {
        return [
            ["value", "setValue:requestReset:"],
            ["placeholder", "setPlaceholder:requestReset:"],
            ["editable", "setEditable:requestReset:"],
            ["min-height", "setMinHeight:requestReset:"],
            ["max-height", "setMaxHeight:requestReset:"],
            ["font-size", "setFontSize:requestReset:"],
            ["text-color", "setTextColor:requestReset:"],
            ["accent-color", "setAccentColor:requestReset:"],
            ["placeholder-color", "setPlaceholderColor:requestReset:"],
            ["confirm-type", "setConfirmType:requestReset:"],
            ["auto-focus", "setAutoFocus:requestReset:"],
        ] as NSArray
    }

    // MARK: - Prop setters

    /// Initial document. Initial-only once the user has edited — programmatic
    /// replacements go through the `setDocument` UI method (same contract as
    /// the stock input's `value` + `setValue`).
    @objc public func setValue(_ value: NSString?, requestReset: Bool) {
        guard !userHasEdited, let json = asString(value), !json.isEmpty else { return }
        guard let (parsed, version) = DocumentMapper.parse(json: json, theme: theme) else { return }
        isProgrammaticEdit = true
        view().attributedText = parsed
        isProgrammaticEdit = false
        localVersion = version
        reportHeightIfChanged()
    }

    @objc public func setPlaceholder(_ value: NSString?, requestReset: Bool) {
        view().placeholderText = asString(value) ?? ""
    }

    // Primitive props arrive as NSNumber: LynxPropsProcessor's propSetterLookUp
    // path derives the arg type from ObjC argument 0 (= self, type "@"), so the
    // value is always delivered as an object — a primitive Bool/CGFloat param
    // slot would be filled with pointer bits (observed: editable=true -> 0).
    //
    // A JSON `null` prop (e.g. `auto-focus={null}`) is delivered as `NSNull`,
    // NOT Swift `nil` — `NSNull` is a non-nil object, so `value?.boolValue`
    // does NOT short-circuit and instead sends `boolValue`/`doubleValue` to
    // `NSNull`, which throws `unrecognized selector` (signalxjs/lynx#379).
    // `asNumber` returns the value only when it is a real `NSNumber`.
    private func asNumber(_ value: NSNumber?) -> NSNumber? {
        guard let v = value, v.isKind(of: NSNumber.self) else { return nil }
        return v
    }

    /// String sibling of `asNumber`. A JSON `null` (or any unset optional
    /// string prop — JS `undefined` ops serialize to `null`) arrives as
    /// `NSNull`, not Swift `nil`. `value as String?` would bridge it and send
    /// `-length` to `NSNull` → `unrecognized selector` (same class of bug as
    /// the numeric path, signalxjs/lynx#379). The `isKind` check returns the
    /// value only when it is a real `NSString`.
    private func asString(_ value: NSString?) -> String? {
        guard let v = value, v.isKind(of: NSString.self) else { return nil }
        return v as String
    }

    @objc public func setEditable(_ value: NSNumber?, requestReset: Bool) {
        let editable = asNumber(value)?.boolValue ?? true
        view().isEditable = editable
        view().isSelectable = true
    }

    @objc public func setMinHeight(_ value: NSNumber?, requestReset: Bool) {
        minHeight = CGFloat(asNumber(value)?.doubleValue ?? 0)
        reportHeightIfChanged()
    }

    @objc public func setMaxHeight(_ value: NSNumber?, requestReset: Bool) {
        maxHeight = CGFloat(asNumber(value)?.doubleValue ?? 0)
        reportHeightIfChanged()
    }

    @objc public func setFontSize(_ value: NSNumber?, requestReset: Bool) {
        let size = CGFloat(asNumber(value)?.doubleValue ?? 0)
        guard size > 0 else { return }
        theme.fontSize = size
        view().font = theme.baseFont
        refreshAllVisuals()
    }

    @objc public func setTextColor(_ value: NSString?, requestReset: Bool) {
        guard let color = UIColor.sigxColor(hex: asString(value)) else { return }
        theme.textColor = color
        view().textColor = color
        refreshAllVisuals()
    }

    @objc public func setAccentColor(_ value: NSString?, requestReset: Bool) {
        guard let color = UIColor.sigxColor(hex: asString(value)) else { return }
        theme.accentColor = color
        view().tintColor = color
        refreshAllVisuals()
    }

    @objc public func setPlaceholderColor(_ value: NSString?, requestReset: Bool) {
        guard let color = UIColor.sigxColor(hex: asString(value)) else { return }
        theme.placeholderColor = color
        view().placeholderColor = color
    }

    @objc public func setConfirmType(_ value: NSString?, requestReset: Bool) {
        switch asString(value) ?? "" {
        case "send": view().returnKeyType = .send
        case "search": view().returnKeyType = .search
        case "next": view().returnKeyType = .next
        case "go": view().returnKeyType = .go
        case "done": view().returnKeyType = .done
        default: view().returnKeyType = .default
        }
    }

    @objc public func setAutoFocus(_ value: NSNumber?, requestReset: Bool) {
        guard asNumber(value)?.boolValue == true else { return }
        DispatchQueue.main.async { self.view().becomeFirstResponder() }
    }

    // Per-prop __lynx_prop_config__ discovery shims (kept alongside
    // propSetterLookUp for parity with SigxWebViewUI).
    @objc(__lynx_prop_config__value)
    public class func __lynxPropConfigValue() -> [String] { ["value", "setValue", "NSString *"] }
    @objc(__lynx_prop_config__placeholder)
    public class func __lynxPropConfigPlaceholder() -> [String] { ["placeholder", "setPlaceholder", "NSString *"] }
    @objc(__lynx_prop_config__editable)
    public class func __lynxPropConfigEditable() -> [String] { ["editable", "setEditable", "NSNumber *"] }
    @objc(__lynx_prop_config__min_height)
    public class func __lynxPropConfigMinHeight() -> [String] { ["min-height", "setMinHeight", "NSNumber *"] }
    @objc(__lynx_prop_config__max_height)
    public class func __lynxPropConfigMaxHeight() -> [String] { ["max-height", "setMaxHeight", "NSNumber *"] }
    @objc(__lynx_prop_config__font_size)
    public class func __lynxPropConfigFontSize() -> [String] { ["font-size", "setFontSize", "NSNumber *"] }
    @objc(__lynx_prop_config__text_color)
    public class func __lynxPropConfigTextColor() -> [String] { ["text-color", "setTextColor", "NSString *"] }
    @objc(__lynx_prop_config__accent_color)
    public class func __lynxPropConfigAccentColor() -> [String] { ["accent-color", "setAccentColor", "NSString *"] }
    @objc(__lynx_prop_config__placeholder_color)
    public class func __lynxPropConfigPlaceholderColor() -> [String] { ["placeholder-color", "setPlaceholderColor", "NSString *"] }
    @objc(__lynx_prop_config__confirm_type)
    public class func __lynxPropConfigConfirmType() -> [String] { ["confirm-type", "setConfirmType", "NSString *"] }
    @objc(__lynx_prop_config__auto_focus)
    public class func __lynxPropConfigAutoFocus() -> [String] { ["auto-focus", "setAutoFocus", "NSNumber *"] }

    // MARK: - UI methods

    @objc public func setDocument(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let json = (params?["doc"] as? String) ?? ""
        DispatchQueue.main.async {
            let view = self.view()
            // Rule 4: never replace the storage mid-composition.
            if view.markedTextRange != nil {
                self.fireChange(isComposing: true)
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "composing"])
                return
            }
            guard let (parsed, version) = DocumentMapper.parse(json: json, theme: self.theme) else {
                callback(SigxRichTextUI.kUIMethodUnknown, "setDocument: unparseable doc")
                return
            }
            // Rule 3: drop stale writes, re-emit so JS reconciles.
            if version < self.localVersion {
                self.fireChange(isComposing: false)
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "stale"])
                return
            }
            // Rule 2: structural no-op suppression.
            if parsed.isEqual(view.attributedText) {
                self.localVersion = max(self.localVersion, version)
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "equal"])
                return
            }
            let caret = view.selectedRange
            self.isProgrammaticEdit = true
            view.attributedText = parsed
            self.isProgrammaticEdit = false
            // The document has diverged from the initial `value` prop — lock
            // the prop out (initial-only contract), same as a user edit.
            self.userHasEdited = true
            self.localVersion = max(self.localVersion, version)
            // Preserve the caret position, clamped to the new length.
            let upper = (parsed.string as NSString).length
            view.selectedRange = NSRange(location: min(caret.location, upper), length: 0)
            self.reportHeightIfChanged()
            self.fireChange(isComposing: false)
            callback(SigxRichTextUI.kUIMethodSuccess, ["applied": true])
        }
    }
    @objc(__lynx_ui_method_config__setDocument)
    dynamic public class func __lynxUIMethodConfigSetDocument() -> NSString { return "setDocument" }

    @objc public func getDocument(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            let json = DocumentMapper.encode(self.view().attributedText ?? NSAttributedString(), version: self.localVersion)
            callback(SigxRichTextUI.kUIMethodSuccess, ["doc": json])
        }
    }
    @objc(__lynx_ui_method_config__getDocument)
    dynamic public class func __lynxUIMethodConfigGetDocument() -> NSString { return "getDocument" }

    @objc public func toggleFormat(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let type = (params?["type"] as? String) ?? ""
        guard let key = SigxRichTextUI.inlineKey(for: type) else {
            callback(SigxRichTextUI.kUIMethodUnknown, "toggleFormat: unknown type \(type)")
            return
        }
        DispatchQueue.main.async {
            let view = self.view()
            var selection = view.selectedRange
            // Toolbar taps can collapse the selection (focus shifts) before this
            // invoke arrives — fall back to the last real selection.
            if selection.length == 0, let last = self.lastNonCollapsedSelection,
               last.location + last.length <= (view.text as NSString).length {
                selection = last
            }
            if selection.length == 0 {
                // Collapsed: flip the typing attributes so the next typed run
                // carries (or drops) the format.
                var typing = view.typingAttributes
                let active = typing[key] != nil
                if active {
                    typing.removeValue(forKey: key)
                } else {
                    // `code` is terminal (mirrors the markdown serializer):
                    // turning it on clears the marks it excludes, and the
                    // excluded marks can't turn on inside it.
                    if key == SigxAttr.code {
                        typing.removeValue(forKey: SigxAttr.bold)
                        typing.removeValue(forKey: SigxAttr.italic)
                        typing.removeValue(forKey: SigxAttr.strike)
                    } else if typing[SigxAttr.code] != nil, key != SigxAttr.link {
                        self.fireSelection()
                        callback(SigxRichTextUI.kUIMethodSuccess, ["active": false])
                        return
                    }
                    typing[key] = true
                }
                typing[.font] = SigxRichTextUI.deriveTypingFont(from: typing, theme: self.theme)
                view.typingAttributes = typing
                self.fireSelection()
                callback(SigxRichTextUI.kUIMethodSuccess, ["active": !active])
                return
            }
            guard let storage = view.textStorage as NSTextStorage? else {
                callback(SigxRichTextUI.kUIMethodUnknown, "toggleFormat: no storage")
                return
            }
            let active = SigxRichTextUI.rangeFullyHasAttribute(storage, key: key, range: selection)
            // `code` is terminal (mirrors the markdown serializer): the marks
            // it excludes can't turn on across an all-code selection.
            if !active, key != SigxAttr.code, key != SigxAttr.link,
               SigxRichTextUI.rangeFullyHasAttribute(storage, key: SigxAttr.code, range: selection) {
                self.fireSelection()
                callback(SigxRichTextUI.kUIMethodSuccess, ["active": false])
                return
            }
            self.isProgrammaticEdit = true
            storage.beginEditing()
            if active {
                storage.removeAttribute(key, range: selection)
            } else {
                if key == SigxAttr.code {
                    // Turning code on strips the marks it excludes.
                    storage.removeAttribute(SigxAttr.bold, range: selection)
                    storage.removeAttribute(SigxAttr.italic, range: selection)
                    storage.removeAttribute(SigxAttr.strike, range: selection)
                }
                storage.addAttribute(key, value: true, range: selection)
            }
            DocumentMapper.refreshVisuals(storage, range: selection, theme: self.theme)
            storage.endEditing()
            self.isProgrammaticEdit = false
            self.userHasEdited = true
            self.localVersion += 1
            // Restore the (possibly fallen-back) selection and keep the field
            // focused so consecutive toolbar taps compose naturally.
            view.selectedRange = selection
            if !view.isFirstResponder { view.becomeFirstResponder() }
            self.fireChange(isComposing: false)
            self.fireSelection()
            callback(SigxRichTextUI.kUIMethodSuccess, ["active": !active])
        }
    }
    @objc(__lynx_ui_method_config__toggleFormat)
    dynamic public class func __lynxUIMethodConfigToggleFormat() -> NSString { return "toggleFormat" }

    @objc public func setBlockType(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let type = (params?["type"] as? String) ?? "paragraph"
        let level = params?["level"] as? Int
        let checked = params?["checked"] as? Bool
        DispatchQueue.main.async {
            let view = self.view()
            guard let storage = view.textStorage as NSTextStorage? else {
                callback(SigxRichTextUI.kUIMethodUnknown, "setBlockType: no storage")
                return
            }
            let ns = storage.string as NSString
            let paragraph = ns.paragraphRange(for: view.selectedRange)
            // An empty paragraph can't hold a storage attribute — carry the
            // block in the typing attributes so the next typed run gets it
            // (e.g. tapping a list toolbar button in an empty editor).
            if paragraph.length == 0 {
                var typing = view.typingAttributes
                if type == "paragraph" {
                    typing.removeValue(forKey: SigxAttr.block)
                } else {
                    var value: [String: Any] = ["type": type]
                    if let level { value["level"] = level }
                    if type == "task" { value["checked"] = checked ?? false }
                    typing[SigxAttr.block] = value
                }
                typing[.font] = SigxRichTextUI.deriveTypingFont(from: typing, theme: self.theme)
                typing[.paragraphStyle] = SigxRichTextUI.deriveTypingParagraphStyle(from: typing)
                view.typingAttributes = typing
                self.fireSelection()
                callback(SigxRichTextUI.kUIMethodSuccess, nil)
                return
            }
            self.isProgrammaticEdit = true
            storage.beginEditing()
            if type == "paragraph" {
                storage.removeAttribute(SigxAttr.block, range: paragraph)
            } else {
                var value: [String: Any] = ["type": type]
                if let level { value["level"] = level }
                if type == "task" { value["checked"] = checked ?? false }
                storage.addAttribute(SigxAttr.block, value: value, range: paragraph)
            }
            DocumentMapper.refreshVisuals(storage, range: paragraph, theme: self.theme)
            storage.endEditing()
            self.isProgrammaticEdit = false
            self.userHasEdited = true
            self.localVersion += 1
            self.reportHeightIfChanged()
            self.fireChange(isComposing: false)
            self.fireSelection()
            callback(SigxRichTextUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__setBlockType)
    dynamic public class func __lynxUIMethodConfigSetBlockType() -> NSString { return "setBlockType" }

    /// Apply an inline format with a payload over an **explicit** range —
    /// unlike `toggleFormat`, which flips over the live selection and carries
    /// no attrs. v1 supports `link`: a non-empty `attrs.href` (re)links the
    /// range, an empty/missing href unlinks it.
    @objc public func applyFormat(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let type = (params?["type"] as? String) ?? ""
        guard type == "link" else {
            callback(SigxRichTextUI.kUIMethodUnknown, "applyFormat: unsupported type \(type)")
            return
        }
        let reqStart = (params?["start"] as? Int) ?? -1
        let reqEnd = (params?["end"] as? Int) ?? -1
        let href = ((params?["attrs"] as? NSDictionary)?["href"] as? String) ?? ""
        DispatchQueue.main.async {
            let view = self.view()
            guard let storage = view.textStorage as NSTextStorage? else {
                callback(SigxRichTextUI.kUIMethodUnknown, "applyFormat: no storage")
                return
            }
            let upper = storage.length
            let s = max(0, min(reqStart, upper))
            let e = max(s, min(reqEnd, upper))
            guard e > s else {
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "emptyRange"])
                return
            }
            let range = NSRange(location: s, length: e - s)
            // Code blocks are literal — the serializer drops inline spans
            // inside them, so a link there could never round-trip.
            if !href.isEmpty {
                var intersectsCode = false
                storage.enumerateAttribute(SigxAttr.block, in: range, options: []) { value, _, stop in
                    if let block = value as? [String: Any], (block["type"] as? String) == "codeBlock" {
                        intersectsCode = true
                        stop.pointee = true
                    }
                }
                if intersectsCode {
                    callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "codeBlock"])
                    return
                }
            }
            self.isProgrammaticEdit = true
            storage.beginEditing()
            if href.isEmpty {
                storage.removeAttribute(SigxAttr.link, range: range)
            } else {
                storage.addAttribute(SigxAttr.link, value: href, range: range)
            }
            DocumentMapper.refreshVisuals(storage, range: range, theme: self.theme)
            storage.endEditing()
            self.isProgrammaticEdit = false
            self.userHasEdited = true
            self.localVersion += 1
            self.reportHeightIfChanged()
            self.fireChange(isComposing: false)
            self.fireSelection()
            callback(SigxRichTextUI.kUIMethodSuccess, ["applied": true])
        }
    }
    @objc(__lynx_ui_method_config__applyFormat)
    dynamic public class func __lynxUIMethodConfigApplyFormat() -> NSString { return "applyFormat" }

    @objc public func insertText(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let text = (params?["text"] as? String) ?? ""
        guard !text.isEmpty else {
            callback(SigxRichTextUI.kUIMethodSuccess, nil)
            return
        }
        DispatchQueue.main.async {
            let view = self.view()
            if view.markedTextRange != nil {
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "composing"])
                return
            }
            self.isProgrammaticEdit = true
            view.insertText(text) // inherits typingAttributes
            self.isProgrammaticEdit = false
            self.userHasEdited = true
            self.localVersion += 1
            self.reportHeightIfChanged()
            self.fireChange(isComposing: false)
            callback(SigxRichTextUI.kUIMethodSuccess, ["applied": true])
        }
    }
    @objc(__lynx_ui_method_config__insertText)
    dynamic public class func __lynxUIMethodConfigInsertText() -> NSString { return "insertText" }

    /// Insert an atomic mention chip: one U+FFFC carrying `sigx.mention` +
    /// a `MentionAttachment` pill. `replaceFrom`/`replaceTo` first remove
    /// the trigger query run. The chip is built with fresh attributes — it
    /// never inherits typing attributes, and typing attributes are reset
    /// afterwards so the chip attrs can't bleed into the next typed char.
    @objc public func insertChip(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let id = (params?["id"] as? String) ?? ""
        let label = (params?["label"] as? String) ?? ""
        let kind = params?["kind"] as? String
        let replaceFrom = params?["replaceFrom"] as? Int
        let replaceTo = params?["replaceTo"] as? Int
        // The mention contract requires a usable payload — an id-less or
        // label-less chip can't be resolved or rendered.
        guard !id.isEmpty, !label.isEmpty else {
            callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "invalid"])
            return
        }
        DispatchQueue.main.async {
            let view = self.view()
            if view.markedTextRange != nil {
                callback(SigxRichTextUI.kUIMethodSuccess, ["applied": false, "reason": "composing"])
                return
            }
            guard let storage = view.textStorage as NSTextStorage? else {
                callback(SigxRichTextUI.kUIMethodUnknown, "insertChip: no storage")
                return
            }
            // Captured before the edit so block/format toggles survive the
            // chip insert (only the chip-specific keys are stripped below).
            let priorTyping = view.typingAttributes
            var location: Int
            self.isProgrammaticEdit = true
            storage.beginEditing()
            if let from = replaceFrom, let to = replaceTo {
                let upper = storage.length
                let s = max(0, min(from, upper))
                let e = max(s, min(to, upper))
                if e > s { storage.deleteCharacters(in: NSRange(location: s, length: e - s)) }
                location = s
            } else {
                // No explicit range: replace the live selection, matching
                // insertText and the Android implementation.
                let sel = view.selectedRange
                let upper = storage.length
                let s = max(0, min(sel.location, upper))
                let e = max(s, min(sel.location + sel.length, upper))
                if e > s { storage.deleteCharacters(in: NSRange(location: s, length: e - s)) }
                location = s
            }
            var attrs: [String: String] = ["id": id, "label": label]
            if let kind, !kind.isEmpty { attrs["kind"] = kind }
            let attachment = MentionAttachment(attrs: attrs, theme: self.theme)
            let chip = NSMutableAttributedString(attachment: attachment) // one U+FFFC
            let chipRange = NSRange(location: 0, length: chip.length)
            chip.addAttribute(SigxAttr.mention, value: attrs, range: chipRange)
            chip.addAttribute(.font, value: self.theme.baseFont, range: chipRange)
            storage.insert(chip, at: location)
            storage.endEditing()
            self.userHasEdited = true
            self.localVersion += 1
            self.lastNonCollapsedSelection = nil
            // Caret after the chip. Still under the programmatic guard —
            // otherwise the delegate fires a selection event for the caret
            // move and fireSelection() below would duplicate it.
            view.selectedRange = NSRange(location: location + chip.length, length: 0)
            // Typing hygiene: restore the pre-insert typing attributes with
            // only the chip keys stripped — block/format toggles survive,
            // the chip attrs never bleed into the next typed char.
            var typing = priorTyping
            typing.removeValue(forKey: .attachment)
            typing.removeValue(forKey: SigxAttr.mention)
            view.typingAttributes = typing
            self.isProgrammaticEdit = false
            self.reportHeightIfChanged()
            self.fireChange(isComposing: false)
            self.fireSelection()
            callback(SigxRichTextUI.kUIMethodSuccess, ["applied": true])
        }
    }
    @objc(__lynx_ui_method_config__insertChip)
    dynamic public class func __lynxUIMethodConfigInsertChip() -> NSString { return "insertChip" }

    @objc public func setSelectionRange(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        let start = (params?["start"] as? Int) ?? 0
        let end = (params?["end"] as? Int) ?? start
        DispatchQueue.main.async {
            let view = self.view()
            let upper = (view.text as NSString).length
            let s = max(0, min(start, upper))
            let e = max(s, min(end, upper))
            view.selectedRange = NSRange(location: s, length: e - s)
            callback(SigxRichTextUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__setSelectionRange)
    dynamic public class func __lynxUIMethodConfigSetSelectionRange() -> NSString { return "setSelectionRange" }

    @objc public func focus(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            self.view().becomeFirstResponder()
            callback(SigxRichTextUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__focus)
    dynamic public class func __lynxUIMethodConfigFocus() -> NSString { return "focus" }

    @objc public func blur(_ params: NSDictionary?, withResult callback: @escaping LynxUIMethodCallbackBlock) {
        DispatchQueue.main.async {
            self.view().resignFirstResponder()
            callback(SigxRichTextUI.kUIMethodSuccess, nil)
        }
    }
    @objc(__lynx_ui_method_config__blur)
    dynamic public class func __lynxUIMethodConfigBlur() -> NSString { return "blur" }

    // MARK: - Event firing (shared with the delegate)

    func fireEvent(_ name: String, params: [String: Any]) {
        let event = LynxCustomEvent(name: name, targetSign: sign, params: params)
        context?.eventEmitter?.send(event)
    }

    func fireChange(isComposing: Bool) {
        let json = DocumentMapper.encode(view().attributedText ?? NSAttributedString(), version: localVersion)
        fireEvent("change", params: ["doc": json, "isComposing": isComposing])
    }

    func fireSelection() {
        let view = self.view()
        let range = view.selectedRange
        var formats: [String] = []
        let attrs = SigxRichTextUI.attributesForSelection(view)
        for (key, name) in SigxAttr.inlineKeys where attrs[key] != nil { formats.append(name) }
        if attrs[SigxAttr.link] != nil { formats.append("link") }

        var activeBlock = "paragraph"
        var headingLevel: Int? = nil
        if let block = attrs[SigxAttr.block] as? [String: Any], let type = block["type"] as? String {
            activeBlock = type
            headingLevel = block["level"] as? Int
        }

        var caret = CGRect.zero
        if let position = view.selectedTextRange?.end {
            caret = view.caretRect(for: position)
        }

        var params: [String: Any] = [
            "start": range.location,
            "end": range.location + range.length,
            "activeFormats": formats.joined(separator: ","),
            "activeBlock": activeBlock,
            "caretX": caret.origin.x.isFinite ? caret.origin.x : 0,
            "caretY": caret.origin.y.isFinite ? caret.origin.y : 0,
            "caretHeight": caret.height.isFinite ? caret.height : 0,
        ]
        if let headingLevel { params["headingLevel"] = headingLevel }
        fireEvent("selection", params: params)
    }

    func markUserEdited() {
        userHasEdited = true
        localVersion += 1
    }

    /// Checkbox tap on a task line (from the view's gutter hit-test): flip
    /// `checked`, redraw the marker, fire change.
    func toggleTask(at paragraph: NSRange) {
        guard let storage = view().textStorage as NSTextStorage?,
              paragraph.location < storage.length else { return }
        let ns = storage.string as NSString
        let para = ns.paragraphRange(for: NSRange(location: paragraph.location, length: 0))
        guard para.length > 0,
              var block = storage.attribute(SigxAttr.block, at: para.location, effectiveRange: nil) as? [String: Any],
              (block["type"] as? String) == "task" else { return }
        block["checked"] = !((block["checked"] as? Bool) ?? false)
        isProgrammaticEdit = true
        storage.beginEditing()
        storage.addAttribute(SigxAttr.block, value: block, range: para)
        storage.endEditing()
        isProgrammaticEdit = false
        userHasEdited = true
        localVersion += 1
        view().layoutManager.invalidateDisplay(forCharacterRange: para)
        fireChange(isComposing: false)
    }

    /// Enter pressed (delegate `shouldChangeTextIn` with `"\n"`, not during
    /// IME composition). Returns whether the default insertion proceeds.
    ///
    /// - List types — Enter on an **empty** item exits the list (the marker
    ///   is removed, the newline swallowed); Enter elsewhere is handled
    ///   manually: the newline + tail get a fresh continuation attr (`task`
    ///   continues unchecked, the ordered start never carries over).
    /// - blockquote / codeBlock — continue via normal typing-attribute
    ///   inheritance (exit is via toolbar), so the default insert proceeds.
    func handleNewline(in range: NSRange) -> Bool {
        let view = self.view()
        guard let storage = view.textStorage as NSTextStorage? else { return true }
        let ns = storage.string as NSString
        let para = ns.paragraphRange(for: range)

        // Zero-length trailing paragraph: the (continued) list state lives
        // only in the typing attributes — Enter there is an empty-item exit.
        if para.length == 0 {
            var typing = view.typingAttributes
            guard let block = typing[SigxAttr.block] as? [String: Any],
                  let type = block["type"] as? String, Self.isListType(type) else { return true }
            typing.removeValue(forKey: SigxAttr.block)
            typing[.font] = SigxRichTextUI.deriveTypingFont(from: typing, theme: theme)
            // Drop the list's inherited gutter indent along with the block.
            typing[.paragraphStyle] = SigxRichTextUI.deriveTypingParagraphStyle(from: typing)
            view.typingAttributes = typing
            fireSelection()
            return false
        }

        guard para.location < storage.length,
              let block = storage.attribute(SigxAttr.block, at: para.location, effectiveRange: nil) as? [String: Any],
              let type = block["type"] as? String, Self.isListType(type) else { return true }

        // Item content length (the trailing newline isn't content).
        var contentLen = para.length
        if ns.character(at: NSMaxRange(para) - 1) == 0x0A { contentLen -= 1 }

        if contentLen == 0 {
            // Empty item: drop the marker, swallow the newline.
            isProgrammaticEdit = true
            storage.beginEditing()
            storage.removeAttribute(SigxAttr.block, range: para)
            DocumentMapper.refreshVisuals(storage, range: para, theme: theme)
            storage.endEditing()
            var typing = view.typingAttributes
            typing.removeValue(forKey: SigxAttr.block)
            typing[.font] = SigxRichTextUI.deriveTypingFont(from: typing, theme: theme)
            // Drop the list's inherited gutter indent along with the block.
            typing[.paragraphStyle] = SigxRichTextUI.deriveTypingParagraphStyle(from: typing)
            view.typingAttributes = typing
            isProgrammaticEdit = false
            markUserEdited()
            reportHeightIfChanged()
            fireChange(isComposing: false)
            fireSelection()
            return false
        }

        // Non-empty item: manual insert so the continuation never carries the
        // ordered start or a checked state (and a mid-item split re-types the
        // tail as a fresh item).
        var continuation: [String: Any] = ["type": type]
        if type == "task" { continuation["checked"] = false }
        var nlAttrs = view.typingAttributes
        nlAttrs[SigxAttr.block] = continuation
        nlAttrs[.font] = SigxRichTextUI.deriveTypingFont(from: nlAttrs, theme: theme)
        nlAttrs[.paragraphStyle] = SigxRichTextUI.deriveTypingParagraphStyle(from: nlAttrs)

        isProgrammaticEdit = true
        storage.beginEditing()
        if range.length > 0 { storage.deleteCharacters(in: range) }
        storage.insert(NSAttributedString(string: "\n", attributes: nlAttrs), at: range.location)
        // Mid-item split: the tail becomes its own fresh item.
        let afterNs = storage.string as NSString
        let tail = afterNs.paragraphRange(for: NSRange(location: range.location + 1, length: 0))
        if tail.length > 0 {
            storage.addAttribute(SigxAttr.block, value: continuation, range: tail)
            DocumentMapper.refreshVisuals(storage, range: tail, theme: theme)
        }
        storage.endEditing()
        view.selectedRange = NSRange(location: range.location + 1, length: 0)
        view.typingAttributes = nlAttrs
        isProgrammaticEdit = false
        lastNonCollapsedSelection = nil
        markUserEdited()
        reportHeightIfChanged()
        fireChange(isComposing: false)
        fireSelection()
        return false
    }

    private static func isListType(_ type: String) -> Bool {
        return type == "bullet" || type == "ordered" || type == "task"
    }

    func reportHeightIfChanged() {
        let view = self.view()
        let content = view.contentHeight()
        // Internal scrolling only once content exceeds the ceiling.
        if maxHeight > 0 {
            view.isScrollEnabled = content > maxHeight
        }
        let clamped = max(minHeight, maxHeight > 0 ? min(content, maxHeight) : content)
        if abs(clamped - lastReportedHeight) >= 0.5 {
            lastReportedHeight = clamped
            fireEvent("heightchange", params: ["height": clamped, "lines": view.lineCount()])
        }
    }

    // MARK: - Helpers

    private func refreshAllVisuals() {
        // The layout manager keeps a theme copy for decoration drawing.
        (view().layoutManager as? SigxLayoutManager)?.theme = theme
        guard let storage = view().textStorage as NSTextStorage?, storage.length > 0 else { return }
        isProgrammaticEdit = true
        storage.beginEditing()
        DocumentMapper.refreshVisuals(storage, range: NSRange(location: 0, length: storage.length), theme: theme)
        // Chip pills capture their look at creation — rebuild on theme change.
        DocumentMapper.refreshMentionAttachments(storage, theme: theme)
        storage.endEditing()
        isProgrammaticEdit = false
    }

    private static func inlineKey(for type: String) -> NSAttributedString.Key? {
        switch type {
        case "bold": return SigxAttr.bold
        case "italic": return SigxAttr.italic
        case "strike": return SigxAttr.strike
        case "code": return SigxAttr.code
        default: return nil
        }
    }

    private static func rangeFullyHasAttribute(_ storage: NSAttributedString, key: NSAttributedString.Key, range: NSRange) -> Bool {
        guard range.length > 0 else { return false }
        var covered = 0
        storage.enumerateAttribute(key, in: range, options: []) { value, sub, _ in
            if value != nil { covered += sub.length }
        }
        return covered == range.length
    }

    /// Attributes representing the current selection: typing attributes when
    /// collapsed (caret), the attributes at the selection start otherwise.
    private static func attributesForSelection(_ view: UITextView) -> [NSAttributedString.Key: Any] {
        let range = view.selectedRange
        if range.length == 0 { return view.typingAttributes }
        guard let storage = view.attributedText, storage.length > 0,
              range.location < storage.length else { return view.typingAttributes }
        return storage.attributes(at: range.location, effectiveRange: nil)
    }

    /// Rebuild the `.font` typing attribute from the custom model keys so a
    /// collapsed-selection toggle is visible on the very next typed character.
    /// Paragraph style matching the typing attributes' block type — kept in
    /// sync with `DocumentMapper.applyParagraphStyles` so the next typed run
    /// gets the right gutter indent (and exiting a block drops it).
    fileprivate static func deriveTypingParagraphStyle(from attrs: [NSAttributedString.Key: Any]) -> NSParagraphStyle {
        let type = (attrs[SigxAttr.block] as? [String: Any])?["type"] as? String ?? "paragraph"
        let style = NSMutableParagraphStyle()
        let indent = BlockMetrics.indent(for: type)
        style.firstLineHeadIndent = indent
        style.headIndent = indent
        return style
    }

    fileprivate static func deriveTypingFont(from attrs: [NSAttributedString.Key: Any], theme: RichTextTheme) -> UIFont {
        var font = theme.baseFont
        if let block = attrs[SigxAttr.block] as? [String: Any],
           let type = block["type"] as? String {
            if type == "heading" {
                font = theme.headingFont(level: block["level"] as? Int ?? 1)
            } else if type == "codeBlock" {
                return theme.codeFont
            }
        }
        // `code` is terminal (matches the serializer + applyBaseVisuals):
        // characters typed inside a code run never pick up bold/italic.
        if attrs[SigxAttr.code] != nil { return theme.codeFont }
        var traits = font.fontDescriptor.symbolicTraits
        if attrs[SigxAttr.bold] != nil { traits.insert(.traitBold) }
        if attrs[SigxAttr.italic] != nil { traits.insert(.traitItalic) }
        if traits != font.fontDescriptor.symbolicTraits,
           let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
            font = UIFont(descriptor: descriptor, size: font.pointSize)
        }
        return font
    }
}

/// `UITextViewDelegate` adapter — separate object so the generic LynxUI
/// subclass doesn't need protocol conformances (mirrors SigxWebView's
/// delegate split).
final class SigxRichTextDelegate: NSObject, UITextViewDelegate {
    private weak var owner: SigxRichTextUI?

    init(owner: SigxRichTextUI) { self.owner = owner }

    func textViewDidChange(_ textView: UITextView) {
        guard let owner, !owner.isProgrammaticEdit else { return }
        owner.lastNonCollapsedSelection = nil
        owner.markUserEdited()
        owner.reportHeightIfChanged()
        let composing = textView.markedTextRange != nil
        owner.fireChange(isComposing: composing)
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        guard let owner, !owner.isProgrammaticEdit,
              text == "\n", textView.markedTextRange == nil else { return true }
        return owner.handleNewline(in: range)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard let owner, !owner.isProgrammaticEdit else { return }
        if textView.selectedRange.length > 0 {
            owner.lastNonCollapsedSelection = textView.selectedRange
        }
        owner.fireSelection()
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
        owner?.fireEvent("focus", params: [:])
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        owner?.fireEvent("blur", params: [:])
    }
}

extension UIColor {
    /// Parse `#RGB`, `#RRGGBB`, or `#RRGGBBAA` (leading `#` optional).
    static func sigxColor(hex: String?) -> UIColor? {
        guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
        let hasAlpha = s.count == 8
        let r = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let g = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let b = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }
}
