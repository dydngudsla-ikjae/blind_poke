import { describe, expect, it, vi } from "vitest";
import type { GameDataBundle, RosterMember } from "../domain/types";
import { worldMapNodes } from "../domain/worldMap";
import { describeFirstVictoryReward, rewardStorageShortfall } from "./campaign";
import { forecastIntrusionLoss, forecastProduction } from "../domain/production";
import { enemyPartsSupply } from "../domain/frontierOperations";
import { forecastSupplyRoute, isolatedTurnsRemaining, suppliedTerritories } from "../domain/territorySupply";
import { gameSaveSchema, mapSnapshotSchema } from "../services/saveSchemas";
import { createInitialState, gameReducer, isFreeWorker, restoreGameState } from "./gameReducer";
import type { GameState } from "./gameTypes";
import { drawGhostIntel, prepareTerritoryBattle, territoryEnemyLevel } from "./territoryBattle";

const member=(id="mon-1"):RosterMember=>({id,alias:"테스트",pokemon:{pokemonRowid:1,nameKr:"이상해씨",hp:45,atk:49,def:49,satk:65,sdef:65,spd:45},level:1,exp:0,favor:80,favCeil:90,favFloor:20,aptitude:50,iv:{},buildingId:null,jobId:null});

function frontierFixture() {
  const roster = [member(), ...[8, 16].map((type1Rowid, index) => ({
    ...member(`mon-${index + 2}`), pokemon: { ...member().pokemon, type1Rowid },
  }))];
  const state = restoreGameState({ v: 3, roster, entryOrder: ["mon-1"], storageCap: 100 }, [
    ...worldMapNodes.filter(node => node.region === 1).map(node => ({ id: node.id, owner: "player" as const })),
    { id: "nw-01", owner: "player", active: true, loyalty: 65 },
    { id: "nw-02", owner: "trainer", trainerId: "opponent", active: true, scouted: true, factionId: "nw-1" },
    { id: "nw-03", owner: "trainer", trainerId: "manufacturer", active: true, factionId: "nw-1" },
    { id: "nw-07", owner: "player", active: true },
    { id: "nw-08", owner: "trainer", trainerId: "far", active: true, scouted: true },
  ]);
  return { ...state, screen: "map" as const };
}

function reloadCampaign(state: ReturnType<typeof createInitialState>) {
  const map = Object.entries(state.territories).map(([id, spot]) => ({ id, ...spot }));
  return restoreGameState(JSON.parse(JSON.stringify(state)), map);
}

it("adds a starter and moves the draft forward in one action for the current round", () => {
  const initial = createInitialState();
  const first = gameReducer(initial, { type: "PICK_STARTER", member: member(), expectedRound: 0 });
  expect(first).toMatchObject({ draftRound: 1, screen: "draft", nextMemberId: 2, caughtSpeciesIds: [1] });
  const second = { ...member("mon-2"), pokemon: { ...member().pokemon, pokemonRowid: 4 } };
  expect(gameReducer(first, { type: "PICK_STARTER", member: second, expectedRound: 0 })).toBe(first);
  const restored = reloadCampaign(first);
  const two = gameReducer(restored, { type: "PICK_STARTER", member: second, expectedRound: 1 });
  const third = { ...member("mon-3"), pokemon: { ...member().pokemon, pokemonRowid: 7 } };
  const revealed = gameReducer(two, { type: "PICK_STARTER", member: third, expectedRound: 2 });
  expect(revealed).toMatchObject({ draftRound: 3, screen: "trainerReveal", caughtSpeciesIds: [1, 4, 7] });
  expect(revealed.roster.map(entry => entry.id)).toEqual(["mon-1", "mon-2", "mon-3"]);
  expect(gameReducer(revealed, { type: "PICK_STARTER", member: member("mon-4"), expectedRound: 3 })).toBe(revealed);
});

it("starts another ordinary hunt for the regular cost without carrying over the previous observation", () => {
  const state: GameState = { ...createInitialState(), screen: "identify", energy: 2, selectedPokemonId: 1,
    selectedTypeName: "풀", selectedScan: { x: .5, y: .5, number: 2 }, roster: [member()], caughtSpeciesIds: [1] };
  const action = { type: "CONTINUE_HUNT" } as const;
  const next = gameReducer(state, action);
  expect(next).toEqual({ ...state, screen: "hunt", energy: 0, selectedPokemonId: null, selectedTypeName: null, selectedScan: null });
  expect(gameReducer(next, action)).toBe(next);
  for (const unavailable of [{ ...state, energy: 1 }, { ...state, huntTypeId: 12 },
    { ...state, counterHunt: { territoryId: "south", typeIds: [8] } }]) {
    expect(gameReducer(unavailable, action)).toBe(unavailable);
  }
  const ending = { ...state, caughtSpeciesIds: Array.from({ length: 25 }, (_, index) => index + 1),
    territories: Object.fromEntries(Object.entries(state.territories).map(([id, site]) => [id, { ...site, owner: "player" as const }])) };
  expect(gameReducer(ending, action)).toBe(ending);
  expect(gameReducer({ ...ending, endingSeen: true }, action)).toMatchObject({ screen: "hunt", energy: 0 });
});

it("starts trainer growth at the legacy load turn and preserves its cap across reloads", () => {
  const legacy = frontierFixture();
  const spots = Object.entries(legacy.territories).map(([id, spot]) => ({ id, ...spot }));
  const state = { ...restoreGameState({ v: 4, roster: legacy.roster, turnCount: 22 }, spots), screen: "map" as const };
  const baseline = territoryEnemyLevel(state, 2, "nw-02");
  expect(territoryEnemyLevel({ ...state, turnCount: 26 }, 2, "nw-02")).toBe(baseline);
  expect(territoryEnemyLevel(reloadCampaign({ ...state, turnCount: 27 }), 2, "nw-02")).toBe(baseline + 1);
  expect(territoryEnemyLevel({ ...state, turnCount: 65 }, 2, "nw-02")).toBe(baseline + 3);
});

