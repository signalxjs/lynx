#!/usr/bin/env node
/**
 * Apply the sigx-standard `main` protection to a repo — branch rules as code.
 *
 * Branch protection lives in GitHub settings, not in the repo's files, so it
 * silently drifts between repos. This script makes it reproducible: run it once
 * per repo (and re-run any time to reconcile).
 *
 * What it enforces:
 *   Repo merge settings:
 *     - Squash-only merges (merge commits + rebase merges disabled) → linear history.
 *     - Auto-delete head branches after merge.
 *   Ruleset "sigx-standard: protect main" on `main`:
 *     - No direct pushes — changes land via PR only.
 *     - PR required: >= 1 approving review, stale approvals dismissed on new
 *       commits, CODEOWNERS review required, review threads must resolve.
 *     - No force-push and no deletion of `main`.
 *     - (Optional) required status checks green before merge — pass --checks.
 *
 * Required status checks are OPT-IN via --checks because a wrong context name
 * would block ALL merges. Discover your real check names on any open PR with
 * `gh pr checks <pr>` (or the PR "Checks" tab), then re-run with them.
 *
 * Usage:
 *   node scripts/apply-branch-protection.mjs <owner/repo> [--checks "a; b; c"] [--approvals N] [--dry-run]
 *   (--checks is semicolon-separated — matrix check names contain commas.)
 *
 * Examples:
 *   node scripts/apply-branch-protection.mjs signalxjs/core
 *   node scripts/apply-branch-protection.mjs signalxjs/core --checks "test (ubuntu-latest, 22); verify-pack"
 *
 * Requirements: `gh` CLI authenticated (`gh auth login`) with admin on the repo.
 */
import { spawnSync } from 'node:child_process';

const RULESET_NAME = 'sigx-standard: protect main';
const DEFAULT_BRANCH = 'main';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let repo;
let checks = [];
let dryRun = false;
let approvals = 1; // required approving reviews; 0 = PR required but owner may self-merge
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--checks') {
        const v = argv[++i];
        // Reject a missing value or a following flag (e.g. `--checks --dry-run`)
        // rather than silently consuming it as a check-run name.
        if (!v || v.startsWith('-')) die('--checks needs a value, e.g. --checks "test (ubuntu-latest, 22); verify-pack"');
        // Split on ';' — NOT ',' — because matrix check-run names contain commas
        // ("test (ubuntu-latest, 22)"). Repeatable: values accumulate across flags.
        checks.push(...v.split(';').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--approvals') {
        const v = argv[++i];
        if (!/^\d+$/.test(v ?? '')) die('--approvals needs a non-negative integer, e.g. --approvals 0');
        approvals = Number(v);
    } else if (!a.startsWith('-') && !repo) repo = a;
    else die(`Unexpected argument: ${a}`);
}
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    die('Usage: node scripts/apply-branch-protection.mjs <owner/repo> [--checks "a; b"] [--approvals N] [--dry-run]\n' +
        '  --checks  semicolon-separated check-run names (repeatable). Use ";" not "," —\n' +
        '            matrix names contain commas, e.g. "test (ubuntu-latest, 22); verify-pack".\n' +
        '  --approvals 0  → PR + CI required, but the author/owner may merge without a separate approval\n' +
        '                   (use for solo/small repos where Copilot reviews but can\'t formally approve)');
}

// ── gh helpers ───────────────────────────────────────────────────────────────
function die(msg) {
    console.error(`✗ ${msg}`);
    process.exit(1);
}

function gh(args, { input } = {}) {
    const res = spawnSync('gh', args, { encoding: 'utf8', input });
    if (res.error) {
        if (res.error.code === 'ENOENT') die('GitHub CLI (`gh`) not found — install it and run `gh auth login`.');
        die(`gh failed: ${res.error.message}`);
    }
    return res;
}

function ghJson(args, { input, allowFail } = {}) {
    const res = gh(args, { input });
    if (res.status !== 0) {
        if (allowFail) return null;
        die(`gh ${args.join(' ')}\n${res.stderr || res.stdout}`);
    }
    return res.stdout.trim() ? JSON.parse(res.stdout) : {};
}

