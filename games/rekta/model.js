/*
 * Rekta's rules and its level generator. No DOM in this file, which is what makes
 * selftest.html possible — and a generator is exactly the kind of code that needs one.
 *
 * Shikaku: cut the grid into rectangles so that each rectangle holds exactly one clue, and
 * that clue equals the number of cells the rectangle covers.
 *
 * Levels are generated from their number rather than stored, so the run has no end and
 * level 40 is the same board every time it is opened. It is *not* the same board as level 40
 * of the Android app: matching that would mean reproducing java.util.Random's exact bit
 * sequence, which would pin this file to that one forever for no player's benefit. These are
 * separate saves and separate players.
 */

/** Board shapes, and the largest clue each may hand out before the level bonus. */
export const DIFFICULTIES = [
    { key: 'easy', label: 'Easy', cols: 6, rows: 8, maxArea: 6 },
    { key: 'medium', label: 'Medium', cols: 8, rows: 10, maxArea: 9 },
    { key: 'hard', label: 'Hard', cols: 10, rows: 13, maxArea: 12 },
];

export function difficultyFor(key) {
    return DIFFICULTIES.find((entry) => entry.key === key) ?? DIFFICULTIES[0];
}

/**
 * A small seeded generator (mulberry32). Math.random cannot be seeded, and a level that is
 * generated from its number needs a stream that can be replayed — that is what lets a hint
 * recompute the answer instead of the board carrying one around.
 */
export function rng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Seeds spread apart by odd constants. Levels one apart would otherwise start the generator
 * in near-identical states, and the opening draws — which decide the shape of the top-left
 * corner — would visibly rhyme from one level to the next.
 */
function seedFor(difficulty, level) {
    const index = DIFFICULTIES.indexOf(difficulty);
    return (Math.imul(index + 1, 0x9e3779b1) + Math.imul(level, 0x85ebca77)) >>> 0;
}

/**
 * The block-size cap for a level. It creeps up as levels do, which is what makes a late level
 * harder on the same grid: bigger blocks mean fewer clues, and fewer clues mean less to
 * anchor a deduction on. It stops climbing because past that point the puzzles stop being
 * harder and start being guesswork.
 */
function maxAreaFor(difficulty, level) {
    return difficulty.maxArea + Math.min(4, Math.floor(Math.max(0, level - 1) / 12));
}

/* ---------- blocks ---------- */

export function area(block) {
    return block.w * block.h;
}

export function contains(block, x, y) {
    return x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
}

export function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/* ---------- generation ---------- */

function isFree(taken, cols, x, y, w, h) {
    for (let row = y; row < y + h; row++) {
        for (let col = x; col < x + w; col++) {
            if (taken[row * cols + col]) return false;
        }
    }
    return true;
}

function fill(taken, cols, block) {
    for (let y = block.y; y < block.y + block.h; y++) {
        for (let x = block.x; x < block.x + block.w; x++) {
            taken[y * cols + x] = true;
        }
    }
}

/**
 * A free cell with the fewest free orthogonal neighbours, chosen at random among equals.
 * Pockets get filled while they are still fillable; taking the roomiest cell instead walls
 * them off and the board ends up dotted with 1s.
 */
function tightestFreeCell(taken, cols, rows, random) {
    let best = Infinity;
    let seen = 0;
    let chosen = -1;

    for (let index = 0; index < taken.length; index++) {
        if (taken[index]) continue;
        const x = index % cols;
        const y = (index / cols) | 0;
        let free = 0;
        if (x > 0 && !taken[index - 1]) free++;
        if (x < cols - 1 && !taken[index + 1]) free++;
        if (y > 0 && !taken[index - cols]) free++;
        if (y < rows - 1 && !taken[index + cols]) free++;

        if (free < best) {
            best = free;
            seen = 1;
            chosen = index;
        } else if (free === best && Math.floor(random() * ++seen) === 0) {
            // Reservoir pick, so every cell tied at the minimum is equally likely without
            // collecting them into a list first.
            chosen = index;
        }
    }
    return chosen;
}

/**
 * Every free rectangle within maxArea that covers the given cell, grouped by shape: one inner
 * list per distinct w×h holding that shape's placements. Never empty — the 1x1 on the anchor
 * is always in it, which is what stops the partition loop getting stuck.
 */
function blocksCovering(taken, cols, rows, maxArea, cx, cy) {
    const shapes = [];
    for (let w = 1; w <= maxArea && w <= cols; w++) {
        for (let h = 1; w * h <= maxArea && h <= rows; h++) {
            const placements = [];
            for (let x = Math.max(0, cx - w + 1); x <= cx && x + w <= cols; x++) {
                for (let y = Math.max(0, cy - h + 1); y <= cy && y + h <= rows; y++) {
                    if (isFree(taken, cols, x, y, w, h)) placements.push({ x, y, w, h });
                }
            }
            if (placements.length > 0) shapes.push(placements);
        }
    }
    return shapes;
}

/**
 * Draws a shape first, then a placement of that shape.
 *
 * Drawing straight from the flat list of rectangles would weight every shape by how many ways
 * it can sit over the anchor, and on a grid taller than it is wide a tall shape simply has
 * more room. That turns the board's aspect ratio into a standing preference for columns, and
 * a board with a preferred axis is a board the player can guess. Keeping the two decisions
 * apart is the whole point — nothing here may collapse them back together.
 */