describe("AI workshop supply and Dark operations", () => {
  const send = { type: "SEND_DARK_SABOTAGE" as const, sourceId: "nw-01", targetId: "nw-04", memberId: "mon-1" };
  const nextTurn = { type: "NEXT_TURN" as const };

  function border(alternate = false) {
    return { ...restoreGameState({ v: 4, roster: [
      { ...member(), pokemon: { ...member().pokemon, type1Rowid: 17, type2Rowid: 8 } },
      { ...member("mon-2"), pokemon: { ...member().pokemon, type1Rowid: 17 } },
    ], storageCap: 200 }, [
      ...worldMapNodes.filter(node => node.region === 1).map(node => ({ id: node.id, owner: "player" as const })),
      { id: "nw-01", owner: "player", active: true },
      { id: "nw-02", owner: "trainer", trainerId: "two", active: true, scouted: true, factionId: "nw-1" },
      { id: "nw-03", owner: alternate ? "trainer" : "unoccupied", trainerId: "three", active: true, scouted: true, factionId: "nw-1" },
      { id: "nw-04", owner: "trainer", trainerId: "four", active: true, scouted: true, factionId: "nw-1" },
    ]), screen: "map" as const };
  }

  it("shares within an intact faction path and skips an unsupplied contact in map order", () => {
    const state = border(true);
    expect(enemyPartsSupply(state.territories).has("nw-02")).toBe(true);
    expect(gameReducer(state, nextTurn).frontier.intrusion).toMatchObject({ sourceId: "nw-02", targetId: "nw-01" });
    const cut = border();
    expect(enemyPartsSupply(cut.territories).has("nw-02")).toBe(false);
    expect(gameReducer(cut, nextTurn).frontier.intrusion).toMatchObject({ sourceId: "nw-04", targetId: "nw-01" });
    const nextContact: typeof cut = { ...cut, territories: { ...cut.territories,
      "nw-04": { ...cut.territories["nw-04"], owner: "player" },
      "nw-07": { ...cut.territories["nw-07"], owner: "trainer", active: true, factionId: "nw-2" },
    } };
    expect(gameReducer(nextContact, nextTurn).frontier.intrusion).toMatchObject({ sourceId: "nw-07", targetId: "nw-04" });
    const withoutLeader: typeof state = { ...state, territories: { ...state.territories,
      "nw-04": { ...state.territories["nw-04"], owner: "player" },
    } };
    expect(enemyPartsSupply(withoutLeader.territories).has("nw-02")).toBe(true);
    const noFaction = { ...state.territories, "nw-03": { ...state.territories["nw-03"], factionId: undefined } };
    expect(enemyPartsSupply(noFaction).has("nw-02")).toBe(false);
  });

  it("reserves one free Dark worker, survives v4 reload and suppresses only one turn of new warnings", () => {
    const state = border();
    expect(gameReducer({ ...state, energy: 0 }, send).frontier.sabotage).toBeUndefined();
    expect(gameReducer(state, { ...send, targetId: "nw-02" })).toBe(state);
    const queued = gameReducer(state, send);
    expect(queued.energy).toBe(state.energy - 1);
    expect(queued.frontier.sabotage).toEqual({ sourceId: "nw-01", targetId: "nw-04", memberId: "mon-1", trainerId: "four" });
    expect(gameReducer(queued, { ...send, memberId: "mon-2" })).toBe(queued);
    expect(gameReducer(queued, { type: "SEND_GHOST_RECON", sourceId: "nw-01", targetId: "nw-02", memberId: "mon-1", pokemonIds: [25] })).toBe(queued);
    const map = Object.entries(queued.territories).map(([id, territory]) => ({ id, ...territory }));
    const restored = restoreGameState(gameSaveSchema.parse({ ...queued, v: 4 }), map);
    expect(restored.frontier.sabotage).toEqual(queued.frontier.sabotage);
    const stopped = gameReducer(restored, nextTurn);
    expect(stopped.frontier).toMatchObject({ intrusion: null, quietTurns: 0 });
    expect(stopped.frontier.sabotage).toBeUndefined();
    expect(gameReducer(stopped, nextTurn).frontier.intrusion?.sourceId).toBe("nw-04");
  });

  it("leaves alternate production and already scheduled attacks in effect", () => {
    const alternate = gameReducer(border(true), send);
    expect(gameReducer(alternate, nextTurn).frontier.intrusion?.sourceId).toBe("nw-02");
    const warned = gameReducer(border(), nextTurn);
    const queued = gameReducer({ ...warned, screen: "map" }, send);
    const hit = gameReducer(queued, nextTurn);
    expect(hit.resources.gold - warned.resources.gold).toBe(27);
    expect(hit.frontier).toMatchObject({ intrusion: null, quietTurns: 3 });
    expect(hit.lastLog).toContain("북서 1거점 · 적 침투 성공 · 턴당 수입 3 제외");
    const legacy = reloadCampaign({ ...warned, frontier: { ...warned.frontier,
      intrusion: { sourceId: "nw-02", targetId: "nw-01" } } });
    expect(enemyPartsSupply(legacy.territories).has("nw-02")).toBe(false);
    expect(gameReducer(legacy, nextTurn).resources.gold - legacy.resources.gold).toBe(27);
  });
});

