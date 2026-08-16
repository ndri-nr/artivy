/*
 * The browser build of Kata·Word: board, keyboard and saving. The rules — scoring the guess,
 * drawing a word, the win streak — are in model.js, which has no DOM in it and is checked by
 * selftest.html.
 *
 * One mode. The app's daily challenge is not here, so there is no "free play" to distinguish
 * it from either: it is just the game. The streak counts consecutive words solved rather than
 * consecutive days.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    LANGUAGES,
    MAX_GUESSES,
    WORD_LENGTHS,
    evaluateGuess,
    loadGuessSet,
    loadList,
    mergeKeyboard,
    pickWord,
} from './model.js';

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/* How many recent words to steer away from. Long enough that a session does not repeat
   itself, short enough that a heavy player is not slowly locked out of the list. */
const RECENT_MEMORY = 40;

const save = storage('kata_word');

const boardEl = document.getElementById('board');
const keysEl = document.getElementById('keys');
const statusEl = document.getElementById('status');
const streakEl = document.getElementById('streak');
const bestEl = document.getElementById('best');
const winsEl = document.getElementById('wins');
const langSelect = document.getElementById('lang');
const lengthSelect = document.getElementById('length');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetText = document.getElementById('sheet-text');
const sheetWord = document.getElementById('sheet-word');
const sheetAction = document.getElementById('sheet-action');

let lang = LANGUAGES.some((entry) => entry.code === save.get('lang', 'en'))
    ? save.get('lang', 'en') : 'en';
let length = WORD_LENGTHS.includes(save.get('length', 5)) ? save.get('length', 5) : 5;

let answer = '';
let guesses = [];
let current = '';
let guessSet = null;
let finished = false;
let busy = false;

/* ---------- saved state ---------- */

function slot() {
    return `game.${lang}.${length}`;
}

function readStats() {
    const stats = save.get('stats', null);
    if (!stats || typeof stats !== 'object') return { played: 0, wins: 0, streak: 0, best: 0 };
    return {
        played: Number(stats.played) || 0,
        wins: Number(stats.wins) || 0,
        streak: Number(stats.streak) || 0,
        best: Number(stats.best) || 0,
    };
}

/** Guesses are trusted only as far as they are strings of the right length. */
function usableGuesses(saved) {
    if (!Array.isArray(saved)) return [];
    return saved
        .filter((word) => typeof word === 'string' && word.length === length)
        .slice(0, MAX_GUESSES);
}

/* ---------- rendering ---------- */

function buildBoard() {
    boardEl.style.setProperty('--cols', length);
    boardEl.style.setProperty('--board-ratio', length / MAX_GUESSES);
    boardEl.replaceChildren();

    for (let row = 0; row < MAX_GUESSES; row++) {
        for (let column = 0; column < length; column++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            boardEl.appendChild(tile);
        }
    }
}

function tileAt(row, column) {
    return boardEl.children[row * length + column];
}

function renderBoard(popAt = -1) {
    for (let row = 0; row < MAX_GUESSES; row++) {
        const guess = guesses[row];
        const typing = row === guesses.length ? current : '';

        for (let column = 0; column < length; column++) {
            const tile = tileAt(row, column);
            if (guess) {
                const status = evaluateGuess(guess, answer)[column];
                tile.textContent = guess[column];
                tile.className = `tile ${status}`;
                // The colour is not the only carrier of the result. Read out, the row is
                // "c, correct. r, correct." rather than a row of letters with no scores.
                tile.setAttribute('aria-label', `${guess[column]}, ${status}`);
            } else {
                const letter = typing[column] ?? '';
                tile.textContent = letter;
                tile.className = letter ? 'tile filled' : 'tile';
                tile.removeAttribute('aria-label');
                if (row === guesses.length && column === popAt) tile.classList.add('pop');
            }
        }
    }
}

function renderKeyboard() {
    const colours = {};
    for (const guess of guesses) mergeKeyboard(colours, guess, evaluateGuess(guess, answer));

    for (const key of keysEl.querySelectorAll('.key[data-letter]')) {
        const state = colours[key.dataset.letter];
        key.className = state ? `key ${state}` : 'key';
    }
}

function renderStats() {
    const stats = readStats();
    streakEl.textContent = String(stats.streak);
    bestEl.textContent = String(stats.best);
    winsEl.textContent = `${stats.wins}/${stats.played}`;
}

function buildKeyboard() {
    keysEl.replaceChildren();

    KEY_ROWS.forEach((letters, index) => {
        const row = document.createElement('div');
        row.className = 'keys-row';

        if (index === 2) row.appendChild(specialKey('Enter', 'enter'));
        for (const letter of letters) {
            const key = document.createElement('button');
            key.className = 'key';
            key.type = 'button';
            key.textContent = letter;
            key.dataset.letter = letter;
            row.appendChild(key);
        }
        if (index === 2) row.appendChild(specialKey('Del', 'backspace'));

        keysEl.appendChild(row);
    });
}

function specialKey(label, action) {
    const key = document.createElement('button');
    key.className = 'key wide';
    key.type = 'button';
    key.textContent = label;
    key.dataset.action = action;
    return key;
}

function say(message) {
    statusEl.textContent = message;
}

/* Dropped as soon as the flash is over. Left on, it would fire again on any tile rebuilt
   later — switching word length, for instance — at a moment nobody asked for it. */
boardEl.addEventListener('animationend', () => boardEl.classList.remove('refreshed'));

