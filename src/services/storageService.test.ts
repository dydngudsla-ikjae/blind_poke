import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState, restoreGameState } from "../game/gameReducer";
import { clearGameStorage, GAME_SAVE_KEY, MAP_SAVE_KEY, readSaveSlot } from "./storageService";

const game = { v: 4, roster: [{ pokemon: { pokemonRowid: 1, nameKr: "이상해씨" } }] };
const map = Object.entries(createInitialState().territories).map(([id, territory]) => ({ id, ...territory }));

describe("save recovery", () => {
  beforeEach(() => localStorage.clear());

  it("uses the map captured in the same write as the game, even when the mirror is damaged", () => {
    localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ ...game, mapSnapshot: map }));
    localStorage.setItem(MAP_SAVE_KEY, "{");
    expect(readSaveSlot()).toMatchObject({ kind: "ready", map, mapRecovered: false });
  });

  it("preserves a v3 game when its separate map is damaged", () => {
    localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ ...game, v: 3 }));
    localStorage.setItem(MAP_SAVE_KEY, "{");
    expect(readSaveSlot()).toMatchObject({ kind: "ready", game: { v: 3 }, map: null, mapRecovered: true });
  });

  it("uses the map copy when the combined snapshot is incomplete", () => {
    for (const truncated of [[], map.slice(0, -1), [...map.slice(0, -1), map[0]]]) {
      localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ ...game, mapSnapshot: truncated }));
      localStorage.setItem(MAP_SAVE_KEY, JSON.stringify(map));
      expect(readSaveSlot()).toMatchObject({ kind: "ready", map, mapRecovered: true });
    }
  });

  it("migrates capped plots, empty assignments and conquest from the seven-node legacy map", () => {
    const roster = [{ ...game.roster[0], building: null, job: null }];
    localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ ...game, v: 2, roster, plotCap: 16, resources: { gold: 5 } }));
    localStorage.setItem(MAP_SAVE_KEY, JSON.stringify(["grasslands", "field", "hill", "forest", "cave", "lake", "peak"].map(id => ({
      id, owner: ["grasslands", "field", "lake", "peak"].includes(id) ? "player" : "wild",
    }))));
    const slot = readSaveSlot();
    expect(slot.kind).toBe("ready");
    if (slot.kind !== "ready") throw new Error("Legacy save was not read");
    const state = restoreGameState(slot.game, slot.map);
    expect(state).toMatchObject({ plotCap: 10, resources: { gold: 5 }, caughtSpeciesIds: [1] });
    expect(Object.keys(state.territories).filter(id => state.territories[id].owner === "player")).toEqual(["home", "southwest", "east", "northwest"]);
  });

  it("distinguishes damaged saves from new games and resets only when explicitly requested", () => {
    localStorage.setItem(GAME_SAVE_KEY, "{");
    expect(readSaveSlot()).toEqual({ kind: "damaged" });
    expect(localStorage.getItem(GAME_SAVE_KEY)).toBe("{");
    expect(clearGameStorage()).toBe(true);
    expect(readSaveSlot()).toEqual({ kind: "empty" });
  });
});
