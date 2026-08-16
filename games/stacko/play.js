/*
 * The browser build of StackO!: an isometric renderer, a fixed-step loop and saving. The
 * rules are in model.js, which has no canvas in it and is checked by selftest.html.
 *
 * The Android build is a real 3D scene in Godot. Here the tower is drawn as flat quads under
 * an isometric projection, which is all the camera ever showed anyway — the angle never moves
 * and nothing rotates, so three faces per block is the whole of it. No WebGL, no 3D library.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    BASE_SIZE,
    BLOCK_HEIGHT,
    MOVE_RANGE,
    advance,
    colourFor,
    drop,
    newRun,
} from './model.js';

/* The isometric angle: a 2:1 diamond, the same one the Godot camera looks down. */
const ISO_X = 0.866;
const ISO_Y = 0.5;

/* A fixed step, so the slab travels the same distance per second on a 60Hz laptop and a
   120Hz phone. Sliding the whole thing off `requestAnimationFrame` deltas would make the
   game literally twice as fast on the faster screen. */
const STEP = 1 / 120;
/* If the tab was hidden or the machine stalled, catch up by at most this much and drop the
   rest. Without a ceiling, returning to a backgrounded tab runs thousands of steps at once
   and the slab teleports. */
const MAX_CATCHUP = 0.25;

const DEBRIS_FALL = 26.0;
const DEBRIS_LIFETIME = 1.6;
const RING_TIME = 0.42;
const SQUASH_TIME = 0.22;

const save = storage('stacko');

const boardEl = document.getElementById('board');
const canvas = document.getElementById('scene');
const context = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const hintEl = document.getElementById('hint');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetText = document.getElementById('sheet-text');
const sheetAction = document.getElementById('sheet-action');

let run = null;
let scale = 10;
let cameraY = 0;
let debris = [];
let rings = [];
let squash = null;
let last = 0;
let accumulator = 0;

/* ---------- projection ---------- */

/** World to screen. `y` is height in world units, positive upwards. */
function project(x, y, z) {
    return [
        canvas.width / 2 + (x - z) * ISO_X * scale,
        canvas.height * 0.62 + (x + z) * ISO_Y * scale - (y - cameraY) * scale,
    ];
}

function shade(colour, factor) {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

function polygon(points, fill) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
}

/**
 * One block: the top face and the two sides that face the camera.
 *
 * Under this projection larger x and larger z are both nearer the viewer, so the +x and +z
 * faces are the visible pair and the other two never need drawing. The three tones are what
 * make it read as a solid rather than a flat diamond.
 */
function drawBlock(block, base, colour, squashAmount = 0) {
    const height = BLOCK_HEIGHT * (1 - squashAmount);
    const grow = 1 + squashAmount * 0.35;
    const hw = (block.w / 2) * grow;
    const hd = (block.d / 2) * grow;
    const top = base + height;
    const { x, z } = block;

    const tl = project(x - hw, top, z - hd);
    const tr = project(x + hw, top, z - hd);
    const br = project(x + hw, top, z + hd);
    const bl = project(x - hw, top, z + hd);
    const drop = height * scale;
    const down = ([sx, sy]) => [sx, sy + drop];

    polygon([bl, br, down(br), down(bl)], shade(colour, 0.52));
    polygon([tr, br, down(br), down(tr)], shade(colour, 0.74));
    polygon([tl, tr, br, bl], colour);
}

/** The expanding square that snaps out of a landing. Four segments, so it echoes the slab. */
function drawRing(ring) {
    const t = ring.age / RING_TIME;
    if (t >= 1) return;
    const spread = 1 + (ring.perfect ? 2.6 : 1.6) * t;
    const hw = (ring.w / 2) * spread;
    const hd = (ring.d / 2) * spread;
    const y = ring.y;

    context.beginPath();
    const corners = [
        project(ring.x - hw, y, ring.z - hd),
        project(ring.x + hw, y, ring.z - hd),
        project(ring.x + hw, y, ring.z + hd),
        project(ring.x - hw, y, ring.z + hd),
    ];
    context.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < 4; i++) context.lineTo(corners[i][0], corners[i][1]);
    context.closePath();
    context.strokeStyle = ring.perfect
        ? `rgba(255, 255, 255, ${1 - t})`
        : `rgba(61, 224, 255, ${0.7 * (1 - t)})`;
    context.lineWidth = (ring.perfect ? 3 : 2) * Math.max(0.4, 1 - t);
    context.stroke();
}

function render() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Far to near is simply bottom to top here: nothing overlaps sideways.
    for (let i = 0; i < run.blocks.length; i++) {
        const amount = squash && squash.index === i
            ? (1 - squash.age / SQUASH_TIME) * 0.42
            : 0;
        drawBlock(run.blocks[i], i * BLOCK_HEIGHT, colourFor(i), Math.max(0, amount));
    }

    for (const piece of debris) {
        context.globalAlpha = Math.max(0, 1 - piece.age / DEBRIS_LIFETIME);
        drawBlock(piece, piece.y, shade(piece.colour, 0.8));
        context.globalAlpha = 1;
    }

    if (run.moving) drawBlock(run.moving, run.placed * BLOCK_HEIGHT, colourFor(run.placed));

    for (const ring of rings) drawRing(ring);
}

