/*
 * The browser build of Pawdoku: board, taps, hearts, the daily clock and saving. The rules
 * and the generator are in model.js, which has no DOM in it and is checked by selftest.html.
 *
 * The tap model is the Android build's, and it is not the obvious one:
 *
 *   - a tap marks the player's own X, and taps it away again;
 *   - a second tap on the same cell within 200ms upgrades it to a cat;
 *   - a long press summons a cat directly, for anyone who would rather not race the timer;
 *   - dragging paints X across cells.
 *
 * A cat is only correct where the solution puts one. Anywhere else costs a life and leaves a
 * red cross that cannot be cleared.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    BLOCKED,
    CAT,
    DAILY_SIZE,
    DAILY_TIME_LIMIT,
    EMPTY,
    LOCKED,
    MAX_HEARTS,
    boardSizeForLevel,
    catsIn,
    dateKey,
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

/* Which of those are dark enough to need light text on top. A lookup rather than luminance
   maths: the palette is fixed and nine long, so this is both simpler and correctable by eye. */
const DARK_REGIONS = new Set([1, 2, 8]);

/** The app's window for "that was a second tap, not a new one". */
const DOUBLE_TAP_MS = 200;
const LONG_PRESS_MS = 500;
const DRAG_SLOP = 8;

const save = storage('pawdoku');

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const counterEl = document.getElementById('counter');
const counterLabel = document.getElementById('counter-label');
const heartsEl = document.getElementById('hearts');
const timerStat = document.getElementById('timer-stat');
const timerEl = document.getElementById('timer');
const endlessButton = document.getElementById('mode-endless');
const dailyButton = document.getElementById('mode-daily');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetText = document.getElementById('sheet-text');
const sheetAction = document.getElementById('sheet-action');

let mode = save.get('mode', 'endless') === 'daily' ? 'daily' : 'endless';
let level = Math.max(1, Number(save.get('level', 1)) || 1);
let puzzle = null;
let states = [];
let hearts = MAX_HEARTS;
let over = false;
/* Wall-clock, not a counter that pauses. Leaving the page and coming back has to restore the
   time that really elapsed, or backing out becomes a way to stop the clock. */
let deadline = null;

/* ---------- saved state ---------- */

function slot() {
    return mode === 'daily' ? `daily.${dateKey(new Date())}` : 'endless';
}

function persist() {
    save.set('mode', mode);
    save.set('level', level);
    save.set(slot(), {
        states: [...states],
        hearts,
        over,
        deadline,
        level: mode === 'endless' ? level : undefined,
    });
}

/** A saved board is trusted only as far as it is the right length and holds known states. */
function usableStates(saved, size) {
    if (!Array.isArray(saved) || saved.length !== size * size) return null;
    return saved.every((s) => s === EMPTY || s === CAT || s === BLOCKED || s === LOCKED)
        ? [...saved]
        : null;
}

function wonDays() {
    const days = save.get('wonDays', []);
    return Array.isArray(days) ? days.filter(Number.isInteger) : [];
}

/* ---------- rendering ---------- */

/**
 * Draws the board, and with it the only thing a player has to read at a glance: the shape of
 * each region.
 *
 * A heavy line goes wherever two regions meet, a hairline between cells inside one region. An
 * even grid of identical heavy lines — which is what this was first — reads as wire mesh and
 * leaves the regions invisible, which is fatal in a puzzle whose rules are about regions.
 *
 * Each internal boundary is drawn once, by the cell on its left or above it, so two
 * neighbours never stack their borders into a line of double thickness. The outer edge is the
 * board's own border, so the last column and row draw nothing.
 */
