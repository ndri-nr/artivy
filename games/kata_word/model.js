/*
 * Kata·Word's rules: guess scoring, the deterministic daily word, and streaks.
 * No DOM here, which is what makes selftest.html possible.
 *
 * The daily word is deliberately the *same word the Android app shows* on the same date.
 * That is worth having — a daily challenge everyone shares stops being one if the website
 * and the app disagree — and unlike Rekta's generator it costs almost nothing: the whole
 * mechanism is a 32-bit hash of yyyyMMdd indexing a word list, and the word lists here are
 * copies of the app's. Both halves have to stay in step: changing daily_*.txt, or changing
 * this hash, moves the word for every future date on one platform only.
 */

export const MAX_GUESSES = 6;
export const WORD_LENGTHS = [4, 5, 6];
export const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'id', label: 'Indonesia' },
];

/* ---------- scoring ---------- */

/**
 * Scores a guess against the answer, two passes, which is the only way duplicate letters
 * come out right. Greens are taken first and consume their letter; a repeated letter only
 * goes yellow while an unconsumed copy is left. Score in one pass and guessing `sasa`
 * against `kasa` lights both s's — the classic wrong answer.
 *
 * Both words must be the same length and already lower-case.
 */
export function evaluateGuess(guess, answer) {
    const n = guess.length;
    const result = new Array(n).fill('absent');
    const remaining = new Map();

    for (const letter of answer) remaining.set(letter, (remaining.get(letter) ?? 0) + 1);

    for (let i = 0; i < n; i++) {
        if (guess[i] === answer[i]) {
            result[i] = 'correct';
            remaining.set(guess[i], remaining.get(guess[i]) - 1);
        }
    }

    for (let i = 0; i < n; i++) {
        if (result[i] === 'correct') continue;
        const left = remaining.get(guess[i]) ?? 0;
        if (left > 0) {
            result[i] = 'present';
            remaining.set(guess[i], left - 1);
        }
    }

    return result;
}

const RANK = { absent: 0, present: 1, correct: 2 };

/** Folds a scored guess into the keyboard colours. A key is never downgraded. */
export function mergeKeyboard(keyboard, guess, statuses) {
    for (let i = 0; i < guess.length; i++) {
        const existing = keyboard[guess[i]];
        if (existing === undefined || RANK[statuses[i]] > RANK[existing]) {
            keyboard[guess[i]] = statuses[i];
        }
    }
}

/* ---------- the daily word ---------- */

/** Local date as an integer, 2026-07-24 becomes 20260724. */
export function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/**
 * A stable hash of the date key, so consecutive days land far apart in the list.
 *
 * `Math.imul` is doing the load-bearing work: it is a true 32-bit multiply, and the plain
 * `a * b & 0xFFFFFFFF` it replaces loses precision past 2^53. The Dart side splits the
 * multiply into 16-bit halves for the same reason, and the two agree exactly — which is what
 * keeps the daily word identical on the website and in the app.
 */
function hashDateKey(key) {
    let x = key >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x & 0x7fffffff;
}

export function dailyIndex(date, listLength) {
    return hashDateKey(dateKey(date)) % listLength;
}

/* ---------- streaks ---------- */

function dayFromKey(key) {
    return new Date(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, key % 100);
}

function daysBetween(a, b) {
    const from = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const to = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((to - from) / 86400000);
}

/**
 * Recomputes both streaks from the set of won dates, rather than incrementing a counter.
 *
 * That is the whole point: a streak that is incremented in place cannot account for a day
 * filled in later, and it drifts the first time a write is missed. Recomputing is
 * order-independent, so back-filling a past day counts for the run it belongs to.
 *
 * The current run is allowed to end at yesterday as well as today, so it does not collapse
 * the moment midnight passes and before today has been played.
 */
export function computeStreaks(wonDateKeys, referenceNow) {
    const won = new Set(wonDateKeys);
    if (won.size === 0) return { current: 0, best: 0 };

    const days = [...won].map(dayFromKey).sort((a, b) => a - b);

    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
        if (run > best) best = run;
    }

    const today = new Date(referenceNow.getFullYear(), referenceNow.getMonth(),
        referenceNow.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    let cursor = null;
    if (won.has(dateKey(today))) cursor = today;
    else if (won.has(dateKey(yesterday))) cursor = yesterday;

    let current = 0;
    while (cursor && won.has(dateKey(cursor))) {
        current++;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }

    return { current, best };
}

/* ---------- free play ---------- */

/**
 * A word for Free Play, avoiding ones played recently.
 *
 * Without `avoid` a regular player meets a repeat far sooner than the list size suggests:
 * the draw has no memory, so the first collision is expected after roughly sqrt(pi n / 2)
 * games — about 55 on a 1900-word list, not 1900. A handful of rerolls removes that, and the
 * loop is bounded so a nearly-exhausted list falls through to a plain pick instead of
 * spinning.
 */
export function pickWord(list, seed, avoid = new Set()) {
    let s = Math.abs(seed);
    for (let i = 0; i < 12; i++) {
        const word = list[s % list.length];
        if (!avoid.has(word)) return word;
        s = (s * 31 + 17) % 0x7fffffff;
    }
    return list[Math.abs(seed) % list.length];
}

/* ---------- word lists ---------- */

const cache = new Map();

function parse(text) {
    return text.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean);
}

/**
 * Loads one list, cached. Only the lists a player actually reaches are fetched: the six
 * language-and-length combinations differ by an order of magnitude in size, and the largest
 * guess list is bigger than everything else on the site put together.
 */
export async function loadList(lang, kind, length) {
    const key = `${lang}_${kind}_${length}`;
    if (!cache.has(key)) {
        cache.set(key, fetch(`words/${lang}/${kind}_${length}.txt`)
            .then((response) => {
                if (!response.ok) throw new Error(`${key}: ${response.status}`);
                return response.text();
            })
            .then(parse)
            .catch((error) => {
                // Do not cache a failure: a player who lost the network mid-load should get
                // another attempt rather than a permanently broken length.
                cache.delete(key);
                throw error;
            }));
    }
    return cache.get(key);
}

/**
 * The accepted-guess set. `answers` is meant to be a subset of `guesses` already; the union
 * is defensive, so a list-generation slip can never leave the game rejecting a word it might
 * itself choose as the solution.
 */
export async function loadGuessSet(lang, length) {
    const [guesses, answers] = await Promise.all([
        loadList(lang, 'guesses', length),
        loadList(lang, 'answers', length),
    ]);
    return new Set([...guesses, ...answers]);
}
