/*
 * PourFect!'s rules, its solver and its level table. No DOM in this file, which is what makes
 * selftest.html possible — and a generator that has to promise every board is winnable is
 * exactly the kind of code that needs one.
 *
 * Water sort: pour the whole run of matching colour off the top of one bottle onto a bottle
 * whose top is the same colour, or into an empty one, and win when every bottle is either
 * empty or full of a single colour. From level 10 there is also a collector — a tall tube that
 * accepts one colour and never gives it back.
 *
 * Levels are generated from their number rather than stored, so level 40 is the same board
 * every time it is opened. It is *not* the same board as level 40 of the Android app: matching
 * that would mean reproducing Dart's Random bit for bit, which buys a player nothing and would
 * pin this file to that one forever.
 *
 * The rules themselves are ported deliberately rather than shared. Nothing here imports from
 * the app and nothing ever should — the site deploys on its own, and a shared file would tie a
 * Play release to a website push.
 */

/** Bottles hold this many units, and a pour moves whole units. */
export const CAPACITY = 4;

/** The widest board, counting the extra bottle. */
export const MAX_BOTTLES = 24;

/**
 * Plain colours a board may use, before the collector's own.
 *
 * Nine in total is the ceiling for telling colours apart at a glance, and the ceiling full
 * stop if you are colour-blind. Wider boards get there by giving each colour more bottles.
 */
export const MAX_PLAIN_COLOURS = 8;

/** The first level with the extra bottle, and the first where the browser build still gives it
 *  away — there are no rewarded adverts here, so it is simply an ordinary bottle. */
export const EXTRA_BOTTLE_FROM = 7;

/**
 * A small seeded generator (mulberry32). Math.random cannot be seeded, and a level generated
 * from its number needs a stream that can be replayed — otherwise leaving a level and coming
 * back would hand out a different board.
 */
