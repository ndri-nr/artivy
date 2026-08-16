/*
 * The browser build of 2048: rendering, input and saving. All the rules live in model.js,
 * which has no DOM in it and is checked by selftest.html.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    SIZE,
    canMove,
    compact,
    fromValues,
    highest,
    move,
    newGame,
    spawn,
    toValues,
} from './model.js';

/* Tile ramp, indexed by the tile's exponent minus one: cool ash climbs to ember, cools back
   down past 2048 so the late game reads as its own band, then leaves the warm family
   entirely. Same ramp as the Android build. The last entry is the catch-all, so a renderer
   never has to guess at a value the palette does not reach. */
const TILE_COLORS = [
    '#352c25', '#473a2f', '#6b4a2c', '#8a5629', '#a55f27', '#be6a26', '#ce7e2e',
    '#db9739', '#e6b14a', '#efc862', '#f6de8c', '#c0553b', '#a33f55', '#7b4468',
    '#554c74', '#3e5c6e', '#3b6b5e', '#2f6e7a', '#2b5f86', '#4b4e9c', '#6a46a0',
    '#8b3f96', '#a93a7e', '#b8465f', '#9e5a53', '#86685a', '#6e7362', '#5a6b72',
];

/* Only the three brightest tiles in the ramp take dark numerals. Everything above 2048
   goes dark again in the palette, so it is light-on-dark once more. */
const DARK_NUMERALS = new Set([512, 1024, 2048]);

const TEXT = {
    en: {
        score: 'SCORE',
        best: 'BEST',
        newGame: 'New game',
        undo: 'Undo',
        hint: 'Swipe, or use the arrow keys.',
        privacy: 'Privacy',
        terms: 'Terms',
        about: 'About',
        noStorage: 'This browser is not letting the page save, so this run will not survive a reload.',
        wonTitle: '2048',
        wonText: 'You made it. The run does not have to stop here.',
        keepGoing: 'Keep going',
        overTitle: 'No moves left',
        overText: 'Final score {score}.',
        tryAgain: 'Try again',
        bestRuns: 'Best runs',
        confirmNew: 'Start a new game? The current run will be lost.',
    },
    id: {
        score: 'SKOR',
        best: 'TERBAIK',
        newGame: 'Main lagi',
        undo: 'Urungkan',
        hint: 'Geser, atau pakai tombol panah.',
        privacy: 'Privasi',
        terms: 'Ketentuan',
        about: 'Tentang',
        noStorage: 'Browser ini tidak mengizinkan penyimpanan, jadi permainan ini hilang saat halaman dimuat ulang.',
        wonTitle: '2048',
        wonText: 'Berhasil. Permainan tidak harus berhenti di sini.',
        keepGoing: 'Lanjut main',
        overTitle: 'Tidak ada langkah',
        overText: 'Skor akhir {score}.',
        tryAgain: 'Coba lagi',
        bestRuns: 'Skor terbaik',
        confirmNew: 'Mulai permainan baru? Permainan sekarang akan hilang.',
    },
};

const SLIDE_MS = 110;
const GAP_RATIO = 0.022;

const save = storage('2048');

const board = document.getElementById('board');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const overlayScores = document.getElementById('overlay-scores');
const overlayPrimary = document.getElementById('overlay-primary');
const overlaySecondary = document.getElementById('overlay-secondary');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const undoButton = document.getElementById('undo');
const langButton = document.getElementById('lang');

const elements = new Map();

let grid = null;
let score = 0;
let best = save.get('best', 0);
let topScores = readTopScores();
let acknowledgedWin = false;
let previous = null;
let lang = TEXT[save.get('lang', 'en')] ? save.get('lang', 'en') : 'en';

/* A saved value is whatever was last written, which after a browser crash or a hand-edited
   key is not necessarily a list of numbers. */
function readTopScores() {
    const saved = save.get('top', []);
    if (!Array.isArray(saved)) return [];
    return saved.filter((value) => Number.isFinite(value)).sort((a, b) => b - a).slice(0, 10);
}
let cell = 0;
let gap = 0;

/* ---------- text ---------- */

function t(key) {
    return TEXT[lang][key];
}

function applyText() {
    for (const node of document.querySelectorAll('[data-t]')) {
        node.textContent = t(node.dataset.t);
    }
    langButton.textContent = lang === 'en' ? 'ID' : 'EN';
    document.documentElement.lang = lang;
}

/* ---------- geometry ---------- */

