/*
 * StackO!'s rules. No DOM and no canvas here, which is what makes selftest.html possible.
 *
 * A slab slides in above the tower; dropping it keeps only the part that overlaps the slab
 * below, and the overhang is sliced away. Every imperfect drop therefore leaves the next slab
 * narrower, and missing entirely ends the run.
 *
 * There is no physics in this: placement is arithmetic on one-dimensional intervals, which is
 * what keeps it exact. The slab only ever misses along the axis it was travelling on, so the
 * other axis never enters the sum. The falling scraps are decoration and live in play.js.
 */

/* --- geometry --- */
export const BASE_SIZE = 9.0;
export const BLOCK_HEIGHT = 1.5;
/* How far the slab travels before turning back. It has to exceed BASE_SIZE or the slab never
   clears the tower and the two read as one shape at the extremes. */
export const MOVE_RANGE = 10.5;

/* --- feel --- */
export const PERFECT_TOL = 0.2;
export const PERFECT_REGROW = 0.28;
/* A streak of twenty should feel good, not end the scoring system, so the bonus is linear and
   capped rather than multiplied. */
export const COMBO_BONUS_MAX = 8;

const SPEED_START = 7.0;
const SPEED_MAX = 22.0;
const SPEED_RAMP_BLOCKS = 45.0;

/*
 * One mode. The app offers three — a thirty-second Speed run and a ten-block Precision run
 * alongside this — and they are the meta around the drop rather than the drop itself, which
 * is the same line the other four browser builds are drawn on.
 *
 * What Classic means, now that nothing varies: no clock, no block limit, every block scores,
 * and a perfect wins width back.
 */
export const REGROW = true;

/* --- colour --- */

function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const [r, g, b] = [
        [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
    ][i % 6];
    return [r, g, b];
}

/*
 * The NEON band: cyan through magenta, cycling every 24 blocks. A theme has to be a band
 * rather than one colour, or a tall tower is a single flat wall — and the band avoids the
 * muddy stretch of the wheel, which is why it is a cosine sweep between two hues rather than
 * a walk all the way round.
 */
const HUE_BASE = 0.47;
const HUE_SPAN = 0.44;
const CYCLE = 24.0;

export function colourFor(index, lighten = 0) {
    const phase = 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / CYCLE);
    const [r, g, b] = hsvToRgb(HUE_BASE + HUE_SPAN * phase, 0.82, 1.0);
    const mix = (c) => Math.round(255 * (c + (1 - c) * lighten));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/* --- a run --- */

/**
 * The slab speeds up as the tower grows, then holds. It stops climbing because past that
 * point the slab is moving faster than a player can read rather than faster than they can
 * react, which is a different and much less interesting kind of hard.
 */
export function speedFor(placed) {
    const t = Math.min(Math.max(placed / SPEED_RAMP_BLOCKS, 0), 1);
    return SPEED_START + (SPEED_MAX - SPEED_START) * t;
}

export function newRun() {
    const run = {
        // The foundation is placed, not dropped, so it does not count towards the score.
        blocks: [{ x: 0, z: 0, w: BASE_SIZE, d: BASE_SIZE }],
        placed: 1,
        score: 0,
        combo: 0,
        bestCombo: 0,
        perfects: 0,
        axis: 0,
        moving: null,
        over: false,
        reason: '',
    };
    spawn(run);
    return run;
}

/**
 * Puts the next slab at the far end of its travel, moving back towards the tower.
 *
 * Always from the positive end. Under this isometric angle +x is the bottom-right corner of
 * the screen and +z the bottom-left, so alternating the axis alone gives the two near
 * entrances the game wants; flipping the direction as well would send half the slabs in from
 * the far corners, which reads as them coming from above.
 */
