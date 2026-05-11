/**
 * Terminal QR code generator.
 *
 * Generates a QR code using Unicode block characters for display
 * in the terminal. Zero dependencies — implements QR encoding inline
 * for the simple case of short URLs (alphanumeric mode, version 1-6).
 *
 * For simplicity, we use a minimal approach: encode the URL data into
 * a 2D boolean matrix and render with Unicode half-block characters.
 */

// QR code encoding constants
const MODE_BYTE = 0b0100;
const EC_LEVEL_L = 0; // ~7% error correction (sufficient for URLs on clean channel)

// Version capacities for byte mode, EC level L
const VERSION_CAPACITIES: number[] = [
    0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
    321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
];

// Error correction codewords per block for each version (EC level L)
const EC_CODEWORDS_PER_BLOCK: number[] = [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
    20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
];

// Number of EC blocks for each version (EC level L). Source: ISO/IEC 18004
// Table 9. Previously the V10–V20 counts were truncated to 4, which produced
// codes that visually parsed but didn't decode in commercial scanners.
const NUM_EC_BLOCKS: number[] = [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,
    4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
];

// Total codewords per version (data + EC). Fixed by the QR spec — the
// previous "size² minus function modules / 8" formula was off by a few
// codewords per version, which threw off data placement so ML Kit /
// commercial scanners couldn't decode the result. Source: ISO/IEC 18004
// Table 1. Length must match VERSION_CAPACITIES.length (21).
const TOTAL_CODEWORDS: number[] = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
    404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
];

// Alignment pattern positions for each version
const ALIGNMENT_PATTERNS: number[][] = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

// Format info bits for EC level L, masks 0-7
const FORMAT_INFO: number[] = [
    0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

// Version info bits for versions 7+
const VERSION_INFO: number[] = [
    0, 0, 0, 0, 0, 0, 0,
    0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847,
    0x0e60d, 0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6,
];

class BitBuffer {
    private buffer: number[] = [];
    private length = 0;

    put(num: number, bitLength: number) {
        for (let i = bitLength - 1; i >= 0; i--) {
            this.buffer.push((num >> i) & 1);
            this.length++;
        }
    }

    getBit(index: number): number {
        return this.buffer[index];
    }

    getLength(): number {
        return this.length;
    }

    getBuffer(): number[] {
        return this.buffer;
    }
}

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x = x << 1;
        if (x >= 256) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();

function gfMultiply(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsEncode(data: number[], ecCount: number): number[] {
    // Build generator polynomial
    const gen = new Uint8Array(ecCount + 1);
    gen[0] = 1;
    for (let i = 0; i < ecCount; i++) {
        for (let j = ecCount; j >= 1; j--) {
            gen[j] = gen[j] ^ gfMultiply(gen[j - 1], GF_EXP[i]);
        }
    }

    const msg = new Uint8Array(data.length + ecCount);
    for (let i = 0; i < data.length; i++) msg[i] = data[i];

    for (let i = 0; i < data.length; i++) {
        const coef = msg[i];
        if (coef !== 0) {
            for (let j = 1; j <= ecCount; j++) {
                msg[i + j] ^= gfMultiply(gen[j], coef);
            }
        }
    }

    return Array.from(msg.slice(data.length));
}

function getVersion(dataLength: number): number {
    for (let v = 1; v <= 20; v++) {
        if (VERSION_CAPACITIES[v] >= dataLength) return v;
    }
    throw new Error('Data too long for QR code (max ~850 bytes)');
}

function getSize(version: number): number {
    return 17 + version * 4;
}

function createMatrix(size: number): (boolean | null)[][] {
    return Array.from({ length: size }, () => Array(size).fill(null));
}

function setModule(matrix: (boolean | null)[][], row: number, col: number, value: boolean) {
    if (row >= 0 && row < matrix.length && col >= 0 && col < matrix.length) {
        matrix[row][col] = value;
    }
}

function addFinderPattern(matrix: (boolean | null)[][], row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
            const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
            const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
            const val = inOuter && (onBorder || inInner);
            setModule(matrix, row + r, col + c, val);
        }
    }
}

function addAlignmentPattern(matrix: (boolean | null)[][], row: number, col: number) {
    for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
            const val = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
            if (matrix[row + r][col + c] === null) {
                matrix[row + r][col + c] = val;
            }
        }
    }
}

function addTimingPatterns(matrix: (boolean | null)[][]) {
    const size = matrix.length;
    for (let i = 8; i < size - 8; i++) {
        const val = i % 2 === 0;
        if (matrix[6][i] === null) matrix[6][i] = val;
        if (matrix[i][6] === null) matrix[i][6] = val;
    }
}

function reserveFormatArea(matrix: (boolean | null)[][]) {
    const size = matrix.length;
    // Around top-left finder
    for (let i = 0; i <= 8; i++) {
        if (matrix[8][i] === null) matrix[8][i] = false;
        if (matrix[i][8] === null) matrix[i][8] = false;
    }
    // Around top-right finder
    for (let i = 0; i <= 7; i++) {
        if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    }
    // Around bottom-left finder
    for (let i = 0; i <= 7; i++) {
        if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
    }
    // Dark module
    matrix[size - 8][8] = true;
}

