/**
 * FileUpload — a files model with a pluggable picker (zero's `file-upload`
 * scope).
 *
 * ```tsx
 * import { FilePicker } from '@sigx/lynx-file-picker';
 *
 * <FileUpload.Root
 *     accept="image/*,application/pdf"
 *     multiple
 *     maxFileSize={10_000_000}
 *     model={() => state.files}
 *     pick={async ({ multiple, types }) => {
 *         const result = await FilePicker.pick({ multiple, types });
 *         return result.cancelled ? [] : result.assets;
 *     }}
 * >
 *     <FileUpload.Label>Attachments</FileUpload.Label>
 *     <FileUpload.Dropzone><text>Tap to add files</text></FileUpload.Dropzone>
 *     <FileUpload.Trigger><text>Browse…</text></FileUpload.Trigger>
 *     <FileUpload.ItemGroup>
 *         {(files: FileUploadFile[]) => files.map((f) => (
 *             <FileUpload.Item file={f} key={f.uri ?? f.name}>
 *                 <FileUpload.ItemName />
 *                 <FileUpload.ItemSize />
 *                 <FileUpload.ItemRemove />
 *             </FileUpload.Item>
 *         ))}
 *     </FileUpload.ItemGroup>
 *     <FileUpload.ClearTrigger><text>Clear</text></FileUpload.ClearTrigger>
 * </FileUpload.Root>
 * ```
 *
 * The lynx spellings:
 *
 * - **The picker is the app's.** Lynx has no `<input type="file">`, so the
 *   `input` part is not rendered and the root takes a `pick` callback: the
 *   trigger (and a dropzone or label tap) calls it with `{ accept,
 *   multiple, types }` — `types` is `accept`'s MIME entries, the shape
 *   `@sigx/lynx-file-picker`'s `FilePicker.pick` takes — and whatever files
 *   it resolves to go through the constraints. A `FilePickerAsset`
 *   (`uri`, `name`, `mimeType`, `size`) IS a `FileUploadFile`, so the
 *   picker's result passes straight through; lynx-zero takes no native
 *   dependency. One pick at a time; a rejected pick reports `pickError`.
 * - **Selection and constraints are zero's.** `multiple` appends across
 *   picks (deduped by `uri`, else name + size + lastModified); single mode
 *   replaces. `accept` (extensions, MIME types, `type/*` families — checked
 *   again here because not every picker filters), `maxFiles`,
 *   `minFileSize`, `maxFileSize` and `validate` run over every candidate:
 *   accepted files join the model, the rest are reported once per pick
 *   through `filesReject` as `{ file, errors }[]`.
 * - **Drag-and-drop is web-only.** There is no desktop to drag from. The
 *   Dropzone is a big tap target that opens the picker; the shared
 *   `highlighted` flag (root + dropzone) is never driven on lynx and is
 *   reachable through `ForceStates` only, for the gallery.
 * - **Buttons are `view`s** with `bindtap`, the `button` trait, tier-2
 *   press feedback and a `pressed` flag: the Trigger (named by its text, or
 *   `label`), each Item's Remove ("Remove <name>") and the ClearTrigger
 *   ("Clear files"), which renders nothing while the model is empty. With
 *   no children Remove draws `×`. `focus-visible` is reachable through
 *   `ForceStates` only (no keyboard focus on this platform).
 * - **Field context.** Inside a `Field.Root` the root adopts its
 *   `disabled` / `invalid` / `required`; a tap on the Field's label opens
 *   the picker. There is no form to post to and no constraint validation:
 *   `invalid` is the app's to set.
 * - **Text parts.** `Label`, `ItemName` and `ItemSize` are `<text>`s:
 *   pass a string (the item parts default to the file's name and its
 *   size, formatted `1.5 kB`).
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createControllableState, createFormControl, createInertState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies['file-upload'];

/**
 * One file in the model. Structurally a `@sigx/lynx-file-picker`
 * `FilePickerAsset` (and close enough to a web `File` for the constraint
 * checks): only `name` and `size` are required.
 */
