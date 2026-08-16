/*
 * Kata·Word's rules: scoring a guess, and drawing the next word. No DOM here, which is what
 * makes selftest.html possible.
 *
 * There is no daily challenge in the browser build, so the date hash the app uses to pick one
 * is not here either — and with it went the only reason this file had to stay bit-for-bit
 * compatible with the Dart side. The word lists are still copies of the app's, because they
 * are the output of a filtering pipeline with real judgement in it.
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

/* ---------- drawing a word ---------- */

/**
 * The next word, avoiding ones played recently.
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
