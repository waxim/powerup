export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Cryptographically secure, unbiased RNG (rejection sampling). Used in production. */
export const cryptoRng: Rng = {
  int(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % maxExclusive;
    }
  },
};

/** Deterministic RNG for tests and simulations (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(maxExclusive: number): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * maxExclusive);
    },
  };
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function randomId(rng: Rng, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ID_ALPHABET[rng.int(ID_ALPHABET.length)];
  return out;
}
