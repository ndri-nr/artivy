/*
 * PourFect! in the browser: the DOM half. The rules are in model.js and have no DOM in them,
 * which is what makes selftest.html possible.
 *
 * What this build is *not*: the app's meta. There are no rewarded adverts here, so the extra
 * bottle from level 7 is simply an ordinary bottle rather than something padlocked, and undo is
 * free. One display advert sits below the board and that is the whole of it.
 */

import {
    CAPACITY, EXTRA_BOTTLE_FROM, UNSOLVABLE, advise, apply, clone, generate, grantExtra, isStuck,
    isSettled, isWon, paramsFor, pourAmount, undo as undoMove,
} from './model.js';
import { isPersistent, storage } from '../js/storage.js';

const save = storage('pourfect');

/*
 * Liquid colours: Okabe-Ito, which exists for exactly this problem — eight hues that stay
 * distinct for the common forms of colour blindness — plus a brown and a near-white that lean
 * on lightness rather than hue.
 *
 * Nine is the most any level uses and exactly how many there are. Wider boards get there by
 * giving each colour more bottles rather than inventing a tenth hue, because a tenth would make
 * one pair identical for some players.
 */
const LIQUIDS = [
    '#E69F00', // 0 orange
    '#56B4E9', // 1 sky blue
    '#009E73', // 2 bluish green
    '#F0E442', // 3 yellow
    '#0072B2', // 4 blue
    '#D55E00', // 5 vermillion
    '#CC79A7', // 6 reddish purple
    '#8C5E3C', // 7 brown
    '#F0F0F0', // 8 near white
];

/*
 * Which hue each colour index wears, by level. Nine orders so the collector — whose index is
 * always one past the plain colours, and so the most repetitive thing on screen — is not
 * wearing the same colour twice in a row. Each order keeps its first six hues clear of the
 * pairs people confuse: orange/vermillion, vermillion/brown, sky/blue, yellow/white.
 */
const HUE_ORDERS = [
    [2, 6, 7, 3, 0, 1, 8, 5, 4],
    [7, 2, 6, 0, 3, 8, 5, 1, 4],
    [0, 3, 6, 2, 7, 4, 1, 8, 5],
    [6, 7, 2, 0, 8, 3, 4, 5, 1],
    [3, 7, 0, 6, 2, 1, 8, 4, 5],
    [2, 0, 6, 7, 8, 4, 5, 1, 3],
    [7, 6, 3, 2, 0, 5, 1, 8, 4],
    [0, 2, 7, 8, 6, 1, 4, 3, 5],
    [6, 3, 2, 7, 0, 4, 8, 5, 1],
];

/** Kenney's `touch_finger_one`, CC0 (kenney.nl). White with a dark outline, which is what lets
 *  it read over any liquid colour and over the dark board alike. */
const HAND_PATH = 'M36 34.75 L36.8 34.8 Q38.3 33 40.3 33 42.65 32.95 43.65 34.65 44.75 33.75'
    + ' 46.25 33.75 47.75 33.75 48.65 34.95 50.7 37.75 52.4 41.8 54 47.75 51.1 51.55'
    + ' 49.45 53.45 46.95 54.35 L41.7 54.75 Q39.65 54.2 37.8 53.1 34.1 50.85 30.45 50.65'
    + ' 24.95 51 25 47.65 25 46.5 25.7 45.65 26.45 44.95 27.55 44.7 29.05 44.5 30.75 44.7'
    + ' 32.85 44.6 32.4 43 L27.85 30.65 Q27.35 29.35 27.85 28.3 28.25 27.55 29.95 27.15'
    + ' 31.6 26.75 32.5 27.45 L33.7 29.05 36 34.75';

/** Three bottles a side, the collector between them — the layout this genre settled on. */
const PER_SIDE = 3;

/** Long enough to see, short enough not to wait for. */
const POUR_MS = 260;

/** Idle before the hand offers a move. Quick while it is teaching, long afterwards: a hint that
 *  arrives while someone is still thinking is an interruption, and the thinking is the game. */
const IDLE_TUTORIAL = 2000;
const IDLE_NORMAL = 15000;

const els = {
    bottles: document.getElementById('bottles'),
    wrap: document.getElementById('wrap'),
    board: document.getElementById('board'),
    level: document.getElementById('level'),
    count: document.getElementById('bottle-count'),
    undo: document.getElementById('undo'),
    restart: document.getElementById('restart'),
    warning: document.getElementById('warning'),
};

