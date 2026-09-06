/**
 * A throwaway per-browser identity, used only to keep one device from liking
 * the same update twice. Deliberately not serious: it lives in localStorage, a
 * new browser is a new person, and clearing site data resets it. No accounts.
 */

import { storagePrefix } from "@config";

const ID_KEY = `${storagePrefix}:viewer`;
const LIKED_KEY = `${storagePrefix}:liked`;

/** localStorage throws outright in some privacy modes, so every access is guarded. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode, or storage disabled. Likes just won't survive a reload.
  }
}

let cachedId: string | null = null;

export function viewerId(): string {
  if (cachedId) return cachedId;

  const stored = read(ID_KEY);
  if (stored) {
    cachedId = stored;
    return stored;
  }

  const fresh =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  write(ID_KEY, fresh);
  cachedId = fresh;
  return fresh;
}

/** Which updates this device has liked. The server dedupes; this is for the UI. */
export function readLiked(): Set<string> {
  const raw = read(LIKED_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeLiked(liked: Set<string>): void {
  write(LIKED_KEY, JSON.stringify([...liked]));
}
