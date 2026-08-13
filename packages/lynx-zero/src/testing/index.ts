/**
 * `@sigx/lynx-zero/testing` — the conformance surface that holds lynx-zero
 * components to the SAME contract zero's web components are held to.
 *
 * `expectAnatomy` wraps `@sigx/lynx-testing`'s TestNode tree into
 * `@sigx/zero/testing`'s `ElementLike` and runs `expectAnatomyElements` —
 * the identical seven rules (declared parts, closed state sets, declared
 * presence-only flags, per-part placements, `hiddenIn` both directions, the
 * part tree, modifier namespace). The rules are zero's; only the tree walk
 * is ours.
 *
 * `expectClassGrammar` is the lynx-specific half: on this platform the
 * `data-*` attributes are the machine-readable anatomy but the CLASSES are
 * what the stylesheet matches, and the two are only trustworthy together.
 * For every anatomy-carrying node it recomputes the expected `zx-*` set from
 * the node's own data attributes through the shared grammar and asserts the
 * rendered class list carries exactly that set (consumer extras allowed —
 * they are not in the `zx-` namespace).
 */
import type { ElementLike, ExpectAnatomyOptions } from '@sigx/zero/testing';
import { expectAnatomyElements } from '@sigx/zero/testing';
import type { Anatomy } from '@sigx/zero/contract/core';
import {
    FLAG_VOCABULARY,
    MOD_ATTR_PREFIX,
    axisClass,
    flagClass,
    modClass,
    orientationClass,
    partClass,
    placementClass,
    stateClass,
} from '@sigx/zero/contract/core';
/**
 * The rendered-node slice the oracles read — STRUCTURAL on purpose, so this
 * subpath carries no type dependency on `@sigx/lynx-testing`:
 * `TestNode` satisfies it as-is, and so would any renderer with the same
 * tree shape.
 */
export interface ConformanceNode {
    props: Record<string, unknown>;
    children: ConformanceNode[];
    parent: ConformanceNode | null;
    _class?: string;
}

/**
 * Attribute semantics over TestNode props: presence-only flags render as
 * `''`, `hidden` may be a boolean, everything else stringifies. `null` means
 * absent — the shape `ElementLike` requires.
 */
function attributeValue(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === false) return null;
    if (raw === true) return '';
    return String(raw);
}

function wrap(node: ConformanceNode): ElementLike {
    return {
        getAttribute: (name) => attributeValue(node.props[name]),
        getAttributeNames: () =>
            Object.keys(node.props).filter((name) => attributeValue(node.props[name]) !== null),
        parent: () => (node.parent ? wrap(node.parent) : null),
    };
}

function collect(node: ConformanceNode, scope: string, out: ConformanceNode[]): void {
    if (attributeValue(node.props['data-scope']) === scope) out.push(node);
    for (const child of node.children) collect(child, scope, out);
}

/**
 * Zero's anatomy oracle over a rendered TestNode tree — pass the `container`
 * from `@sigx/lynx-testing`'s `render()` (or any subtree root).
 */
export function expectAnatomy(root: ConformanceNode, anatomy: Anatomy, options: ExpectAnatomyOptions = {}): void {
    const nodes: ConformanceNode[] = [];
    collect(root, anatomy.scope, nodes);
    expectAnatomyElements(nodes.map(wrap), anatomy, options);
}

export interface ExpectClassGrammarOptions {
    /** Custom axes the component renders (`data-<axis>`), like `expectAnatomy`. */
    axes?: readonly string[];
}

const CONTRACT_VALUE_ATTRS = new Set(['data-color', 'data-size', 'data-variant']);
const FLAGS = new Set<string>(FLAG_VOCABULARY);

/**
 * The classes' own oracle: recompute the expected `zx-*` set from each
 * anatomy-carrying node's data attributes and assert the rendered class list
 * matches it exactly (extras outside the `zx-` namespace are consumer
 * classes and pass through).
 *
 * Throws a plain `Error` like the anatomy oracle, so it runs under any test
 * runner.
 */
export function expectClassGrammar(root: ConformanceNode, anatomy: Anatomy, options: ExpectClassGrammarOptions = {}): void {
    const nodes: ConformanceNode[] = [];
    collect(root, anatomy.scope, nodes);
    if (nodes.length === 0) {
        throw new Error(`[@sigx/lynx-zero] expectClassGrammar(${anatomy.scope}): no parts rendered for this scope`);
    }
    const customAxisAttrs = new Set((options.axes ?? []).map((axis) => `data-${axis}`));

    for (const node of nodes) {
        const el = wrap(node);
        const part = el.getAttribute('data-part') ?? '(missing data-part)';
        const expected = new Set<string>([partClass(anatomy.scope, part)]);
        for (const attr of el.getAttributeNames()) {
            const value = el.getAttribute(attr)!;
            if (attr === 'data-state') expected.add(stateClass(value));
            else if (attr === 'data-orientation') expected.add(orientationClass(value));
            else if (attr === 'data-placement') expected.add(placementClass(value));
            else if (CONTRACT_VALUE_ATTRS.has(attr) || customAxisAttrs.has(attr)) {
                expected.add(axisClass(attr.slice(5), value));
            } else if (attr.startsWith(MOD_ATTR_PREFIX)) {
                expected.add(modClass(attr.slice(MOD_ATTR_PREFIX.length)));
            } else if (attr.startsWith('data-') && FLAGS.has(attr.slice(5))) {
                expected.add(flagClass(attr.slice(5)));
            }
        }
        const rendered = new Set(
            String(node._class ?? node.props['class'] ?? '')
                .split(/\s+/)
                .filter((cls) => cls.startsWith('zx-')),
        );
        const missing = [...expected].filter((cls) => !rendered.has(cls));
        const extra = [...rendered].filter((cls) => !expected.has(cls));
        if (missing.length > 0 || extra.length > 0) {
            throw new Error(
                `[@sigx/lynx-zero] expectClassGrammar(${anatomy.scope}): part "${part}" classes disagree with its data attributes`
                + (missing.length ? ` — missing: ${missing.join(', ')}` : '')
                + (extra.length ? ` — unexpected: ${extra.join(', ')}` : ''),
            );
        }
    }
}