function buildBoard() {
    const n = puzzle.n;
    boardEl.style.setProperty('--cells', n);
    boardEl.replaceChildren();

    for (let cell = 0; cell < n * n; cell++) {
        const button = document.createElement('div');
        button.className = 'cell';
        button.dataset.cell = cell;
        button.setAttribute('role', 'gridcell');

        const region = puzzle.regions[cell] % REGION_COLORS.length;
        button.style.background = REGION_COLORS[region];
        button.style.color = DARK_REGIONS.has(region) ? '#fff' : '#3c2f26';

        const edges = [];
        if (cell % n !== n - 1) {
            edges.push(puzzle.regions[cell] !== puzzle.regions[cell + 1]
                ? 'inset calc(-1 * var(--edge)) 0 0 var(--boundary)'
                : 'inset -1px 0 0 var(--hairline)');
        }
        if (Math.floor(cell / n) !== n - 1) {
            edges.push(puzzle.regions[cell] !== puzzle.regions[cell + n]
                ? 'inset 0 calc(-1 * var(--edge)) 0 var(--boundary)'
                : 'inset 0 -1px 0 var(--hairline)');
        }
        button.style.boxShadow = edges.join(', ');

        boardEl.appendChild(button);
    }
}

const LABELS = { [CAT]: 'cat', [BLOCKED]: 'marked empty', [LOCKED]: 'wrong guess' };

function render() {
    for (const button of boardEl.children) {
        const state = states[Number(button.dataset.cell)];
        button.replaceChildren();

        if (state !== EMPTY) {
            const mark = document.createElement('span');
            if (state === CAT) {
                mark.className = 'mark';
                mark.textContent = '🐱';
            } else {
                // The cross is drawn by the stylesheet from two bars, so it carries no text.
                mark.className = state === LOCKED ? 'mark cross locked' : 'mark cross';
            }
            button.appendChild(mark);
            button.setAttribute('aria-label', LABELS[state]);
        } else {
            button.removeAttribute('aria-label');
        }
    }

    const placed = catsIn(states).length;
    counterEl.textContent = mode === 'daily' ? `${placed}/${puzzle.n}` : String(level);
    counterLabel.textContent = mode === 'daily' ? 'CATS' : 'LEVEL';

    heartsEl.replaceChildren();
    for (let i = 0; i < MAX_HEARTS; i++) {
        const heart = document.createElement('span');
        heart.textContent = '♥';
        if (i >= hearts) heart.className = 'spent';
        heartsEl.appendChild(heart);
    }
    heartsEl.setAttribute('aria-label', `${hearts} of ${MAX_HEARTS} lives left`);
}

function say(message) {
    statusEl.textContent = message;
}

/* ---------- the daily clock ---------- */

