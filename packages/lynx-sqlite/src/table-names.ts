/**
 * Lightweight SQL table-name extraction for live-query invalidation.
 *
 * This is deliberately NOT a SQL parser. The contract is conservative:
 * whenever extraction is uncertain it falls back to `'*'` (writes notify
 * every subscriber / reads re-run on any write), trading precision for
 * correctness. Identifiers are normalized to lowercase with quotes and
 * schema prefixes stripped, so subscriptions match regardless of quoting
 * style.
 */

/** `"x"`, `[x]`, `` `x` `` or a bare identifier. */
const IDENT = String.raw`(?:"[^"]+"|\[[^\]]+\]|\`[^\`]+\`|[A-Za-z_][\w$]*)`;

/**
 * Tokens that can follow a table reference in a FROM clause but are never
 * a table alias. Lowercase; quoted identifiers never match (they keep
 * their quotes as tokens).
 */
const KEYWORDS = new Set([
    'where', 'group', 'order', 'by', 'limit', 'offset', 'having', 'window',
    'on', 'using', 'join', 'inner', 'left', 'right', 'full', 'outer',
    'cross', 'natural', 'union', 'except', 'intersect', 'select', 'set',
    'values', 'as', 'not', 'indexed', 'returning',
]);

/**
 * Remove line (`--`) and block comments while leaving `'...'` string
 * literals intact (a `--` inside a literal is data, not a comment).
 */
function stripComments(sql: string): string {
    let out = '';
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        if (ch === "'") {
            let j = i + 1;
            while (j < sql.length) {
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") { j += 2; continue; } // '' escape
                    j++;
                    break;
                }
                j++;
            }
            out += sql.slice(i, j);
            i = j;
            continue;
        }
        if (ch === '-' && sql[i + 1] === '-') {
            const nl = sql.indexOf('\n', i);
            i = nl === -1 ? sql.length : nl;
            continue;
        }
        if (ch === '/' && sql[i + 1] === '*') {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 2;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

/** Strip quoting and lowercase. `main.messages` callers pass each part separately. */
function normalizeIdent(raw: string): string {
    const first = raw[0];
    const unquoted =
        first === '"' || first === '`' || first === '[' ? raw.slice(1, -1) : raw;
    return unquoted.toLowerCase();
}

/** Last segment of a possibly schema-qualified identifier (`main.t` → `t`). */
function lastIdent(qualified: string): string {
    // Split on a dot that sits between identifier parts; quoted parts can't
    // contain an unquoted dot followed by an identifier in our IDENT grammar.
    const parts = qualified.match(new RegExp(IDENT, 'g')) ?? [qualified];
    return normalizeIdent(parts[parts.length - 1]);
}

function firstKeyword(sql: string): string {
    const m = sql.match(/^[\s(]*([A-Za-z]+)/);
    return m ? m[1].toUpperCase() : '';
}

const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

/**
 * Tables a statement writes. Returns `null` for read-only statements (no
 * notification), a set of table names for recognized DML, or `'*'` when
 * uncertain (DDL, write-CTEs, unknown verbs) — notify everyone.
 */
export function writtenTables(sql: string): ReadonlySet<string> | '*' | null {
    const clean = stripComments(sql).trim();
    switch (firstKeyword(clean)) {
        case 'SELECT':
        case 'EXPLAIN':
        case 'VALUES':
        case 'PRAGMA':
            return null;
        case 'WITH':
            // A CTE prefix can front INSERT/UPDATE/DELETE. Resolving the
            // main verb means parsing the CTE list — scan for write verbs
            // instead and stay conservative on a hit.
            return /\b(insert|update|delete|replace)\b/i.test(clean) ? '*' : null;
        case 'INSERT':
        case 'REPLACE': {
            const m = clean.match(new RegExp(
                String.raw`^(?:insert|replace)\s+(?:or\s+[a-z]+\s+)?into\s+(${QUALIFIED})`, 'i'));
            return m ? new Set([lastIdent(m[1])]) : '*';
        }
        case 'UPDATE': {
            const m = clean.match(new RegExp(
                String.raw`^update\s+(?:or\s+[a-z]+\s+)?(${QUALIFIED})`, 'i'));
            return m ? new Set([lastIdent(m[1])]) : '*';
        }
        case 'DELETE': {
            const m = clean.match(new RegExp(
                String.raw`^delete\s+from\s+(${QUALIFIED})`, 'i'));
            return m ? new Set([lastIdent(m[1])]) : '*';
        }
        default:
            // DDL (CREATE/DROP/ALTER), VACUUM, unknown verbs.
            return '*';
    }
}

const TOKEN = new RegExp(
    String.raw`'(?:[^']|'')*'|${IDENT}|\d[\w.]*|,|\(|\)|\.|[^\s]`, 'g');

function isIdentToken(t: string): boolean {
    return /^["\[\`A-Za-z_]/.test(t) && !KEYWORDS.has(t.toLowerCase());
}

/**
 * Tables a statement reads (what a live query must subscribe to).
 * Collects every identifier after `FROM`/`JOIN`, following comma-joins and
 * skipping aliases; subqueries are covered because their own FROMs appear
 * later in the same token stream. CTE names show up as harmless extra
 * subscriptions (nothing ever notifies them). Returns `'*'` if the
 * statement has a FROM clause we couldn't extract anything from.
 */
export function readTables(sql: string): ReadonlySet<string> | '*' {
    const clean = stripComments(sql);
    const tokens = clean.match(TOKEN) ?? [];
    const found = new Set<string>();
    let sawFrom = false;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i].toLowerCase();
        if (t !== 'from' && t !== 'join') continue;
        sawFrom = true;
        // collectTables returns the first unconsumed index; step back one so
        // the loop's i++ re-examines it (it may itself be a JOIN keyword).
        i = collectTables(tokens, i + 1, found) - 1;
    }
    if (sawFrom && found.size === 0) return '*';
    return found;
}

/** Consume `t1 [AS a] [, t2 [AS b]]…` starting at `i`; returns the index of the first unconsumed token. */
function collectTables(tokens: string[], i: number, found: Set<string>): number {
    while (i < tokens.length) {
        // Subquery / table-valued function — its inner FROM is found by the
        // caller's scan; nothing to collect here.
        if (tokens[i] === '(') return i;
        if (!isIdentToken(tokens[i])) return i;
        let name = tokens[i];
        if (tokens[i + 1] === '.' && i + 2 < tokens.length && isIdentToken(tokens[i + 2])) {
            name = tokens[i + 2]; // schema-qualified: keep the table part
            i += 2;
        }
        found.add(normalizeIdent(name));
        i++;
        if (tokens[i]?.toLowerCase() === 'as') i++;
        if (i < tokens.length && isIdentToken(tokens[i])) i++; // alias
        if (tokens[i] === ',') { i++; continue; }
        return i;
    }
    return i;
}
