/*
 * The browser build of Rekta: drawing, input, the clock and saving. The rules and the level
 * generator are in model.js, which has no DOM in it and is checked by selftest.html.
 */

import { storage, isPersistent } from '../js/storage.js';
import {
    DIFFICULTIES,
    area,
    blockAt,
    boardFor,
    clueAt,
    colorIndex,
    covered,
    difficultyFor,
    isValid,
    place,
    removeAt,
    solved,
} from './model.js';

/* Block ramp, cycled by geometry so a block keeps its colour and neighbours rarely repeat. */
const BLOCK_COLORS = ['#3de0ff', '#9b6bff', '#4dffb8', '#ff5cc8', '#63a0ff', '#ffc46b'];

const save = storage('rekta');

const boardEl = document.getElementById('board');
const gridEl = document.getElementById('grid');
const blocksEl = document.getElementById('blocks');
const cluesEl = document.getElementById('clues');
const previewEl = document.getElementById('preview');
const overlayEl = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const levelEl = document.getElementById('level');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const difficultyRow = document.getElementById('difficulty');

let difficulty = difficultyFor(save.get('difficulty', 'easy'));
let level = 1;
let board = null;

/* The clock counts up and has no limit: it starts on the first block, stops on the solve, and
   there is no fail state. `elapsed` is what has already been banked; `startedAt` is null
   whenever the clock is not running. */
let elapsed = 0;
let startedAt = null;

/* ---------- clock ---------- */

function now() {
    return performance.now();
}

function seconds() {
    return Math.floor((elapsed + (startedAt === null ? 0 : now() - startedAt)) / 1000);
}

function formatTime(total) {
    if (total === null || total === undefined) return '—';
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function startClock() {
    // Refuses to start while the tab is hidden, so a player is never charged for time
    // they were not looking at the board.
    if (startedAt !== null || document.hidden) return;
    startedAt = now();
}

function stopClock() {
    if (startedAt === null) return;
    elapsed += now() - startedAt;
    startedAt = null;
}

function tick() {
    timeEl.textContent = formatTime(seconds());
}

setInterval(tick, 250);

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopClock();
        persist();
    } else if (board && board.blocks.length > 0 && !solved(board)) {
        startClock();
    }
});

window.addEventListener('pagehide', () => {
    stopClock();
    persist();
});

/* ---------- saving ---------- */

function bestKey() {
    return `best.${difficulty.key}`;
}

function persist() {
    save.set('difficulty', difficulty.key);
    save.set(`level.${difficulty.key}`, level);
    save.set('board', {
        difficulty: difficulty.key,
        level,
        blocks: board.blocks,
        elapsed: Math.round(elapsed + (startedAt === null ? 0 : now() - startedAt)),
    });
}

/** Blocks are trusted only as far as they are shaped right and sit inside this grid. */
function usableBlocks(saved) {
    if (!Array.isArray(saved)) return [];
    return saved.filter((block) =>
        block
        && Number.isInteger(block.x) && Number.isInteger(block.y)
        && Number.isInteger(block.w) && Number.isInteger(block.h)
        && block.w > 0 && block.h > 0
        && block.x >= 0 && block.y >= 0
        && block.x + block.w <= board.cols && block.y + block.h <= board.rows);
}

/* ---------- rendering ---------- */

function buildGrid() {
    boardEl.style.setProperty('--cols', board.cols);
    boardEl.style.setProperty('--rows', board.rows);
    boardEl.style.setProperty('--board-ratio', board.cols / board.rows);

    gridEl.replaceChildren();
    cluesEl.replaceChildren();

    for (let y = 0; y < board.rows; y++) {
        for (let x = 0; x < board.cols; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            gridEl.appendChild(cell);

            const clue = clueAt(board, x, y);
            if (clue === 0) continue;

            // Clues go in their own layer rather than inside the cell, so that a block drawn
            // over them cannot hide the one number the player needs to read.
            const marker = document.createElement('div');
            marker.className = 'clue';
            marker.dataset.x = x;
            marker.dataset.y = y;
            frame(marker, x, y, 1, 1);

            const disc = document.createElement('span');
            disc.textContent = String(clue);
            marker.appendChild(disc);
            cluesEl.appendChild(marker);
        }
    }
}

function frame(element, x, y, w, h) {
    element.style.left = `${(x / board.cols) * 100}%`;
    element.style.top = `${(y / board.rows) * 100}%`;
    element.style.width = `${(w / board.cols) * 100}%`;
    element.style.height = `${(h / board.rows) * 100}%`;
}

function renderBlocks() {
    blocksEl.replaceChildren();
    for (const block of board.blocks) {
        const element = document.createElement('div');
        const valid = isValid(board, block);
        element.className = valid ? 'block' : 'block invalid';
        if (valid) element.style.color = BLOCK_COLORS[colorIndex(block, BLOCK_COLORS.length)];
        frame(element, block.x, block.y, block.w, block.h);
        blocksEl.appendChild(element);
    }

    // A clue takes the colour of whatever block owns it, so a wrong rectangle reads as wrong
    // at the number as well as at its edge.
    for (const marker of cluesEl.children) {
        const owner = blockAt(board, Number(marker.dataset.x), Number(marker.dataset.y));
        marker.firstChild.style.borderColor = !owner
            ? 'transparent'
            : (isValid(board, owner)
                ? BLOCK_COLORS[colorIndex(owner, BLOCK_COLORS.length)]
                : '#ff5c6e');
    }

    levelEl.textContent = String(level);
    bestEl.textContent = formatTime(save.get(bestKey(), null));
}

