/*
 * PawDoku's rules and its puzzle generator. No DOM here, which is what makes selftest.html
 * possible — and a generator that can hand out an unsolvable board is exactly the thing worth
 * checking automatically.
 *
 * The puzzle: place n cats on an n×n board so that every row, every column and every coloured
 * region holds exactly one, and no two cats touch — including diagonally. Every board has
 * exactly one solution, which is not a nicety: without it a player can deduce correctly and
 * still be told they are wrong.
 *
 * Cells are plain integers, `row * n + col`. The Dart engine uses a Pos value type; here an
 * integer is its own identity and its own Set key, which the region flood fill leans on.
 */

export const MAX_HEARTS = 3;

/** Board size by level. Rises, then caps, so levels are endless but stay solvable. */
export function boardSizeForLevel(level) {
    if (level <= 20) return 5;
    if (level <= 40) return 6;
    if (level <= 60) return 7;
    if (level <= 80) return 8;
    return 9;
}

/**
 * A seeded generator (mulberry32). Math.random cannot be seeded, and a level generated from
 * its number has to be the same board every time it is opened — otherwise retrying a level
 * after losing would hand out a different puzzle.
 *
 * Level n here is not level n in the Android app. Matching would mean reproducing dart:math's
 * Random stream exactly, which is an implementation detail rather than a promise, and no
 * player gains anything from the two agreeing.
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

function shuffled(items, random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/* ---------- rules ---------- */

export const rowOf = (cell, n) => Math.floor(cell / n);
export const colOf = (cell, n) => cell % n;

/** Cats may not touch, diagonals included — the king's move in chess. */
export function kingAdjacent(a, b, n) {
    return Math.abs(rowOf(a, n) - rowOf(b, n)) <= 1
        && Math.abs(colOf(a, n) - colOf(b, n)) <= 1
        && a !== b;
}

/**
 * Why placing a cat here would be illegal, or null when it is fine. This and `isSolved` are
 * the single source of truth for legality — nothing else may re-derive adjacency inline.
 */
export function checkPlacement(puzzle, cats, target) {
    const { n, regions } = puzzle;
    for (const cat of cats) {
        if (cat === target) continue;
        if (rowOf(cat, n) === rowOf(target, n)) return 'row';
        if (colOf(cat, n) === colOf(target, n)) return 'column';
        if (regions[cat] === regions[target]) return 'region';
        if (kingAdjacent(cat, target, n)) return 'adjacency';
    }
    return null;
}

/* ---------- what a tap does ---------- */

/*
 * Four cell states, and the distinction that matters is between the two crosses. `BLOCKED` is
 * the player's own note, toggled freely. `LOCKED` is the red cross left behind by summoning a
 * cat where there is none: it costs a life and it is permanent.
 */
export const EMPTY = 0;
export const CAT = 1;
export const BLOCKED = 2;
export const LOCKED = 3;

/** A single tap only ever moves the player's own note. Cats and locked cells are fixed. */
export function toggleNote(states, cell) {
    if (states[cell] === CAT || states[cell] === LOCKED) return false;
    states[cell] = states[cell] === BLOCKED ? EMPTY : BLOCKED;
    return true;
}

/**
 * Summoning a cat, which is judged against the *solution* and not against the cats already on
 * the board.
 *
 * That is the whole difficulty of the game and it is easy to get subtly wrong: a cell can be
 * perfectly legal given everything placed so far and still not be where the cat goes. Judging
 * by legality would let a player fill the board with locally-fine guesses and only discover
 * the contradiction at the end; judging by the solution costs them a life on the spot.
 */
export function summon(puzzle, states, cell) {
    if (states[cell] === CAT || states[cell] === LOCKED) return 'ignored';
    if (puzzle.solution.includes(cell)) {
        states[cell] = CAT;
        return 'cat';
    }
    states[cell] = LOCKED;
    return 'wrong';
}

