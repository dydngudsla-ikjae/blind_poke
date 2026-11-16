import { describe, expect, it, vi } from "vitest";
import type { GameDataBundle, PokemonRecord, RosterMember } from "../domain/types";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";
import { huntCandidates } from "./gameHelpers";
import { prepareTerritoryBattle } from "./territoryBattle";
import { counterHuntPool, nextWeaknessMove, territoryPreparation, territoryTactics, uncoveredTerritoryTypes } from "./territoryReadiness";
import { nextResearchIncrease } from "../domain/production";

const species = (pokemonRowid: number, nameKr: string, type1Rowid: number, type2Rowid?: number): PokemonRecord => ({
  pokemonRowid, nameKr, type1Rowid, type2Rowid, hp: 40, atk: 40, def: 40, satk: 40, sdef: 40, spd: 40,
});
const member = (id: string, pokemon: PokemonRecord, level = 1, exp = 0): RosterMember => ({
  id, pokemon, level, exp, alias: pokemon.nameKr, iv: {}, favor: 80, favCeil: 80, favFloor: 20, aptitude: 10,
});
const ghost = species(769, "모래꿍", 5, 8);
const totodile = species(158, "리아코", 11);
const poochyena = species(261, "포챠나", 17);
const frillish = species(592, "탱그릴", 8, 11);
const caterpie = species(10, "캐터피", 7);
const halfGhost = species(425, "흔들풍손", 8, 3);
const target = [5, 8];
const benchmark: GameDataBundle = {
  abilities: [], trainers: [],
  pokemon: [ghost, totodile, poochyena, frillish, caterpie, halfGhost],
  types: [
    { typeRowid: 1, nameKr: "노말", relation: { relationMap: { "8": { damageTo: 0, damageFrom: 0 } } } },
    { typeRowid: 11, nameKr: "물", relation: { relationMap: { "5": { damageTo: 2, damageFrom: 1 } } } },
  ],
  moves: [
    { moveRowid: 33, nameKr: "몸통박치기", typeRowid: 1, details: { power: 40, pp: 35, accuracy: 100, damageClass: 2 } },
    { moveRowid: 55, nameKr: "물대포", typeRowid: 11, details: { power: 40, pp: 25, accuracy: 100, damageClass: 3 } },
  ],
  battle: { learnsets: { "158": [[55, 6], [33, 1]], "261": [[33, 1]], "592": [[55, 1]] }, moves: { "33": {}, "55": {} } },
};

function frontier(scouted = true) {
  const state = createInitialState();
  state.screen = "map";
  state.roster = [member("a", totodile)];
  state.entryOrder = ["a"];
  state.territories.southwest = { ...state.territories.southwest, owner: "player", scouted: true };
  state.territories.south = { ...state.territories.south, scouted };
  return state;
}