let level = 1;
let board = null;
let history = [];
let extra = -1;
let picked = -1;
let hover = -1;
let hint = null;
let dead = false;
let pouring = false;
let idleTimer = null;
let hues = HUE_ORDERS[0];

/* ----------------------------------------------------------------- drawing a vessel */

function colourOf(unit) {
    return LIQUIDS[hues[unit % hues.length]];
}

/**
 * The bottle silhouette, in a viewBox whose height follows the capacity.
 *
 * Proportions are measured in **widths**, not fractions of the height. The collector is several
 * times taller than a bottle, and a shoulder defined as a percentage of height turned it into a
 * bottle somebody had stretched — a neck as long as a whole small bottle.
 */
function silhouette(width, height) {
    const cx = width / 2;
    const neck = width * 0.5;
    const neckTop = width * 0.135;
    const neckBottom = width * 0.45;
    const shoulder = width * 0.95;
    const foot = width * 0.24;
    return `M${cx - neck / 2} ${neckTop}`
        + ` L${cx - neck / 2} ${neckBottom}`
        + ` C${cx - neck / 2} ${shoulder - width * 0.28} 0 ${shoulder - width * 0.4} 0 ${shoulder}`
        + ` L0 ${height - foot}`
        + ` Q0 ${height} ${foot} ${height}`
        + ` L${width - foot} ${height}`
        + ` Q${width} ${height} ${width} ${height - foot}`
        + ` L${width} ${shoulder}`
        + ` C${width} ${shoulder - width * 0.4} ${cx + neck / 2} ${shoulder - width * 0.28}`
        + ` ${cx + neck / 2} ${neckBottom}`
        + ` L${cx + neck / 2} ${neckTop} Z`;
}

/** Space above the liquid — shoulder, neck and cap — as a multiple of the width. */
const HEADROOM = 0.95;

function vesselSvg(index, { rows = 1 } = {}) {
    const capacity = board.caps[index];
    const units = board.tubes[index];
    const width = 100;
    // The collector spans every row, so its box is that many bottles tall; its own bands then
    // come out shorter than a bottle's, which is what a taller tube with more units should look
    // like.
    const bottleHeight = CAPACITY * 60 + width * HEADROOM;
    const height = index === board.collector ? bottleHeight * rows : bottleHeight;
    const liquidTop = width * HEADROOM;
    const band = (height - liquidTop) / capacity;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `-4 -4 ${width + 8} ${height + 8}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('vessel');
    if (index === board.collector) svg.classList.add('collector');
    if (index === picked) svg.classList.add('picked');
    if (index === hover) svg.classList.add('target');
    if (isSettled(board, index)) svg.classList.add('settled');
    svg.dataset.index = String(index);

    const clipId = `clip-${index}`;
    const sealed = units.length === capacity && units.every((unit) => unit === units[0]);
    svg.innerHTML = `
        <defs><clipPath id="${clipId}"><path d="${silhouette(width, height)}"/></clipPath></defs>
        <path d="${silhouette(width, height)}" fill="rgba(255,255,255,0.09)"/>
        <g clip-path="url(#${clipId})">
            ${units.map((unit, i) => {
                const bottom = height - band * i;
                return `<rect x="-2" y="${bottom - band}" width="${width + 4}" height="${band + 1}"
                              fill="${colourOf(unit)}"/>`;
            }).join('')}
            ${units.length > 0 ? `<rect x="-2" y="${height - band * units.length}"
                width="${width + 4}" height="${width * 0.06}"
                fill="rgba(255,255,255,0.2)"/>` : ''}
            <rect x="${width * 0.1}" y="${liquidTop * 0.9}" width="${width * 0.26}"
                  height="${(height - liquidTop) * 0.92}" rx="${width * 0.13}"
                  fill="rgba(255,255,255,0.1)"/>
            <rect x="${width * 0.15}" y="${liquidTop}" width="${width * 0.075}"
                  height="${(height - liquidTop) * 0.86}" rx="${width * 0.05}"
                  fill="rgba(255,255,255,0.5)"/>
        </g>
        ${sealed ? `<rect x="${width * 0.22}" y="0" width="${width * 0.56}"
            height="${width * 0.3}" rx="${width * 0.09}"
            fill="${shade(colourOf(units[0]), 0.42)}"/>` : ''}
        <path d="${silhouette(width, height)}" fill="none"
              stroke="${index === board.collector && board.collectorColour >= 0
                  ? colourOf(board.collectorColour) : 'rgba(202,221,245,0.55)'}"
              stroke-width="${index === picked ? width * 0.06 : width * 0.035}"/>
    `;
    return svg;
}

/** A darker version of a colour, for the cap of a finished bottle. */
function shade(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const mix = (channel) => Math.round(channel * (1 - amount));
    return `#${[
        mix((value >> 16) & 255), mix((value >> 8) & 255), mix(value & 255),
    ].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------------ the layout */