function addFormatInfo(matrix: (boolean | null)[][], maskPattern: number) {
    const size = matrix.length;
    const bits = FORMAT_INFO[maskPattern];

    for (let i = 0; i <= 5; i++) {
        matrix[8][i] = !!((bits >> (14 - i)) & 1);
    }
    matrix[8][7] = !!((bits >> 8) & 1);
    matrix[8][8] = !!((bits >> 7) & 1);
    matrix[7][8] = !!((bits >> 6) & 1);

    for (let i = 0; i <= 5; i++) {
        matrix[5 - i][8] = !!((bits >> (i)) & 1);
    }

    for (let i = 0; i <= 7; i++) {
        matrix[8][size - 1 - i] = !!((bits >> i) & 1);
    }
    for (let i = 0; i <= 6; i++) {
        matrix[size - 1 - i][8] = !!((bits >> (14 - i)) & 1);
    }
}

function addVersionInfo(matrix: (boolean | null)[][], version: number) {
    if (version < 7) return;
    const size = matrix.length;
    const bits = VERSION_INFO[version];

    for (let i = 0; i < 18; i++) {
        const bit = !!((bits >> i) & 1);
        const row = Math.floor(i / 3);
        const col = i % 3;
        matrix[5 - row][size - 9 - col] = bit;
        matrix[size - 9 - col][5 - row] = bit;
    }
}

const MASK_FUNCTIONS: ((row: number, col: number) => boolean)[] = [
    (r, c) => (r + c) % 2 === 0,
    (r, _) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function placeData(matrix: (boolean | null)[][], bits: number[]) {
    const size = matrix.length;
    let bitIndex = 0;
    let upward = true;

    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5; // Skip timing column

        const rows = upward
            ? Array.from({ length: size }, (_, i) => size - 1 - i)
            : Array.from({ length: size }, (_, i) => i);

        for (const row of rows) {
            for (const col of [right, right - 1]) {
                if (matrix[row][col] === null) {
                    matrix[row][col] = bitIndex < bits.length ? !!bits[bitIndex] : false;
                    bitIndex++;
                }
            }
        }
        upward = !upward;
    }
}

function applyMask(matrix: (boolean | null)[][], reserved: (boolean | null)[][], mask: number): boolean[][] {
    const size = matrix.length;
    const result: boolean[][] = Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_, c) => !!matrix[r][c])
    );

    const fn = MASK_FUNCTIONS[mask];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (reserved[r][c] !== null) continue; // Don't mask reserved areas
            if (fn(r, c)) result[r][c] = !result[r][c];
        }
    }

    return result;
}

function penaltyScore(matrix: boolean[][]): number {
    const size = matrix.length;
    let penalty = 0;

    // Rule 1: Runs of same color
    for (let r = 0; r < size; r++) {
        let count = 1;
        for (let c = 1; c < size; c++) {
            if (matrix[r][c] === matrix[r][c - 1]) {
                count++;
                if (count === 5) penalty += 3;
                else if (count > 5) penalty++;
            } else {
                count = 1;
            }
        }
    }
    for (let c = 0; c < size; c++) {
        let count = 1;
        for (let r = 1; r < size; r++) {
            if (matrix[r][c] === matrix[r - 1][c]) {
                count++;
                if (count === 5) penalty += 3;
                else if (count > 5) penalty++;
            } else {
                count = 1;
            }
        }
    }

    // Rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const v = matrix[r][c];
            if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
                penalty += 3;
            }
        }
    }

    return penalty;
}

