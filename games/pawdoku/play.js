/*
 * The browser build of Pawdoku: board, taps, lives and saving. The rules and the generator
 * are in model.js, which has no DOM in it and is checked by selftest.html.
 *
 * Endless levels only. The app's daily challenge, coins, store, trophies, hints and paws are
 * all deliberately absent — this is the puzzle, not the economy around it.
 *
 * The tap model is the app's, and it is not the obvious one:
 *
 *   - a tap marks the player's own X, and taps it away again;
 *   - a second tap on the same cell within 200ms upgrades it to a paw;
 *   - a long press places a paw directly;
 *   - dragging paints X across cells.
 *
 * A paw is only correct where the solution puts one. Anywhere else costs a life and leaves a
 * red cross that cannot be cleared.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    BLOCKED,
    CAT,
    EMPTY,
    LOCKED,
    MAX_HEARTS,
    boardSizeForLevel,
    catsIn,
    generate,
    isSolved,
    summon,
    toggleNote,
} from './model.js';

/* The Android palette, chosen rather than generated: one red, one green, a warm rose that
   does not collapse onto the blues, light and dark alternating so neighbours stay apart. */
const REGION_COLORS = [
    '#f4dc7a', '#4e7cc0', '#e0795c', '#e693b4', '#7cc6a9',
    '#d99a3c', '#a9dceb', '#9aa5b1', '#a85e86',
];

/* Material's `pets` glyph, which is the paw the Android build draws. Inline so it takes the
   fill colour and stays sharp at any board size, with no icon font to load. */
const PAW_PATH = 'M4.5 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm4.5-4a2.5 2.5 0 1 0 0 5 '
    + '2.5 2.5 0 0 0 0-5zm6 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm4.5 4a2.5 2.5 0 1 0 0 5 '
    + '2.5 2.5 0 0 0 0-5zm-2.16 5.36c-.87-1.02-1.6-1.89-2.48-2.91-.46-.54-1.05-1.08-1.75-1.32'
    + '-.11-.04-.22-.07-.33-.09-.25-.04-.52-.04-.78-.04s-.53 0-.79.05c-.11.02-.22.05-.33.09'
    + '-.7.24-1.28.78-1.75 1.32-.87 1.02-1.6 1.89-2.48 2.91-1.31 1.31-2.92 2.76-2.62 4.79'
    + '.29 1.02 1.02 2.03 2.33 2.32.73.15 3.06-.44 5.54-.44h.18c2.48 0 4.81.58 5.54.44 '
    + '1.31-.29 2.04-1.31 2.33-2.32.31-2.04-1.3-3.49-2.61-4.8z';

/** The app's window for "that was a second tap, not a new one". */
const DOUBLE_TAP_MS = 200;
const LONG_PRESS_MS = 500;
const DRAG_SLOP = 8;

const save = storage('pawdoku');

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const counterEl = document.getElementById('counter');
const heartsEl = document.getElementById('hearts');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetText = document.getElementById('sheet-text');
const sheetAction = document.getElementById('sheet-action');

let level = Math.max(1, Number(save.get('level', 1)) || 1);
let puzzle = null;
let states = [];
let hearts = MAX_HEARTS;
let over = false;

/* ---------- saved state ---------- */

function persist() {
    save.set('level', level);
    save.set('board', { states: [...states], hearts, over, level });
}

/** A saved board is trusted only as far as it is the right length and holds known states. */
function usableStates(saved, size) {
    if (!Array.isArray(saved) || saved.length !== size * size) return null;
    return saved.every((s) => s === EMPTY || s === CAT || s === BLOCKED || s === LOCKED)
        ? [...saved]
        : null;
}

/* ---------- rendering ---------- */

/**
 * Draws the board: separate rounded tiles with a gap, on a white card, with no region borders
 * at all. Colour alone groups the cells, one colour per region — which is how the Android
 * build looks, and it is what keeps this reading as a friendly puzzle rather than a worksheet.
 */
function buildBoard() {
    const n = puzzle.n;
    boardEl.style.setProperty('--cells', n);
    boardEl.replaceChildren();

    for (let cell = 0; cell < n * n; cell++) {
        const tile = document.createElement('div');
        tile.className = 'cell';
        tile.dataset.cell = cell;
        tile.setAttribute('role', 'gridcell');
        tile.style.background = REGION_COLORS[puzzle.regions[cell] % REGION_COLORS.length];
        boardEl.appendChild(tile);
    }
}