/* ---------- the game ---------- */

function shake() {
    boardEl.classList.remove('row-invalid');
    // Reading offsetWidth restarts the animation; without it a second rejection in a row
    // does nothing visible and the player thinks the key was missed.
    void boardEl.offsetWidth;
    boardEl.classList.add('row-invalid');
}

function showSheet(won) {
    sheetTitle.textContent = won ? 'Solved' : 'Out of tries';
    sheetText.textContent = won ? `In ${guesses.length} of ${MAX_GUESSES}.` : 'The word was';
    sheetWord.textContent = answer;
    sheetWord.hidden = won;
    sheetAction.textContent = 'Next word';
    sheet.hidden = false;
}

function finish(won) {
    finished = true;

    const stats = readStats();
    // A streak of consecutive words solved. Zeroed by a loss rather than decremented, which
    // is the only reading of "streak" that means anything.
    const streak = won ? stats.streak + 1 : 0;
    save.set('stats', {
        played: stats.played + 1,
        wins: stats.wins + (won ? 1 : 0),
        streak,
        best: Math.max(stats.best, streak),
    });

    const recent = [answer, ...(save.get('recent', []) || [])]
        .filter((word) => typeof word === 'string')
        .slice(0, RECENT_MEMORY);
    save.set('recent', recent);

    persist();
    renderStats();
    say(won ? 'Solved.' : `The word was ${answer.toUpperCase()}.`);
    showSheet(won);
}

function persist() {
    save.set('lang', lang);
    save.set('length', length);
    save.set(slot(), { answer, guesses, finished });
}

function submit() {
    if (finished || busy) return;

    if (current.length !== length) {
        shake();
        say(`Needs ${length} letters.`);
        return;
    }
    if (!guessSet.has(current)) {
        shake();
        say('Not in the word list.');
        return;
    }

    guesses.push(current);
    const won = current === answer;
    current = '';

    renderBoard();
    renderKeyboard();
    persist();

    if (won) finish(true);
    else if (guesses.length >= MAX_GUESSES) finish(false);
    else say(`${MAX_GUESSES - guesses.length} tries left.`);
}

function type(letter) {
    if (finished || busy || current.length >= length) return;
    current += letter;
    renderBoard(current.length - 1);
}

function backspace() {
    if (finished || busy || current.length === 0) return;
    current = current.slice(0, -1);
    renderBoard();
}

/* ---------- starting a word ---------- */

async function start(nextWord = false) {
    busy = true;
    sheet.hidden = true;
    current = '';
    guesses = [];
    finished = false;

    buildBoard();
    say('Loading words…');

    try {
        guessSet = await loadGuessSet(lang, length);
        const pool = await loadList(lang, 'answers', length);
        const saved = nextWord ? null : save.get(slot(), null);

        answer = saved && typeof saved.answer === 'string' && saved.answer.length === length
            ? saved.answer
            : pickWord(pool, Date.now() & 0x7fffffff, new Set(save.get('recent', []) || []));
    } catch {
        // A failed fetch is the one thing that can leave this page with no game at all.
        say('Could not load the word list. Check your connection and reload.');
        busy = false;
        return;
    }

    const saved = save.get(slot(), null);
    if (saved && saved.answer === answer) {
        guesses = usableGuesses(saved.guesses);
        finished = saved.finished === true
            || guesses.length >= MAX_GUESSES
            || guesses.includes(answer);
    }

    busy = false;
    renderBoard();
    renderKeyboard();
    renderStats();
    persist();

    if (finished) showSheet(guesses.includes(answer));
    else if (nextWord) {
        // Pressing New word on a board with nothing on it looks like nothing happened, since
        // an empty grid is an empty grid whichever word is behind it. Say so, and flash the
        // board, or the player presses it again wondering whether it took.
        say(`New ${length}-letter word. Six tries.`);
        boardEl.classList.remove('refreshed');
        void boardEl.offsetWidth;
        boardEl.classList.add('refreshed');
    } else say('Guess the word in six tries.');
}

/* ---------- input ---------- */

keysEl.addEventListener('click', (event) => {
    const key = event.target.closest('.key');
    if (!key) return;
    if (key.dataset.action === 'enter') submit();
    else if (key.dataset.action === 'backspace') backspace();
    else if (key.dataset.letter) type(key.dataset.letter);
});

window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLSelectElement) return;

    if (event.key === 'Enter') {
        event.preventDefault();
        if (!sheet.hidden) return;
        submit();
    } else if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
    } else if (/^[a-zA-Z]$/.test(event.key)) {
        type(event.key.toLowerCase());
    }
});

langSelect.addEventListener('change', () => {
    lang = langSelect.value;
    start();
});

lengthSelect.addEventListener('change', () => {
    length = Number(lengthSelect.value);
    start();
});

document.getElementById('skip').addEventListener('click', () => start(true));
sheetAction.addEventListener('click', () => start(true));

document.getElementById('sheet-close').addEventListener('click', () => {
    sheet.hidden = true;
});

/* ---------- boot ---------- */

for (const entry of LANGUAGES) {
    const option = document.createElement('option');
    option.value = entry.code;
    option.textContent = entry.label;
    option.selected = entry.code === lang;
    langSelect.appendChild(option);
}

for (const size of WORD_LENGTHS) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = `${size} letters`;
    option.selected = size === length;
    lengthSelect.appendChild(option);
}

if (!isPersistent()) document.getElementById('warning').hidden = false;

buildKeyboard();
start();