const [owner, name] = repo.split('/');

// ── 1. repo merge settings (squash-only + auto-delete) ───────────────────────
const repoSettings = {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
};

// ── 2. the ruleset ───────────────────────────────────────────────────────────
const pullRequestRule = {
    type: 'pull_request',
    parameters: {
        required_approving_review_count: approvals,
        dismiss_stale_reviews_on_push: true,
        // Code-owner review implies an approval — only enforce it when approvals are required.
        require_code_owner_review: approvals > 0,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
    },
};

const rules = [
    { type: 'deletion' },
    { type: 'non_fast_forward' }, // blocks force-push
    pullRequestRule,
];

if (checks.length) {
    rules.push({
        type: 'required_status_checks',
        parameters: {
            strict_required_status_checks_policy: true, // branch must be up to date
            required_status_checks: checks.map((context) => ({ context })),
        },
    });
}

const ruleset = {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${DEFAULT_BRANCH}`], exclude: [] } },
    rules,
    // Empty bypass list: not even admins skip the PR flow. Add actor IDs here if
    // you ever need an escape hatch.
    bypass_actors: [],
};

// ── apply ────────────────────────────────────────────────────────────────────
console.log(`Repo:   ${repo}`);
console.log(`Branch: ${DEFAULT_BRANCH}`);
console.log(`Checks: ${checks.length ? checks.join(', ') : '(none — pass --checks to require CI green)'}`);
console.log(`Reviews: ${approvals} approving review(s)${approvals === 0 ? ' — PR required, owner may self-merge' : ', CODEOWNERS enforced'}`);
console.log(`Merges: squash-only, auto-delete branch on merge`);

if (dryRun) {
    console.log('\n--dry-run — would PATCH repo settings:');
    console.log(JSON.stringify(repoSettings, null, 2));
    console.log('\n--dry-run — would create/update ruleset:');
    console.log(JSON.stringify(ruleset, null, 2));
    process.exit(0);
}

// Verify auth before mutating, for a clear error rather than a cryptic API failure.
// Use `gh api user` (the active token) rather than `gh auth status`, which exits
// non-zero if any *other* configured account is broken even when the active one works.
if (gh(['api', 'user', '-q', '.login']).status !== 0) {
    die('Not authenticated — run `gh auth login` (need admin on the repo).');
}

// Merge settings.
ghJson(['api', '-X', 'PATCH', `repos/${owner}/${name}`, '--input', '-'], {
    input: JSON.stringify(repoSettings),
});
console.log('✓ Merge settings applied (squash-only, auto-delete).');

// Ruleset: find existing by name, then PUT (update) or POST (create) — idempotent.
const existing = ghJson(['api', `repos/${owner}/${name}/rulesets`, '--paginate'], { allowFail: true }) || [];
const found = Array.isArray(existing) ? existing.find((r) => r.name === RULESET_NAME) : null;

if (found) {
    ghJson(['api', '-X', 'PUT', `repos/${owner}/${name}/rulesets/${found.id}`, '--input', '-'], {
        input: JSON.stringify(ruleset),
    });
    console.log(`✓ Ruleset updated (id ${found.id}).`);
} else {
    const created = ghJson(['api', '-X', 'POST', `repos/${owner}/${name}/rulesets`, '--input', '-'], {
        input: JSON.stringify(ruleset),
    });
    console.log(`✓ Ruleset created (id ${created.id}).`);
}

console.log(`\n✓ '${DEFAULT_BRANCH}' is protected on ${repo}.`);
if (!checks.length) {
    console.log(
        '\nNext: require CI to be green before merge. Find your check names on an\n' +
        'open PR with `gh pr checks <pr>`, then re-run with e.g.\n' +
        `  node scripts/apply-branch-protection.mjs ${repo} --checks "test (ubuntu-latest, 22); verify-pack"`,
    );
}