function pawMark() {
    const disc = document.createElement('span');
    disc.className = 'mark paw';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', PAW_PATH);
    svg.appendChild(path);
    disc.appendChild(svg);
    return disc;
}

function crossMark(locked) {
    const mark = document.createElement('span');
    mark.className = locked ? 'mark cross locked' : 'cross note';
    return mark;
}

const LABELS = { [CAT]: 'paw', [BLOCKED]: 'marked empty', [LOCKED]: 'wrong guess' };

function render() {
    for (const tile of boardEl.children) {
        const state = states[Number(tile.dataset.cell)];
        tile.replaceChildren();

        if (state === EMPTY) {
            tile.removeAttribute('aria-label');
            continue;
        }
        tile.appendChild(state === CAT ? pawMark() : crossMark(state === LOCKED));
        tile.setAttribute('aria-label', LABELS[state]);
    }

    counterEl.textContent = String(level);

    heartsEl.replaceChildren();
    for (let i = 0; i < MAX_HEARTS; i++) {
        const heart = document.createElement('span');
        // Outlined rather than faded for a lost life, which is what the app shows.
        heart.textContent = i < hearts ? '♥' : '♡';
        heartsEl.appendChild(heart);
    }
    heartsEl.setAttribute('aria-label', `${hearts} of ${MAX_HEARTS} lives left`);
}

function say(message) {
    statusEl.textContent = message;
}

/* ---------- playing ---------- */

function finish(won, message) {
    over = true;

    // Save the finished board under the level it actually belongs to, and only then advance
    // the counter. The other order files a solved board against the *next* level, and the
    // next level then loads already solved.
    persist();
    if (won) {
        level += 1;
        save.set('level', level);
    }

    render();
    say(message);

    sheetTitle.textContent = won ? 'Solved' : 'Out of lives';
    sheetText.textContent = won ? `Level ${level - 1} done. On to ${level}.` : message;
    sheetAction.textContent = won ? 'Next level' : 'Try again';
    sheet.hidden = false;
}

function flash(cell, className) {
    const tile = boardEl.children[cell];
    tile.classList.remove('rejected', 'landed');
    // Reading offsetWidth restarts the animation, so two wrong guesses in a row both show.
    void tile.offsetWidth;
    tile.classList.add(className);
}

function doToggle(cell) {
    if (over || !toggleNote(states, cell)) return;
    render();
    persist();
}

function doSummon(cell) {
    if (over) return;

    const result = summon(puzzle, states, cell);
    if (result === 'ignored') return;

    if (result === 'wrong') {
        hearts -= 1;
        flash(cell, 'rejected');
        say(hearts > 0
            ? `No paw there. ${hearts} ${hearts === 1 ? 'life' : 'lives'} left.`
            : 'No paw there.');
        render();
        persist();
        if (hearts <= 0) finish(false, 'Out of lives.');
        return;
    }

    flash(cell, 'landed');
    render();
    persist();

    if (isSolved(puzzle, catsIn(states))) {
        finish(true, 'Solved.');
        return;
    }
    say(`${catsIn(states).length} of ${puzzle.n} placed.`);
}

/* ---------- input ---------- */

function cellAt(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right
        || clientY < rect.top || clientY > rect.bottom) return null;
    const column = Math.floor(((clientX - rect.left) / rect.width) * puzzle.n);
    const row = Math.floor(((clientY - rect.top) / rect.height) * puzzle.n);
    if (row < 0 || row >= puzzle.n || column < 0 || column >= puzzle.n) return null;
    return row * puzzle.n + column;
}

let press = null;
let lastTapCell = null;
let lastTapAt = 0;

boardEl.addEventListener('pointerdown', (event) => {
    if (over) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;

    event.preventDefault();
    press = {
        cell,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        painted: false,
        handled: false,
        timer: setTimeout(() => {
            // Long press places a paw directly. Marked handled so the release does not also
            // toggle the note underneath it.
            if (!press || press.handled || press.painted) return;
            press.handled = true;
            doSummon(cell);
        }, LONG_PRESS_MS),
    };

    try {
        boardEl.setPointerCapture(event.pointerId);
    } catch {
        // Capture only keeps a drag that wanders off the board reporting here. Losing it must
        // not abort the handler and strand `press`.
    }
});

