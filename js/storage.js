/*
 * Saved progress for the browser games.
 *
 * Every game gets its own namespace and nothing reads a raw key directly, the same
 * discipline the Android builds keep around SharedPreferences. Three failures are
 * real here and all three are handled rather than thrown:
 *
 *   - localStorage is missing or throws on access (some browsers do this in private
 *     mode, and an iframe with third-party storage blocked does it too),
 *   - the quota is full, so a write fails,
 *   - a stored value is corrupt, usually a half-written save from a killed tab.
 *
 * None of those should end a game in progress. A game that cannot save should still
 * be playable, so the fallback is an in-memory store that lasts the session, and
 * `persistent` tells the page whether it is worth warning the player.
 */

const memory = new Map();

const memoryBackend = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
};

let backend = null;
let persistent = false;

function resolve() {
    if (backend) return backend;
    try {
        const probe = '__artivy_probe__';
        // Reading alone is not enough: some browsers expose localStorage and only
        // throw when something is actually written to it.
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        backend = window.localStorage;
        persistent = true;
    } catch {
        backend = memoryBackend;
        persistent = false;
    }
    return backend;
}

/** True once storage has been touched and turned out to survive a reload. */
export function isPersistent() {
    resolve();
    return persistent;
}

/**
 * A namespaced view over storage. `storage('2048').get('best', 0)` reads the key
 * `artivy.2048.best`.
 */
export function storage(slug) {
    const prefix = `artivy.${slug}.`;

    return {
        get(key, fallback = null) {
            try {
                const raw = resolve().getItem(prefix + key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch {
                // Corrupt value. Returning the fallback loses one key; letting the
                // parse error out would lose the whole save.
                return fallback;
            }
        },

        /** Returns false when the write did not land, so a caller can tell the player. */
        set(key, value) {
            try {
                resolve().setItem(prefix + key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },

        remove(key) {
            try {
                resolve().removeItem(prefix + key);
            } catch {
                /* nothing worth doing: the key is already unreachable */
            }
        },
    };
}
