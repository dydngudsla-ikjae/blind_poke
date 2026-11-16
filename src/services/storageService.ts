import { gameSaveSchema, mapSaveSchema, mapSnapshotSchema, type ParsedGameSave, type ParsedMapSave } from "./saveSchemas";

export const GAME_SAVE_KEY = "blindpoke-save-v1";
export const MAP_SAVE_KEY = "blindpoke-map-v1";

type SaveSlot = { kind: "empty" } | { kind: "damaged" } | { kind: "unavailable" } |
  { kind: "ready"; game: ParsedGameSave; map: ParsedMapSave | null; mapRecovered: boolean };

function decode(raw: string | null): unknown {
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function readSaveSlot(): SaveSlot {
  try {
    const raw = localStorage.getItem(GAME_SAVE_KEY);
    if (raw === null) return { kind: "empty" };
    const decoded = decode(raw);
    if (decoded && typeof decoded === "object" && "newGame" in decoded && decoded.newGame === true) return { kind: "empty" };
    const game = gameSaveSchema.safeParse(decoded);
    if (!game.success) return { kind: "damaged" };
    const snapshot = mapSnapshotSchema.safeParse(game.data.mapSnapshot);
    if (snapshot.success) return { kind: "ready", game: game.data, map: snapshot.data, mapRecovered: false };
    const legacy = localStorage.getItem(MAP_SAVE_KEY);
    const map = mapSaveSchema.safeParse(decode(legacy));
    return { kind: "ready", game: game.data, map: map.success ? map.data : null,
      mapRecovered: game.data.mapSnapshot !== undefined || (legacy !== null && !map.success) };
  } catch {
    return { kind: "unavailable" };
  }
}

export function writeGameSave(game: object, map: ParsedMapSave): boolean {
  try {
    localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ ...game, v: 4, mapSnapshot: map }));
  } catch {
    return false;
  }
  // The map copy supports saves produced by older versions. The combined snapshot is authoritative.
  try { localStorage.setItem(MAP_SAVE_KEY, JSON.stringify(map)); } catch { /* The game snapshot already succeeded. */ }
  return true;
}

export function clearGameStorage(): boolean {
  try {
    localStorage.setItem(GAME_SAVE_KEY, '{"v":4,"newGame":true}');
  } catch {
    return false;
  }
  try { localStorage.removeItem(MAP_SAVE_KEY); } catch { /* The reset marker supersedes the legacy map. */ }
  return true;
}