export interface FileUploadFile {
    name: string;
    /** Size in bytes (`0` when unknowable). */
    size: number;
    /** MIME type — what a native picker reports. */
    mimeType?: string;
    /** The web `File`'s spelling of the MIME type; read when `mimeType` is absent. */
    type?: string;
    /** Where the file lives (`file://…`, `content://…`) — the dedupe identity when present. */
    uri?: string;
    lastModified?: number;
}

/** What the `pick` callback is asked for. */
export interface FileUploadPickRequest {
    /** The root's `accept` string, as given. */
    accept: string | undefined;
    multiple: boolean;
    /**
     * `accept`'s MIME entries (`image/*`, `application/pdf`) — the list
     * `FilePicker.pick({ types })` takes. Empty when `accept` names only
     * extensions or is unset (the picker then offers every file, and the
     * root's own `accept` check filters).
     */
    types: string[];
}

export type FileUploadPicker = (
    request: FileUploadPickRequest,
) => Promise<readonly FileUploadFile[] | null | undefined> | readonly FileUploadFile[] | null | undefined;

/**
 * Why a candidate file was refused. The four built-in codes are the
 * constraints the Root checks itself; anything else is a string the app's
 * `validate` returned.
 */
export type FileRejectionCode = 'invalid-type' | 'too-large' | 'too-small' | 'too-many' | (string & {});

/** One refused file and every reason it was refused, in check order. */
export interface FileRejection {
    file: FileUploadFile;
    errors: FileRejectionCode[];
}

/** The per-file constraints `fileErrors` checks. */
export interface FileConstraints {
    accept?: string;
    minFileSize?: number;
    maxFileSize?: number;
    validate?: (file: FileUploadFile) => string | string[] | null | undefined;
}

const mimeOf = (file: FileUploadFile): string => (file.mimeType ?? file.type ?? '').toLowerCase();

/**
 * Does one file match an `accept` string? zero's rule: comma-separated
 * extensions (`.txt`), exact MIME types, or wildcard families (`image/*`).
 * No `accept` accepts everything.
 */
export function acceptsFile(accept: string | undefined, file: FileUploadFile): boolean {
    if (!accept) return true;
    const type = mimeOf(file);
    const name = file.name.toLowerCase();
    return accept.split(',').some((raw) => {
        const token = raw.trim().toLowerCase();
        if (token === '') return false;
        if (token.startsWith('.')) return name.endsWith(token);
        if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
        return type === token;
    });
}

/** `accept`'s MIME entries — what a native picker filters by. */
export function acceptMimeTypes(accept: string | undefined): string[] {
    if (!accept) return [];
    return accept.split(',').map((t) => t.trim()).filter((t) => t.includes('/'));
}

/** `1536` → `'1.5 kB'` — SI units, one decimal below 10, none above (zero's). */
export function formatBytes(size: number): string {
    if (size < 1000) return `${size} B`;
    const units = ['kB', 'MB', 'GB', 'TB'];
    let value = size;
    let unit = 'B';
    for (const next of units) {
        if (value < 1000) break;
        value /= 1000;
        unit = next;
    }
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return `${rounded} ${unit}`;
}

/** Every per-file refusal for one candidate: type, size bounds, then the app's codes. */
export function fileErrors(file: FileUploadFile, c: FileConstraints): FileRejectionCode[] {
    const errors: FileRejectionCode[] = [];
    if (!acceptsFile(c.accept, file)) errors.push('invalid-type');
    if (c.maxFileSize != null && file.size > c.maxFileSize) errors.push('too-large');
    if (c.minFileSize != null && file.size < c.minFileSize) errors.push('too-small');
    const custom = c.validate?.(file);
    if (typeof custom === 'string') errors.push(custom);
    else if (Array.isArray(custom)) errors.push(...custom);
    return errors;
}