function rng(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* ------------------------------------------------------------------ the board */

/**
 * A board is `{ tubes, caps, collector, collectorColour }`.
 *
 * `tubes[i]` is bottom-first, so the last element is the top. Mutable on purpose: the solver
 * walks hundreds of thousands of positions and copying per step would dominate its cost, while
 * the page needs a move history for undo anyway. Both use apply/undo on one board.
 */
export function board(tubes, caps, collector = -1, collectorColour = -1) {
    return { tubes, caps, collector, collectorColour };
}

export function clone(b) {
    return board(b.tubes.map((tube) => tube.slice()), b.caps.slice(), b.collector,
        b.collectorColour);
}

export function room(b, i) {
    return b.caps[i] - b.tubes[i].length;
}

/** How many identical units sit on top of tube `i` — the block a single pour moves. */
export function topRun(b, i) {
    const tube = b.tubes[i];
    if (tube.length === 0) return 0;
    const colour = tube[tube.length - 1];
    let n = 1;
    while (n < tube.length && tube[tube.length - 1 - n] === colour) n++;
    return n;
}

/** Units a pour would move, or 0 when it is illegal. */
export function pourAmount(b, from, to) {
    if (from === to) return 0;
    const source = b.tubes[from];
    if (source.length === 0) return 0;
    // The collector is one-way. Its colour cannot be arranged as full bottles — there are more
    // units of it than that — so pouring back out is never part of a solution, and allowing it
    // only offers a player a way to undo their own progress by accident.
    if (from === b.collector) return 0;
    const colour = source[source.length - 1];
    if (to === b.collector && colour !== b.collectorColour) return 0;
    const space = room(b, to);
    if (space === 0) return 0;
    const target = b.tubes[to];
    if (target.length > 0 && target[target.length - 1] !== colour) return 0;
    const block = topRun(b, from);
    return block < space ? block : space;
}

export function apply(b, move) {
    for (let i = 0; i < move.count; i++) b.tubes[move.to].push(b.tubes[move.from].pop());
}

export function undo(b, move) {
    for (let i = 0; i < move.count; i++) b.tubes[move.from].push(b.tubes[move.to].pop());
}

export function isSettled(b, i) {
    const tube = b.tubes[i];
    if (tube.length !== b.caps[i]) return false;
    return tube.every((unit) => unit === tube[0]);
}

export function isWon(b) {
    return b.tubes.every((tube, i) => tube.length === 0
        || (tube.length === b.caps[i] && tube.every((unit) => unit === tube[0])));
}

export function legalMoves(b) {
    const moves = [];
    for (let from = 0; from < b.tubes.length; from++) {
        if (b.tubes[from].length === 0) continue;
        for (let to = 0; to < b.tubes.length; to++) {
            const count = pourAmount(b, from, to);
            if (count > 0) moves.push({ from, to, count });
        }
    }
    return moves;
}

export function isStuck(b) {
    return !isWon(b) && legalMoves(b).length === 0;
}

/**
 * The key the solver's visited set uses.
 *
 * Small bottles are interchangeable, so they are sorted: two boards differing only by which
 * bottle holds what are the same position, and collapsing them is most of why the search
 * finishes. The collector is kept in place because it is interchangeable with nothing, and
 * each capacity goes into the key so the extra bottle is never mistaken for a small one.
 */
export function key(b) {
    const small = [];
    for (let i = 0; i < b.tubes.length; i++) {
        if (i === b.collector) continue;
        small.push(`${b.tubes[i].join(',')}:${b.caps[i]}`);
    }
    small.sort();
    const collector = b.collector < 0 ? '' : b.tubes[b.collector].join(',');
    return `${collector}|${small.join('/')}`;
}

/* ----------------------------------------------------------------- the solver */

export const SOLVABLE = 'solvable';
export const UNSOLVABLE = 'unsolvable';
export const UNKNOWN = 'unknown';

/**
 * Depth-first search for a full solution.
 *
 * Speed comes from two things and neither is a micro-optimisation: the canonical key above,
 * and trying the pours that finish a bottle before the ones that shuffle liquid around.
 *
 * `maxStates` is a budget, and running out of it reports *unsolvable* to the caller only
 * through `exhausted` — a solver that guesses "yes" is worse than one that says "no", because
 * the page tells a player their level is over based on this.
 */
export function solve(b, maxStates = 200000) {
    const seen = new Set();
    const path = [];
    let visited = 0;
    let bailed = false;

    function score(work, move) {
        const colour = work.tubes[move.from][work.tubes[move.from].length - 1];
        let value = 0;
        const target = work.tubes[move.to];
        if (target.length + move.count === work.caps[move.to]
            && target.every((unit) => unit === colour)) {
            value += 100; // finishes a bottle
        }
        if (move.count === work.tubes[move.from].length) value += 50; // empties one
        if (move.count === topRun(work, move.from)) value += 20; // whole block, no split
        if (target.length === 0) value -= 10; // spending a free bottle is a cost
        return value;
    }

    function ordered(work) {
        const moves = [];
        for (let from = 0; from < work.tubes.length; from++) {
            if (work.tubes[from].length === 0) continue;
            if (isSettled(work, from)) continue; // finished, never touch it again
            const run = topRun(work, from);
            const whole = run === work.tubes[from].length;
            for (let to = 0; to < work.tubes.length; to++) {
                const count = pourAmount(work, from, to);
                if (count === 0) continue;
                // Moving a single-colour bottle into an empty one changes nothing but which
                // bottle it sits in, and doubles the branching factor.
                if (whole && work.tubes[to].length === 0) continue;
                moves.push({ from, to, count });
            }
        }
        return moves.sort((a, c) => score(work, c) - score(work, a));
    }

    function dfs(work) {
        if (isWon(work)) return true;
        if (bailed) return false;
        if (++visited > maxStates) {
            bailed = true;
            return false;
        }
        const k = key(work);
        if (seen.has(k)) return false;
        seen.add(k);
        for (const move of ordered(work)) {
            apply(work, move);
            path.push(move);
            if (dfs(work)) return true;
            path.pop();
            undo(work, move);
            if (bailed) return false;
        }
        return false;
    }

    const found = dfs(clone(b));
    return { path: found ? path : null, exhausted: bailed, distinct: seen.size };
}

/**
 * A move to point at, and what the search learned on the way.
 *
 * Telling *proved unsolvable* apart from *ran out of budget* is the whole point. Without it a
 * hint falls back to "the best legal move" on a dead board and points A to B, then B to A, for
 * as long as anyone keeps waiting — a game that has ended pretending it has not. `avoid` is
 * the move just made, whose exact reverse is never suggested.
 */
export function advise(b, { maxStates = 200000, avoid = null } = {}) {
    const result = solve(b, maxStates);
    if (result.path && result.path.length > 0) {
        return { move: result.path[0], verdict: SOLVABLE, reachable: -1 };
    }
    if (!result.exhausted) {
        return { move: null, verdict: UNSOLVABLE, reachable: result.distinct };
    }

    let best = null;
    let bestScore = -Infinity;
    for (const move of legalMoves(b)) {
        if (isSettled(b, move.from)) continue;
        if (avoid && move.from === avoid.to && move.to === avoid.from) continue;
        const colour = b.tubes[move.from][b.tubes[move.from].length - 1];
        const target = b.tubes[move.to];
        let value = 0;
        if (target.length + move.count === b.caps[move.to]
            && target.every((unit) => unit === colour)) value += 100;
        if (move.count === b.tubes[move.from].length) value += 50;
        if (move.count === topRun(b, move.from)) value += 20;
        if (target.length === 0) value -= 10;
        if (value > bestScore) {
            bestScore = value;
            best = move;
        }
    }
    return { move: best, verdict: UNKNOWN, reachable: -1 };
}

/** True when some position reachable from here can no longer be won, or when the board is too
 *  big to be sure. Only affordable on tiny boards, which is exactly where it is needed: the
 *  tutorial promises a player cannot ruin the level. */
export function hasDeadEnd(b, maxStates = 60000) {
    const index = new Map();
    const states = [];
    const edges = [];
    const won = [];

    function idOf(work) {
        const k = key(work);
        if (index.has(k)) return index.get(k);
        const id = states.length;
        index.set(k, id);
        states.push(clone(work));
        edges.push([]);
        return id;
    }

    const queue = [idOf(b)];
    while (queue.length > 0) {
        if (states.length > maxStates) return true; // too big to verify, so refuse
        const id = queue.pop();
        const work = states[id];
        if (isWon(work)) {
            won.push(id);
            continue;
        }
        for (const move of legalMoves(work)) {
            apply(work, move);
            const known = states.length;
            const next = idOf(work);
            edges[id].push(next);
            if (states.length > known) queue.push(next);
            undo(work, move);
        }
    }
    if (won.length === 0) return true;

    const reverse = states.map(() => []);
    edges.forEach((to, from) => to.forEach((target) => reverse[target].push(from)));
    const canWin = states.map(() => false);
    const back = won.slice();
    won.forEach((id) => { canWin[id] = true; });
    while (back.length > 0) {
        const id = back.pop();
        for (const previous of reverse[id]) {
            if (!canWin[previous]) {
                canWin[previous] = true;
                back.push(previous);
            }
        }
    }
    return canWin.some((winnable) => !winnable);
}

/**
 * How many times a player must find the *only* move that keeps the board winnable.
 *
 * This is what difficulty feels like here. Solution length barely matters — a long line of
 * obvious pours is easy — while a position offering four legal moves of which one survives is
 * a wall. Measured over the opening moves, which is where a player decides whether a level is
 * fair.
 */
export function forcedMoves(b, steps = 8, maxStates = 20000) {
    const work = clone(b);
    let forced = 0;
    for (let step = 0; step < steps && !isWon(work); step++) {
        const legal = legalMoves(work).filter((move) => !isSettled(work, move.from));
        if (legal.length === 0) break;
        let safe = 0;
        let follow = null;
        for (const move of legal) {
            apply(work, move);
            const alive = advise(work, { maxStates }).verdict !== UNSOLVABLE;
            undo(work, move);
            if (alive) {
                safe++;
                if (!follow) follow = move;
            }
        }
        if (legal.length > 1 && safe === 1) forced++;
        apply(work, follow ?? legal[0]);
    }
    return forced;
}

/* -------------------------------------------------------------- the level table */

/**
 * The level table.
 *
 * Written out one level at a time up to nine because the shape of each is a design decision,
 * then a ramp: two more bottles every five levels to twenty-four at level 50, with the
 * collector's capacity stepping 10 → 14 → 18 so a four-row tube is not drawing bands the size
 * of whole bottles.
 *
 * The collector's capacity is never a multiple of [CAPACITY]. Ten units of a colour cannot be
 * arranged as full bottles of four, so that colour has nowhere to end up except the collector.
 * Make it a multiple and the tube becomes optional decoration.
 *
 * Editing any of this renumbers every board for a player mid-run. Treat it as a content change.
 */
export function paramsFor(level) {
    const plain = (colours, freeTubes, minMoves, extra = {}) => ({
        colours,
        plainBottles: colours,
        freeTubes,
        collectorCap: 0,
        minMoves,
        forgiving: false,
        maxForced: null,
        ...extra,
    });

    if (level <= 1) return plain(2, 1, 3, { forgiving: true });
    if (level === 2) return plain(3, 1, 4, { forgiving: true });
    // The roomiest tutorial board, and the reason it can promise no dead ends while still
    // taking a while to solve.
    if (level === 3) return plain(3, 2, 6, { forgiving: true });
    // No forced move before level 6, declared rather than hoped for: the Dart build happened
    // to generate boards with none here, and "happened to" is not a curve.
    if (level <= 5) return plain(4, 1, 8, { maxForced: 0 });
    // Deliberately the loosest board in the run — a breather before six colours arrive.
    if (level === 6) return plain(4, 2, 12, { maxForced: 0 });
    if (level === 7) return plain(6, 1, 12, { maxForced: 2 });
    if (level <= 9) return plain(7, 1, 14, { maxForced: 3 });

    const bottles = Math.min(Math.max(8 + 2 * Math.floor((level - 10) / 5), 8), MAX_BOTTLES);
    const cap = bottles <= 10 ? 10 : bottles <= 16 ? 14 : 18;
    const overflow = Math.floor((cap - 2) / CAPACITY);
    const plainBottles = bottles - 1 - overflow;
    return {
        // Climbs to the ceiling and stays there. Past that the board grows by giving the
        // colours it has more bottles, never by inventing a hue nobody can tell from another.
        colours: Math.min(plainBottles, MAX_PLAIN_COLOURS),
        plainBottles,
        freeTubes: 0,
        collectorCap: cap,
        minMoves: bottles + 4,
        forgiving: false,
        maxForced: null,
    };
}

/** Units of the collector's colour already in it, so every bottle can start exactly full. */
function collectorSeed(params) {
    return params.collectorCap % CAPACITY;
}

function deal(params, extraFree, random) {
    const units = [];
    // Bottles per colour, as even as the numbers allow: the first few take the remainder, so
    // thirteen bottles across eight colours is 2,2,2,2,2,1,1,1. Insisting every colour fill the
    // same number forces a whole-number division, and that division is what once made the
    // colour count fall as boards grew.
    const each = Math.floor(params.plainBottles / params.colours);
    const extra = params.plainBottles % params.colours;
    for (let colour = 0; colour < params.colours; colour++) {
        const bottles = each + (colour < extra ? 1 : 0);
        for (let i = 0; i < CAPACITY * bottles; i++) units.push(colour);
    }
    const collectorColour = params.collectorCap > 0 ? params.colours : -1;
    const seed = collectorSeed(params);
    for (let i = 0; i < params.collectorCap - seed; i++) units.push(collectorColour);

    for (let i = units.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [units[i], units[j]] = [units[j], units[i]];
    }

    const dealt = CAPACITY * params.plainBottles + params.collectorCap - seed;
    const filled = Math.ceil(dealt / CAPACITY);
    const tubes = [];
    const caps = [];
    let at = 0;
    for (let i = 0; i < filled + params.freeTubes + extraFree; i++) {
        tubes.push(units.slice(at, Math.min(at + CAPACITY, units.length)));
        caps.push(CAPACITY);
        at += CAPACITY;
    }
    let collector = -1;
    if (params.collectorCap > 0) {
        collector = tubes.length;
        // Seeded, so the tube says which colour it takes before the player has to guess.
        tubes.push(new Array(seed).fill(collectorColour));
        caps.push(params.collectorCap);
    }
    return board(tubes, caps, collector, collectorColour);
}

/**
 * The board for `level` — the same board every time, because it is derived from the level
 * number and nothing else.
 *
 * Boards are filled at random and then *verified* with the solver rather than built by
 * shuffling a solved board backwards. The solver has to exist anyway (hints read its path, and
 * the page announces dead boards from it), so this reuses it instead of adding a second piece
 * of generation logic that could disagree with it.
 */
export function generate(level) {
    const base = paramsFor(level);
    // Attempts come before slack: the table is a design decision, and quietly adding a bottle
    // because one random fill came out unsolvable would change the level rather than reject the
    // fill. Extra free bottles make a board strictly easier, so escalating them terminates.
    for (let slack = 0; slack <= 3; slack++) {
        const attempts = slack === 0 ? 400 : 200;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const random = rng(level * 1000003 + slack * 1009 + attempt);
            const candidate = deal(base, base.collectorCap === 0 ? slack : 0, random);
            if (isWon(candidate)) continue;
            const result = solve(candidate);
            if (!result.path || result.path.length < base.minMoves) continue;
            if (base.forgiving && hasDeadEnd(candidate)) continue;
            if (base.maxForced !== null && forcedMoves(candidate) > base.maxForced) continue;
            return candidate;
        }
    }
    throw new Error(`no solvable board for level ${level}`);
}

/** The extra bottle: appended last, so its arrival cannot shift the collector's index. */
export function grantExtra(b, cap = CAPACITY) {
    b.tubes.push([]);
    b.caps.push(cap);
    return b.tubes.length - 1;
}