export function catsIn(states) {
    const out = [];
    for (let cell = 0; cell < states.length; cell++) if (states[cell] === CAT) out.push(cell);
    return out;
}

export function isSolved(puzzle, cats) {
    if (cats.length !== puzzle.n) return false;
    const seen = new Set();
    for (const cat of cats) {
        if (checkPlacement(puzzle, cats, cat) !== null) return false;
        seen.add(puzzle.regions[cat]);
    }
    return seen.size === puzzle.n;
}

/* ---------- solving ---------- */

function groupByRegion(n, regions) {
    const cells = Array.from({ length: n }, () => []);
    for (let cell = 0; cell < n * n; cell++) cells[regions[cell]].push(cell);
    return cells;
}

/**
 * Up to `max` full solutions, each indexed by region id. Regions are assigned in order and
 * the search backtracks; one cat per region is what makes region the natural axis.
 */
export function findSolutions(n, regions, max = 2) {
    const cellsByRegion = groupByRegion(n, regions);

    /*
     * Smallest region first. The search order does not change which solutions exist, only how
     * long it takes to be sure of them — and being sure is the expensive part, because
     * proving a board has no *second* solution means exhausting the whole tree.
     *
     * Measured: without this, a 9x9 took about 290ms to generate, enough to visibly stall a
     * tap and enough to have justified moving the whole generator onto a worker thread.
     * Starting from the most constrained region instead prunes that tree early.
     */
    const order = [...Array(n).keys()].sort(
        (a, b) => cellsByRegion[a].length - cellsByRegion[b].length);

    const usedRow = new Array(n).fill(false);
    const usedCol = new Array(n).fill(false);
    const current = new Array(n).fill(-1);
    const placed = [];
    const solutions = [];

    function legal(cell) {
        if (usedRow[rowOf(cell, n)] || usedCol[colOf(cell, n)]) return false;
        for (const other of placed) {
            if (kingAdjacent(cell, other, n)) return false;
        }
        return true;
    }

    function search(depth) {
        if (solutions.length >= max) return;
        if (depth === n) {
            solutions.push([...current]);
            return;
        }
        const region = order[depth];
        for (const cell of cellsByRegion[region]) {
            if (!legal(cell)) continue;
            usedRow[rowOf(cell, n)] = true;
            usedCol[colOf(cell, n)] = true;
            placed.push(cell);
            current[region] = cell;
            search(depth + 1);
            current[region] = -1;
            placed.pop();
            usedRow[rowOf(cell, n)] = false;
            usedCol[colOf(cell, n)] = false;
            if (solutions.length >= max) return;
        }
    }

    search(0);
    return solutions;
}

/** How many solutions a region map admits, giving up at `limit`. Two is enough to know. */
export function countSolutions(n, regions, limit = 2) {
    return findSolutions(n, regions, limit).length;
}

/* ---------- generation ---------- */

/**
 * One cat per row, no column repeated, no two touching.
 *
 * Only the previous row needs checking for adjacency: rows are filled in order and hold one
 * cat each, so two cats can only ever touch across consecutive rows.
 */
function placeCats(n, random) {
    const columns = new Array(n).fill(-1);
    const usedCol = new Array(n).fill(false);

    function place(row) {
        if (row === n) return true;
        for (const column of shuffled([...Array(n).keys()], random)) {
            if (usedCol[column]) continue;
            if (row > 0 && Math.abs(columns[row - 1] - column) <= 1) continue;
            usedCol[column] = true;
            columns[row] = column;
            if (place(row + 1)) return true;
            usedCol[column] = false;
            columns[row] = -1;
        }
        return false;
    }

    return place(0) ? columns.map((column, row) => row * n + column) : null;
}

function neighbours(cell, n) {
    const row = rowOf(cell, n);
    const column = colOf(cell, n);
    const out = [];
    if (row > 0) out.push(cell - n);
    if (row < n - 1) out.push(cell + n);
    if (column > 0) out.push(cell - 1);
    if (column < n - 1) out.push(cell + 1);
    return out;
}