describe("frontier operations", () => {
  it("forecasts the amount a pending intrusion actually removes after storage is applied", () => {
    const warned = gameReducer(frontierFixture(), { type: "NEXT_TURN" });
    for (const [space, expected] of [[32, 3], [28, 1], [27, 0]]) {
      const ready = { ...warned, storageCap: 100, resources: { ...warned.resources, gold: 100 - space } };
      const safe = { ...ready, frontier: { ...ready.frontier, intrusion: null } };
      expect(forecastIntrusionLoss(ready)).toBe(expected);
      expect(gameReducer(safe, { type: "NEXT_TURN" }).resources.gold - gameReducer(ready, { type: "NEXT_TURN" }).resources.gold).toBe(expected);
      expect(forecastIntrusionLoss(safe)).toBe(0);
    }
  });

  it("dispatches one available Ghost to a scouted and supplied frontier, then saves the team for one battle", () => {
    const map = frontierFixture();
    const order = { type: "SEND_GHOST_RECON" as const, targetId: "nw-02", sourceId: "nw-01", memberId: "mon-2", pokemonIds: [94, 25] };
    expect(gameReducer(map, { ...order, memberId: "mon-1" })).toBe(map);
    expect(gameReducer(map, { ...order, sourceId: "nw-07", targetId: "nw-08" })).toBe(map);
    const sent = gameReducer(map, order);
    expect(sent.energy).toBe(4);
    expect(gameReducer(sent, order)).toBe(sent);
    expect(reloadCampaign(sent).frontier).toEqual(sent.frontier);
    const ready = gameReducer(reloadCampaign(sent), { type: "NEXT_TURN" });
    expect(ready.frontier.intel["nw-02"]).toMatchObject({ pokemonIds: [94, 25] });
    expect(ready.frontier.intel["nw-02"].memberId).toBeUndefined();
    const saved = { ...reloadCampaign(ready), screen: "map" as const };
    const pokemon = [1, 25, 94].map(pokemonRowid => ({ ...member().pokemon, pokemonRowid }));
    const data: GameDataBundle = { pokemon, trainers: [], types: [], moves: [], abilities: [], battle: { learnsets: {}, moves: {} } };
    const setup = prepareTerritoryBattle(saved, data, "nw-02")!;
    expect(setup.enemyTeam.map(entry => entry.pokemonId)).toEqual([94, 25]);
    const battle = gameReducer(saved, { type: "START_TERRITORY_BATTLE", setup });
    expect(battle.battle?.enemyTeam.map(entry => entry.pokemonId)).toEqual([94, 25]);
    expect(battle.frontier.intel["nw-02"]).toBeUndefined();
  });

  it("warns a turn ahead, skips only the target's income if undefended and waits three full turns", () => {
    const first = gameReducer(frontierFixture(), { type: "NEXT_TURN" });
    expect(first.resources.gold).toBe(30);
    expect(first.frontier.intrusion).toMatchObject({ targetId: "nw-01", sourceId: "nw-02" });
    expect(first.territories["nw-07"].loyalty).toBe(65);
    const warned = reloadCampaign(first);
    expect(forecastProduction(warned).income).toBe(27);
    let state = gameReducer(warned, { type: "NEXT_TURN" });
    expect(state.resources.gold - warned.resources.gold).toBe(27);
    expect(state.territories["nw-01"]).toMatchObject({ owner: "player", loyalty: 100 });
    expect(state.frontier.quietTurns).toBe(3);
    for (const quietTurns of [2, 1, 0]) {
      state = gameReducer(reloadCampaign(state), { type: "NEXT_TURN" });
      expect(state.frontier).toMatchObject({ intrusion: null, quietTurns });
    }
    expect(gameReducer(state, { type: "NEXT_TURN" }).frontier.intrusion?.targetId).toBe("nw-01");
  });

  it("accepts an available Dragon once, keeps income and cancels a cut frontier without a second loss", () => {
    const first = gameReducer(frontierFixture(), { type: "NEXT_TURN" });
    const order = { type: "BLOCK_INTRUSION" as const, targetId: "nw-01", memberId: "mon-3" };
    expect(gameReducer(first, { ...order, memberId: "mon-2" })).toBe(first);
    const blocked = gameReducer(first, order);
    expect(blocked.energy).toBe(4);
    expect(gameReducer(blocked, order)).toBe(blocked);
    const settled = gameReducer(reloadCampaign(blocked), { type: "NEXT_TURN" });
    expect(settled.resources.gold - first.resources.gold).toBe(30);
    expect(settled.lastLog).toContain("북서 1거점 · 침투 차단");
    expect(settled.frontier).toMatchObject({ intrusion: null, quietTurns: 3 });
    const cut = { ...first, territories: { ...first.territories, island: { ...first.territories.island, owner: "unoccupied" as const } } };
    const cancelled = gameReducer(cut, { type: "NEXT_TURN" });
    expect(cancelled.resources.gold - first.resources.gold).toBe(24);
    expect(cancelled.territories["nw-01"].loyalty).toBe(65);
  });
});

