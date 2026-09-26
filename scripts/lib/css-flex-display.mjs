/**
 * css-flex-display.mjs — find CSS rules that lay out a row without `display: flex`.
 *
 * Lynx views are not flexbox by default (linear layout), so a class rule with
 * `flex-direction: row` and no `display: flex` stacks its children vertically.
 * Unit tests that assert class names cannot see it; only a device screenshot
 * can (#508 Rating; #1136 Card.Actions, Modal.Actions, Tabs, Steps). A modifier
 * rule counts as covered when a base rule it extends sets `display: flex`
 * (`.steps` → `.steps-horizontal`).
 */

/**
 * @param {string} css
 * @returns {string[]} selectors of the offending rules
 */
export function rowRulesWithoutFlex(css) {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, ' '), body }));
    const flexSelectors = rules.filter((r) => /display\s*:\s*flex/.test(r.body)).map((r) => r.sel);
    return rules
        .filter((r) => /flex-direction\s*:\s*row/.test(r.body) && !/display\s*:\s*flex/.test(r.body))
        .filter((r) => !flexSelectors.some((base) => r.sel !== base && r.sel.startsWith(`${base}-`)))
        .map((r) => r.sel);
}
