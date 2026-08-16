/*
 * The browser build of Pawdoku: board, taps, hearts, the daily clock and saving. The rules
 * and the generator are in model.js, which has no DOM in it and is checked by selftest.html.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    DAILY_SIZE,
    DAILY_TIME_LIMIT,
    MAX_HEARTS,
    boardSizeForLevel,
    checkPlacement,
    dateKey,
    generate,
    isSolved,
} from './model.js';

/* The Android palette, and it is chosen rather than generated: one red, one green, a warm
   rose that does not collapse onto the blues, light and dark alternating so neighbouring
   regions stay apart at a glance. */
const REGION_COLORS = [
    '#f4dc7a', '#4e7cc0', '#e0795c', '#e693b4', '#7cc6a9',
    '#d99a3c', '#a9dceb', '#9aa5b1', '#a85e86',
];

/* Text on a region, picked per colour rather than by luminance maths: the palette is fixed
   and short, so a lookup is both simpler and easier to correct by eye. */
const DARK_REGIONS = new Set([1, 2, 8]);

const WHY = {
    row: 'Already a cat in that row.',
    column: 'Already a cat in that column.',
    region: 'Already a cat in that colour.',
    adjacency: 'Cats may not touch, not even at a corner.',
};

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
let cats = new Set();
let blocked = new Set();
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
        cats: [...cats],
        blocked: [...blocked],
        hearts,
        over,
        deadline,
        level: mode === 'endless' ? level : undefined,
    });
}

/** Cells are trusted only as far as they are integers inside this board. */
function usableCells(saved, size) {
    if (!Array.isArray(saved)) return [];
    return saved.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size);
}

function wonDays() {
    const days = save.get('wonDays', []);
    return Array.isArray(days) ? days.filter(Number.isInteger) : [];
}

/* ---------- rendering ---------- */

function buildBoard() {
    boardEl.style.setProperty('--cells', puzzle.n);
    boardEl.replaceChildren();

    for (let cell = 0; cell < puzzle.n * puzzle.n; cell++) {
        const button = document.createElement('button');
        button.className = 'cell';
        button.type = 'button';
        button.dataset.cell = cell;

        const region = puzzle.regions[cell];
        button.style.background = REGION_COLORS[region % REGION_COLORS.length];
        button.style.color = DARK_REGIONS.has(region % REGION_COLORS.length) ? '#fff' : '#3c2f26';

        boardEl.appendChild(button);
    }
}

function render() {
    for (const button of boardEl.children) {
        const cell = Number(button.dataset.cell);
        button.replaceChildren();
        button.disabled = over;

        if (cats.has(cell)) {
            const mark = document.createElement('span');
            mark.className = 'mark';
            mark.textContent = '🐱';
            button.appendChild(mark);
            button.setAttribute('aria-label', 'cat');
        } else if (blocked.has(cell)) {
            const mark = document.createElement('span');
            mark.className = 'mark blocked';
            mark.textContent = '✕';
            button.appendChild(mark);
            button.setAttribute('aria-label', 'marked empty');
        } else {
            button.removeAttribute('aria-label');
        }
    }

    counterEl.textContent = mode === 'daily' ? `${cats.size}/${puzzle.n}` : String(level);
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

    sheetTitle.textContent = won ? 'Solved' : 'Out of lives';
    sheetText.textContent = won
        ? (mode === 'daily'
            ? `Today's puzzle, with ${formatTime(remaining())} to spare.`
            : `Level ${level - 1} done. On to ${level}.`)
        : message;
    sheetAction.textContent = won && mode === 'endless' ? 'Next level' : 'Try again';
    sheet.hidden = false;
}

function tap(cell) {
    if (over) return;

    // The cycle is empty -> cat -> blocked -> empty. Blocked is the player's own note that a
    // cell is ruled out; the game never places one.
    if (cats.has(cell)) {
        cats.delete(cell);
        blocked.add(cell);
    } else if (blocked.has(cell)) {
        blocked.delete(cell);
    } else {
        const why = checkPlacement(puzzle, [...cats], cell);
        if (why) {
            // Refused, not placed. The board must not end up in an illegal state, so the
            // only feedback is the shake and the reason.
            hearts -= 1;
            const button = boardEl.children[cell];
            button.classList.remove('rejected');
            void button.offsetWidth;
            button.classList.add('rejected');
            say(`${WHY[why]} ${hearts} ${hearts === 1 ? 'life' : 'lives'} left.`);
            render();
            persist();
            if (hearts <= 0) finish(false, 'Out of lives.');
            return;
        }
        cats.add(cell);
        if (mode === 'daily' && deadline === null) {
            // The clock starts on the first cat, not on load, so opening the page to look at
            // the board does not cost time.
            deadline = Date.now() + DAILY_TIME_LIMIT * 1000;
        }
    }

    render();
    persist();

    if (isSolved(puzzle, [...cats])) {
        finish(true, 'Solved.');
        return;
    }
    say(`${cats.size} of ${puzzle.n} placed.`);
}

boardEl.addEventListener('click', (event) => {
    const button = event.target.closest('.cell');
    if (button) tap(Number(button.dataset.cell));
});

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
    if (saved && typeof saved === 'object'
        && (mode === 'daily' || saved.level === level)) {
        cats = new Set(usableCells(saved.cats, size));
        blocked = new Set(usableCells(saved.blocked, size));
        hearts = Number.isInteger(saved.hearts) ? Math.min(saved.hearts, MAX_HEARTS) : MAX_HEARTS;
        deadline = Number.isFinite(saved.deadline) ? saved.deadline : null;
        over = saved.over === true;
    } else {
        cats = new Set();
        blocked = new Set();
        hearts = MAX_HEARTS;
        deadline = null;
        over = false;
    }

    // A restored daily may have run out of time while the page was closed.
    if (mode === 'daily' && !over && deadline !== null && remaining() <= 0) {
        hearts = 0;
        over = true;
    }
    if (hearts <= 0) over = true;
    if (isSolved(puzzle, [...cats])) over = true;

    buildBoard();
    render();
    tick();
    persist();

    if (over) {
        const won = isSolved(puzzle, [...cats]);
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
            : 'One cat per row, column and colour — none touching.');
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
    // After a win in endless the level has already advanced, so this just builds the next
    // board. Everywhere else it is a fresh go at the same one.
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