export function spawn(run) {
    const top = run.blocks[run.blocks.length - 1];
    run.moving = {
        x: run.axis === 0 ? top.x + MOVE_RANGE : top.x,
        z: run.axis === 1 ? top.z + MOVE_RANGE : top.z,
        w: top.w,
        d: top.d,
        dir: -1,
        home: run.axis === 0 ? top.x : top.z,
    };
}

/** Slides the moving slab, turning it back at each end of its travel. */
export function advance(run, seconds) {
    if (run.over || !run.moving) return;
    const m = run.moving;
    const speed = speedFor(run.placed);
    let pos = (run.axis === 0 ? m.x : m.z) + m.dir * speed * seconds;

    if (pos < m.home - MOVE_RANGE) {
        pos = m.home - MOVE_RANGE;
        m.dir = 1;
    } else if (pos > m.home + MOVE_RANGE) {
        pos = m.home + MOVE_RANGE;
        m.dir = -1;
    }
    if (run.axis === 0) m.x = pos;
    else m.z = pos;
}

/**
 * Resolves a drop. Returns what happened, so the renderer can react without re-deriving it.
 *
 * `result` is 'perfect', 'sliced' or 'miss'. A slice comes back with the piece that was cut
 * off, which is the only thing on screen that moves under its own steam.
 */
export function drop(run) {
    if (run.over || !run.moving) return { result: 'none' };

    const top = run.blocks[run.blocks.length - 1];
    const m = run.moving;
    const axis = run.axis;

    const movingPos = axis === 0 ? m.x : m.z;
    const prevPos = axis === 0 ? top.x : top.z;
    const delta = movingPos - prevPos;
    const span = axis === 0 ? top.w : top.d;
    const overlap = span - Math.abs(delta);

    if (overlap <= 0) {
        const lost = { ...m };
        run.moving = null;
        run.over = true;
        run.reason = 'missed the tower completely';
        return { result: 'miss', lost };
    }

    const perfect = Math.abs(delta) <= PERFECT_TOL;
    const block = { x: m.x, z: m.z, w: m.w, d: m.d };
    let slice = null;

    if (perfect) {
        // Snapping true and winning a little width back: the only way a tower ever recovers
        // from a sloppy drop, which is what stops a long run being a slow slide into a sliver.
        block.x = top.x;
        block.z = top.z;
        block.w = Math.min(BASE_SIZE, top.w + PERFECT_REGROW);
        block.d = Math.min(BASE_SIZE, top.d + PERFECT_REGROW);
        run.perfects += 1;
        run.combo += 1;
        run.bestCombo = Math.max(run.bestCombo, run.combo);
    } else {
        // The landed block is the overlap, centred halfway between the two.
        if (axis === 0) {
            block.x = top.x + delta / 2;
            block.z = top.z;
            block.w = overlap;
            block.d = top.d;
            const sliceW = Math.abs(delta);
            slice = {
                x: delta > 0 ? top.x + span / 2 + sliceW / 2 : top.x - span / 2 - sliceW / 2,
                z: top.z,
                w: sliceW,
                d: top.d,
            };
        } else {
            block.x = top.x;
            block.z = top.z + delta / 2;
            block.w = top.w;
            block.d = overlap;
            const sliceD = Math.abs(delta);
            slice = {
                x: top.x,
                z: delta > 0 ? top.z + span / 2 + sliceD / 2 : top.z - span / 2 - sliceD / 2,
                w: top.w,
                d: sliceD,
            };
        }
        run.combo = 0;
    }

    // Every block scores, and a perfect adds its streak on top, so accuracy compounds instead
    // of merely avoiding loss. `combo` was incremented above, so the first perfect pays 2.
    const gained = perfect ? 1 + Math.min(run.combo, COMBO_BONUS_MAX) : 1;
    run.score += gained;

    run.blocks.push(block);
    run.placed += 1;
    run.moving = null;
    run.axis = 1 - run.axis;

    spawn(run);
    return { result: perfect ? 'perfect' : 'sliced', block, slice, gained };
}
