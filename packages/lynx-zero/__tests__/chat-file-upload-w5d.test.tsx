/**
 * Wave 5 (W5D #1276, epic #1140): FileUpload, Chat and ChatLog. Every state
 * the tests drive is held to BOTH oracles (anatomy + class grammar).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { signal } from '@sigx/lynx';
import { Chat, ChatLog, Field, FileUpload, registerAxisDefaults } from '../src/index';
import type { FileRejection, FileUploadFile, FileUploadPickRequest } from '../src/index';
import { acceptMimeTypes, acceptsFile, chatLogEndOffset, fileErrors, formatBytes } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { CHAT_LOG_SETTLE_DELAY, CHAT_LOG_SETTLE_TRIES } from '../src/components/chat-log/ChatLog';
import { sameAvatarBox } from '../src/components/chat/Chat';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: unknown, scope: keyof typeof anatomies): void => {
    expectAnatomy(container as never, anatomies[scope]);
    expectClassGrammar(container as never, anatomies[scope]);
};

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, scope: string, part: string): TestNode | null => allParts(root, scope, part)[0] ?? null;
const byTag = (root: TestNode, tag: string): TestNode | null => {
    if (root.type === tag) return root;
    for (const child of root.children) {
        const hit = byTag(child, tag);
        if (hit) return hit;
    }
    return null;
};

const tap = async (node: TestNode): Promise<void> => {
    await act(() => fireEvent.tap(node as never));
};
const fire = async (node: TestNode, handler: string, event: unknown): Promise<void> => {
    await act(() => node._handlers.get(handler)?.(event));
};
const flush = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const wait = async (ms: number): Promise<void> => {
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

const PNG: FileUploadFile = { name: 'photo.png', size: 1536, mimeType: 'image/png', uri: 'file:///a/photo.png' };
const PDF: FileUploadFile = { name: 'report.pdf', size: 2_400_000, mimeType: 'application/pdf', uri: 'file:///a/report.pdf' };
const TXT: FileUploadFile = { name: 'notes.txt', size: 12, mimeType: 'text/plain', uri: 'file:///a/notes.txt' };

afterEach(() => {
    clearAxisDefaults();
});

// ── FileUpload ──────────────────────────────────────────────────────────

describe('FileUpload helpers', () => {
    it('acceptsFile: extensions, exact MIME types and families; no accept takes all', () => {
        expect(acceptsFile(undefined, TXT)).toBe(true);
        expect(acceptsFile('image/*', PNG)).toBe(true);
        expect(acceptsFile('image/*', PDF)).toBe(false);
        expect(acceptsFile('.pdf, .txt', TXT)).toBe(true);
        expect(acceptsFile('application/pdf', PDF)).toBe(true);
        // The web File spelling (`type`) is read when mimeType is absent.
        expect(acceptsFile('image/png', { name: 'x', size: 1, type: 'image/png' })).toBe(true);
    });

    it('acceptMimeTypes keeps the MIME entries a native picker filters by', () => {
        expect(acceptMimeTypes('image/*, .pdf,application/pdf')).toEqual(['image/*', 'application/pdf']);
        expect(acceptMimeTypes('.txt')).toEqual([]);
        expect(acceptMimeTypes(undefined)).toEqual([]);
    });

    it('formatBytes and fileErrors follow zero', () => {
        expect(formatBytes(999)).toBe('999 B');
        expect(formatBytes(1536)).toBe('1.5 kB');
        expect(formatBytes(2_400_000)).toBe('2.4 MB');
        expect(formatBytes(24_000_000)).toBe('24 MB');
        expect(fileErrors(PDF, { accept: 'image/*', maxFileSize: 1000, validate: () => 'nope' }))
            .toEqual(['invalid-type', 'too-large', 'nope']);
        expect(fileErrors(TXT, { minFileSize: 100 })).toEqual(['too-small']);
    });
});

function Upload(p: {
    pick?: (r: FileUploadPickRequest) => unknown;
    multiple?: boolean;
    accept?: string;
    maxFiles?: number;
    maxFileSize?: number;
    disabled?: boolean;
    invalid?: boolean;
    defaultFiles?: FileUploadFile[];
    onFilesChange?: (f: FileUploadFile[]) => void;
    onFilesReject?: (r: FileRejection[]) => void;
    onPickError?: (e: unknown) => void;
    color?: string;
    size?: string;
}) {
    return (
        <FileUpload.Root
            pick={p.pick as never}
            multiple={p.multiple}
            accept={p.accept}
            maxFiles={p.maxFiles}
            maxFileSize={p.maxFileSize}
            disabled={p.disabled}
            invalid={p.invalid}
            defaultFiles={p.defaultFiles}
            onFilesChange={p.onFilesChange}
            onFilesReject={p.onFilesReject}
            onPickError={p.onPickError}
            color={p.color}
            size={p.size}
        >
            <FileUpload.Label>Attachments</FileUpload.Label>
            <FileUpload.Dropzone><text>Tap to add</text></FileUpload.Dropzone>
            <FileUpload.Trigger><text>Browse</text></FileUpload.Trigger>
            <FileUpload.ItemGroup>
                {(files: FileUploadFile[]) => files.map((f) => (
                    <FileUpload.Item key={f.uri ?? f.name} file={f}>
                        <FileUpload.ItemName />
                        <FileUpload.ItemSize />
                        <FileUpload.ItemRemove />
                    </FileUpload.Item>
                ))}
            </FileUpload.ItemGroup>
            <FileUpload.ClearTrigger><text>Clear</text></FileUpload.ClearTrigger>
        </FileUpload.Root>
    );
}

const names = (container: TestNode): string[] =>
    allParts(container, 'file-upload', 'item-name').map((n) => n.textContent());

describe('FileUpload', () => {
    it('renders the parts; no input part; clear hidden while empty', () => {
        const { container } = render(<Upload />);
        const root = byPart(container, 'file-upload', 'root')!;
        expect(root._class).toContain('zx-file-upload__root');
        expect(byPart(container, 'file-upload', 'input')).toBeNull();
        expect(byPart(container, 'file-upload', 'clear-trigger')).toBeNull();
        const trigger = byPart(container, 'file-upload', 'trigger')!;
        expect(trigger.props['accessibility-trait']).toBe('button');
        expect(allParts(container, 'file-upload', 'item')).toHaveLength(0);
        conforms(container, 'file-upload');
    });

    it('the trigger calls pick with accept/multiple/types; picked files join the model', async () => {
        const requests: FileUploadPickRequest[] = [];
        const changes: FileUploadFile[][] = [];
        const { container } = render(
            <Upload
                multiple
                accept="image/*,.pdf,application/pdf"
                pick={async (r) => { requests.push(r); return [PNG, PDF]; }}
                onFilesChange={(f) => changes.push(f)}
            />,
        );
        await tap(byPart(container, 'file-upload', 'trigger')!);
        await flush();
        expect(requests).toEqual([{ accept: 'image/*,.pdf,application/pdf', multiple: true, types: ['image/*', 'application/pdf'] }]);
        expect(changes).toHaveLength(1);
        expect(names(container)).toEqual(['photo.png', 'report.pdf']);
        expect(allParts(container, 'file-upload', 'item-size').map((n) => n.textContent())).toEqual(['1.5 kB', '2.4 MB']);
        const remove = byPart(container, 'file-upload', 'item-remove')!;
        expect(remove.props['accessibility-label']).toBe('Remove photo.png');
        expect(remove.textContent()).toBe('×');
        expect(byPart(container, 'file-upload', 'clear-trigger')!.props['accessibility-label']).toBe('Clear files');
        conforms(container, 'file-upload');
    });

    it('multiple appends and dedupes; single replaces', async () => {
        let next: FileUploadFile[] = [PNG];
        const { container } = render(<Upload multiple pick={() => next} />);
        const trigger = byPart(container, 'file-upload', 'trigger')!;
        await tap(trigger);
        next = [PNG, TXT];
        await tap(trigger);
        expect(names(container)).toEqual(['photo.png', 'notes.txt']);

        const single = render(<Upload pick={() => next} />);
        const t2 = byPart(single.container, 'file-upload', 'trigger')!;
        await tap(t2);
        expect(names(single.container)).toEqual(['photo.png']);
        next = [TXT];
        await tap(t2);
        expect(names(single.container)).toEqual(['notes.txt']);
    });

    it('constraints reject once per pick through filesReject; accepted files still join', async () => {
        const rejects: FileRejection[][] = [];
        const { container } = render(
            <Upload
                multiple
                accept="image/*,text/plain"
                maxFiles={1}
                maxFileSize={2000}
                pick={() => [PNG, PDF, TXT]}
                onFilesReject={(r) => rejects.push(r)}
            />,
        );
        await tap(byPart(container, 'file-upload', 'trigger')!);
        expect(names(container)).toEqual(['photo.png']);
        expect(rejects).toHaveLength(1);
        expect(rejects[0]!.map((r) => [r.file.name, r.errors])).toEqual([
            ['report.pdf', ['invalid-type', 'too-large']],
            ['notes.txt', ['too-many']],
        ]);
    });

    it('item remove and clear empty the model; the dropzone and label open the picker', async () => {
        const pick = vi.fn(() => [PNG, TXT]);
        const { container } = render(<Upload multiple pick={pick} />);
        await tap(byPart(container, 'file-upload', 'dropzone')!);
        expect(pick).toHaveBeenCalledTimes(1);
        expect(names(container)).toEqual(['photo.png', 'notes.txt']);
        await tap(allParts(container, 'file-upload', 'item-remove')[0]!);
        expect(names(container)).toEqual(['notes.txt']);
        await tap(byPart(container, 'file-upload', 'clear-trigger')!);
        expect(names(container)).toEqual([]);
        expect(byPart(container, 'file-upload', 'clear-trigger')).toBeNull();
        await tap(byPart(container, 'file-upload', 'label')!);
        expect(pick).toHaveBeenCalledTimes(2);
        conforms(container, 'file-upload');
    });

    it('one pick at a time; a failing pick reports pickError', async () => {
        let resolve!: (f: FileUploadFile[]) => void;
        const pick = vi.fn(() => new Promise<FileUploadFile[]>((r) => { resolve = r; }));
        const { container } = render(<Upload pick={pick} />);
        const trigger = byPart(container, 'file-upload', 'trigger')!;
        await tap(trigger);
        await tap(trigger);
        expect(pick).toHaveBeenCalledTimes(1);
        resolve([PNG]);
        await flush();
        expect(names(container)).toEqual(['photo.png']);

        const errors: unknown[] = [];
        const failing = render(<Upload pick={() => { throw new Error('denied'); }} onPickError={(e) => errors.push(e)} />);
        await tap(byPart(failing.container, 'file-upload', 'trigger')!);
        expect((errors[0] as Error).message).toBe('denied');
    });

    it('disabled: every part flags it, taps do nothing, the reader hears it', async () => {
        const pick = vi.fn(() => [PNG]);
        const { container } = render(<Upload disabled pick={pick} defaultFiles={[TXT]} />);
        for (const part of ['root', 'label', 'trigger', 'clear-trigger', 'dropzone', 'item', 'item-remove']) {
            const node = byPart(container, 'file-upload', part)!;
            expect(node.props['data-disabled'], part).toBe('');
            expect(node._class, part).toContain('zx-f-disabled');
        }
        expect(byPart(container, 'file-upload', 'trigger')!.props['accessibility-status']).toBe('disabled');
        await tap(byPart(container, 'file-upload', 'trigger')!);
        await tap(byPart(container, 'file-upload', 'item-remove')!);
        await tap(byPart(container, 'file-upload', 'clear-trigger')!);
        expect(pick).not.toHaveBeenCalled();
        expect(names(container)).toEqual(['notes.txt']);
        conforms(container, 'file-upload');
    });

    it('adopts the Field: disabled/invalid/required, and the field label opens the picker', async () => {
        const pick = vi.fn(() => [PNG]);
        const { container } = render(
            <Field.Root invalid required>
                <Field.Label>Files</Field.Label>
                <Upload pick={pick} />
            </Field.Root>,
        );
        const root = byPart(container, 'file-upload', 'root')!;
        expect(root._class).toContain('zx-f-invalid');
        expect(root._class).toContain('zx-f-required');
        expect(byPart(container, 'file-upload', 'trigger')!._class).toContain('zx-f-invalid');
        expect(byPart(container, 'file-upload', 'label')!._class).toContain('zx-f-required');
        await tap(byPart(container, 'field', 'label')!);
        expect(pick).toHaveBeenCalledTimes(1);
        conforms(container, 'file-upload');
    });

    it('an Item rendering a rejected file stamps invalid; axes reach every part', () => {
        registerAxisDefaults({ 'file-upload': { size: 'md', color: 'primary' } });
        const { container } = render(
            <FileUpload.Root size="lg" color="secondary">
                <FileUpload.ItemGroup>
                    <FileUpload.Item file={PDF} invalid>
                        <FileUpload.ItemName />
                        <FileUpload.ItemSize>too big</FileUpload.ItemSize>
                    </FileUpload.Item>
                </FileUpload.ItemGroup>
            </FileUpload.Root>,
        );
        const item = byPart(container, 'file-upload', 'item')!;
        expect(item._class).toContain('zx-f-invalid');
        expect(byPart(container, 'file-upload', 'item-size')!.textContent()).toBe('too big');
        for (const part of ['root', 'item-group', 'item', 'item-name']) {
            const cls = byPart(container, 'file-upload', part)!._class;
            expect(cls, part).toContain('zx-a-size-lg');
            expect(cls, part).toContain('zx-a-color-secondary');
        }
        conforms(container, 'file-upload');
    });

    it('ForceStates reaches pressed, focus-visible and highlighted', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true, highlighted: true }}>
                <Upload defaultFiles={[PNG]} />
            </ForceStates>,
        );
        for (const part of ['trigger', 'clear-trigger', 'item-remove']) {
            const cls = byPart(container, 'file-upload', part)!._class;
            expect(cls, part).toContain('zx-f-pressed');
            expect(cls, part).toContain('zx-f-focus-visible');
        }
        expect(byPart(container, 'file-upload', 'root')!._class).toContain('zx-f-highlighted');
        expect(byPart(container, 'file-upload', 'dropzone')!._class).toContain('zx-f-highlighted');
        conforms(container, 'file-upload');
    });

    it('a touch presses the trigger (tier 1 in tests)', async () => {
        const { container } = render(<Upload />);
        const trigger = byPart(container, 'file-upload', 'trigger')!;
        await act(() => fireEvent.touchStart(trigger as never));
        expect(byPart(container, 'file-upload', 'trigger')!._class).toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(trigger as never));
        expect(byPart(container, 'file-upload', 'trigger')!._class).not.toContain('zx-f-pressed');
    });

    it('a controlled model drives the list', async () => {
        const st = signal({ files: [PNG] as FileUploadFile[] });
        const { container } = render(
            <FileUpload.Root model={() => st.files} multiple pick={() => [TXT]}>
                <FileUpload.Trigger><text>Browse</text></FileUpload.Trigger>
                <FileUpload.ItemGroup>
                    {(files: FileUploadFile[]) => files.map((f) => (
                        <FileUpload.Item key={f.name} file={f}><FileUpload.ItemName /></FileUpload.Item>
                    ))}
                </FileUpload.ItemGroup>
            </FileUpload.Root>,
        );
        expect(names(container)).toEqual(['photo.png']);
        await tap(byPart(container, 'file-upload', 'trigger')!);
        expect(st.files.map((f) => f.name)).toEqual(['photo.png', 'notes.txt']);
        expect(names(container)).toEqual(['photo.png', 'notes.txt']);
    });
});

// ── Chat ────────────────────────────────────────────────────────────────

describe('Chat', () => {
    it('stamps placement on the root only; strings in parts become <text>', () => {
        const { container } = render(
            <view>
                <Chat.Root>
                    <Chat.Header>Ada · 12:45</Chat.Header>
                    <Chat.Bubble>Hello</Chat.Bubble>
                    <Chat.Footer>Seen</Chat.Footer>
                </Chat.Root>
                <Chat.Root placement="end" color="primary">
                    <Chat.Bubble>Hi</Chat.Bubble>
                </Chat.Root>
            </view>,
        );
        const [start, end] = allParts(container, 'chat', 'root');
        expect(start!.props['data-placement']).toBe('start');
        expect(start!._class).toContain('zx-p-start');
        expect(end!.props['data-placement']).toBe('end');
        expect(end!._class).toContain('zx-p-end');
        const bubbles = allParts(container, 'chat', 'bubble');
        expect(bubbles[0]!.props['data-placement']).toBeUndefined();
        expect(bubbles[0]!.children[0]!.type).toBe('text');
        expect(bubbles[0]!.textContent()).toBe('Hello');
        // The colour rides the row and is pushed down to the bubble.
        expect(bubbles[1]!._class).toContain('zx-a-color-primary');
        expect(byPart(container, 'chat', 'header')!.textContent()).toBe('Ada · 12:45');
        conforms(container, 'chat');
    });

    it('reserves the measured avatar on the placement side', async () => {
        const { container } = render(
            <view>
                <Chat.Root>
                    <Chat.Avatar><view /></Chat.Avatar>
                    <Chat.Bubble>Hello</Chat.Bubble>
                </Chat.Root>
                <Chat.Root placement="end" avatarGap={4}>
                    <Chat.Avatar><view /></Chat.Avatar>
                    <Chat.Bubble>Hi</Chat.Bubble>
                </Chat.Root>
            </view>,
        );
        const [a, b] = allParts(container, 'chat', 'avatar');
        expect(a!.props['style']).toMatchObject({ position: 'absolute', bottom: '0px', left: '0px' });
        expect(b!.props['style']).toMatchObject({ position: 'absolute', bottom: '0px', right: '0px' });
        await fire(a!, 'bindlayoutchange', { detail: { width: 40, height: 40, top: 0, left: 0 } });
        await fire(b!, 'bindlayoutchange', { params: { width: 32, height: 32, top: 0, left: 0, right: 0, bottom: 0 } });
        const [ra, rb] = allParts(container, 'chat', 'root');
        expect(ra!.props['style']).toMatchObject({ paddingLeft: '48px', minHeight: '40px' });
        expect(rb!.props['style']).toMatchObject({ paddingRight: '36px', minHeight: '32px' });
        conforms(container, 'chat');
    });

    it('sub-pixel avatar re-measures never re-reserve: bounded under iOS layout snapping (#1295)', async () => {
        const { container } = render(
            <Chat.Root>
                <Chat.Avatar><view /></Chat.Avatar>
                <Chat.Bubble>Hello</Chat.Bubble>
            </Chat.Root>,
        );
        const avatar = byPart(container, 'chat', 'avatar')!;
        const root = (): TestNode => byPart(container, 'chat', 'root')!;
        await fire(avatar, 'bindlayoutchange', { detail: { width: 40, height: 40, top: 0, left: 0 } });
        const reserved = JSON.stringify(root().props['style']);
        expect(root().props['style']).toMatchObject({ paddingLeft: '48px', minHeight: '40px' });
        // The device loop: the reservation shifts the avatar a third of a
        // point, and its height snaps back and forth. 100 such events must
        // leave the reservation (and so the render) untouched.
        let changes = 0;
        for (let i = 0; i < 100; i++) {
            await fire(avatar, 'bindlayoutchange', { detail: { width: 40, height: i % 2 ? 40 : 40.333333333333336, top: 0, left: 0 } });
            if (JSON.stringify(root().props['style']) !== reserved) changes++;
        }
        expect(changes).toBe(0);
        // A real change still lands, in whole pixels.
        await fire(avatar, 'bindlayoutchange', { detail: { width: 47.5, height: 47.5, top: 0, left: 0 } });
        expect(root().props['style']).toMatchObject({ paddingLeft: '56px', minHeight: '48px' });
    });

    it('sameAvatarBox: within a pixel is the same box', () => {
        expect(sameAvatarBox(null, null)).toBe(true);
        expect(sameAvatarBox({ width: 40, height: 40 }, null)).toBe(false);
        expect(sameAvatarBox({ width: 40, height: 40 }, { width: 40.34, height: 39.67 })).toBe(true);
        expect(sameAvatarBox({ width: 40, height: 40 }, { width: 41.5, height: 40 })).toBe(false);
    });

    it('size pushes down to every part', () => {
        const { container } = render(
            <Chat.Root size="xl">
                <Chat.Bubble>Big</Chat.Bubble>
            </Chat.Root>,
        );
        expect(byPart(container, 'chat', 'bubble')!._class).toContain('zx-a-size-xl');
        conforms(container, 'chat');
    });
});

// ── ChatLog ─────────────────────────────────────────────────────────────

interface Probe {
    container: TestNode;
    scroller: TestNode;
    content: () => TestNode;
    calls: Array<[string, unknown]>;
}

function mountLog(opts: { rows?: number; onFollowingChange?: (v: boolean) => void } = {}): Probe & { st: { rows: number } } {
    const st = signal({ rows: opts.rows ?? 3 });
    const calls: Array<[string, unknown]> = [];
    const { container } = render(
        <ChatLog.Root
            label="Thread"
            onFollowingChange={opts.onFollowingChange}
        >
            <ChatLog.Content>
                {Array.from({ length: st.rows }, (_, i) => (
                    <Chat.Root key={i} placement={i % 2 ? 'end' : 'start'}>
                        <Chat.Bubble>{`m${i}`}</Chat.Bubble>
                    </Chat.Root>
                ))}
            </ChatLog.Content>
            <ChatLog.JumpTrigger />
        </ChatLog.Root>,
    );
    const scroller = byTag(container, 'scroll-view')!;
    // The native UI method seam: an element with its own `invoke`.
    (scroller as unknown as { invoke: (m: string, p: unknown) => void }).invoke = (m, p) => { calls.push([m, p]); };
    return { container, scroller, content: () => byPart(container, 'chat-log', 'content')!, calls, st };
}

describe('ChatLog', () => {
    it('chatLogEndOffset clamps at zero', () => {
        expect(chatLogEndOffset(900, 300)).toBe(600);
        expect(chatLogEndOffset(100, 300)).toBe(0);
    });

    it('renders the frame, a native scroller with the content inside, and no trigger while following', () => {
        const { container, scroller } = mountLog();
        const root = byPart(container, 'chat-log', 'root')!;
        expect(root._class).toContain('zx-chat-log__root');
        expect(scroller.props['scroll-y']).toBe(true);
        expect(scroller.props['accessibility-label']).toBe('Thread');
        expect(byPart(scroller, 'chat-log', 'content')).not.toBeNull();
        expect(byPart(container, 'chat-log', 'jump-trigger')).toBeNull();
        conforms(container, 'chat-log');
        conforms(container, 'chat');
    });

    it('follows the tail: a content height change scrolls to the end, with a bounded settle', async () => {
        const { scroller, content, calls, st } = mountLog();
        await fire(scroller, 'bindlayoutchange', { detail: { width: 300, height: 200, top: 0, left: 0 } });
        await fire(content(), 'bindlayoutchange', { detail: { width: 300, height: 500, top: 0, left: 0 } });
        expect(calls.at(-1)).toEqual(['scrollTo', { offset: 300, smooth: false }]);
        // Native never reports the scroll: the settle loop re-issues, then stops.
        const before = calls.length;
        // Generous: the chain is TRIES timers of SETTLE_DELAY, and a loaded runner stretches each.
        await wait(1000);
        expect(calls.length - before).toBe(CHAT_LOG_SETTLE_TRIES);
        // A row lands: the content grows and the log pins again.
        st.rows = 4;
        await flush();
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 300, deltaY: 300 } });
        const n = calls.length;
        await fire(content(), 'bindlayoutchange', { detail: { width: 300, height: 560, top: 0, left: 0 } });
        expect(calls.length).toBe(n + 1);
        expect(calls.at(-1)).toEqual(['scrollTo', { offset: 360, smooth: false }]);
        // Already at the end: nothing to do.
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 360, deltaY: 60 } });
        await wait(CHAT_LOG_SETTLE_DELAY * 2);
        expect(calls.length).toBe(n + 1);
    });

    it('scrolling up lets go and shows the jump trigger; the trigger follows again', async () => {
        const changes: boolean[] = [];
        const { container, scroller, content, calls } = mountLog({ onFollowingChange: (v) => changes.push(v) });
        await fire(scroller, 'bindlayoutchange', { detail: { width: 300, height: 200, top: 0, left: 0 } });
        await fire(content(), 'bindlayoutchange', { detail: { width: 300, height: 800, top: 0, left: 0 } });
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 600, deltaY: 600 } });
        // A small drag up, inside the threshold, keeps following.
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 590, deltaY: -10 } });
        expect(changes).toEqual([]);
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 400, deltaY: -190 } });
        expect(changes).toEqual([false]);
        const trigger = byPart(container, 'chat-log', 'jump-trigger')!;
        expect(trigger.props['data-state']).toBe('open');
        expect(trigger._class).toContain('zx-s-open');
        expect(trigger.props['accessibility-label']).toBe('Jump to latest');
        expect(trigger.textContent()).toBe('Jump to latest');
        conforms(container, 'chat-log');
        // Content growing while the reader is up does not yank them down.
        const n = calls.length;
        await fire(content(), 'bindlayoutchange', { detail: { width: 300, height: 900, top: 0, left: 0 } });
        expect(calls.length).toBe(n);
        await tap(trigger);
        expect(changes).toEqual([false, true]);
        expect(calls.at(-1)).toEqual(['scrollTo', { offset: 700, smooth: false }]);
        expect(byPart(container, 'chat-log', 'jump-trigger')).toBeNull();
        conforms(container, 'chat-log');
    });

    it('model:following — the app writing true jumps to the end', async () => {
        const st = signal({ following: false });
        const calls: Array<[string, unknown]> = [];
        const { container } = render(
            <ChatLog.Root model:following={() => st.following}>
                <ChatLog.Content><Chat.Root><Chat.Bubble>x</Chat.Bubble></Chat.Root></ChatLog.Content>
                <ChatLog.JumpTrigger />
            </ChatLog.Root>,
        );
        const scroller = byTag(container, 'scroll-view')!;
        (scroller as unknown as { invoke: (m: string, p: unknown) => void }).invoke = (m, p) => { calls.push([m, p]); };
        await fire(scroller, 'bindlayoutchange', { detail: { width: 300, height: 100, top: 0, left: 0 } });
        await fire(byPart(container, 'chat-log', 'content')!, 'bindlayoutchange', { detail: { width: 300, height: 400, top: 0, left: 0 } });
        expect(calls).toEqual([]);
        expect(byPart(container, 'chat-log', 'jump-trigger')).not.toBeNull();
        st.following = true;
        await flush();
        expect(calls.at(-1)).toEqual(['scrollTo', { offset: 300, smooth: false }]);
        expect(byPart(container, 'chat-log', 'jump-trigger')).toBeNull();
    });

    it('scrolling back to the end follows again', async () => {
        const changes: boolean[] = [];
        const { scroller, content } = mountLog({ onFollowingChange: (v) => changes.push(v) });
        await fire(scroller, 'bindlayoutchange', { detail: { width: 300, height: 200, top: 0, left: 0 } });
        await fire(content(), 'bindlayoutchange', { detail: { width: 300, height: 800, top: 0, left: 0 } });
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 100, deltaY: -500 } });
        await fire(scroller, 'bindscroll', { detail: { scrollTop: 590, deltaY: 490 } });
        expect(changes).toEqual([false, true]);
    });

    it('a controlled following=false shows the trigger; axes and forced flags reach the parts', () => {
        registerAxisDefaults({ 'chat-log': { size: 'md', color: 'primary' } });
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <ChatLog.Root defaultFollowing={false} color="accent" size="sm">
                    <ChatLog.Content><Chat.Root><Chat.Bubble>x</Chat.Bubble></Chat.Root></ChatLog.Content>
                    <ChatLog.JumpTrigger label="New messages" />
                </ChatLog.Root>
            </ForceStates>,
        );
        const trigger = byPart(container, 'chat-log', 'jump-trigger')!;
        expect(trigger._class).toContain('zx-f-pressed');
        expect(trigger._class).toContain('zx-f-focus-visible');
        expect(trigger._class).toContain('zx-a-color-accent');
        expect(trigger._class).toContain('zx-a-size-sm');
        expect(trigger.textContent()).toBe('New messages');
        expect(trigger.props['style']).toMatchObject({ pointerEvents: 'auto' });
        expect(byPart(container, 'chat-log', 'root')!._class).toContain('zx-f-focus-visible');
        expect(byPart(container, 'chat-log', 'content')!._class).toContain('zx-a-size-sm');
        conforms(container, 'chat-log');
    });
});