boardEl.addEventListener('pointermove', (event) => {
    if (!press || press.id !== event.pointerId || press.handled) return;
    if (Math.abs(event.clientX - press.x) < DRAG_SLOP
        && Math.abs(event.clientY - press.y) < DRAG_SLOP) return;

    // Past the slop this is a drag, not a tap. Dragging paints the player's X across cells;
    // it never disturbs a paw or a locked cross, which is what toggleNote already refuses.
    clearTimeout(press.timer);
    const cell = cellAt(event.clientX, event.clientY);
    if (cell === null) return;

    if (!press.painted) {
        press.painted = true;
        if (states[press.cell] === EMPTY) toggleNote(states, press.cell);
    }
    if (states[cell] === EMPTY) {
        toggleNote(states, cell);
        render();
        persist();
    }
});

function endPress(event) {
    if (!press || press.id !== event.pointerId) return;
    clearTimeout(press.timer);

    const finished = press;
    press = null;
    if (finished.handled || finished.painted) {
        lastTapCell = null;
        return;
    }

    const cell = cellAt(event.clientX, event.clientY) ?? finished.cell;
    const now = Date.now();
    if (cell === lastTapCell && now - lastTapAt < DOUBLE_TAP_MS) {
        // A quick second tap on the same cell upgrades the note to a paw. The first tap has
        // already left an X there, and summon overwrites it either way.
        lastTapCell = null;
        doSummon(cell);
    } else {
        lastTapCell = cell;
        lastTapAt = now;
        doToggle(cell);
    }
}

boardEl.addEventListener('pointerup', endPress);

for (const ending of ['pointercancel', 'lostpointercapture']) {
    boardEl.addEventListener(ending, () => {
        if (press) clearTimeout(press.timer);
        press = null;
    });
}

// A long press on a touch screen otherwise opens the browser's own text-selection menu.
boardEl.addEventListener('contextmenu', (event) => event.preventDefault());

/* ---------- starting a puzzle ---------- */

function load(fresh = false) {
    sheet.hidden = true;

    const size = boardSizeForLevel(level);
    puzzle = generate(size, (level * 2654435761) >>> 0);
    if (!puzzle) {
        // 200 attempts all got stuck. Vanishingly unlikely, but a page that says so beats a
        // page that is silently blank.
        say('Could not build a board for this level. Please reload.');
        return;
    }

    const saved = fresh ? null : save.get('board', null);
    const restored = saved && typeof saved === 'object' && saved.level === level
        ? usableStates(saved.states, size)
        : null;

    if (restored) {
        states = restored;
        hearts = Number.isInteger(saved.hearts) ? Math.min(saved.hearts, MAX_HEARTS) : MAX_HEARTS;
        over = saved.over === true;
    } else {
        states = new Array(size * size).fill(EMPTY);
        hearts = MAX_HEARTS;
        over = false;
    }

    if (hearts <= 0) over = true;
    if (isSolved(puzzle, catsIn(states))) over = true;

    buildBoard();
    render();
    persist();

    if (over) {
        const won = isSolved(puzzle, catsIn(states));
        say(won ? 'Solved.' : 'Out of lives. Restart to try again.');
        sheetTitle.textContent = won ? 'Solved' : 'Out of lives';
        sheetText.textContent = won
            ? 'Ready for the next level.'
            : 'Restart to try this board again.';
        sheetAction.textContent = won ? 'Next level' : 'Try again';
        sheet.hidden = false;
    } else {
        say('Tap to mark. Tap twice, or hold, to place a paw.');
    }
}

document.getElementById('restart').addEventListener('click', () => load(true));

sheetAction.addEventListener('click', () => {
    // After a win the level has already advanced, so this builds the next board. After a loss
    // it is a fresh go at the same one.
    load(true);
});

document.getElementById('sheet-close').addEventListener('click', () => {
    sheet.hidden = true;
});

/* ---------- boot ---------- */

if (!isPersistent()) document.getElementById('warning').hidden = false;

load();
