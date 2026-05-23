export function createSeededRng(seed) {
    let state = seed >>> 0;
    function next() {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let z = Math.imul(state ^ (state >>> 15), 1 | state);
        z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    }
    function nextInt(max) {
        return Math.floor(next() * max);
    }
    return { next, nextInt, seed };
}
//# sourceMappingURL=rng.js.map