describe("enemy observation and Flying detection", () => {
  const next = { type: "NEXT_TURN" } as const;
  const detect = { type: "DETECT_ENEMY_OBSERVATION", targetId: "nw-01", memberId: "mon-4" } as const;
  const pokemon = [
    { ...member().pokemon, pokemonRowid: 1, type1Rowid: 12 },
    { ...member().pokemon, pokemonRowid: 7, type1Rowid: 11 },
    { ...member().pokemon, pokemonRowid: 4, type1Rowid: 10 },
  ];
  const data: GameDataBundle = { pokemon, trainers: [], moves: [], abilities: [], battle: { learnsets: {}, moves: {} }, types: [
    { typeRowid: 10, nameKr: "불꽃", relation: { relationMap: { 12: { damageFrom: .5, damageTo: 2 } } } },
    { typeRowid: 11, nameKr: "물", relation: { relationMap: { 12: { damageFrom: 2, damageTo: .5 } } } },
  ] };

  function border() {
    const fixture = frontierFixture();
    return { ...fixture, roster: [{ ...fixture.roster[0], pokemon: pokemon[0] }, ...fixture.roster.slice(1),
      { ...member("mon-4"), pokemon: { ...member().pokemon, type1Rowid: 16, type2Rowid: 3 } }],
    territories: { ...fixture.territories, "nw-02": { ...fixture.territories["nw-02"], factionId: undefined } } };
  }

  function reload(state: GameState) {
    return restoreGameState(gameSaveSchema.parse({ ...state, v: 4 }),
      Object.entries(state.territories).map(([id, site]) => ({ id, ...site })));
  }

  it("observes without enemy parts, while preserving financial intrusion priority and excluding a cut border", () => {
    const financial = gameReducer(frontierFixture(), next, data);
    expect(financial.frontier.intrusion?.sourceId).toBe("nw-02");
    expect(financial.frontier.espionage?.observation).toBeUndefined();
    const control = border();
    expect(enemyPartsSupply(control.territories).has("nw-02")).toBe(false);
    const warned = gameReducer(control, next, data);
    expect(warned.frontier.intrusion).toBeNull();
    expect(warned.frontier.espionage?.observation).toMatchObject({ sourceId: "nw-02", targetId: "nw-01" });
    const cut = { ...warned, territories: { ...warned.territories, island: { ...warned.territories.island, owner: "unoccupied" as const } } };
    expect(gameReducer(cut, next, data).frontier.espionage).toEqual({ quietTurns: 3 });
  });

  it("reserves one free Flying worker and preserves the response across reload without losing gold", () => {
    const warned = gameReducer(border(), next, data);
    const exhausted = { ...warned, energy: 0 };
    expect(gameReducer(exhausted, detect, data)).toBe(exhausted);
    expect(gameReducer(warned, { ...detect, memberId: "mon-3" }, data)).toBe(warned);
    expect(gameReducer(warned, { ...detect, targetId: "nw-07" }, data)).toBe(warned);
    const defended = gameReducer(warned, detect, data);
    expect(defended.energy).toBe(warned.energy - 1);
    expect(gameReducer(defended, detect, data)).toBe(defended);
    const restored = reload(defended);
    expect(restored.frontier.espionage?.observation?.detectorId).toBe("mon-4");
    expect(isFreeWorker(restored, restored.roster[3])).toBe(false);
    const resolved = gameReducer(restored, next, data);
    expect(resolved.frontier.espionage).toEqual({ quietTurns: 3 });
    expect(isFreeWorker(resolved, resolved.roster[3])).toBe(true);
    expect(resolved.resources.gold).toBe(gameReducer(warned, next, data).resources.gold);
    expect(resolved.lastLog.some(line => line.includes("적 첩보 차단"))).toBe(true);
  });

  it("uses the lead types at settlement once, keeps the two assigned levels, and expires after three turns", () => {
    const warned = gameReducer({ ...border(), entryOrder: ["mon-2", "mon-1"] }, next, data);
    const settled = gameReducer({ ...warned, entryOrder: ["mon-1", "mon-2"] }, next, data);
    const prep = settled.frontier.espionage?.preparation;
    expect(prep).toMatchObject({ territoryId: "nw-02", leadTypes: [12], expiresTurn: settled.turnCount + 3 });
    expect(reload(settled).frontier.espionage?.preparation).toEqual(prep);
    const map = { ...settled, screen: "map" as const, entryOrder: ["mon-2", "mon-1"] };
    const rng = vi.spyOn(Math, "random");
    try {
      const nextBattle = (state: typeof map) => {
        rng.mockReturnValueOnce(.4).mockReturnValueOnce(.9).mockReturnValueOnce(0).mockReturnValueOnce(.9);
        return prepareTerritoryBattle(state, data, "nw-02")!;
      };
      const baseline = nextBattle({ ...map, frontier: { ...map.frontier, espionage: undefined } });
      expect(baseline.enemyTeam.map(entry => entry.pokemonId)).toEqual([7, 4]);
      const prepared = nextBattle(map);
      expect(prepared.enemyTeam).toEqual([...baseline.enemyTeam].reverse());
      const started = gameReducer(map, { type: "START_TERRITORY_BATTLE", setup: prepared }, data);
      expect(started.frontier.espionage?.preparation).toBeUndefined();
      let elapsed = settled;
      for (const quietTurns of [2, 1, 0]) {
        elapsed = gameReducer(elapsed, next, data);
        expect(elapsed.frontier.espionage?.observation).toBeUndefined();
        expect(elapsed.frontier.espionage?.quietTurns ?? 0).toBe(quietTurns);
      }
      expect(elapsed.frontier.espionage?.preparation).toBeUndefined();
      expect(nextBattle({ ...elapsed, screen: "map" }).enemyTeam.map(entry => entry.pokemonId)).toEqual([7, 4]);
    } finally { rng.mockRestore(); }
  });

  it("reflects prepared defense in a Ghost report and honors an already disclosed order", () => {
    const observed = gameReducer(gameReducer(border(), next, data), next, data);
    const map = { ...observed, screen: "map" as const };
    const rng = vi.spyOn(Math, "random").mockReturnValueOnce(.4).mockReturnValueOnce(.9).mockReturnValue(0);
    try {
      const pokemonIds = drawGhostIntel(map, data, "nw-02");
      const ghost = gameReducer(map, { type: "SEND_GHOST_RECON", sourceId: "nw-01", targetId: "nw-02", memberId: "mon-2", pokemonIds }, data);
      const ready = gameReducer(ghost, next, data);
      expect(ready.frontier.intel["nw-02"].pokemonIds).toEqual([4, 7]);
      const beforeObservation = border();
      const published = { ...beforeObservation, frontier: { ...beforeObservation.frontier,
        intel: { "nw-02": { sourceId: "nw-01", trainerId: "opponent", pokemonIds: [7, 4] } } } };
      const later = reload(gameReducer(gameReducer(published, next, data), next, data));
      expect(later.frontier.espionage?.preparation?.leadTypes).toEqual([12]);
      expect(later.frontier.intel["nw-02"].pokemonIds).toEqual([7, 4]);
      expect(later.lastLog).toContain("북서 1거점 · 적 첩보 성공 · 북서 2거점 공개 순서 유지");
      expect(prepareTerritoryBattle({ ...later, screen: "map" }, data, "nw-02")?.enemyTeam.map(entry => entry.pokemonId)).toEqual([7, 4]);
    } finally { rng.mockRestore(); }
  });

  it("recovers prior operations if the added optional save field is damaged", () => {
    const warned = gameReducer(frontierFixture(), next, data);
    const parsed = gameSaveSchema.parse({ ...warned, v: 4, frontier: {
      ...warned.frontier, espionage: { quietTurns: -1 },
    } });
    expect(parsed.frontier?.intrusion).toEqual(warned.frontier.intrusion);
    expect(parsed.frontier?.espionage).toBeUndefined();
  });
});