/* ---------- the loop ---------- */

function step(seconds) {
    if (!run.over) advance(run, seconds);

    for (const piece of debris) {
        piece.age += seconds;
        piece.fall += DEBRIS_FALL * seconds * (piece.age + 0.2);
        piece.y = piece.startY - piece.fall;
    }
    debris = debris.filter((piece) => piece.age < DEBRIS_LIFETIME);

    for (const ring of rings) ring.age += seconds;
    rings = rings.filter((ring) => ring.age < RING_TIME);

    if (squash) {
        squash.age += seconds;
        if (squash.age >= SQUASH_TIME) squash = null;
    }

    // The camera rises to keep the top of the tower in the same place on screen.
    const target = Math.max(0, (run.placed - 3) * BLOCK_HEIGHT);
    cameraY += (target - cameraY) * Math.min(1, seconds * 6);
}

function frame(now) {
    const seconds = last === 0 ? 0 : Math.min((now - last) / 1000, MAX_CATCHUP);
    last = now;
    accumulator += seconds;

    while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
    }

    render();
    updateHud();
    requestAnimationFrame(frame);
}

/* ---------- chrome ---------- */

function updateHud() {
    scoreEl.textContent = String(run.score);
}

/**
 * The board's readout. One line, in one place: the instruction to begin, then what the last
 * drop was worth. A player watching the slab should not have to look away from it to read the
 * result of their own tap.
 */
function say(message, perfect = false) {
    hintEl.textContent = message;
    hintEl.classList.toggle('perfect', perfect);
}

function finish() {
    const best = Number(save.get('best', 0)) || 0;
    const beaten = run.score > best;
    if (beaten) save.set('best', run.score);
    bestEl.textContent = String(Math.max(best, run.score));

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    sheetTitle.textContent = beaten ? 'New best' : 'Run over';
    sheetText.textContent = `${plural(run.score, 'point')} from ${plural(run.placed - 1, 'block')}`
        + (run.bestCombo > 1 ? `, best streak ${run.bestCombo}` : '')
        + `. You ${run.reason}.`;
    sheetAction.textContent = 'Play again';
    sheet.hidden = false;
    say(run.reason === 'missed the tower completely' ? 'Missed' : run.reason);
}

/* ---------- playing ---------- */

function tap() {
    if (!run || run.over) return;
    // The pulse is an invitation, and it has been accepted.
    hintEl.classList.remove('idle');

    const result = drop(run);
    if (result.result === 'none') return;

    if (result.result === 'miss') {
        debris.push({
            ...result.lost,
            y: (run.placed) * BLOCK_HEIGHT,
            startY: (run.placed) * BLOCK_HEIGHT,
            fall: 0,
            age: 0,
            colour: colourFor(run.placed),
        });
        finish();
        return;
    }

    const level = run.blocks.length - 1;
    squash = { index: level, age: 0 };
    rings.push({
        x: result.block.x,
        z: result.block.z,
        w: result.block.w,
        d: result.block.d,
        y: (level + 1) * BLOCK_HEIGHT,
        perfect: result.result === 'perfect',
        age: 0,
    });

    if (result.slice) {
        debris.push({
            ...result.slice,
            y: level * BLOCK_HEIGHT,
            startY: level * BLOCK_HEIGHT,
            fall: 0,
            age: 0,
            colour: colourFor(level),
        });
    }

    if (result.result === 'perfect') {
        say(run.combo > 1 ? `Perfect ×${run.combo}` : 'Perfect', true);
    } else {
        const blocks = run.placed - 1;
        say(`${blocks} block${blocks === 1 ? '' : 's'}`);
    }

    if (result.finished) finish();
}

function start() {
    run = newRun();
    debris = [];
    rings = [];
    squash = null;
    cameraY = 0;
    sheet.hidden = true;
    hintEl.classList.add('idle');
    hintEl.classList.remove('perfect');

    bestEl.textContent = String(Number(save.get('best', 0)) || 0);
    resize();
    say('Tap to drop');
}

/* ---------- sizing ---------- */

/**
 * The canvas is sized in device pixels and scaled back down in CSS, or the diagonals of every
 * block come out soft on a phone. The world scale is derived from the width so the slab's full
 * travel always fits, whatever size the shell gave the board.
 */
function resize() {
    const rect = boardEl.getBoundingClientRect();
    if (rect.width === 0) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // The widest the scene ever gets: a slab at the end of its travel, half of it beyond.
    const span = (MOVE_RANGE + BASE_SIZE / 2) * 2 * ISO_X;
    scale = canvas.width / (span * 1.12);
}

new ResizeObserver(resize).observe(boardEl);

/* ---------- input ---------- */

boardEl.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    tap();
});

window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (sheet.hidden) tap();
});

sheetAction.addEventListener('click', start);
document.getElementById('restart').addEventListener('click', start);

// Closing the card leaves the finished tower on screen to look at. The panel's New run is
// what starts another, which is why that button is not on the card alone.
document.getElementById('sheet-close').addEventListener('click', () => {
    sheet.hidden = true;
    say('Run over');
});

/* ---------- boot ---------- */

if (!isPersistent()) document.getElementById('warning').hidden = false;

start();
requestAnimationFrame(frame);