function renderDifficulties() {
    difficultyRow.replaceChildren();
    for (const entry of DIFFICULTIES) {
        const button = document.createElement('button');
        button.className = 'play-button';
        button.textContent = `${entry.label} ${entry.cols}×${entry.rows}`;
        button.setAttribute('aria-pressed', String(entry.key === difficulty.key));
        button.addEventListener('click', () => {
            if (entry.key === difficulty.key) return;
            stopClock();
            persist();
            difficulty = entry;
            level = save.get(`level.${entry.key}`, 1);
            load();
        });
        difficultyRow.appendChild(button);
    }
}

/* ---------- level flow ---------- */

function load(restore = null) {
    board = boardFor(difficulty, level);
    elapsed = restore ? (Number(restore.elapsed) || 0) : 0;
    startedAt = null;

    if (restore) board.blocks = usableBlocks(restore.blocks);

    overlayEl.hidden = true;
    previewEl.hidden = true;
    buildGrid();
    renderDifficulties();
    renderBlocks();
    tick();
    persist();

    if (board.blocks.length > 0 && !solved(board)) startClock();
    if (solved(board)) finish(false);
}

function nextLevel() {
    level += 1;
    load();
}

/**
 * `record` is false when a solved board is merely being shown again after a reload, so a run
 * cannot file its time as a new best every time the page is refreshed.
 */
function finish(record = true) {
    stopClock();
    const total = seconds();
    const previous = save.get(bestKey(), null);
    const beaten = record && (previous === null || total < previous);
    if (beaten) save.set(bestKey(), total);

    overlayText.innerHTML = '';
    const line = document.createElement('span');
    line.textContent = formatTime(total);
    overlayText.appendChild(line);
    if (beaten) {
        const flag = document.createElement('span');
        flag.className = 'record';
        flag.textContent = ' · best yet';
        overlayText.appendChild(flag);
    }

    overlayEl.hidden = false;
    renderBlocks();
    persist();
}

function afterChange() {
    renderBlocks();
    persist();
    if (solved(board)) finish();
    else if (board.blocks.length > 0) startClock();
}

/* ---------- input ---------- */

function cellAt(clientX, clientY) {
    const rect = boardEl.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * board.cols);
    const y = Math.floor(((clientY - rect.top) / rect.height) * board.rows);
    return {
        x: Math.min(Math.max(x, 0), board.cols - 1),
        y: Math.min(Math.max(y, 0), board.rows - 1),
    };
}

let drag = null;

boardEl.addEventListener('pointerdown', (event) => {
    if (!overlayEl.hidden) return;
    drag = { ...cellAt(event.clientX, event.clientY), id: event.pointerId };
    try {
        boardEl.setPointerCapture(event.pointerId);
    } catch {
        // Capture is an optimisation, not a requirement — it keeps a drag that wanders off
        // the board reporting to the board. Losing it must not abort the handler and strand
        // `drag`, because a stale anchor turns the next stray pointerup into a rectangle
        // stretching from wherever the finger last went down.
    }
    previewEl.hidden = false;
    frame(previewEl, drag.x, drag.y, 1, 1);
});

boardEl.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const to = cellAt(event.clientX, event.clientY);
    frame(previewEl,
        Math.min(drag.x, to.x), Math.min(drag.y, to.y),
        Math.abs(to.x - drag.x) + 1, Math.abs(to.y - drag.y) + 1);
});

boardEl.addEventListener('pointerup', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const to = cellAt(event.clientX, event.clientY);
    const from = drag;
    drag = null;
    previewEl.hidden = true;

    if (from.x === to.x && from.y === to.y) {
        // A tap clears the rectangle under the finger, or claims the cell when there is none.
        // Claiming is the only way to answer a clue of 1, so it cannot be dropped.
        if (!removeAt(board, to.x, to.y)) place(board, to.x, to.y, to.x, to.y);
    } else {
        place(board, from.x, from.y, to.x, to.y);
    }
    afterChange();
});

/* Both endings matter. `pointercancel` is the browser taking the gesture away — a system
   edge-swipe, a scroll it decided to own. `lostpointercapture` covers the rest, including the
   capture never having been granted. Either way the drag is over and the anchor has to go,
   or it survives to pair with an unrelated pointerup later. */
for (const ending of ['pointercancel', 'lostpointercapture']) {
    boardEl.addEventListener(ending, () => {
        drag = null;
        previewEl.hidden = true;
    });
}

document.getElementById('next').addEventListener('click', nextLevel);

document.getElementById('clear').addEventListener('click', () => {
    if (board.blocks.length === 0) return;
    board.blocks = [];
    stopClock();
    elapsed = 0;
    renderBlocks();
    tick();
    persist();
});

document.getElementById('skip').addEventListener('click', nextLevel);

/* ---------- boot ---------- */

if (!isPersistent()) document.getElementById('warning').hidden = false;

const saved = save.get('board', null);
if (saved && typeof saved === 'object' && saved.difficulty === difficulty.key) {
    level = Number.isInteger(saved.level) && saved.level > 0 ? saved.level : 1;
    load(saved);
} else {
    level = save.get(`level.${difficulty.key}`, 1);
    load();
}