/**
 * Multi-source random flood fill: each cat seeds its own region, then unclaimed cells next to
 * a region are pulled in one at a time in random order. Regions come out contiguous and
 * holding exactly one cat each by construction.
 */
function growRegions(n, cats, random) {
    const regions = new Array(n * n).fill(-1);
    const frontier = [];

    function claim(cell, id) {
        regions[cell] = id;
        for (const next of neighbours(cell, n)) {
            if (regions[next] === -1) frontier.push([next, id]);
        }
    }

    cats.forEach((cell, id) => claim(cell, id));

    let remaining = n * n - n;
    while (remaining > 0 && frontier.length > 0) {
        const index = Math.floor(random() * frontier.length);
        const [cell, id] = frontier[index];
        frontier.splice(index, 1);
        if (regions[cell] !== -1) continue;
        claim(cell, id);
        remaining--;
    }

    return regions;
}

/** Whether a region's cells are 4-connected and still contain the cat they were grown from. */
function regionContiguous(n, regions, id, mustContain) {
    if (regions[mustContain] !== id) return false;

    let total = 0;
    for (const region of regions) if (region === id) total++;

    const seen = new Set([mustContain]);
    const stack = [mustContain];
    while (stack.length > 0) {
        const cell = stack.pop();
        for (const next of neighbours(cell, n)) {
            if (regions[next] === id && !seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return seen.size === total;
}

/**
 * Moves one cell out of its region into a neighbouring one, provided the region it leaves
 * stays in one piece and keeps its own cat. The receiving region cannot be broken by this,
 * since the cell is adjacent to it.
 */
function tryMoveCell(n, regions, cell, fromRegion, targetByRegion, random) {
    const candidates = new Set();
    for (const next of neighbours(cell, n)) {
        if (regions[next] !== fromRegion) candidates.add(regions[next]);
    }

    for (const into of shuffled([...candidates], random)) {
        regions[cell] = into;
        if (regionContiguous(n, regions, fromRegion, targetByRegion[fromRegion])) return true;
        regions[cell] = fromRegion;
    }
    return false;
}

/**
 * Carves away alternate solutions until only the intended one is left.
 *
 * Each round takes an alternate solution, finds a region where it disagrees with the intended
 * cat, and moves that disagreeing cell into a neighbouring region — which makes that
 * alternate illegal without touching the intended answer. Getting stuck is normal and not an
 * error; the caller simply starts again from a fresh board.
 */
function refineToUnique(n, regions, solution, random) {
    const targetByRegion = new Array(n).fill(-1);
    for (const cell of solution) targetByRegion[regions[cell]] = cell;

    for (let iteration = 0; iteration < 2000; iteration++) {
        const solutions = findSolutions(n, regions, 2);
        if (solutions.length === 1) return true;
        if (solutions.length === 0) return false;

        const alternate = solutions.find((candidate) =>
            candidate.some((cell, region) => cell !== targetByRegion[region])) ?? solutions[0];

        let moved = false;
        for (const region of shuffled([...Array(n).keys()], random)) {
            if (alternate[region] === targetByRegion[region]) continue;
            if (tryMoveCell(n, regions, alternate[region], region, targetByRegion, random)) {
                moved = true;
                break;
            }
        }
        if (!moved) return false;
    }

    return findSolutions(n, regions, 2).length === 1;
}

/**
 * A puzzle of size n with exactly one solution. `seed` makes it reproducible, which is what
 * the daily challenge and the self-check both need.
 *
 * Returns null rather than throwing if 200 fresh attempts all get stuck. A caller that cannot
 * make a board should say so, not crash the page.
 */
export function generate(n, seed) {
    const random = rng(seed);

    for (let attempt = 0; attempt < 200; attempt++) {
        const solution = placeCats(n, random);
        if (!solution) continue;

        const regions = growRegions(n, solution, random);
        if (refineToUnique(n, regions, solution, random)) {
            return { n, regions, solution };
        }
    }
    return null;
}