/** Rows of bottles, at most [PER_SIDE] * 2 each and as even as the count allows: eleven
 *  bottles become 6-5, never 6-6-(-1). A row holding one bottle reads as a mistake. */
function rowsOf(count) {
    const rows = Math.max(1, Math.ceil(count / (PER_SIDE * 2)));
    const per = Math.ceil(count / rows);
    const out = [];
    for (let at = 0; at < count; at += per) out.push(Math.min(per, count - at));
    return out;
}

function render() {
    const smalls = [];
    for (let i = 0; i < board.tubes.length; i++) if (i !== board.collector) smalls.push(i);
    const rows = rowsOf(smalls.length);
    const widest = Math.max(...rows);
    const hasCollector = board.collector >= 0;

    // Columns are declared, not measured: the left half, the collector, then the right half.
    // With no collector the row is simply centred, which is what an odd count wants.
    const left = Math.ceil(widest / 2);
    const right = widest - left;
    els.bottles.style.setProperty('--rows', String(rows.length));
    els.bottles.style.setProperty('--columns', hasCollector
        ? `repeat(${left}, 1fr) 1.2fr repeat(${right}, 1fr)`
        : `repeat(${widest}, 1fr)`);
    // Which column the tall tube stands in. Grid places a row-spanning item before the
    // auto-flow ones, so without this it takes column 1 rather than the middle.
    els.bottles.style.setProperty('--collector-column', String(left + 1));
    // width ÷ height of the box the board should reserve. A bottle is about 0.3 as wide as it
    // is tall; being slightly generous costs a slightly smaller board, which is the cheap way
    // to be wrong.
    const columns = widest + (hasCollector ? 1.2 : 0);
    els.board.style.setProperty('--board-ratio',
        String((columns * 0.32 / rows.length).toFixed(3)));

    els.bottles.textContent = '';
    let at = 0;
    for (let row = 0; row < rows.length; row++) {
        const inRow = smalls.slice(at, at + rows[row]);
        at += rows[row];
        const half = Math.ceil(inRow.length / 2);
        inRow.slice(0, half).forEach((index) => els.bottles.appendChild(vesselSvg(index)));
        if (hasCollector && row === 0) {
            els.bottles.appendChild(vesselSvg(board.collector, { rows: rows.length }));
        }
        inRow.slice(half).forEach((index) => els.bottles.appendChild(vesselSvg(index)));
    }

    els.level.textContent = String(level);
    els.count.textContent = String(board.tubes.length);
    els.undo.disabled = history.length === 0 || pouring;
    drawHand();
    drawOverlay();
}

/* ----------------------------------------------------------------------- interaction */

function vesselAt(x, y) {
    for (const svg of els.bottles.querySelectorAll('.vessel')) {
        const box = svg.getBoundingClientRect();
        // Generous vertically: a bottle is narrow, and a finger landing just above or below one
        // still meant it.
        if (x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 10 && y <= box.bottom + 10) {
            return Number(svg.dataset.index);
        }
    }
    return -1;
}

function pourable(from, to) {
    return pourAmount(board, from, to);
}

/**
 * Can this vessel be picked up at all?
 *
 * Three cannot, for one reason: no legal pour starts there, so lifting one is a selection with
 * nothing behind it, which reads as the tap not working. Empty is obvious; the collector is
 * one-way by the rules; a sealed bottle is finished, and pouring it back out can only undo
 * progress, since the win wants exactly the state it is already in.
 */
function pickable(index) {
    return index !== board.collector
        && board.tubes[index].length > 0
        && !isSettled(board, index);
}

function tap(index) {
    if (pouring || isWon(board) || index < 0) return;
    if (picked < 0) {
        if (pickable(index)) {
            picked = index;
            render();
        }
        return;
    }
    if (picked === index) {
        picked = -1;
        render();
        return;
    }
    const count = pourable(picked, index);
    if (count === 0) {
        picked = pickable(index) ? index : -1;
        render();
        return;
    }
    pour({ from: picked, to: index, count });
}

