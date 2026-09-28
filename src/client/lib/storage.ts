/** Browser storage can be unavailable (private mode, blocked cookies); never let that break the game. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/** Seat tokens are the only "account": whoever holds the token owns the seat. */
export function getSeatToken(tableId: string): string | null {
  return read(`powerup:seat:${tableId}`);
}

export function setSeatToken(tableId: string, token: string): void {
  write(`powerup:seat:${tableId}`, token);
}

export function clearSeatToken(tableId: string): void {
  write(`powerup:seat:${tableId}`, null);
}

/** A `#seat=<token>` link lets a player move their seat to another device. */
export function adoptSeatFromHash(tableId: string): void {
  const m = window.location.hash.match(/seat=([a-z0-9]{10,40})/);
  if (!m) return;
  setSeatToken(tableId, m[1]);
  window.history.replaceState(null, "", window.location.pathname);
}

export function getSavedName(): string {
  return read("powerup:name") ?? "";
}

export function saveName(name: string): void {
  write("powerup:name", name);
}

export function getPref(key: string, fallback: boolean): boolean {
  const v = read(`powerup:pref:${key}`);
  return v === null ? fallback : v === "1";
}

export function setPref(key: string, value: boolean): void {
  write(`powerup:pref:${key}`, value ? "1" : "0");
}