/** Identity for dedupe — the location when the picker gives one. */
const fileKey = (f: FileUploadFile): string => f.uri ?? `${f.name} ${f.size} ${f.lastModified ?? ''}`;

interface FileUploadContext {
    state: ControllableState<FileUploadFile[]>;
    addFiles(incoming: readonly FileUploadFile[]): void;
    removeFile(file: FileUploadFile): void;
    clear(): void;
    openPicker(): void;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
}

function makeInert(): FileUploadContext {
    return {
        state: createInertState<FileUploadFile[]>([]),
        addFiles: () => {},
        removeFile: () => {},
        clear: () => {},
        openPicker: () => {},
        disabled: () => false,
        invalid: () => false,
        required: () => false,
    };
}

const useFileUploadContext = defineInjectable<FileUploadContext>(() => makeInert());

// ── Root ──

export type FileUploadRootProps =
    & Define.Model<FileUploadFile[]>
    & Define.Prop<'defaultFiles', FileUploadFile[], false>
    & Define.Event<'filesChange', FileUploadFile[]>
    /** Opens the platform picker and resolves to the chosen files (empty / null when cancelled). */
    & Define.Prop<'pick', FileUploadPicker, false>
    & Define.Prop<'accept', string, false>
    & Define.Prop<'multiple', boolean, false>
    /** Most files the model holds under `multiple`; extras are rejected `too-many`. */
    & Define.Prop<'maxFiles', number, false>
    /** Smallest accepted file, in bytes; smaller ones are rejected `too-small`. */
    & Define.Prop<'minFileSize', number, false>
    /** Largest accepted file, in bytes; larger ones are rejected `too-large`. */
    & Define.Prop<'maxFileSize', number, false>
    /** App check per candidate: return an error code (or several) to refuse it, `null` to accept. */
    & Define.Prop<'validate', (file: FileUploadFile) => string | string[] | null | undefined, false>
    /** The candidates the last pick refused; they never join the model. */
    & Define.Event<'filesReject', FileRejection[]>
    /** The `pick` callback threw or rejected. */
    & Define.Event<'pickError', unknown>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    & Define.Prop<'color', string, false>
    /** Falls back to the enclosing Field's size. */
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const FileUploadRoot = component<FileUploadRootProps>(({ props, slots, emit, onUnmounted }) => {
    const state = createControllableState<FileUploadFile[]>(
        () => props.model,
        props.defaultFiles ?? [],
        (v) => emit('filesChange', v),
    );
    const fc = createFormControl({ props: () => props, idBase: 'zx-file-upload', controlPart: 'trigger' });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? fc.field.size(),
    }));
    // One pick at a time: a second tap while the sheet is up is not a second sheet.
    let picking = false;

    const ctx: FileUploadContext = {
        state,
        addFiles(incoming) {
            if (fc.disabled()) return;
            const constraints: FileConstraints = {
                accept: props.accept,
                minFileSize: props.minFileSize,
                maxFileSize: props.maxFileSize,
                validate: props.validate,
            };
            const rejected: FileRejection[] = [];
            const accepted: FileUploadFile[] = [];
            // Single mode replaces, so it always has room for exactly one;
            // `multiple` counts what the model already holds.
            const seen = new Set(props.multiple ? state.value.map(fileKey) : []);
            let room = props.multiple
                ? (props.maxFiles != null ? Math.max(0, props.maxFiles - state.value.length) : Infinity)
                : 1;
            for (const f of incoming) {
                // A file the model already holds is not news — skipped, not refused.
                if (seen.has(fileKey(f))) continue;
                const errors = fileErrors(f, constraints);
                if (errors.length > 0) {
                    rejected.push({ file: f, errors });
                } else if (room <= 0) {
                    rejected.push({ file: f, errors: ['too-many'] });
                } else {
                    seen.add(fileKey(f));
                    accepted.push(f);
                    room--;
                }
            }
            if (accepted.length > 0) {
                state.value = props.multiple ? [...state.value, ...accepted] : [accepted[0]!];
            }
            if (rejected.length > 0) emit('filesReject', rejected);
        },
        removeFile(file) {
            if (fc.disabled()) return;
            // The model's files come back through the reactive store: match by
            // identity first, then by key (a proxied read is never `===` raw).
            const key = fileKey(file);
            const next = state.value.filter((f) => f !== file && fileKey(f) !== key);
            if (next.length !== state.value.length) state.value = next;
        },
        clear() {
            if (fc.disabled() || state.value.length === 0) return;
            state.value = [];
        },
        openPicker() {
            const pick = props.pick;
            if (fc.disabled() || !pick || picking) return;
            picking = true;
            const request: FileUploadPickRequest = {
                accept: props.accept,
                multiple: !!props.multiple,
                types: acceptMimeTypes(props.accept),
            };
            const done = (files: readonly FileUploadFile[] | null | undefined): void => {
                picking = false;
                if (files && files.length > 0) ctx.addFiles(files);
            };
            const fail = (error: unknown): void => {
                picking = false;
                emit('pickError', error);
            };
            try {
                const out = pick(request);
                if (out && typeof (out as Promise<unknown>).then === 'function') {
                    (out as Promise<readonly FileUploadFile[] | null | undefined>).then(done, fail);
                } else {
                    done(out as readonly FileUploadFile[] | null | undefined);
                }
            } catch (error) {
                fail(error);
            }
        },
        disabled: fc.disabled,
        invalid: fc.invalid,
        required: fc.required,
    };
    defineProvide(useFileUploadContext, () => ctx);
    // A tap on the enclosing Field's label opens the picker (the web label's
    // activation of the trigger it points at).
    fc.reportValidity({ element: () => null, value: () => state.value, focus: () => ctx.openPicker() }, onUnmounted);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: fc.disabled(), invalid: fc.invalid(), required: fc.required(), highlighted: false },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'FileUpload.Root' });