describe("game reducer",()=>{
  it("stores at most six unique battle entries in order",()=>{
    let state={...createInitialState(),roster:Array.from({length:7},(_,index)=>member(`mon-${index+1}`))};
    state=gameReducer(state,{type:"SET_ENTRY_ORDER",memberIds:["mon-3","mon-1","mon-3","mon-2","mon-4","mon-5","mon-6","mon-7"]});
    expect(state.entryOrder).toEqual(["mon-3","mon-1","mon-2","mon-4","mon-5","mon-6"]);
    expect(state.message).toBe("전투 엔트리는 최대 6마리입니다.");
  });
  it("places six trainers in ten active territories on a forty-node map",()=>{
    const state=createInitialState("player",["a","b","c","d","e","f","g"]);
    expect(Object.keys(state.territories)).toHaveLength(40);
    expect(Object.values(state.territories).filter(value=>value.active)).toHaveLength(10);
    expect(Object.values(state.territories).filter(value=>value.owner==="trainer")).toHaveLength(6);
    expect(Object.values(state.territories).filter(value=>value.active&&value.owner==="unoccupied")).toHaveLength(3);
    expect(Object.values(state.territories).filter(value=>!value.active)).toHaveLength(30);
  });
  it("reproduces a seeded placement without assigning the player or a trainer twice", () => {
    function seeded(seed: number) {
      return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    }
    const candidates = ["player", "a", "b", "c", "d", "e", "f", "g", "a", ""];
    const layouts = Array.from({ length: 100 }, (_, seed) => createInitialState("player", candidates, seeded(seed)).territories);
    expect(layouts[19]).toEqual(createInitialState("player", candidates, seeded(19)).territories);
    expect(layouts[19]).not.toEqual(layouts[22]);
    for (const layout of layouts) {
      const names = Object.values(layout).filter(spot => spot.owner === "trainer").map(spot => spot.trainerId);
      expect(new Set(names).size).toBe(6);
      expect(names).not.toContain("player");
      expect(names).not.toContain("");
      expect(layout.southwest).toMatchObject({ owner: "unoccupied", active: true, scouted: false });
      expect(Object.values(layout).filter(spot => !spot.active).every(spot => spot.owner === "unoccupied")).toBe(true);
    }
    const short = createInitialState("player", ["player", "a", "a", ""]).territories;
    expect(Object.values(short).filter(spot => spot.owner === "trainer")).toHaveLength(1);
  });
  it("reveals a territory when it is scouted",()=>{
    const state={...createInitialState("player",["a","b","c","d","e","f"]),screen:"map" as const};
    const next=gameReducer(state,{type:"SCOUT_TERRITORY",territoryId:"south"});
    expect(next.territories.south.scouted).toBe(true);
    expect(gameReducer(state,{type:"SCOUT_TERRITORY",territoryId:"nw-01"})).toBe(state);
  });
  it("charges once to challenge a scouted adjacent territory and awards the first victory once", () => {
    const base = createInitialState();
    const map = { ...base, screen: "map" as const, roster: [member()], entryOrder: ["mon-1"] };
    const start = {
      type: "START_TERRITORY_BATTLE" as const,
      setup: { territoryId: "southwest", enemyName: "상대", enemyTeam: [{ pokemonId: 4, level: 3 }] },
    };
    expect(gameReducer(map, start)).toBe(map);
    const scouted = gameReducer(map, { type: "SCOUT_TERRITORY", territoryId: "southwest" });
    const empty = { ...scouted, entryOrder: [] };
    expect(gameReducer(empty, start)).toBe(empty);
    const exhausted = { ...scouted, energy: 1 };
    expect(gameReducer(exhausted, start)).toBe(exhausted);
    const battle = gameReducer(scouted, start);
    expect(battle).toMatchObject({ screen: "battle", energy: map.energy - 2, battle: start.setup });
    expect(gameReducer(battle, start)).toBe(battle);
    const claimed = gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId: "southwest" });
    expect(claimed).toMatchObject({ screen: "battle", mapFocusId: "southwest", resources: { candy: 1, gold: 5 } });
    expect(claimed.territories.southwest.owner).toBe("player");
    expect(gameReducer(claimed, { type: "CLAIM_TERRITORY", territoryId: "southwest" })).toBe(claimed);
    expect(gameReducer(claimed, { type: "NEXT_TURN" }).resources.gold).toBe(8);
  });
  it("shows only the first victory rewards that can fit and saves the same amounts", () => {
    const initial = createInitialState();
    const map = { ...initial, screen: "map" as const, roster: [member()], entryOrder: ["mon-1"],
      resources: { ...initial.resources, gold: initial.storageCap - 2, candy: initial.storageCap } };
    const scouted = gameReducer(map, { type: "SCOUT_TERRITORY", territoryId: "southwest" });
    const setup = { territoryId: "southwest", enemyName: "야생 포켓몬", enemyTeam: [{ pokemonId: 10, level: 2 }] };
    const battle = gameReducer(scouted, { type: "START_TERRITORY_BATTLE", setup });
    expect(describeFirstVictoryReward(battle)).toBe("자금 +2 · 저장 공간 부족");
    const won = gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId: "southwest" });
    expect(won.resources).toMatchObject({ gold: initial.storageCap, candy: initial.storageCap });
    expect(won.territories.southwest.owner).toBe("player");
    expect(describeFirstVictoryReward({ ...battle, resources: won.resources })).toBe("저장 공간 부족");
  });
  it("charges a cure once on the current battle round and never spends action energy", () => {
    const initial = createInitialState();
    const map = { ...initial, screen: "map" as const, roster: [member()], entryOrder: ["mon-1"],
      resources: { ...initial.resources, cureItem: 2 } };
    const ready = gameReducer(map, { type: "SCOUT_TERRITORY", territoryId: "southwest" });
    const battle = gameReducer(ready, { type: "START_TERRITORY_BATTLE", setup: {
      territoryId: "southwest", enemyName: "테스트", enemyTeam: [{ pokemonId: 13, level: 3 }],
    } });
    const cure = { type: "USE_BATTLE_CURE" as const, territoryId: "southwest", round: 2 };
    expect(gameReducer(ready, cure)).toBe(ready);
    expect(gameReducer(battle, { ...cure, territoryId: "south" })).toBe(battle);
    const used = gameReducer(battle, cure);
    expect(used).toMatchObject({ resources: { cureItem: 1 }, energy: battle.energy, battle: { lastCureRound: 2 } });
    expect(gameReducer(used, cure)).toBe(used);
    expect(gameReducer(used, { ...cure, round: 1 })).toBe(used);
  });
  it("opens the next region only after the current region is secured, with a connected route through all forty territories", () => {
    let state = { ...createInitialState("player", ["a", "b", "c", "d", "e", "f"]), roster: [member()], entryOrder: ["mon-1"] };
    for (const region of [1, 2, 3, 4]) {
      const goals = worldMapNodes.filter(node => node.region === region && node.id !== "home");
      expect(goals.every(node => state.territories[node.id].active)).toBe(true);
      expect(worldMapNodes.filter(node => node.region > region).every(node => !state.territories[node.id].active)).toBe(true);
      const remaining = new Set(goals.map(node => node.id));
      while (remaining.size) {
        const target = goals.find(node => remaining.has(node.id) && node.neighbors.some(id => state.territories[id].owner === "player"));
        expect(target).toBeDefined();
        if (!target) throw new Error("No reachable frontier");
        state = { ...state, screen: "map", energy: 5 };
        state = gameReducer(state, { type: "SCOUT_TERRITORY", territoryId: target.id });
        state = gameReducer(state, { type: "START_TERRITORY_BATTLE", setup: { territoryId: target.id, enemyName: "상대", enemyTeam: [{ pokemonId: 10, level: 2 }] } });
        state = gameReducer(state, { type: "CLAIM_TERRITORY", territoryId: target.id });
        expect(state.territories[target.id]).toMatchObject({ owner: "player", trainerId: null, scouted: true });
        remaining.delete(target.id);
      }
    }
  });
  it("challenges the occupying trainer and uses their roster once the first victory is recorded", () => {
    const pokemon = member().pokemon;
    const base = createInitialState("player", ["blue"], () => 0);
    const south = { ...base.territories.south, scouted: true };
    const southwest = { ...base.territories.southwest, owner: "player" as const, scouted: true };
    const state = { ...base, screen: "map" as const, territories: { ...base.territories, south, southwest },
      roster: [member()], entryOrder: ["mon-1"] };
    const data: GameDataBundle = { pokemon: [pokemon, { ...pokemon, pokemonRowid: 7 }], moves: [], types: [], abilities: [], battle: { learnsets: {}, moves: {} },
      trainers: [{ id: "blue", nameKr: "그린", nameEn: "Blue", region: "Kanto", generation: 1, roles: [], specialtyTypes: [], pokemon: [{ id: 7, nameKr: "꼬부기" }] }] };
    const setup = prepareTerritoryBattle(state, data, "south");
    expect(setup).toMatchObject({ territoryId: "south", enemyName: "그린", enemyTeam: [{ pokemonId: 7 }] });
    expect(prepareTerritoryBattle({ ...state, territories: { ...state.territories, south: { ...south, scouted: false } } }, data, "south")).toBeNull();
    if (!setup) throw new Error("Scouted trainer battle was unavailable");
    const battle = gameReducer(state, { type: "START_TERRITORY_BATTLE", setup });
    const won = gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId: "south" });
    expect(won.territories.south).toMatchObject({ owner: "player", trainerId: null });
  });
  it("deploys two three-site factions per newly opened region and permits an unscouted leader challenge", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => `trainer-${i}`);
    let state = { ...createInitialState("player", candidates, () => 0), roster: [member()], entryOrder: ["mon-1"] };
    const layouts = [
      ["nw-02", "nw-03", "nw-04", "nw-07", "nw-08", "nw-09"],
      ["se-03", "se-04", "se-05", "se-08", "se-09", "se-10"],
      ["ne-03", "ne-04", "ne-05", "ne-07", "ne-08", "ne-09"],
    ];
    for (const region of [1, 2, 3, 4]) {
      const sites = worldMapNodes.filter(node => node.region === region && node.id !== "home");
      const assigned = sites.filter(node => state.territories[node.id].owner === "trainer").map(node => node.id);
      if (region > 1) {
        const layout = layouts[region - 2];
        expect(assigned).toEqual(layout);
        expect(new Set(assigned.map(id => state.territories[id].trainerId)).size).toBe(6);
        const factionIds = assigned.map(id => state.territories[id].factionId);
        expect(factionIds.slice(0, 3)).toEqual(Array(3).fill(factionIds[0]));
        expect(factionIds.slice(3)).toEqual(Array(3).fill(factionIds[3]));
        expect(factionIds[0]).toBeTruthy();
        expect(factionIds[0]).not.toEqual(factionIds[3]);
        const leader = sites.find(node => node.id === layout[2])!;
        const others = assigned.filter(id => id !== leader.id).map(id => state.territories[id]);
        const setup = { territoryId: leader.id, enemyName: "대표", enemyTeam: [{ pokemonId: 10, level: 8 }] };
        const map = { ...state, screen: "map" as const, energy: 5 };
        expect(state.territories[leader.id].scouted).toBe(false);
        expect(leader.neighbors.every(id => state.territories[id].owner !== "player")).toBe(true);
        const battle = gameReducer(map, { type: "START_TERRITORY_BATTLE", setup });
        expect(battle.energy).toBe(3);
        state = gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId: leader.id });
        expect(state.territories[leader.id]).toMatchObject({ owner: "player", loyalty: 100, factionId: factionIds[2] });
        expect(assigned.filter(id => id !== leader.id).map(id => state.territories[id])).toEqual(others);
      }
      const remaining = new Set(sites.filter(node => state.territories[node.id].owner !== "player").map(node => node.id));
      while (remaining.size) {
        const site = sites.find(node => remaining.has(node.id) && node.neighbors.some(id => state.territories[id].owner === "player"))!;
        const map = { ...state, screen: "map" as const, energy: 5 };
        const scouted = gameReducer(map, { type: "SCOUT_TERRITORY", territoryId: site.id });
        const battle = gameReducer(scouted, { type: "START_TERRITORY_BATTLE", setup: { territoryId: site.id, enemyName: "상대", enemyTeam: [{ pokemonId: 10, level: 3 }] } });
        state = gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId: site.id });
        expect(state.territories[site.id].owner).toBe("player");
        remaining.delete(site.id);
      }
    }
  });
  it("forecasts the fewest remaining captures to extend or restore the home supply route", () => {
    const { territories } = restoreGameState({ v: 3, roster: [member()] }, worldMapNodes.map(({ id, region }) => ({
      id, active: region <= 2, owner: region === 1 ? "player" : "unoccupied",
    })));
    expect(forecastSupplyRoute(territories, "nw-01")?.missing).toEqual([]);
    expect(forecastSupplyRoute(territories, "nw-10")).toMatchObject({
      path: ["island", "nw-01", "nw-04", "nw-07", "nw-10"], missing: ["nw-01", "nw-04", "nw-07"],
    });
    territories["nw-04"].owner = "player";
    territories["nw-07"].owner = "player";
    expect(suppliedTerritories(territories).has("nw-07")).toBe(false);
    expect(forecastSupplyRoute(territories, "nw-10")?.missing).toEqual(["nw-01"]);
    territories["nw-01"].owner = "player";
    expect(forecastSupplyRoute(territories, "nw-07")?.missing).toEqual([]);
    territories["nw-01"].active = false;
    expect(forecastSupplyRoute(territories, "nw-07")).toBeNull();
    expect(forecastSupplyRoute(territories, "ne-01")).toBeNull();
    expect([undefined, 65, 30, 0].map(isolatedTurnsRemaining)).toEqual([3, 2, 1, 1]);
  });
  it("preserves a legacy open region, loses isolated clusters in three turns and recovers when a route opens", () => {
    const legacy = restoreGameState({ v: 3, roster: [member()], storageCap: 100 }, [
      { id: "island", owner: "player" },
      { id: "nw-01", owner: "unoccupied", active: true },
      { id: "nw-04", owner: "player", active: true },
      { id: "nw-03", owner: "player", active: true },
    ]);
    const endTurn = (state: typeof legacy) => gameReducer(state, { type: "NEXT_TURN" });
    expect(legacy.territories["nw-01"]).toEqual({ owner: "unoccupied", trainerId: null, scouted: false, active: true });
    expect(legacy.territories["nw-04"].loyalty).toBe(100);
    expect(forecastProduction(legacy).income).toBe(3);
    const one = endTurn(legacy);
    expect(one.territories["nw-04"].loyalty).toBe(65);
    const snapshot = mapSnapshotSchema.parse(Object.entries(one.territories).map(([id, spot]) => ({ id, ...spot })));
    const loaded = restoreGameState(one, snapshot);
    expect(loaded.territories["nw-04"].loyalty).toBe(65);
    expect(loaded.resources.gold).toBe(3);
    const two = endTurn(loaded);
    expect(two.territories["nw-03"].loyalty).toBe(30);
    const three = endTurn(two);
    expect(three.territories["nw-04"]).toMatchObject({ owner: "unoccupied", trainerId: null, active: true });
    expect(three.territories["nw-03"].owner).toBe("unoccupied");
    expect(three.resources.gold).toBe(9);
    const connected = { ...one, territories: { ...one.territories } };
    for (const node of worldMapNodes.filter(node => node.region === 1 || node.id === "nw-01")) {
      connected.territories[node.id] = { ...connected.territories[node.id], owner: "player" };
    }
    expect(forecastProduction(connected).income).toBe(36);
    const recovered = endTurn(connected);
    expect(recovered.territories["nw-04"].loyalty).toBe(100);
    expect(recovered.resources.gold - one.resources.gold).toBe(36);
  });
  it("keeps downstream regions open and does not reassign a lost faction site", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => `trainer-${i}`);
    const older = createInitialState("player", candidates);
    const map = worldMapNodes.map(({ id, region }) => ({
      id, ...older.territories[id], active: region <= 3,
      ...(id === "nw-04" && { owner: "player" as const, loyalty: 30, factionId: "nw-1", scouted: true }),
    }));
    const restored = restoreGameState({ ...older, roster: [member()], entryOrder: ["mon-1"] }, map, "player", candidates);
    const later = gameReducer(restored, { type: "NEXT_TURN" });
    expect(later.territories["nw-04"]).toMatchObject({ owner: "unoccupied", trainerId: null, loyalty: 0, active: true, factionId: "nw-1" });
    expect(worldMapNodes.filter(node => node.region === 3).every(node => later.territories[node.id].active)).toBe(true);
    const saved = mapSnapshotSchema.parse(Object.entries(later.territories).map(([id, territory]) => ({ id, ...territory })));
    expect(restoreGameState(later, saved, "player", candidates).territories).toEqual(later.territories);
  });
  it("retains distinct recorded species outside the roster and pays each claimed milestone once", () => {
    let state = restoreGameState({ v: 4, roster: [member()], caughtSpeciesIds: [2, 2, 3, 4, 5, 6, 7, 8, 9] }, null);
    expect(state.caughtSpeciesIds).toHaveLength(9);
    state = gameReducer(state, { type: "ADD_MEMBER", member: member("mon-2") });
    expect(state.caughtSpeciesIds).toHaveLength(9);
    state = gameReducer(state, { type: "ADD_MEMBER", member: { ...member("mon-3"), pokemon: { ...member().pokemon, pokemonRowid: 10 } } });
    state = gameReducer(state, { type: "PATCH", patch: { roster: [member()] } });
    expect(state.caughtSpeciesIds).toHaveLength(10);
    const claim = { type: "CLAIM_DEX_REWARD" as const, threshold: 10 };
    const rewarded = gameReducer(state, claim);
    expect(rewarded.resources.candy).toBeGreaterThan(0);
    expect(gameReducer(rewarded, claim)).toBe(rewarded);
    expect(restoreGameState(rewarded, null).claimedDexRewards).toEqual([10]);
    const full = { ...state, resources: { ...state.resources, candy: state.storageCap } };
    expect(gameReducer(full, claim)).toBe(full);
  });
  it("reports the missing space of each reward resource and blocks a partial payout", () => {
    const base = createInitialState();
    const full = { ...base, caughtSpeciesIds: Array.from({ length: 25 }, (_, index) => index + 1),
      resources: { ...base.resources, tm: 49, gold: 55 } };
    const reward = { tm: 3, gold: 10 };
    const claim = { type: "CLAIM_DEX_REWARD", threshold: 25 } as const;
    expect(rewardStorageShortfall(full, reward)).toEqual([["tm", 2], ["gold", 15]]);
    expect(gameReducer(full, claim)).toBe(full);
    const enough = { ...full, resources: { ...full.resources, tm: 47, gold: 40 } };
    expect(rewardStorageShortfall(enough, reward)).toEqual([]);
    const rewarded = gameReducer(enough, claim);
    expect(rewarded.resources).toMatchObject({ tm: 50, gold: 50 });
    expect(gameReducer(rewarded, claim)).toBe(rewarded);
  });
  it.each([false, true])("pays an existing outpost research completion only once (legacy=%s)", legacyOutpostResearch => {
    const claim = { type: "CLAIM_INHERITED_RESEARCH_REWARD" as const };
    const raw = { v: 4, roster: [member()], resources: { candy: 48, gold: 12 }, storageCap: 50,
      turnCount: 46, energy: 1, claimedDexRewards: [10], inheritedResearchCompleted: true, legacyOutpostResearch };
    const state = restoreGameState(gameSaveSchema.parse(raw), null);
    expect(state.inheritedResearchRewardClaimed).toBeUndefined();
    expect(state.resources.candy).toBe(48);
    const rewarded = gameReducer(state, claim);
    expect(rewarded).toEqual({ ...state, resources: { ...state.resources, candy: 50 }, inheritedResearchRewardClaimed: true });
    expect(gameReducer(rewarded, claim)).toBe(rewarded);
    const reloaded = restoreGameState(gameSaveSchema.parse({ ...rewarded, v: 4 }), null);
    expect(reloaded.inheritedResearchRewardClaimed).toBe(true);
    expect(gameReducer(reloaded, claim)).toBe(reloaded);
  });

  it("keeps the optional research reward pending until both candy units fit", () => {
    const claim = { type: "CLAIM_INHERITED_RESEARCH_REWARD" as const };
    const base = createInitialState();
    expect(gameReducer(base, claim)).toBe(base);
    for (const candy of [49, 50]) {
      const full = { ...base, inheritedResearchCompleted: true as const, resources: { ...base.resources, candy } };
      expect(gameReducer(full, claim)).toBe(full);
      expect(full.inheritedResearchRewardClaimed).toBeUndefined();
    }
    const withRoom = { ...base, inheritedResearchCompleted: true as const, resources: { ...base.resources, candy: 48 } };
    expect(gameReducer(withRoom, claim).inheritedResearchRewardClaimed).toBe(true);
  });
  it("completes a one-worker building after three turns",()=>{
    let state={...createInitialState(),roster:[member()]};
    state=gameReducer(state,{type:"START_BUILDING",building:{id:"building-1",type:"farm",plotIndex:0,status:"constructing",remainingTurns:3},memberIds:["mon-1"]});
    state=gameReducer(state,{type:"NEXT_TURN"});state=gameReducer(state,{type:"NEXT_TURN"});state=gameReducer(state,{type:"NEXT_TURN"});
    expect(state.buildings[0]).toMatchObject({status:"active",remainingTurns:0});
  });
  it("pauses construction without workers",()=>{
    const state={...createInitialState(),buildings:[{id:"building-1",type:"farm",plotIndex:0,status:"constructing" as const,remainingTurns:2}]};
    expect(gameReducer(state,{type:"NEXT_TURN"}).buildings[0].remainingTurns).toBe(2);
  });
});

