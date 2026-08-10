/**
 * Public-surface freeze test for @sigx/lynx-runtime-internal.
 *
 * This package is not an app-facing module — it is the shared leaf both
 * bundle layers import, so its surface is a *wire contract* rather than an
 * API: `OP` is the BG↔MT opcode table, and `./snapshot` is the namespace the
 * upstream `@lynx-js/react/transform` snapshot pass emits calls against. Both
 * are consumed by code nobody typechecks against this package — compiled
 * template output on one side, a separately-bundled MT layer on the other —
 * so a rename or a renumber here fails at runtime on device, far from the
 * cause. Freezing it makes that a CI failure instead.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Three layers:
 *  - Runtime: the value exports of BOTH published entry points (`.` and
 *    `./snapshot`, per package.json `exports`). Type-only exports (`OpCode`,
 *    `MapperParams`, `SnapshotDef`, …) are erased and are pinned below.
 *  - Opcode numbers: unlike a normal export list, the *values* are the
 *    contract — the two thread layers are bundled separately and a shifted
 *    number silently reinterprets every op after it.
 *  - Types: the generated-code call shapes and the name unions that
 *    lynx-runtime-main's mapper/reducer tables have to stay in step with.
 *
 * There is no `.web.ts` sibling here (the module is thread-neutral by
 * construction — see the snapshot.ts header), so no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as runtimeInternal from '../src/index';
import { OP } from '../src/index';
import type { OpCode } from '../src/index';
import * as snapshot from '../src/snapshot';
import type {
    SnapshotCreateFn,
    SnapshotDef,
    SnapshotElement,
    SnapshotHooks,
    SnapshotInstanceLike,
    SnapshotSlotEntry,
    SnapshotUpdateFn,
} from '../src/snapshot';
import type {
    BuiltinMapperName,
    DerivedReducer,
    DerivedReducerName,
    RangeParams,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface of the root entry', () => {
        // Everything else the barrel re-exports is type-only.
        expect(Object.keys(runtimeInternal).sort()).toEqual(['OP']);
    });

    it('matches the locked surface of the ./snapshot entry', () => {
        // Every name here is referenced by *generated* code (the transform
        // emits `ReactLynx.<name>(...)` against this namespace), so a rename
        // has no callsite in this repo to break — only compiled bundles.
        expect(Object.keys(snapshot).sort()).toEqual(
            [
                // DynamicPartType constants the transform references by name
                '__DynamicPartAttr',
                '__DynamicPartSpread',
                '__DynamicPartSlot',
                '__DynamicPartChildren',
                '__DynamicPartListChildren',
                '__DynamicPartMultiChildren',
                '__DynamicPartSlotV2',
                '__DynamicPartListSlotV2',
                // Precomputed single-slot forms
                '__DynamicPartChildren_0',
                '__DynamicPartListChildren_0',
                '__DynamicPartSlotV2_0',
                '__DynamicPartListSlotV2_0',
                // Registry
                'snapshotManager',
                'snapshotCreatorMap',
                'createSnapshot',
                'getSnapshotDef',
                'isSnapshotType',
                'resetSnapshotRegistry',
                'purgeSnapshotTemplatesByPrefix',
                // Page id (live binding read by compiled create bodies)
                '__pageId',
                'setSnapshotPageId',
                // MT hook installation + the updater delegates
                'installSnapshotHooks',
                'updateEvent',
                'updateWorkletEvent',
                'updateRef',
                'updateWorkletRef',
                'updateGesture',
                'updateSpread',
                'updateListItemPlatformInfo',
                'snapshotCreateList',
                'transformRef',
            ].sort(),
        );
    });
});

describe('opcode numbering', () => {
    it('freezes every opcode to its wire number', () => {
        // The BG and MT layers ship as separate bundles that may be built at
        // different times (dev reload, OTA); they agree only on these
        // integers. Renumbering or reusing a retired slot mis-decodes the
        // whole stream — append new ops at the end and extend this table.
        expect(OP).toEqual({
            CREATE: 0,
            CREATE_TEXT: 1,
            INSERT: 2,
            REMOVE: 3,
            SET_PROP: 4,
            SET_TEXT: 5,
            SET_EVENT: 6,
            REMOVE_EVENT: 7,
            SET_STYLE: 8,
            SET_CLASS: 9,
            SET_ID: 10,
            SET_WORKLET_EVENT: 11,
            SET_MT_REF: 12,
            INIT_MT_REF: 13,
            RELEASE_MT_REF: 14,
            REGISTER_AV_BRIDGE: 15,
            UNREGISTER_AV_BRIDGE: 16,
            REGISTER_AV_STYLE_BINDING: 17,
            UNREGISTER_AV_STYLE_BINDING: 18,
            SET_GESTURE_DETECTOR: 19,
            REMOVE_GESTURE_DETECTOR: 20,
            INVOKE_UI_METHOD: 21,
            SNAPSHOT_CREATE: 22,
            SNAPSHOT_SET_VALUES: 23,
            SNAPSHOT_SET_VALUE: 24,
            SNAPSHOT_BIND_SLOT: 25,
            INVOKE_WORKLET: 26,
            REGISTER_AV_DERIVED: 27,
            UNREGISTER_AV_DERIVED: 28,
            REGISTER_AV_METHOD_BINDING: 29,
            UNREGISTER_AV_METHOD_BINDING: 30,
            REGISTER_FRAME_CALLBACK: 31,
            SET_FRAME_CALLBACK_ACTIVE: 32,
            UNREGISTER_FRAME_CALLBACK: 33,
        });
    });
});

describe('public types', () => {
    it('keeps OP a literal-typed const map and OpCode its value union', () => {
        // `as const` is what makes an op array narrow to its tuple shape at
        // the callsites that build batches; widening OP's members to `number`
        // would silently disable that checking everywhere.
        expectTypeOf(OP.CREATE).toEqualTypeOf<0>();
        expectTypeOf(OP.UNREGISTER_FRAME_CALLBACK).toEqualTypeOf<33>();
        expectTypeOf<OpCode>().toEqualTypeOf<(typeof OP)[keyof typeof OP]>();
    });

    it('pins the generated-code registration contract', () => {
        // The transform emits this call positionally with eight arguments;
        // reordering or dropping a trailing optional breaks compiled bundles
        // that no typecheck in this repo covers.
        expectTypeOf(snapshot.createSnapshot).toEqualTypeOf<
            (
                uniqID: string,
                create: SnapshotCreateFn | null,
                update: SnapshotUpdateFn[] | null,
                slot: SnapshotSlotEntry[] | null,
                cssId?: number,
                entryName?: string,
                refAndSpreadIndexes?: number[] | null,
                isLazySnapshotSupported?: boolean,
            ) => string
        >();
        // Registration goes through this map, so its shape is equally part of
        // the emitted contract: id → lazy creator returning the id.
        expectTypeOf(snapshot.snapshotCreatorMap).toEqualTypeOf<
            Record<string, (uniqID: string) => string>
        >();
        expectTypeOf(snapshot.getSnapshotDef).toEqualTypeOf<
            (uniqID: string) => SnapshotDef | undefined
        >();
    });

    it('pins the instance field names compiled closures read', () => {
        // `create(ctx)` / `update(ctx, i, oldValue)` bodies address these
        // fields literally. `__elements` is nullable because a staged
        // instance exists before its elements do (lazy SNAPSHOT_CREATE).
        expectTypeOf<SnapshotInstanceLike>().toEqualTypeOf<{
            __id: number;
            __values: unknown[];
            __elements: SnapshotElement[] | null;
        }>();
        expectTypeOf<SnapshotCreateFn>().toEqualTypeOf<
            (ctx: SnapshotInstanceLike) => SnapshotElement[]
        >();
        expectTypeOf<SnapshotUpdateFn>().toEqualTypeOf<
            (ctx: SnapshotInstanceLike, index: number, oldValue: unknown) => void
        >();
    });

    it('keeps the hook delegates thread-neutral and installable', () => {
        // Thread neutrality is the whole design: this module must stay
        // byte-identical on both layers, so anything element-specific is
        // reached only through `installSnapshotHooks`. A delegate that grew a
        // direct element type here would break the MT loader's cross-layer
        // module identity.
        expectTypeOf(snapshot.installSnapshotHooks).toEqualTypeOf<(impl: SnapshotHooks) => void>();
        expectTypeOf(snapshot.updateRef).toEqualTypeOf<
            (
                ctx: SnapshotInstanceLike,
                index: number,
                oldValue: unknown,
                elementIndex: number,
            ) => void
        >();
        expectTypeOf<SnapshotElement>().toEqualTypeOf<unknown>();
        // Live ESM binding, not a getter — namespace reads observe updates.
        expectTypeOf(snapshot.__pageId).toEqualTypeOf<number>();
        expectTypeOf(snapshot.setSnapshotPageId).toEqualTypeOf<(id: number) => void>();
    });

    it('pins the mapper and reducer name unions', () => {
        // These names are the only thing that crosses to the MT (a name ships
        // over the wire where a captured function cannot), and each must have
        // a matching entry in lynx-runtime-main's `mtMappers` / reducer
        // tables. Dropping one from the union is a silent no-op animation.
        expectTypeOf<BuiltinMapperName>().toEqualTypeOf<
            | 'translateX'
            | 'translateY'
            | 'translate'
            | 'scale'
            | 'scaleX'
            | 'scaleY'
            | 'opacity'
            | 'rotate'
            | 'width'
            | 'height'
            | 'paddingTop'
            | 'paddingRight'
            | 'paddingBottom'
            | 'paddingLeft'
            | 'marginTop'
            | 'marginRight'
            | 'marginBottom'
            | 'marginLeft'
        >();
        expectTypeOf<DerivedReducerName>().toEqualTypeOf<'max' | 'min' | 'sum' | 'scale'>();
        expectTypeOf<RangeParams>().toEqualTypeOf<{
            inputRange: number[];
            outputRange: number[];
            extrapolate?: 'clamp' | 'identity';
        }>();
        // A reducer folds live source values on the MT — number[] in, number
        // out, no thread crossing.
        expectTypeOf<DerivedReducer>().toEqualTypeOf<
            (values: number[], params?: unknown) => number
        >();
    });
});