/**
 * The pour, animated by moving the source vessel rather than by cloning it.
 *
 * ponytail: the bottle slides over its target and tips, then the liquid lands in one step. The
 * app tips it and pours the units across fractionally; here the transform is a CSS transition
 * and the difference is a few frames nobody is counting. Positions come from
 * getBoundingClientRect, which is fine — the rule against measuring is about *sizing the
 * board*, not about placing an animation.
 */
function pour(move) {
    const source = els.bottles.querySelector(`.vessel[data-index="${move.from}"]`);
    const target = els.bottles.querySelector(`.vessel[data-index="${move.to}"]`);
    picked = -1;
    hover = -1;
    pouring = true;
    els.undo.disabled = true;

    if (!source || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        land(move);
        return;
    }
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const toRight = to.left >= from.left;
    source.style.zIndex = '3';
    source.style.transform =
        `translate(${to.left - from.left + (toRight ? -from.width * 0.5 : from.width * 0.5)}px,`
        + ` ${to.top - from.top - from.height * 0.28}px)`
        + ` rotate(${toRight ? 42 : -42}deg)`;
    setTimeout(() => {
        source.style.transform = '';
        source.style.zIndex = '';
        land(move);
    }, POUR_MS);
}

function land(move) {
    apply(board, move);
    history.push(move);
    pouring = false;
    if (isWon(board)) {
        level += 1;
        save.set('level', level);
        save.remove('board');
        render();
        return;
    }
    persist();
    // Straight after the pour that might have caused it, and on a small budget: proving a board
    // dead is cheap precisely when it is dead, because few legal moves means a small reachable
    // space. A healthy board hits the budget at once and says nothing.
    checkDead(40000);
    render();
    armHand();
}

function checkDead(budget) {
    const verdict = advise(board, { maxStates: budget });
    if (verdict.verdict !== UNSOLVABLE) return;
    // Only announced when the player can see why: nothing legal left, or a reachable space
    // small enough that every move is visibly shuffling the same few arrangements.
    if (isStuck(board) || (verdict.reachable >= 0 && verdict.reachable <= 24)) {
        dead = true;
        hint = null;
    }
}

/* --- pointer handling: one listener for taps and drags alike --- */

let dragFrom = -1;
let dragMoved = false;

els.bottles.addEventListener('pointerdown', (event) => {
    touched();
    if (pouring) return;
    const index = vesselAt(event.clientX, event.clientY);
    if (index < 0 || !pickable(index)) return;
    dragFrom = index;
    dragMoved = false;
    els.bottles.setPointerCapture(event.pointerId);
});

els.bottles.addEventListener('pointermove', (event) => {
    if (dragFrom < 0) return;
    dragMoved = true;
    const over = vesselAt(event.clientX, event.clientY);
    // Only a legal destination lights up. Highlighting an illegal one and then refusing the
    // drop teaches the player nothing twice.
    const next = over >= 0 && over !== dragFrom && pourable(dragFrom, over) > 0 ? over : -1;
    if (next !== hover) {
        hover = next;
        if (picked !== dragFrom) picked = dragFrom;
        render();
    }
});

els.bottles.addEventListener('pointerup', (event) => {
    const from = dragFrom;
    const over = hover;
    dragFrom = -1;
    hover = -1;
    if (from < 0) {
        tap(vesselAt(event.clientX, event.clientY));
        return;
    }
    if (!dragMoved) {
        picked = -1;
        tap(from);
        return;
    }
    if (over < 0) {
        // Released on nothing: the bottle stays picked up, so a drag that changed its mind
        // becomes the first half of a tap-tap.
        picked = from;
        render();
        return;
    }
    picked = from;
    tap(over);
});

els.undo.addEventListener('click', () => {
    if (history.length === 0 || pouring) return;
    touched();
    undoMove(board, history.pop());
    picked = -1;
    dead = false;
    persist();
    render();
});

els.restart.addEventListener('click', () => load(level));

/* ------------------------------------------------------------------------ the hand */

function armHand() {
    clearTimeout(idleTimer);
    if (dead || isWon(board)) return;
    const wait = paramsFor(level).forgiving ? IDLE_TUTORIAL : IDLE_NORMAL;
    idleTimer = setTimeout(() => {
        if (pouring || dead || isWon(board)) return;
        // The full budget here: this is the moment the game may tell someone their board is
        // finished, and that has to be a proof rather than a search that gave up.
        const verdict = advise(board, { avoid: history[history.length - 1] ?? null });
        if (verdict.verdict === UNSOLVABLE) {
            checkDead(200000);
            render();
            return;
        }
        hint = verdict.move;
        render();
    }, wait);
}