// ── Label ──

type TextPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

export type FileUploadLabelProps = TextPartProps;

const FileUploadLabel = component<FileUploadLabelProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    return () => (
        <text
            {...partBag(anatomy, 'label', {
                flags: { disabled: upload.disabled(), invalid: upload.invalid(), required: upload.required() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...{ bindtap: () => upload.openPicker() }}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'FileUpload.Label' });

// ── Trigger / ClearTrigger / ItemRemove — the three buttons ──

type ButtonPartProps =
    /** Accessible name; defaults to the part's own (see each). */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

export type FileUploadTriggerProps = ButtonPartProps;

/** Opens the picker. */
const FileUploadTrigger = component<FileUploadTriggerProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ isDisabled: () => upload.disabled(), feel: props.pressFeel !== false });
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                flags: { disabled: upload.disabled(), invalid: upload.invalid(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, disabled: upload.disabled() })}
            bindtap={() => upload.openPicker()}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'FileUpload.Trigger' });

export type FileUploadClearTriggerProps = ButtonPartProps;

/** Empties the model. Renders nothing while there is nothing to clear. */
const FileUploadClearTrigger = component<FileUploadClearTriggerProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ isDisabled: () => upload.disabled(), feel: props.pressFeel !== false });
    return () => {
        if (upload.state.value.length === 0) return null;
        return (
            <view
                {...partBag(anatomy, 'clear-trigger', {
                    flags: { disabled: upload.disabled(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label ?? 'Clear files', disabled: upload.disabled() })}
                bindtap={() => upload.clear()}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'FileUpload.ClearTrigger' });

// ── Dropzone ──

export type FileUploadDropzoneProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/**
 * A big tap target for the picker. On the web it is also the drop target;
 * lynx has nothing to drop, so `highlighted` is never driven here.
 */
const FileUploadDropzone = component<FileUploadDropzoneProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'dropzone', {
                flags: { disabled: upload.disabled(), highlighted: false },
                ...partAxes(axes()),
                class: props.class,
            })}
            bindtap={() => upload.openPicker()}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'FileUpload.Dropzone' });