function pickShapeThenPlacement(shapes, random) {
    let total = 0;
    for (const shape of shapes) total += area(shape[0]);

    let roll = Math.floor(random() * total);
    for (const shape of shapes) {
        roll -= area(shape[0]);
        if (roll < 0) return shape[Math.floor(random() * shape.length)];
    }
    const last = shapes[shapes.length - 1];
    return last[Math.floor(random() * last.length)];
}

/** The combined block when two are edge-aligned neighbours, otherwise null. */
function union(a, b) {
    const stacked = a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y);
    if (stacked) return { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h };

    const sideBySide = a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x);
    if (sideBySide) return { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h };

    return null;
}

/**
 * Folds single cells into an adjacent block whenever the union is itself a rectangle. A board
 * littered with 1s is legal but joyless: those cells solve themselves and give the player
 * nothing to reason about.
 */
function mergeStrays(blocks, maxArea) {
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < blocks.length && !merged; i++) {
            if (area(blocks[i]) !== 1) continue;
            for (let j = 0; j < blocks.length; j++) {
                if (i === j) continue;
                const joined = union(blocks[i], blocks[j]);
                if (!joined || area(joined) > maxArea) continue;
                blocks[Math.min(i, j)] = joined;
                blocks.splice(Math.max(i, j), 1);
                merged = true;
                break;
            }
        }
    }
}

/** Cuts the grid into rectangles, none larger than maxArea. */
export function partition(cols, rows, maxArea, random) {
    const taken = new Array(cols * rows).fill(false);
    const out = [];

    for (let left = cols * rows; left > 0; ) {
        const anchor = tightestFreeCell(taken, cols, rows, random);
        const chosen = pickShapeThenPlacement(
            blocksCovering(taken, cols, rows, maxArea, anchor % cols, (anchor / cols) | 0),
            random,
        );
        out.push(chosen);
        fill(taken, cols, chosen);
        left -= area(chosen);
    }

    mergeStrays(out, maxArea);
    return out;
}

/**
 * One valid answer for a level, recomputed rather than stored. The clues are placed *after*
 * the partition is drawn, so seeding a fresh generator the same way replays exactly the same
 * cuts. That is what lets a hint reveal a real block with no solver and no saved solution.
 *
 * It is *an* answer, not *the* answer. The generator never checks whether a second partition
 * fits the same clues, and the game accepts any that does — which is also why placing a block
 * overwrites what it overlaps instead of refusing.
 */
export function solutionFor(difficulty, level) {
    return partition(difficulty.cols, difficulty.rows, maxAreaFor(difficulty, level),
        rng(seedFor(difficulty, level)));
}

/** A fresh board for a numbered level: the clue grid, with no blocks drawn on it yet. */
export function boardFor(difficulty, level) {
    const random = rng(seedFor(difficulty, level));
    const blocks = partition(difficulty.cols, difficulty.rows,
        maxAreaFor(difficulty, level), random);

    const clues = new Array(difficulty.cols * difficulty.rows).fill(0);
    for (const block of blocks) {
        const cx = block.x + Math.floor(random() * block.w);
        const cy = block.y + Math.floor(random() * block.h);
        clues[cy * difficulty.cols + cx] = area(block);
    }

    return { cols: difficulty.cols, rows: difficulty.rows, clues, blocks: [] };
}

/* ---------- play ---------- */

function clamp(value, limit) {
    return value < 0 ? 0 : Math.min(value, limit - 1);
}

/**
 * Draws a block spanning two cells, dropping anything it overlaps. Overwriting rather than
 * refusing is the whole interaction: redrawing over a wrong guess should not need an erase
 * first, and a hint may well disagree with a block the player drew that is also correct.
 */
export function place(board, x1, y1, x2, y2) {
    const left = clamp(Math.min(x1, x2), board.cols);
    const top = clamp(Math.min(y1, y2), board.rows);
    const right = clamp(Math.max(x1, x2), board.cols);
    const bottom = clamp(Math.max(y1, y2), board.rows);

    const block = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    board.blocks = board.blocks.filter((existing) => !overlaps(existing, block));
    board.blocks.push(block);
    return block;
}

/** Removes the block covering a cell, if there is one. True when one went. */
export function removeAt(board, x, y) {
    const before = board.blocks.length;
    board.blocks = board.blocks.filter((block) => !contains(block, x, y));
    return board.blocks.length !== before;
}

export function blockAt(board, x, y) {
    return board.blocks.find((block) => contains(block, x, y)) ?? null;
}

export function clueAt(board, x, y) {
    return board.clues[y * board.cols + x];
}

/**
 * Whether a block could be part of a solution: exactly one clue inside it, and that clue equal
 * to its area. Drives the live colour feedback as well as the solve check.
 */
export function isValid(board, block) {
    let found = 0;
    for (let y = block.y; y < block.y + block.h; y++) {
        for (let x = block.x; x < block.x + block.w; x++) {
            const clue = clueAt(board, x, y);
            if (clue === 0) continue;
            found++;
            if (found > 1 || clue !== area(block)) return false;
        }
    }
    return found === 1;
}

/** How many cells the drawn blocks cover. They never overlap, so this is a plain sum. */
export function covered(board) {
    return board.blocks.reduce((total, block) => total + area(block), 0);
}

export function solved(board) {
    if (covered(board) !== board.cols * board.rows) return false;
    return board.blocks.every((block) => isValid(board, block));
}

/**
 * Colour index for a block, derived from its geometry so a block keeps its colour for as long
 * as it exists and neighbours rarely repeat.
 */
export function colorIndex(block, count) {
    return (block.x * 7 + block.y * 13 + block.w * 3 + block.h * 5) % count;
}