function touched() {
    hint = null;
    armHand();
}

function drawHand() {
    els.wrap.querySelector('.hand')?.remove();
    if (!hint) return;
    const from = els.bottles.querySelector(`.vessel[data-index="${hint.from}"]`);
    const to = els.bottles.querySelector(`.vessel[data-index="${hint.to}"]`);
    if (!from || !to) return;
    const box = els.wrap.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const hand = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hand.setAttribute('viewBox', '0 0 64 64');
    hand.classList.add('hand');
    hand.innerHTML = `<path d="${HAND_PATH}" fill="#fff" stroke="#241e1a" stroke-width="4"
        stroke-linejoin="round" paint-order="stroke"/>`;
    // The fingertip sits near the foot of the vessel, so the hand hangs below the glass instead
    // of covering the liquid it points at.
    hand.style.setProperty('--from-x', `${a.left - box.left + a.width * 0.2}px`);
    hand.style.setProperty('--from-y', `${a.bottom - box.top - a.height * 0.16}px`);
    hand.style.setProperty('--to-x', `${b.left - box.left + b.width * 0.2}px`);
    hand.style.setProperty('--to-y', `${b.bottom - box.top - b.height * 0.16}px`);
    els.wrap.appendChild(hand);
}

/* ---------------------------------------------------------------------- the overlays */

function drawOverlay() {
    els.wrap.querySelector('.overlay')?.remove();
    if (!isWon(board) && !dead) return;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    if (isWon(board)) {
        overlay.innerHTML = `<h2>Done!</h2><p>Level ${level - 1} cleared.</p>`
            + '<div class="overlay-actions"><button class="play-button" id="next">'
            + 'Next level</button></div>';
        els.wrap.appendChild(overlay);
        overlay.querySelector('#next').addEventListener('click', () => load(level));
        return;
    }
    overlay.innerHTML = '<h2>No moves left</h2>'
        + '<p>This board cannot be finished. Start a new one, or close this and have a look at '
        + 'it first.</p>'
        + '<div class="overlay-actions">'
        + '<button class="play-button" id="close">Close</button>'
        + '<button class="play-button" id="again">New board</button></div>';
    els.wrap.appendChild(overlay);
    // Two choices on purpose: "new board" is the obvious one, and "close" is for the player who
    // wants to sit and look at the board that beat them, which is where the next attempt is
    // actually learned.
    overlay.querySelector('#close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#again').addEventListener('click', () => load(level));
}

/* ------------------------------------------------------------------------ persistence */

function persist() {
    save.set('board', {
        level,
        tubes: board.tubes,
        caps: board.caps,
        collector: board.collector,
        collectorColour: board.collectorColour,
        history,
    });
}

function load(next) {
    level = next;
    save.set('level', level);
    save.remove('board');
    board = generate(level);
    // From level 7 the board carries one bottle more than the table asks for. In the app it
    // starts padlocked and two rewarded adverts open it; there are no rewarded adverts here, so
    // it is simply an ordinary bottle.
    extra = level >= EXTRA_BOTTLE_FROM ? grantExtra(board) : -1;
    history = [];
    picked = -1;
    hover = -1;
    hint = null;
    dead = false;
    pouring = false;
    hues = HUE_ORDERS[level % HUE_ORDERS.length];
    persist();
    render();
    armHand();
}

function restore() {
    const saved = save.get('board', null);
    const savedLevel = save.get('level', 1);
    level = typeof savedLevel === 'number' && savedLevel >= 1 ? savedLevel : 1;
    hues = HUE_ORDERS[level % HUE_ORDERS.length];
    if (saved && saved.level === level && Array.isArray(saved.tubes)) {
        const fresh = generate(level);
        const withExtra = level >= EXTRA_BOTTLE_FROM ? 1 : 0;
        // A snapshot from an older set of rules is not this level any more. Comparing the shape
        // catches that without a version number anybody has to remember to bump.
        if (saved.tubes.length === fresh.tubes.length + withExtra) {
            board = clone({
                tubes: saved.tubes,
                caps: saved.caps,
                collector: saved.collector,
                collectorColour: saved.collectorColour,
            });
            extra = withExtra ? board.tubes.length - 1 : -1;
            history = Array.isArray(saved.history) ? saved.history : [];
            render();
            armHand();
            return;
        }
    }
    load(level);
}

if (!isPersistent()) els.warning.hidden = false;
restore();