/**
 * Derives the cell size from whatever size the board ended up, and repaints at that scale.
 *
 * How large the board is allowed to be is decided entirely in CSS. This only follows along,
 * which is why it is driven by a ResizeObserver on the board rather than by resize events:
 * every cause — rotation, a resized window, the web font swapping in, mobile browser chrome
 * sliding away — ends up changing the board's box, and that is the one thing worth watching.
 */
function measure() {
    const size = board.getBoundingClientRect().width;
    if (size === 0) return;

    gap = size * GAP_RATIO;
    cell = (size - gap * (SIZE + 1)) / SIZE;
    board.style.setProperty('--cell', `${cell}px`);

    board.classList.add('no-anim');
    render();
    // Let the no-animation frame paint before slides are allowed again, so a resize does not
    // look like every tile sliding into place.
    requestAnimationFrame(() => board.classList.remove('no-anim'));
}

function offset(index) {
    return gap + index * (cell + gap);
}

function place(element, x, y) {
    element.style.transform = `translate(${offset(x)}px, ${offset(y)}px)`;
}

/* ---------- rendering ---------- */

function backdrop() {
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const slot = document.createElement('div');
            slot.className = 'cell';
            slot.dataset.x = x;
            slot.dataset.y = y;
            board.appendChild(slot);
        }
    }
}

function positionBackdrop() {
    for (const slot of board.querySelectorAll('.cell')) {
        place(slot, Number(slot.dataset.x), Number(slot.dataset.y));
    }
}

function paint(element, value) {
    const index = Math.min(Math.log2(value) - 1, TILE_COLORS.length - 1);
    const label = compact(value);
    element.style.background = TILE_COLORS[Math.max(0, index)];
    element.style.color = DARK_NUMERALS.has(value) ? '#241d17' : '#f0e7da';
    element.style.fontSize = `${cell * fontScale(label.length)}px`;
    element.textContent = label;
}

function fontScale(length) {
    if (length <= 2) return 0.44;
    if (length === 3) return 0.36;
    if (length === 4) return 0.29;
    return 0.24;
}

/**
 * A brand-new element starts at translate(0, 0) — the board's top-left corner — so the first
 * transform on it would animate from there, and a spawned tile would appear to slide in from
 * the corner rather than simply arrive on its square. Suppressing the transition for one
 * frame puts it where it belongs; the scale-up in `.spawn` is the only motion it should have.
 */
function createTile(id, x, y) {
    const element = document.createElement('div');
    element.className = 'tile';
    element.addEventListener('animationend', () => element.classList.remove('spawn', 'merge'));
    element.style.transition = 'none';
    place(element, x, y);
    board.appendChild(element);

    void element.offsetWidth; // commit the position before motion is allowed again
    element.style.transition = '';

    elements.set(id, element);
    return element;
}

function render() {
    positionBackdrop();

    const alive = new Set();
    const retiring = [];

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const tile = grid[y][x];
            if (!tile) continue;

            alive.add(tile.id);
            const element = elements.get(tile.id) ?? createTile(tile.id, x, y);
            place(element, x, y);
            paint(element, tile.value);

            if (tile.spawned) {
                element.classList.add('spawn');
                delete tile.spawned;
            }

            if (tile.absorbed !== undefined) {
                const swallowed = elements.get(tile.absorbed);
                if (swallowed) {
                    // Slide the losing tile onto the survivor, then drop it once it arrives.
                    place(swallowed, x, y);
                    retiring.push(tile.absorbed);
                }
                element.classList.add('merge');
                delete tile.absorbed;
            }
        }
    }

    for (const [id, element] of elements) {
        if (alive.has(id) || retiring.includes(id)) continue;
        element.remove();
        elements.delete(id);
    }

    if (retiring.length > 0) {
        setTimeout(() => {
            for (const id of retiring) {
                const element = elements.get(id);
                if (!element) continue;
                element.remove();
                elements.delete(id);
            }
        }, SLIDE_MS);
    }

    scoreEl.textContent = compact(score);
    bestEl.textContent = compact(best);
    undoButton.disabled = previous === null;
}

/* ---------- overlays ---------- */

function showScores(highlight) {
    overlayScores.innerHTML = '';
    if (topScores.length === 0) {
        overlayScores.hidden = true;
        return;
    }
    overlayScores.hidden = false;
    let marked = false;
    topScores.forEach((value, index) => {
        const item = document.createElement('li');
        item.textContent = `${index + 1}. ${value}`;
        // Only the first matching row is the run that just ended; a repeated score
        // otherwise lights up every copy of itself.
        if (!marked && value === highlight) {
            item.classList.add('current');
            marked = true;
        }
        overlayScores.appendChild(item);
    });
}