// ── ItemGroup ──

export type FileUploadItemGroupProps = Define.Prop<'class', string, false> & Define.Slot<'default', FileUploadFile[]>;

const FileUploadItemGroup = component<FileUploadItemGroupProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    return () => {
        // A function child arrives uncalled from the slot accessor — call it
        // with the live list (zero's rule).
        const files = upload.state.value;
        const out: unknown = slots.default?.(files);
        const items: unknown[] = out == null ? [] : (Array.isArray(out) ? out : [out]);
        const rendered = items.map((item) =>
            typeof item === 'function' ? (item as (f: FileUploadFile[]) => unknown)(files) : item);
        return (
            <view {...partBag(anatomy, 'item-group', { ...partAxes(axes()), class: props.class })}>
                {rendered as JSXElement[]}
            </view>
        );
    };
}, { name: 'FileUpload.ItemGroup' });

// ── Item ──

interface FileUploadItemContext {
    file(): FileUploadFile;
}

const useFileUploadItemContext = defineInjectable<FileUploadItemContext>(() => ({
    file: () => ({ name: 'unknown', size: 0 }),
}));

export type FileUploadItemProps =
    & Define.Prop<'file', FileUploadFile>
    /** Stamps `invalid` — for an app rendering a REJECTED file through Item. */
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const FileUploadItem = component<FileUploadItemProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const axes = useVariantAxes();
    defineProvide(useFileUploadItemContext, () => ({ file: () => props.file }));
    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: { disabled: upload.disabled(), invalid: !!props.invalid },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'FileUpload.Item' });

export type FileUploadItemTextProps = TextPartProps;

function itemText(part: 'item-name' | 'item-size', name: string, fallback: (file: FileUploadFile) => string) {
    return component<FileUploadItemTextProps>(({ props, slots }) => {
        const item = useFileUploadItemContext();
        const axes = useVariantAxes();
        return () => {
            const own = slots.default?.() as unknown;
            const empty = own == null || (Array.isArray(own) && own.length === 0);
            return (
                <text
                    {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}
                    // One line: a long name ellipsizes instead of pushing the size and × off the row.
                    {...{ 'text-maxline': '1' }}
                >
                    {empty ? fallback(item.file()) : own as JSXElement}
                </text>
            );
        };
    }, { name });
}

const FileUploadItemName = itemText('item-name', 'FileUpload.ItemName', (f) => f.name);
const FileUploadItemSize = itemText('item-size', 'FileUpload.ItemSize', (f) => formatBytes(f.size));

export type FileUploadItemRemoveProps = ButtonPartProps;

/** Removes its file. Named "Remove <filename>"; with no children it draws `×`. */
const FileUploadItemRemove = component<FileUploadItemRemoveProps>(({ props, slots }) => {
    const upload = useFileUploadContext();
    const item = useFileUploadItemContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ isDisabled: () => upload.disabled(), feel: props.pressFeel !== false });
    return () => (
        <view
            {...partBag(anatomy, 'item-remove', {
                flags: { disabled: upload.disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({
                trait: 'button',
                label: props.label ?? `Remove ${item.file().name}`,
                disabled: upload.disabled(),
            })}
            bindtap={() => upload.removeFile(item.file())}
            {...press.handlers}
        >
            {(slots.default?.() as JSXElement | undefined) ?? <text>×</text>}
        </view>
    );
}, { name: 'FileUpload.ItemRemove' });

export const FileUpload = compound(FileUploadRoot, {
    Root: FileUploadRoot,
    Label: FileUploadLabel,
    Trigger: FileUploadTrigger,
    ClearTrigger: FileUploadClearTrigger,
    Dropzone: FileUploadDropzone,
    ItemGroup: FileUploadItemGroup,
    Item: FileUploadItem,
    ItemName: FileUploadItemName,
    ItemSize: FileUploadItemSize,
    ItemRemove: FileUploadItemRemove,
});