function formatTime(seconds) {
    const safe = Math.max(0, seconds);
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function remaining() {
    if (deadline === null) return DAILY_TIME_LIMIT;
    return Math.ceil((deadline - Date.now()) / 1000);
}

function tick() {
    if (mode !== 'daily') return;
    timerEl.textContent = formatTime(remaining());
    if (!over && deadline !== null && remaining() <= 0) {
        hearts = 0;
        finish(false, 'Out of time.');
    }
}

setInterval(tick, 250);

/* ---------- playing ---------- */

function finish(won, message) {
    over = true;

    if (won && mode === 'daily') {
        const days = new Set(wonDays());
        days.add(dateKey(new Date()));
        save.set('wonDays', [...days]);
    }

    // Save the finished board under the level it actually belongs to, and only then advance
    // the counter. The other order files a solved board against the *next* level, and the
    // next level then loads already solved.
    persist();
    if (won && mode === 'endless') {
        level += 1;
        save.set('level', level);
    }

    render();
    say(message);

    sheetTitle.textContent = won ? 'Solved' : (hearts <= 0 ? 'Out of lives' : 'Out of time');
    sheetText.textContent = won
        ? (mode === 'daily'
            ? `Today's puzzle, with ${formatTime(remaining())} to spare.`
            : `Level ${level - 1} done. On to ${level}.`)
        : message;
    sheetAction.textContent = won && mode === 'endless' ? 'Next level' : 'Try again';
    sheet.hidden = false;
}

function afterMove() {
    render();
    persist();

    if (isSolved(puzzle, catsIn(states))) {
        finish(true, 'Solved.');
        return true;
    }
    return false;
}

function flash(cell, className) {
    const button = boardEl.children[cell];
    button.classList.remove('rejected', 'landed');
    // Reading offsetWidth restarts the animation, so two wrong guesses in a row both show.
    void button.offsetWidth;
    button.classList.add(className);
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
            ? `No cat there. ${hearts} ${hearts === 1 ? 'life' : 'lives'} left.`
            : 'No cat there.');
        render();
        persist();
        if (hearts <= 0) finish(false, 'Out of lives.');
        return;
    }

    flash(cell, 'landed');
    if (afterMove()) return;
    const placed = catsIn(states).length;
    say(`${placed} of ${puzzle.n} placed.`);
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
            // Long press summons directly. Marked handled so the release does not also
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
    // it never disturbs a cat or a locked cross, which is what toggleNote already refuses.
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
        // A quick second tap on the same cell upgrades the note to a cat. The first tap has
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
    timerStat.hidden = mode !== 'daily';

    const size = mode === 'daily' ? DAILY_SIZE : boardSizeForLevel(level);
    const seed = mode === 'daily' ? dateKey(new Date()) : level * 2654435761;

    puzzle = generate(size, seed >>> 0);
    if (!puzzle) {
        // 200 attempts all got stuck. Vanishingly unlikely, but a page that says so beats a
        // page that is silently blank.
        say('Could not build a board for this level. Please reload.');
        return;
    }

    const saved = fresh ? null : save.get(slot(), null);
    const restored = saved && typeof saved === 'object'
        && (mode === 'daily' || saved.level === level)
        ? usableStates(saved.states, size)
        : null;

    if (restored) {
        states = restored;
        hearts = Number.isInteger(saved.hearts) ? Math.min(saved.hearts, MAX_HEARTS) : MAX_HEARTS;
        deadline = Number.isFinite(saved.deadline) ? saved.deadline : null;
        over = saved.over === true;
    } else {
        states = new Array(size * size).fill(EMPTY);
        hearts = MAX_HEARTS;
        deadline = null;
        over = false;
    }

    // A restored daily may have run out of time while the page was closed.
    if (mode === 'daily' && !over && deadline !== null && remaining() <= 0) hearts = 0;
    if (hearts <= 0) over = true;
    if (isSolved(puzzle, catsIn(states))) over = true;

    buildBoard();
    render();
    tick();
    persist();

    if (over) {
        const won = isSolved(puzzle, catsIn(states));
        say(won ? 'Solved.' : 'Out of lives. Restart to try again.');
        sheetTitle.textContent = won ? 'Solved' : 'Out of lives';
        sheetText.textContent = won
            ? (mode === 'daily' ? "Today's puzzle is done." : 'Ready for the next level.')
            : 'Restart to try this board again.';
        sheetAction.textContent = won && mode === 'endless' ? 'Next level' : 'Try again';
        sheet.hidden = false;
    } else {
        say(mode === 'daily'
            ? "Today's 7x7. Three minutes, starting with your first cat."
            : 'Tap to mark. Tap twice, or hold, to place a cat.');
    }
}

function setMode(next) {
    if (mode === next) return;
    mode = next;
    endlessButton.setAttribute('aria-pressed', String(next === 'endless'));
    dailyButton.setAttribute('aria-pressed', String(next === 'daily'));
    load();
}

endlessButton.addEventListener('click', () => setMode('endless'));
dailyButton.addEventListener('click', () => setMode('daily'));

document.getElementById('restart').addEventListener('click', () => load(true));

sheetAction.addEventListener('click', () => {
    // After a win in endless the level has already advanced, so this builds the next board.
    // Everywhere else it is a fresh go at the same one.
    load(true);
});

document.getElementById('sheet-close').addEventListener('click', () => {
    sheet.hidden = true;
});

/* ---------- boot ---------- */

endlessButton.setAttribute('aria-pressed', String(mode === 'endless'));
dailyButton.setAttribute('aria-pressed', String(mode === 'daily'));

if (!isPersistent()) document.getElementById('warning').hidden = false;

load();