/* The overlay's text is written in, not marked up with data-t, so switching language while
   it is open has to redraw it. This remembers how. */
let redrawOverlay = null;

function showWin() {
    redrawOverlay = showWin;
    overlayTitle.textContent = t('wonTitle');
    overlayText.textContent = t('wonText');
    overlayScores.hidden = true;
    overlayPrimary.textContent = t('keepGoing');
    overlayPrimary.onclick = () => {
        acknowledgedWin = true;
        persist();
        overlay.hidden = true;
    };
    overlaySecondary.hidden = true;
    overlay.hidden = false;
}

/**
 * `record` is false when a dead board is being shown again after a reload. Recording there
 * would add the same run to the table on every refresh.
 */
function showGameOver(record = true) {
    redrawOverlay = () => showGameOver(false);
    if (record) {
        topScores = [...topScores, score].sort((a, b) => b - a).slice(0, 10);
        save.set('top', topScores);
    }

    overlayTitle.textContent = t('overTitle');
    overlayText.textContent = t('overText').replace('{score}', String(score));
    showScores(score);
    overlayPrimary.textContent = t('tryAgain');
    overlayPrimary.onclick = () => start();
    overlaySecondary.hidden = true;
    overlay.hidden = false;
}

/* ---------- game flow ---------- */

function persist() {
    save.set('grid', toValues(grid));
    save.set('score', score);
    save.set('best', best);
    save.set('won', acknowledgedWin);
}

function start() {
    grid = newGame();
    score = 0;
    acknowledgedWin = false;
    previous = null;
    overlay.hidden = true;
    persist();
    render();
}

function step(direction) {
    if (!overlay.hidden) return;

    const snapshot = { values: toValues(grid), score, won: acknowledgedWin };
    const result = move(grid, direction);
    if (!result.moved) return;

    grid = result.grid;
    score += result.gained;
    if (score > best) best = score;
    // One level of undo. A full history is a bigger save and a bigger UI for something
    // players use to take back the last swipe.
    previous = snapshot;

    spawn(grid);
    persist();
    render();

    if (!acknowledgedWin && highest(grid) >= 2048) {
        showWin();
        return;
    }
    if (!canMove(grid)) showGameOver();
}

function undo() {
    if (!previous) return;
    const restored = fromValues(previous.values);
    if (!restored) return;

    grid = restored;
    score = previous.score;
    acknowledgedWin = previous.won;
    previous = null;
    overlay.hidden = true;

    persist();
    board.classList.add('no-anim');
    render();
    requestAnimationFrame(() => board.classList.remove('no-anim'));
}

function restore() {
    const saved = fromValues(save.get('grid', null));
    if (!saved) {
        start();
        return;
    }
    grid = saved;
    score = save.get('score', 0);
    acknowledgedWin = save.get('won', false) === true;
    if (score > best) best = score;
    if (!canMove(grid)) showGameOver(false);
}

/* ---------- input ---------- */

const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
};

window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const direction = KEYS[event.key] ?? KEYS[event.key.toLowerCase?.()];
    if (!direction) return;
    event.preventDefault();
    step(direction);
});

/* Pointer Events cover mouse, touch and pen in one path, so there is no separate touch
   handler to keep in sync. The board carries `touch-action: none`, which is what stops a
   swipe from scrolling the page instead of moving the tiles. */
const SWIPE_MIN = 24;
let swipeStart = null;

board.addEventListener('pointerdown', (event) => {
    swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});

board.addEventListener('pointerup', (event) => {
    if (!swipeStart || swipeStart.id !== event.pointerId) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? 'right' : 'left');
    else step(dy > 0 ? 'down' : 'up');
});

board.addEventListener('pointercancel', () => {
    swipeStart = null;
});

document.getElementById('new').addEventListener('click', () => {
    // Only worth asking when there is a run to lose.
    if (score > 0 && overlay.hidden && !window.confirm(t('confirmNew'))) return;
    start();
});

undoButton.addEventListener('click', undo);

langButton.addEventListener('click', () => {
    lang = lang === 'en' ? 'id' : 'en';
    save.set('lang', lang);
    applyText();
    if (!overlay.hidden && redrawOverlay) redrawOverlay();
});

/* ---------- boot ---------- */

applyText();
backdrop();
restore();

if (!isPersistent()) document.getElementById('warning').hidden = false;

/* Observing fires once straight away, and that first call is what draws the opening board.
   Safe from feedback: `measure` writes --cell, which the board's own size does not depend on. */
new ResizeObserver(measure).observe(board);
