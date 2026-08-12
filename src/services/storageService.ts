export const GAME_SAVE_KEY = "blindpoke-save-v1";
export const MAP_SAVE_KEY = "blindpoke-map-v1";

export function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readGameSave():ParsedGameSave|null{
  const parsed=gameSaveSchema.safeParse(readStorage<unknown>(GAME_SAVE_KEY));
  if(!parsed.success){
    if(readStorage<unknown>(GAME_SAVE_KEY)!==null) console.warn("손상된 게임 저장을 무시합니다.",parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export function readMapSave():ParsedMapSave|null{
  const parsed=mapSaveSchema.safeParse(readStorage<unknown>(MAP_SAVE_KEY));
  return parsed.success?parsed.data:null;
}

export function clearGameStorage(): void {
  localStorage.removeItem(GAME_SAVE_KEY);
  localStorage.removeItem(MAP_SAVE_KEY);
}
import { gameSaveSchema, mapSaveSchema, type ParsedGameSave, type ParsedMapSave } from "./saveSchemas";