function encodeQR(data: string): boolean[][] {
    const bytes = Buffer.from(data, 'utf-8');
    const version = getVersion(bytes.length);
    const size = getSize(version);
    const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version];
    const numBlocks = NUM_EC_BLOCKS[version];
    const totalCodewords = TOTAL_CODEWORDS[version];

    // Build data bits
    const bitBuf = new BitBuffer();
    bitBuf.put(MODE_BYTE, 4);
    bitBuf.put(bytes.length, version <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) {
        bitBuf.put(bytes[i], 8);
    }

    // Total data codewords
    const dataCodewords = totalCodewords - ecPerBlock * numBlocks;

    // Pad to fill data capacity
    const targetBits = dataCodewords * 8;
    if (bitBuf.getLength() < targetBits) {
        bitBuf.put(0, Math.min(4, targetBits - bitBuf.getLength()));
    }
    while (bitBuf.getLength() % 8 !== 0) {
        bitBuf.put(0, 1);
    }
    const padBytes = [0xEC, 0x11];
    let padIdx = 0;
    while (bitBuf.getLength() < targetBits) {
        bitBuf.put(padBytes[padIdx % 2], 8);
        padIdx++;
    }

    // Convert to codewords
    const dataWords: number[] = [];
    const buf = bitBuf.getBuffer();
    for (let i = 0; i < dataCodewords; i++) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
            byte = (byte << 1) | (buf[i * 8 + j] || 0);
        }
        dataWords.push(byte);
    }

    // Split into blocks and compute EC
    const blockSize = Math.floor(dataCodewords / numBlocks);
    const longBlocks = dataCodewords % numBlocks;
    const dataBlocks: number[][] = [];
    const ecBlocks: number[][] = [];

    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
        const bSize = blockSize + (i >= numBlocks - longBlocks ? 1 : 0);
        const block = dataWords.slice(offset, offset + bSize);
        dataBlocks.push(block);
        ecBlocks.push(rsEncode(block, ecPerBlock));
        offset += bSize;
    }

    // Interleave
    const allBits: number[] = [];
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
        for (const block of dataBlocks) {
            if (i < block.length) {
                for (let j = 7; j >= 0; j--) {
                    allBits.push((block[i] >> j) & 1);
                }
            }
        }
    }
    for (let i = 0; i < ecPerBlock; i++) {
        for (const block of ecBlocks) {
            if (i < block.length) {
                for (let j = 7; j >= 0; j--) {
                    allBits.push((block[i] >> j) & 1);
                }
            }
        }
    }

    // Build matrix with reserved areas
    const reserved = createMatrix(size);
    addFinderPattern(reserved, 0, 0);
    addFinderPattern(reserved, 0, size - 7);
    addFinderPattern(reserved, size - 7, 0);
    addTimingPatterns(reserved);
    reserveFormatArea(reserved);

    const positions = ALIGNMENT_PATTERNS[version] || [];
    for (let i = 0; i < positions.length; i++) {
        for (let j = 0; j < positions.length; j++) {
            const r = positions[i], c = positions[j];
            if (reserved[r]?.[c] !== null) continue;
            addAlignmentPattern(reserved, r, c);
        }
    }

    // Place data on a copy
    const matrix = reserved.map(row => [...row]);
    placeData(matrix, allBits);

    // Try all masks, pick best
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
        const masked = applyMask(matrix, reserved, m);
        const p = penaltyScore(masked);
        if (p < bestPenalty) {
            bestPenalty = p;
            bestMask = m;
        }
    }

    const result = applyMask(matrix, reserved, bestMask);

    // Write format & version info
    const fmtMatrix = createMatrix(size);
    addFinderPattern(fmtMatrix, 0, 0);
    addFinderPattern(fmtMatrix, 0, size - 7);
    addFinderPattern(fmtMatrix, size - 7, 0);
    addTimingPatterns(fmtMatrix);
    addFormatInfo(fmtMatrix, bestMask);
    addVersionInfo(fmtMatrix, version);

    // Overlay format/version info onto result
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (reserved[r][c] !== null) {
                result[r][c] = !!fmtMatrix[r][c];
            }
        }
    }

    addFormatInfo(result as any, bestMask);
    if (version >= 7) addVersionInfo(result as any, version);

    return result;
}

/**
 * Generate a QR code string for terminal display.
 * Uses Unicode half-block characters (▀▄█ ) to render 2 rows per line.
 *
 * @param text - The text/URL to encode
 * @param opts - Options: quiet zone width, colors
 * @returns Multi-line string ready for console.log()
 */
export function generateQR(text: string, opts?: { quiet?: number; invert?: boolean }): string {
    // Quiet zone: ISO/IEC 18004 requires at least 4 modules of white border
    // around the matrix. The previous default of 2 made finder-pattern
    // detection slow — scanners would burn many frames before lock-on.
    const quiet = opts?.quiet ?? 4;
    const invert = opts?.invert ?? false;

    let matrix: boolean[][];
    try {
        matrix = encodeQR(text);
    } catch {
        // Fallback: return a simple text representation
        return `  [QR: ${text}]`;
    }

    const size = matrix.length;
    const totalSize = size + quiet * 2;

    // Pad with quiet zone
    const getModule = (r: number, c: number): boolean => {
        const mr = r - quiet;
        const mc = c - quiet;
        if (mr < 0 || mr >= size || mc < 0 || mc >= size) return false;
        return matrix[mr][mc];
    };

    const lines: string[] = [];

    // Use half-block characters: each character represents 2 vertical pixels
    // ▀ = top half, ▄ = bottom half, █ = full, ' ' = empty
    const BLACK = invert ? false : true;

    for (let r = 0; r < totalSize; r += 2) {
        let line = '';
        for (let c = 0; c < totalSize; c++) {
            const top = getModule(r, c);
            const bottom = r + 1 < totalSize ? getModule(r + 1, c) : false;

            if (top === BLACK && bottom === BLACK) {
                line += '█';
            } else if (top === BLACK && bottom !== BLACK) {
                line += '▀';
            } else if (top !== BLACK && bottom === BLACK) {
                line += '▄';
            } else {
                line += ' ';
            }
        }
        lines.push(line);
    }

    return lines.join('\n');
}