describe("save migration",()=>{
  it("keeps the saved occupier and does not reuse it when restoring absent starting nodes", () => {
    const saved = restoreGameState({ v: 3, roster: [member()], trainerId: "player" }, [
      { id: "south", owner: "trainer", trainerId: "a", scouted: true },
      { id: "southwest", owner: "player" },
    ], "player", ["player", "a", "b", "c", "d", "e", "f", "g"]);
    expect(saved.territories.south).toMatchObject({ trainerId: "a", scouted: true });
    expect(saved.territories.southwest).toMatchObject({ owner: "player", scouted: true });
    const trainers = Object.values(saved.territories).filter(spot => spot.owner === "trainer");
    expect(trainers).toHaveLength(6);
    expect(new Set(trainers.map(spot => spot.trainerId)).size).toBe(6);
    expect(trainers.some(spot => spot.trainerId === "player")).toBe(false);
  });

  it("preserves conquered nodes and existing open regions, and keeps the scouted copy of a duplicated identity", () => {
    const restored = restoreGameState({ v: 3, roster: [member()], trainerId: "player" }, [
      { id: "southwest", owner: "player" },
      { id: "southwest", owner: "unoccupied" },
      { id: "west", owner: "trainer", trainerId: "a", scouted: false },
      { id: "south", owner: "trainer", trainerId: "a", scouted: true },
      { id: "center", owner: "trainer", trainerId: "player" },
      { id: "southeast", owner: "trainer", trainerId: "retired", scouted: true },
      { id: "nw-01", owner: "unoccupied", unlocked: true },
    ], "player", ["a","b","c","d","e","f"]);
    expect(restored.territories.southwest).toMatchObject({ owner: "player", scouted: true });
    expect(restored.territories.south).toMatchObject({ owner: "trainer", trainerId: "a", scouted: true });
    expect(restored.territories.west).toMatchObject({ owner: "trainer", trainerId: null, scouted: false });
    expect(restored.territories.center).toMatchObject({ owner: "trainer", trainerId: null });
    expect(restored.territories.southeast).toMatchObject({ owner: "trainer", trainerId: null, scouted: true });
    expect(restored.territories["nw-01"].active).toBe(true);
    expect(restored.territories["nw-02"].active).toBe(false);
  });
  it("restores v2 resources, roster, building and separately stored territory ownership", () => {
    const roster = [{ ...member(), buildingId: "building-5" }];
    const buildings = [{ id: "building-5", status: "active", type: "clinic", plotIndex: 2, remainingTurns: 0 }];
    const state = restoreGameState({ v: 2, roster, buildings, resources: { gold: 7 }, turnCount: 4 },
      [{ id: "southwest", owner: "player" }, { id: "south", owner: "trainer", trainerId: "blue" }]);
    expect(state).toMatchObject({ buildings, plotCap: 3, caughtSpeciesIds: [1], turnCount: 4, nextBuildingId: 6,
      resources: { gold: 7 }, territories: { southwest: { owner: "player", scouted: true }, south: { owner: "trainer", trainerId: "blue" } } });
    expect(state.roster[0].buildingId).toBe("building-5");
  });

  it("trims legacy battle entries to six",()=>{
    const roster=Array.from({length:7},(_,index)=>({...member(`mon-${index+1}`),inEntry:true}));
    const state=restoreGameState({v:3,roster,resources:{}},null);
    expect(state.entryCap).toBe(6);
    expect(state.entryOrder).toHaveLength(6);
    expect(state.roster.every(entry=>entry.inEntry===undefined)).toBe(true);
  });
  it("migrates a v1 building assignment",()=>{
    const legacyMember={...member(),building:"farm"};delete (legacyMember as any).buildingId;
    const state=restoreGameState({v:1,roster:[legacyMember],resources:{},underConstruction:{farm:2}},null);
    expect(state.buildings[0]).toMatchObject({id:"building-1",type:"farm",status:"constructing",remainingTurns:2});
    expect(state.roster[0].buildingId).toBe("building-1");
  });
});
