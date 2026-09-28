/**
 * App env (#1244): the typed `env` block of `signalx.config.ts` — variant
 * merge, JSON validation, secret-key warning, `SIGX_LYNX_ENV` plumbing, the
 * env hash, `.env` loading, and the `defineLynxConfig` typing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config/parser.js';
import {
    assertJsonEnv,
    canonicalEnvJson,
    envHash,
    findSecretLookingKeys,
    loadDotenvFiles,
} from '../src/config/env.js';
import { defineLynxConfig, readEnv, requireEnv, type EnvOf, type LynxConfig } from '../src/config/index.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const key of ['SIGX_LYNX_ENV', 'SIGX_LYNX_VARIANT', 'SIGX_LYNX_LOGGING', 'SIGX_LYNX_UPDATES_CHANNEL']) {
        delete process.env[key];
    }
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const base = (): LynxConfig => ({
    name: 'demo',
    env: { apiBaseUrl: 'https://api.example.com', flags: { beta: false, limit: 3 }, regions: ['eu'] },
    variants: {
        staging: { env: { apiBaseUrl: 'https://staging.example.com', flags: { beta: true } } },
        pr: { extends: 'staging', env: { regions: ['us', 'eu'] } },
    },
});

describe('resolveConfig — env', () => {
    it('exports the base env as canonical JSON in SIGX_LYNX_ENV', () => {
        const config = resolveConfig(base());
        expect(config.env).toEqual(base().env);
        expect(process.env['SIGX_LYNX_ENV']).toBe(canonicalEnvJson(base().env));
        expect(JSON.parse(process.env['SIGX_LYNX_ENV']!)).toEqual(base().env);
    });

    it('deep-merges the variant env (nested objects merge, arrays replace, extends chains)', () => {
        expect(resolveConfig(base(), 'staging').env).toEqual({
            apiBaseUrl: 'https://staging.example.com',
            flags: { beta: true, limit: 3 },
            regions: ['eu'],
        });
        expect(resolveConfig(base(), 'pr').env).toEqual({
            apiBaseUrl: 'https://staging.example.com',
            flags: { beta: true, limit: 3 },
            regions: ['us', 'eu'],
        });
        expect(JSON.parse(process.env['SIGX_LYNX_ENV']!).regions).toEqual(['us', 'eu']);
    });

    it('exports `{}` when no env is configured', () => {
        expect(resolveConfig({ name: 'demo' }).env).toEqual({});
        expect(process.env['SIGX_LYNX_ENV']).toBe('{}');
    });

    it('rejects non-JSON values with the key path', () => {
        const bad = (env: unknown) => () => resolveConfig({ name: 'demo', env } as LynxConfig);
        expect(bad({ api: { timeout: () => 1 } })).toThrow(/env\.api\.timeout is a function/);
        expect(bad({ when: new Date() })).toThrow(/env\.when is a Date/);
        expect(bad({ dsn: undefined })).toThrow(/env\.dsn is undefined.*requireEnv/);
        expect(bad({ list: [1, Number.NaN] })).toThrow(/env\.list\[1\] is NaN/);
        expect(bad(['not', 'an', 'object'])).toThrow(/env must be a plain object/);
    });

    it('clears a stale updates channel when the resolved config has none', () => {
        process.env['SIGX_LYNX_UPDATES_CHANNEL'] = 'staging';
        resolveConfig({ name: 'demo' });
        expect(process.env['SIGX_LYNX_UPDATES_CHANNEL']).toBeUndefined();
    });

    it('warns once per secret-looking key, and not for envAllow keys', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const raw: LynxConfig = {
            name: 'demo',
            env: { stripe: { publishableToken: 'pk_1' }, adminPassword: 'x', sentryDsn: 'd' },
            envAllow: ['publishableToken'],
        };
        resolveConfig(raw);
        resolveConfig(raw);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain('env.adminPassword');
    });
});

describe('env helpers', () => {
    it('findSecretLookingKeys matches key names, honoring the allow list', () => {
        expect(findSecretLookingKeys({
            clientSecret: 'a', privateKey: 'b', PASSWD: 'c', auth: { refreshToken: 'd' }, apiUrl: 'e',
        }, ['privateKey'])).toEqual(['env.clientSecret', 'env.PASSWD', 'env.auth.refreshToken']);
    });

    it('envHash is independent of key order and changes with values', () => {
        expect(envHash({ a: 1, b: { c: 2, d: 3 } })).toBe(envHash({ b: { d: 3, c: 2 }, a: 1 }));
        expect(envHash({ a: 1 })).not.toBe(envHash({ a: 2 }));
        expect(envHash(undefined)).toBe(envHash({}));
    });

    it('assertJsonEnv accepts plain JSON and null-prototype objects', () => {
        expect(() => assertJsonEnv({ a: null, b: [true, 'x', 1.5], c: Object.create(null) })).not.toThrow();
        expect(() => assertJsonEnv(undefined)).not.toThrow();
    });

    it('readEnv / requireEnv read process.env, treating empty as unset', () => {
        process.env['SIGX_TEST_ENV_VALUE'] = 'v';
        process.env['SIGX_TEST_ENV_EMPTY'] = '';
        try {
            expect(readEnv('SIGX_TEST_ENV_VALUE')).toBe('v');
            expect(readEnv('SIGX_TEST_ENV_EMPTY')).toBeUndefined();
            expect(requireEnv('SIGX_TEST_ENV_VALUE')).toBe('v');
            expect(() => requireEnv('SIGX_TEST_ENV_EMPTY')).toThrow(/SIGX_TEST_ENV_EMPTY.*\.env\.local/);
        } finally {
            delete process.env['SIGX_TEST_ENV_VALUE'];
            delete process.env['SIGX_TEST_ENV_EMPTY'];
        }
    });
});

describe('loadDotenvFiles', () => {
    function project(files: Record<string, string>): string {
        const cwd = mkdtempSync(join(tmpdir(), 'sigx-dotenv-'));
        tempDirs.push(cwd);
        for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
        return cwd;
    }

    it('layers .env < .env.local < .env.<variant> < .env.<variant>.local; real env wins', () => {
        const cwd = project({
            '.env': 'A=env\nB=env\nC=env\nD=env\nREAL=env\n',
            '.env.local': 'B=local\nC=local\nD=local\n',
            '.env.staging': 'C=staging\nD=staging\n',
            '.env.staging.local': 'D=staging-local\n',
            '.env.prod': 'A=prod\n',
        });
        const env: Record<string, string | undefined> = { REAL: 'ci' };
        const loaded = loadDotenvFiles(cwd, 'staging', env);
        expect(loaded).toEqual(['.env', '.env.local', '.env.staging', '.env.staging.local']);
        expect(env).toEqual({ A: 'env', B: 'local', C: 'staging', D: 'staging-local', REAL: 'ci' });
    });

    it('skips variant files for the base build and tolerates missing files', () => {
        const cwd = project({ '.env.local': 'X=1\n', '.env.staging': 'X=2\n' });
        const env: Record<string, string | undefined> = {};
        expect(loadDotenvFiles(cwd, undefined, env)).toEqual(['.env.local']);
        expect(env).toEqual({ X: '1' });
    });
});

describe('defineLynxConfig typing', () => {
    it('infers the env shape and restricts variant env keys to it', () => {
        const config = defineLynxConfig({
            name: 'demo',
            env: { apiBaseUrl: 'https://api.example.com', retries: 2 },
            variants: {
                dev: { env: { retries: 5 } },
                // @ts-expect-error — typo'd key not declared by the base env
                typo: { env: { apiBaseUrll: 'https://dev.example.com' } },
                // @ts-expect-error — wrong value type
                wrong: { env: { retries: 'five' } },
            },
        });
        const env: EnvOf<typeof config> = { apiBaseUrl: 'x', retries: 1 };
        // @ts-expect-error — EnvOf has exactly the declared keys
        const missing: EnvOf<typeof config> = { apiBaseUrl: 'x' };
        expect([env, missing]).toHaveLength(2);
    });

    it('rejects non-JSON env values at the type level', () => {
        // @ts-expect-error — functions are not JSON
        const bad = defineLynxConfig({ name: 'demo', env: { fn: () => 1 } });
        expect(bad.name).toBe('demo');
    });
});
