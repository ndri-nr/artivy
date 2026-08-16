/*
 * 2048 rules. No DOM in this file, which is what makes it testable from selftest.html.
 *
 * A grid is SIZE rows of SIZE cells, each cell either null or a tile `{id, value}`.
 * Tiles keep their id across a move so the renderer can animate the one element from its
 * old square to its new one; a merged tile reports the id it swallowed in `absorbed`, so
 * that element can be slid onto the survivor and then dropped.
 */

export const SIZE = 4;

let nextId = 1;

function makeTile(value) {
    return { id: nextId++, value };
}

export function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

/**
 * Maps a line index and a position along it to board coordinates, so one slide routine
 * serves all four directions. Every direction is read as "towards position 0".
 */
function coord(direction, line, step) {
    switch (direction) {
        case 'left':
            return [step, line];
        case 'right':
            return [SIZE - 1 - step, line];
        case 'up':
            return [line, step];
        case 'down':
            return [line, SIZE - 1 - step];
        default:
            throw new Error(`unknown direction: ${direction}`);
    }
}

/**
 * Slides one line towards index 0 and merges equal neighbours.
 *
 * The rule that matters: a tile produced by a merge cannot merge again in the same move.
 * `[2,2,4,4]` is `[4,8]`, never `[16]`, and `[2,2,2]` is `[4,2]` because the pair nearest
 * the destination goes first. Both fall out of consuming the partner and stepping past it.
 */
function slideLine(line) {
    const packed = line.filter(Boolean);
    const result = [];
    let gained = 0;

    for (let i = 0; i < packed.length; i++) {
        const current = packed[i];
        const next = packed[i + 1];
        if (next && next.value === current.value) {
            const value = current.value * 2;
            result.push({ id: current.id, value, absorbed: next.id });
            gained += value;
            i++;
        } else {
            result.push({ id: current.id, value: current.value });
        }
    }

    while (result.length < SIZE) result.push(null);
    return { line: result, gained };
}

/**
 * Applies a move. Returns a fresh grid and leaves the one passed in untouched, so a caller
 * can keep the previous grid for undo without copying it first.
 *
 * `moved` is false when nothing shifted, and a move that changes nothing must not spawn a
 * tile — otherwise a board can be filled by swiping into a wall.
 */
export function move(grid, direction) {
    const next = emptyGrid();
    let gained = 0;
    let moved = false;

    for (let line = 0; line < SIZE; line++) {
        const source = [];
        for (let step = 0; step < SIZE; step++) {
            const [x, y] = coord(direction, line, step);
            source.push(grid[y][x]);
        }

        const slid = slideLine(source);
        gained += slid.gained;

        for (let step = 0; step < SIZE; step++) {
            const [x, y] = coord(direction, line, step);
            const before = source[step];
            const after = slid.line[step];
            next[y][x] = after;

            if ((before ? before.id : 0) !== (after ? after.id : 0)) moved = true;
            else if (before && after && before.value !== after.value) moved = true;
        }
    }

    return { grid: next, gained, moved };
}

export function freeCells(grid) {
    const free = [];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (!grid[y][x]) free.push([x, y]);
        }
    }
    return free;
}

/**
 * Drops one tile on a random free square: 2 nine times out of ten, 4 otherwise.
 * Mutates the grid and returns the new tile, or null if there was no room.
 */
export function spawn(grid, random = Math.random) {
    const free = freeCells(grid);
    if (free.length === 0) return null;

    const [x, y] = free[Math.floor(random() * free.length)];
    const tile = makeTile(random() < 0.9 ? 2 : 4);
    tile.spawned = true;
    grid[y][x] = tile;
    return tile;
}

/** A move exists while any square is free, or any two neighbours match. */
export function canMove(grid) {
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const cell = grid[y][x];
            if (!cell) return true;
            if (x + 1 < SIZE && grid[y][x + 1] && grid[y][x + 1].value === cell.value) return true;
            if (y + 1 < SIZE && grid[y + 1][x] && grid[y + 1][x].value === cell.value) return true;
        }
    }
    return false;
}

export function highest(grid) {
    let best = 0;
    for (const row of grid) {
        for (const cell of row) {
            if (cell && cell.value > best) best = cell.value;
        }
    }
    return best;
}

export function newGame() {
    const grid = emptyGrid();
    spawn(grid);
    spawn(grid);
    return grid;
}

/* Saving keeps values only. Tile ids are a rendering concern and mean nothing after a
   reload, so they are handed out fresh on the way back in. */

export function toValues(grid) {
    return grid.map((row) => row.map((cell) => (cell ? cell.value : 0)));
}

export function fromValues(values) {
    if (!Array.isArray(values) || values.length !== SIZE) return null;
    const grid = emptyGrid();
    for (let y = 0; y < SIZE; y++) {
        if (!Array.isArray(values[y]) || values[y].length !== SIZE) return null;
        for (let x = 0; x < SIZE; x++) {
            const value = values[y][x];
            if (value === 0) continue;
            if (!Number.isInteger(value) || value < 2 || (value & (value - 1)) !== 0) return null;
            grid[y][x] = makeTile(value);
        }
    }
    return grid;
}

/**
 * Short label for tight spaces: full up to four digits, then thousands or millions.
 * Truncates instead of rounding, so 99999 reads as 99K and never overstates itself as 100K.
 */
export function compact(value) {
    if (value < 10000) return String(value);
    if (value < 1000000) return `${Math.floor(value / 1000)}K`;
    if (value >= 100000000) return `${Math.floor(value / 1000000)}M`;

    const tenths = Math.floor(value / 100000);
    return tenths % 10 === 0 ? `${tenths / 10}M` : `${Math.floor(tenths / 10)}.${tenths % 10}M`;
}