describe("starting region counter preparation", () => {
  it("derives risks from the real encounter pool without changing RNG or revealing an unscouted site", () => {
    const rng = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const state = frontier(false);
      rng.mockClear();
      expect(uncoveredTerritoryTypes(state, benchmark, "south")).toEqual([]);
      state.territories.south.scouted = true;
      expect(uncoveredTerritoryTypes(state, benchmark, "south").map(group => group.typeIds)).toContainEqual(target);
      expect(rng).not.toHaveBeenCalled();
      expect(prepareTerritoryBattle(state, benchmark, "south")?.enemyTeam[0].pokemonId).toBe(ghost.pokemonRowid);
      state.territories.southwest.owner = "unoccupied";
      expect(uncoveredTerritoryTypes(state, benchmark, "south")).toEqual([]);
    } finally {
      rng.mockRestore();
    }
  });

  it("suggests a benched member first and only recommends affordable candy levels", () => {
    const state = frontier();
    state.roster[0] = member("a", totodile, 5, 80);
    expect(territoryPreparation(state, benchmark, target)).toBeNull();
    state.resources.candy = 1;
    expect(territoryPreparation(state, benchmark, target)).toMatchObject({ kind: "growth", candy: 1, level: 6 });
    state.roster.push(member("b", frillish));
    expect(territoryPreparation(state, benchmark, target)).toMatchObject({ kind: "entry", member: { id: "b" } });
  });

  it("forecasts the next equipped weakness move with actual remaining experience and held-item bonuses", () => {
    expect(nextWeaknessMove(member("a", totodile), benchmark, target)).toMatchObject({ level: 6, candy: 15, move: { id: 55 } });
    expect(nextWeaknessMove({ ...member("a", totodile, 5, 35), heldItem: "lucky_egg" }, benchmark, target))
      .toMatchObject({ level: 6, candy: 2, move: { id: 55 } });
    expect(nextWeaknessMove(member("a", totodile, 6), benchmark, target)).toBeNull();
    expect(nextWeaknessMove(member("a", totodile), benchmark, [8])).toBeNull();
  });

  it("uses attacks available at the encounter level for shared weaknesses and possible switch-ins", () => {
    const state = frontier(false);
    state.roster = [member("a", species(4, "불꽃", 10)), member("b", species(6, "불꽃 독", 10, 4)), member("c", halfGhost)];
    state.entryOrder = ["a", "b", "c"];
    const data: GameDataBundle = {
      ...benchmark,
      types: [...benchmark.types, { typeRowid: 5, nameKr: "땅", relation: { relationMap: {
        "10": { damageTo: 2, damageFrom: 1 }, "4": { damageTo: 2, damageFrom: 1 }, "3": { damageTo: 0, damageFrom: 1 },
      } } }],
      moves: [...benchmark.moves, { moveRowid: 89, nameKr: "지진", typeRowid: 5, details: { power: 100, pp: 10, accuracy: 100, damageClass: 2 } }],
      battle: { moves: { ...benchmark.battle.moves, "89": {} }, learnsets: { ...benchmark.battle.learnsets, "769": [[89, 4]] } },
    };
    expect(territoryTactics(state, data, "south")).toEqual([]);
    state.territories.south.scouted = true;
    const group = territoryTactics(state, data, "south").find(group => group.key === "5-8");
    expect(group?.threats[0]).toMatchObject({ typeId: 5, weak: [{ id: "a" }, { id: "b" }], switches: [{ member: { id: "c" }, multiplier: 0 }] });
    data.battle.learnsets["769"] = [[89, 6]];
    expect(territoryTactics(state, data, "south").find(group => group.key === "5-8")?.threats).toEqual([]);
  });

  it("finds the first research level that increases output with the current held item", () => {
    const worker = { ...member("a", species(337, "루나톤", 14)), aptitude: 61, jobId: "research" as const };
    expect(nextResearchIncrease(worker)).toEqual({ level: 4, candy: 6, current: 1, potential: 2 });
    expect(nextResearchIncrease({ ...worker, heldItem: "choice_band" })).toEqual({ level: 2, candy: 1, current: 1, potential: 2 });
  });

  it("selects one marked candidate using actual level-one attacks and excludes rare candidates", () => {
    const rare = { ...frillish, pokemonRowid: 999, details: { isLegendary: true } };
    const data = { ...benchmark, pokemon: [...benchmark.pokemon, rare],
      battle: { ...benchmark.battle, learnsets: { ...benchmark.battle.learnsets, "999": [[55, 1] as [number, number]] } } };
    const eligible = counterHuntPool(data, target);
    expect(eligible.map(pokemon => pokemon.nameKr)).toEqual(["탱그릴"]);
    const candidates = huntCandidates(data.pokemon, data.types, 3, null, eligible);
    expect(candidates.filter(candidate => candidate.counter).map(candidate => candidate.pokemon)).toEqual([frillish]);
    expect(new Set(candidates.map(candidate => candidate.pokemon.pokemonRowid)).size).toBe(3);
    expect(counterHuntPool({ ...data, pokemon: [poochyena] }, target)).toEqual([]);
  });

  it("charges once, restores the same map report, and excludes in-progress actions from restored state", () => {
    const state = frontier();
    const start = { type: "START_COUNTER_HUNT", territoryId: "south", typeIds: target } as const;
    expect(gameReducer({ ...state, energy: 1 }, start).energy).toBe(1);
    const hunting = gameReducer(state, start);
    expect(hunting).toMatchObject({ screen: "hunt", energy: 3 });
    expect(gameReducer(hunting, start)).toBe(hunting);
    expect(gameReducer(hunting, { type: "END_HUNT" })).toMatchObject({ screen: "map", mapFocusId: "south", counterHunt: null, energy: 3 });
    expect(restoreGameState({ ...hunting, v: 4 }, null).counterHunt).toBeNull();

    const setup = prepareTerritoryBattle(state, benchmark, "south")!;
    const battling = gameReducer(state, { type: "START_TERRITORY_BATTLE", setup });
    const concede = { type: "CONCEDE_TERRITORY", territoryId: "south" } as const;
    const ended = gameReducer(battling, concede);
    expect(ended).toMatchObject({ screen: "map", mapFocusId: "south", battle: null, energy: 3 });
    expect(ended.resources).toBe(state.resources);
    expect(ended.territories).toBe(state.territories);
    expect(gameReducer(ended, concede)).toBe(ended);
    expect(gameReducer(ended, { type: "CLAIM_TERRITORY", territoryId: "south" })).toBe(ended);
  });
});
