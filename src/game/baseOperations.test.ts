import { describe, expect, it } from "vitest";
import type { BuildingState, RosterMember } from "../domain/types";
import { createInitialState, gameReducer, restoreGameState } from "./gameReducer";
import type { GameState } from "./gameTypes";
import { forecastGold, forecastProduction } from "../domain/production";
import { huntCandidates } from "./gameHelpers";
import { STARTING_TERRITORY_IDS, worldMapNodes } from "../domain/worldMap";
import { inheritedDojoProgress } from "./campaign";
import { gameSaveSchema } from "../services/saveSchemas";

function worker(id: string, type1Rowid: number, type2Rowid?: number): RosterMember {
  return {
    id, alias: id, pokemon: { pokemonRowid: Number(id.slice(4)), nameKr: id, type1Rowid, type2Rowid,
      hp: 45, atk: 49, def: 49, satk: 65, sdef: 65, spd: 45 },
    level: 1, exp: 0, favor: 80, favCeil: 90, favFloor: 20, aptitude: 50, iv: {},
  };
}

function facility(id: string, type: string, plotIndex: number, status: BuildingState["status"] = "active"): BuildingState {
  return { id, type, plotIndex, status, remainingTurns: status === "active" ? 0 : 1 };
}

function outpostCampaign(connected: boolean) {
  return restoreGameState({ v: 3, roster: [worker("mon-1", 12), worker("mon-2", 11), worker("mon-3", 5)],
    entryOrder: ["mon-1"], resources: { seed: 1 } }, [
    ...STARTING_TERRITORY_IDS.map(id => ({ id, owner: "player" as const })),
    { id: "nw-01", owner: connected ? "player" : "unoccupied", active: true },
    { id: "nw-04", owner: "trainer", trainerId: "guard", active: true },
  ]);
}

function claimOutpost(state: GameState, territoryId: string) {
  const setup = { territoryId, enemyName: "상대", enemyTeam: [{ pokemonId: 10, level: 5 }] };
  const battle = gameReducer({ ...state, screen: "map", energy: 5 }, { type: "START_TERRITORY_BATTLE", setup });
  return gameReducer(battle, { type: "CLAIM_TERRITORY", territoryId });
}

describe("outpost construction", () => {
  it("offers a trainer's building once and restores old occupied sites with two empty plots", () => {
    const legacy = outpostCampaign(true);
    expect(legacy.outposts["nw-01"]).toEqual({ plotCap: 2, clearing: null, inheritancePending: false });
    const won = claimOutpost(legacy, "nw-04");
    expect(won.outposts["nw-04"]).toMatchObject({ plotCap: 2, inheritancePending: true });
    const declined = gameReducer(won, { type: "RESOLVE_INHERITANCE", siteId: "nw-04", buildingType: null });
    expect(declined.outposts["nw-04"].inheritancePending).toBe(false);
    expect(declined.buildings).toEqual([]);
    expect(gameReducer(declined, { type: "RESOLVE_INHERITANCE", siteId: "nw-04", buildingType: "farm" })).toBe(declined);
  });

  it("gives the home farm first access to limited shared seeds and stops remote work when cut off", () => {
    const claimed = claimOutpost(outpostCampaign(true), "nw-04");
    const state = { ...claimed, buildings: [facility("home-farm", "farm", 1), { ...facility("remote", "farm", 0), siteId: "nw-04" }],
      roster: [{ ...worker("mon-2", 11), jobId: "fruit" as const, buildingId: "remote" },
        { ...worker("mon-4", 11), jobId: "fruit" as const, buildingId: "home-farm" }] };
    const production = forecastProduction(state);
    expect(production.workers.get("mon-4")?.produced).toBe(1);
    expect(production.workers.get("mon-2")?.produced).toBe(0);
    const isolated = { ...state, territories: { ...state.territories, "nw-01": { ...state.territories["nw-01"], owner: "unoccupied" as const } } };
    expect(forecastProduction(isolated).workers.has("mon-2")).toBe(false);
    expect(gameReducer(isolated, { type: "ASSIGN_JOB", buildingId: "remote", jobId: "fruit", memberId: "mon-4" })).toBe(isolated);
    expect(gameReducer(isolated, { type: "RELEASE_WORKER", buildingId: "remote", memberId: "mon-2" }).roster[0].buildingId).toBeNull();
  });

  it("preserves the building, releases its builder at loss and resumes only after recapture and reassignment", () => {
    const claimed = claimOutpost(outpostCampaign(true), "nw-04");
    const building = { ...facility("remote", "dojo", 1, "constructing"), siteId: "nw-04" };
    const started = gameReducer(claimed, { type: "START_BUILDING", building, memberIds: ["mon-1"] });
    expect(started.buildings[0].remainingTurns).toBe(3);
    let state = gameReducer(started, { type: "NEXT_TURN" });
    state = { ...state, territories: { ...state.territories, "nw-01": { ...state.territories["nw-01"], owner: "unoccupied" } } };
    for (let turn = 0; turn < 3; turn++) state = gameReducer(state, { type: "NEXT_TURN" });
    expect(state.territories["nw-04"].owner).toBe("unoccupied");
    expect(state.buildings[0].remainingTurns).toBe(2);
    expect(state.roster[0].buildingId).toBeNull();
    state = claimOutpost(claimOutpost(state, "nw-01"), "nw-04");
    state = gameReducer(state, { type: "ADD_BUILDERS", buildingId: "remote", memberIds: ["mon-1"] });
    state = gameReducer(state, { type: "NEXT_TURN" });
    expect(state.buildings[0].remainingTurns).toBe(1);
  });
});

describe("inherited dojo challenge", () => {
  function capturedDojoSite() {
    const campaign = outpostCampaign(true);
    const state: GameState = { ...campaign, roster: [...campaign.roster, worker("mon-4", 14)],
      territories: { ...campaign.territories, "nw-02": { ...campaign.territories["nw-02"], owner: "trainer", trainerId: "guard" } } };
    return claimOutpost(state, "nw-02");
  }

  it("tracks inheritance, supply, staffing and real production, and persists completion", () => {
    const captured = capturedDojoSite();
    expect(inheritedDojoProgress(captured)).toMatchObject({ step: "inherit" });
    const inherited = gameReducer(captured, { type: "RESOLVE_INHERITANCE", siteId: "nw-02", buildingType: "dojo" });
    const dojo = inherited.buildings[0];
    expect(dojo).toMatchObject({ inherited: true, siteId: "nw-02", type: "dojo" });
    expect(inheritedDojoProgress(inherited)).toMatchObject({ step: "assign", siteId: "nw-02" });
    const staffed = gameReducer(inherited, { type: "ASSIGN_JOB", buildingId: dojo.id, memberId: "mon-4", jobId: "research" });
    const cut: GameState = { ...staffed, territories: { ...staffed.territories,
      "nw-01": { ...staffed.territories["nw-01"], owner: "unoccupied" } } };
    expect(inheritedDojoProgress(cut)).toMatchObject({ step: "supply", siteId: "nw-02" });
    expect(gameReducer(cut, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();
    const lost: GameState = { ...cut, territories: { ...cut.territories,
      "nw-02": { ...cut.territories["nw-02"], owner: "unoccupied", loyalty: 0 } } };
    expect(inheritedDojoProgress(lost)).toEqual({ step: "recapture", siteId: "nw-02" });

    const full = { ...staffed, resources: { ...staffed.resources, candy: staffed.storageCap } };
    expect(inheritedDojoProgress(full)).toMatchObject({ step: "storage", siteId: "nw-02" });
    expect(gameReducer(full, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();
    expect(inheritedDojoProgress(staffed)).toMatchObject({ step: "produce", siteId: "nw-02" });
    const completed = gameReducer(staffed, { type: "NEXT_TURN" });
    expect(completed.resources).toEqual(forecastProduction(staffed).resources);
    expect(completed.claimedDexRewards).toEqual(staffed.claimedDexRewards);
    expect(completed.inheritedResearchCompleted).toBe(true);
    const detached = gameReducer(completed, { type: "RELEASE_WORKER", buildingId: dojo.id, memberId: "mon-4" });
    const restored = restoreGameState(gameSaveSchema.parse({ ...detached, v: 4 }), Object.entries(detached.territories)
      .map(([id, territory]) => ({ ...territory, id })));
    expect(restored.buildings[0]).toMatchObject({ inherited: true });
    expect(inheritedDojoProgress(restored)).toEqual({ step: "complete" });
  });

  it("preserves a legacy dojo in the same location without inferring inheritance or completion", () => {
    const state = capturedDojoSite();
    const declined = gameReducer(state, { type: "RESOLVE_INHERITANCE", siteId: "nw-02", buildingType: null });
    const ordinary = { ...facility("building-1", "dojo", 0), siteId: "nw-02" };
    const raw = { ...declined, v: 4, buildings: [ordinary], roster: declined.roster.map(member => member.id === "mon-4"
      ? { ...member, buildingId: ordinary.id, jobId: "research" } : member) };
    const restored = restoreGameState(gameSaveSchema.parse(raw), Object.entries(state.territories).map(([id, territory]) => ({ ...territory, id })));
    expect(restored.buildings).toEqual([ordinary]);
    expect(inheritedDojoProgress(restored)).toEqual({ step: "inherit" });
    const produced = gameReducer(restored, { type: "NEXT_TURN" });
    expect(produced.resources.candy).toBe(restored.resources.candy + 1);
    expect(produced.inheritedResearchCompleted).toBeUndefined();

    const cleared = restoreGameState(raw, worldMapNodes.map(({ id }) => ({ id, owner: "player", active: true })));
    expect(inheritedDojoProgress(cleared)).toEqual({ step: "unavailable" });
  });

  it("recognizes an exhausted old v4 save and completes through actual production at a supplied outpost", () => {
    const campaign = capturedDojoSite();
    const declared = gameReducer(campaign, { type: "RESOLVE_INHERITANCE", siteId: "nw-02", buildingType: null });
    const ordinary = { ...facility("building-1", "dojo", 1), siteId: "nw-02" };
    const legacy = { v: 4, roster: declared.roster.map(member => member.id === "mon-4"
      ? { ...member, buildingId: ordinary.id, jobId: "research" } : member),
      buildings: [ordinary], outposts: declared.outposts };
    const map = worldMapNodes.map(({ id }) => ({ id, owner: "player" as const, active: true }));
    const state = restoreGameState(gameSaveSchema.parse(legacy), map);
    expect(state.legacyOutpostResearch).toBe(true);
    expect(inheritedDojoProgress(state)).toMatchObject({ step: "produce", siteId: "nw-02", outpostRoute: true });
    expect(state.buildings).toEqual([ordinary]);

    const full = { ...state, resources: { ...state.resources, candy: state.storageCap } };
    expect(inheritedDojoProgress(full)).toMatchObject({ step: "storage", outpostRoute: true });
    expect(gameReducer(full, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();
    const cut: GameState = { ...state, territories: { ...state.territories,
      "nw-01": { ...state.territories["nw-01"], owner: "unoccupied" },
      "nw-03": { ...state.territories["nw-03"], owner: "unoccupied" } } };
    expect(inheritedDojoProgress(cut)).toMatchObject({ step: "supply", outpostRoute: true });
    expect(gameReducer(cut, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();

    const completed = gameReducer(state, { type: "NEXT_TURN" });
    expect(completed.resources).toEqual(forecastProduction(state).resources);
    expect(completed.claimedDexRewards).toEqual(state.claimedDexRewards);
    expect(completed.inheritedResearchCompleted).toBe(true);
    const restored = restoreGameState(gameSaveSchema.parse({ ...completed, v: 4 }), map);
    expect(restored.buildings).toEqual([ordinary]);
    expect(inheritedDojoProgress(restored)).toMatchObject({ step: "complete", outpostRoute: true });
  });

  it("keeps both new saves and pending inheritance on the standard route", () => {
    const campaign = capturedDojoSite();
    const fresh = createInitialState();
    expect(fresh.legacyOutpostResearch).toBe(false);
    const ordinary = { ...facility("building-1", "dojo", 1), siteId: "nw-02" };
    const legacy = { v: 4, roster: campaign.roster.map(member => member.id === "mon-4"
      ? { ...member, buildingId: ordinary.id, jobId: "research" } : member),
      buildings: [ordinary], outposts: campaign.outposts };
    const map = worldMapNodes.map(({ id }) => ({ id, owner: "player" as const, active: true }));
    const pending = restoreGameState(gameSaveSchema.parse(legacy), map);
    expect(pending.legacyOutpostResearch).toBe(true);
    expect(inheritedDojoProgress(pending)).toEqual({ step: "inherit" });
    expect(gameReducer(pending, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();

    const declined = gameReducer(pending, { type: "RESOLVE_INHERITANCE", siteId: "nw-02", buildingType: null });
    const standard = restoreGameState(gameSaveSchema.parse({ ...declined, v: 4, legacyOutpostResearch: fresh.legacyOutpostResearch }), map);
    expect(standard.legacyOutpostResearch).toBe(false);
    expect(inheritedDojoProgress(standard)).toEqual({ step: "unavailable" });
    expect(gameReducer(standard, { type: "NEXT_TURN" }).inheritedResearchCompleted).toBeUndefined();
  });
});

describe("next-turn gold forecast", () => {
  it("matches the 40-site payout before and after a charge purchase", () => {
    const state = restoreGameState({ v: 4, energy: 0, roster: [worker("mon-1", 1)], resources: { gold: 20 } },
      worldMapNodes.map(({ id }) => ({ id, owner: "player", active: true })));
    expect(forecastGold(state)).toEqual({ received: 30, overflow: 87, storageCap: 50 });
    expect(gameReducer(state, { type: "NEXT_TURN" }).resources.gold).toBe(50);

    const purchase = gameReducer(state, { type: "BUY_ENERGY_CHARGE" });
    expect(purchase).toMatchObject({ energy: 2, resources: { gold: 15 } });
    expect(forecastGold(purchase)).toEqual({ received: 35, overflow: 82, storageCap: 50 });
    const settled = gameReducer(purchase, { type: "NEXT_TURN" });
    expect(settled.lastLog).toContain("확보 지역 수입 · 자금 +35");
    expect(forecastGold(settled)).toEqual({ received: 0, overflow: 117, storageCap: 50 });
  });

  it("uses the available material once across mint workers and reflects refrigeration and intrusion", () => {
    const campaign = outpostCampaign(true);
    const intrusion = { sourceId: "nw-04", targetId: "nw-01" };
    const state: GameState = { ...campaign, plotCap: 2,
      buildings: [facility("workshop", "workshop", 0), facility("restaurant", "restaurant", 1)],
      resources: { ...campaign.resources, gold: 32, material: 2 },
      roster: [
        { ...worker("mon-1", 9), buildingId: "workshop", jobId: "mint" },
        { ...worker("mon-2", 9), buildingId: "workshop", jobId: "mint" },
        { ...worker("mon-3", 15), buildingId: "restaurant", jobId: "chill" },
        worker("mon-4", 16),
      ],
      frontier: { ...campaign.frontier, intrusion },
    };
    expect(forecastGold(state)).toEqual({ received: 28, overflow: 1, storageCap: 60 });
    expect(gameReducer(state, { type: "NEXT_TURN" }).resources).toMatchObject({ gold: 60, material: 1 });

    const defended = { ...state, frontier: { ...state.frontier, intrusion: { ...intrusion, defenderId: "mon-4" } } };
    expect(forecastGold(defended)).toEqual({ received: 28, overflow: 4, storageCap: 60 });
    expect(gameReducer(defended, { type: "NEXT_TURN" }).resources).toMatchObject({ gold: 60, material: 2 });

    const withRoom = { ...defended, resources: { ...defended.resources, gold: 0 } };
    expect(forecastGold(withRoom)).toEqual({ received: 32, overflow: 0, storageCap: 60 });

    const partialRoom = { ...state, resources: { ...state.resources, gold: 32.5 } };
    expect(forecastGold(partialRoom)).toEqual({ received: 27, overflow: 2, storageCap: 60 });
    expect(gameReducer(partialRoom, { type: "NEXT_TURN" }).resources.gold).toBe(59.5);
  });
});

describe("research staffing limits", () => {
  const researchers = (count: number) => Array.from({ length: 5 }, (_, index) => ({
    ...worker(`mon-${index + 1}`, 14, 2), aptitude: index === 0 ? 90 : 50,
    buildingId: index < count ? "home-dojo" : null, jobId: index < count ? "research" as const : null,
  }));
  const assign = (buildingId: string, memberId: string) => ({ type: "ASSIGN_JOB" as const, buildingId, memberId, jobId: "research" as const });

  it("blocks a fourth researcher at one dojo, allows the assignment at a supplied second dojo, and leaves combat training open", () => {
    const claimed = claimOutpost(outpostCampaign(true), "nw-04");
    const state = { ...claimed, roster: researchers(3), buildings: [facility("home-dojo", "dojo", 0),
      { ...facility("remote-dojo", "dojo", 0), siteId: "nw-04" }] };
    expect(gameReducer(state, assign("home-dojo", "mon-4"))).toBe(state);
    const placed = gameReducer(state, assign("remote-dojo", "mon-4"));
    expect(placed.energy).toBe(state.energy - 1);
    expect(placed.roster[3]).toMatchObject({ buildingId: "remote-dojo", jobId: "research" });
    expect(forecastProduction(placed).resources.candy).toBe(5);
    expect(gameReducer(placed, assign("home-dojo", "mon-4"))).toBe(placed);
    const taught = gameReducer(placed, { ...assign("home-dojo", "mon-5"), jobId: "train" });
    expect(taught.roster[4]).toMatchObject({ buildingId: "home-dojo", jobId: "train" });
    expect(gameReducer(taught, assign("home-dojo", "mon-5"))).toBe(taught);
  });

  it("restores all four legacy researchers and admits a replacement only after two workers are released", () => {
    const legacy = restoreGameState({ v: 4, roster: researchers(4), buildings: [facility("home-dojo", "dojo", 0)] }, null);
    expect(forecastProduction(legacy).resources.candy).toBe(5);
    expect(gameReducer(legacy, assign("home-dojo", "mon-5"))).toBe(legacy);
    const release = (state: GameState, memberId: string) => gameReducer(state, { type: "RELEASE_WORKER", buildingId: "home-dojo", memberId });
    const three = release(legacy, "mon-4");
    expect(gameReducer(three, assign("home-dojo", "mon-5"))).toBe(three);
    const two = release(three, "mon-3");
    const restored = gameReducer(two, assign("home-dojo", "mon-5"));
    expect(restored.energy).toBe(two.energy - 1);
    expect(restored.roster[4]).toMatchObject({ buildingId: "home-dojo", jobId: "research" });
    expect(gameReducer(restored, assign("home-dojo", "mon-4"))).toBe(restored);
  });
});

describe("base operations", () => {
  it("warns at the favor floor, then leaves after the next turn's work and returns held equipment", () => {
    const base = createInitialState();
    const workerAtRisk = { ...worker("mon-1", 12), favor: 22, buildingId: "farm", jobId: "seed" as const, heldItem: "choice_band" };
    const state: GameState = { ...base, screen: "base", introPending: false, roster: [workerAtRisk],
      buildings: [facility("farm", "farm", 0)], entryOrder: ["mon-1"], caughtSpeciesIds: [1], nextMemberId: 2 };
    const warned = gameReducer(state, { type: "NEXT_TURN" });
    expect(warned.roster[0]).toMatchObject({ favor: 20, departurePending: true });
    expect(warned.lastLog.some(line => line.includes("다음 턴 이탈 예정"))).toBe(true);
    const restored = restoreGameState(JSON.parse(JSON.stringify(warned)), null);
    const departed = gameReducer(restored, { type: "NEXT_TURN" });
    expect(departed).toMatchObject({ roster: [], entryOrder: [], caughtSpeciesIds: [1], nextMemberId: 2,
      resources: { seed: forecastProduction(restored).resources.seed, items: { choice_band: 1 } } });
    expect(departed.lastLog.some(line => line.includes("우호도 하한 · 이탈"))).toBe(true);
    const empty = restoreGameState(departed, null);
    expect(empty).toMatchObject({ screen: "base", roster: [], buildings: state.buildings, caughtSpeciesIds: [1], turnCount: 2 });
    expect(gameReducer(empty, { type: "NEXT_TURN" }).resources).toEqual(departed.resources);
    expect(gameReducer(empty, { type: "START_HUNT" }).screen).toBe("hunt");
  });

  it("gives existing low-favor saves a warning turn and clears it with food or an equipped sash", () => {
    const original = restoreGameState({ v: 3, roster: [{ ...worker("mon-1", 12), favor: 20 }],
      resources: { food: 1, items: { focus_sash: 1, soothe_bell: 1 } } }, null);
    const turn = { type: "NEXT_TURN" as const };
    const warned = gameReducer(original, turn);
    expect(warned.roster[0]).toMatchObject({ favor: 20, departurePending: true });

    const fed = gameReducer(warned, { type: "USE_GROWTH_ITEM", memberId: "mon-1", item: "food" });
    expect(fed.roster[0].departurePending).toBeUndefined();
    expect(gameReducer(fed, turn).roster[0].favor).toBe(33);

    const equipped = gameReducer(warned, { type: "EQUIP_HELD_ITEM", memberId: "mon-1", item: "focus_sash" });
    const protectedTurn = gameReducer(gameReducer(equipped, turn), turn);
    expect(protectedTurn.roster[0]).toMatchObject({ favor: 20, heldItem: "focus_sash" });
    expect(protectedTurn.roster[0].departurePending).toBeUndefined();
    expect(protectedTurn.resources.items.focus_sash).toBe(0);
    expect(protectedTurn.lastLog.some(line => line.includes("기합의띠로 이탈 방지"))).toBe(true);

    const swapped = gameReducer(protectedTurn, { type: "EQUIP_HELD_ITEM", memberId: "mon-1", item: "soothe_bell" });
    expect(swapped.resources.items.focus_sash).toBe(1);
    expect(gameReducer(swapped, turn).roster[0]).toMatchObject({ departurePending: true });
  });

  it("spends from the latest stock and applies growth once when the last item is used", () => {
    const base = createInitialState();
    const state: GameState = { ...base, screen: "base", roster: [worker("mon-1", 12)],
      resources: { ...base.resources, candy: 1, food: 1, healItem: 1, tm: 1 } };
    const candy = { type: "USE_GROWTH_ITEM" as const, item: "candy" as const, memberId: "mon-1" };
    const grown = gameReducer(state, candy);
    expect(grown).toMatchObject({ energy: 4, resources: { candy: 0 }, roster: [{ level: 2, exp: 0, favCeil: 93 }] });
    expect(gameReducer(grown, candy)).toBe(grown);
    const fed = gameReducer(grown, { ...candy, item: "food" });
    expect(fed).toMatchObject({ energy: 3, resources: { food: 0 }, roster: [{ favor: 93 }] });
    expect(gameReducer(fed, { ...candy, item: "healItem" })).toBe(fed);
    const trained = gameReducer(fed, { ...candy, item: "tm" });
    expect(trained).toMatchObject({ energy: 2, resources: { tm: 0 }, roster: [{ aptitude: 55 }] });
  });

  it("charges one kit and one tool craft when stock lasts for one, and swaps equipment without duplication", () => {
    const base = createInitialState();
    const state: GameState = { ...base, screen: "base", energy: 2, roster: [{ ...worker("mon-1", 12), heldItem: "lucky_egg" }],
      resources: { ...base.resources, gold: 5, tool: 3 } };
    const charge = { type: "BUY_ENERGY_CHARGE" as const };
    const charged = gameReducer(state, charge);
    expect(charged).toMatchObject({ energy: 4, resources: { gold: 0 } });
    expect(gameReducer(charged, charge)).toBe(charged);
    const craft = { type: "CRAFT_HELD_ITEM" as const, item: "choice_band" as const };
    const crafted = gameReducer(charged, craft);
    expect(crafted).toMatchObject({ energy: 4, resources: { tool: 0, items: { choice_band: 1 } } });
    expect(gameReducer(crafted, craft)).toBe(crafted);
    const equip = { type: "EQUIP_HELD_ITEM" as const, memberId: "mon-1", item: "choice_band" as const };
    const equipped = gameReducer(crafted, equip);
    expect(equipped).toMatchObject({ resources: { items: { choice_band: 0, lucky_egg: 1 } }, roster: [{ heldItem: "choice_band" }] });
    expect(gameReducer(equipped, equip)).toBe(equipped);
  });

  it("restores paused v1 construction and spends neither its remaining time nor energy on cancel", () => {
    const restored = restoreGameState({ v: 1, roster: [worker("mon-1", 12)], underConstruction: { dojo: 2 } }, null);
    expect(restored.buildings).toEqual([{ ...facility("building-1", "dojo", 0, "constructing"), remainingTurns: 2 }]);
    const later = gameReducer(restored, { type: "NEXT_TURN" });
    expect(later.buildings[0].remainingTurns).toBe(2);
    const canceled = gameReducer(later, { type: "CANCEL_BUILDING", buildingId: "building-1" });
    expect(canceled.buildings).toEqual([]);
    expect(canceled.energy).toBe(later.energy);
  });

  it("restores one worker per identity and one building per plot without changing valid legacy stock", () => {
    const seedWorker = { ...worker("mon-1", 12), buildingId: "building-1", job: "seed" };
    const unnamed = { ...worker("mon-2", 1), id: undefined };
    const restored = restoreGameState({ v: 3, roster: [unnamed, seedWorker, seedWorker],
      buildings: [facility("building-1", "farm", 0), facility("building-2", "farm", 0)],
      resources: { seed: 4, fruit: -3, candy: 0.5, items: { lucky_egg: 2, choice_band: "1" } } }, null);
    expect(restored.roster.map(mon => mon.id)).toEqual(["mon-2", "mon-1"]);
    expect(restored.buildings.map(building => building.id)).toEqual(["building-1"]);
    expect(restored.resources).toMatchObject({ seed: 4, fruit: 0, candy: 0, items: { lucky_egg: 2 } });
    expect(restored.resources.items).not.toHaveProperty("choice_band");
    expect(forecastProduction(restored).resources.seed).toBe(7);
    expect(gameReducer(restored, { type: "ADD_MEMBER", member: seedWorker })).toBe(restored);
  });

  it.each(["farm", "restaurant", "dojo", "workshop", "clinic"])("starts %s in the first plot with a Normal-type builder", type => {
    const state = { ...createInitialState(), roster: [worker("mon-1", 1)] };
    const begun = gameReducer(state, { type: "START_BUILDING", building: facility("a", type, 0), memberIds: ["mon-1"] });
    expect(begun.buildings[0]).toMatchObject({ type, status: "constructing", remainingTurns: 3 });
  });

  it("keeps energy and assignments intact when a construction input is invalid or repeated", () => {
    const state = { ...createInitialState(), roster: [worker("mon-1", 1), worker("mon-2", 1)] };
    const start = { type: "START_BUILDING" as const, building: facility("building-1", "farm", 0), memberIds: ["mon-1"] };
    expect(gameReducer(state, { ...start, building: { ...start.building, type: "missing" } })).toBe(state);
    expect(gameReducer(state, { ...start, memberIds: ["mon-1", "unknown"] })).toBe(state);
    const started = gameReducer(state, start);
    expect(gameReducer(started, { ...start, memberIds: ["mon-2"], building: { ...start.building, id: "building-2" } })).toBe(started);
    expect(gameReducer(started, { type: "ADD_BUILDERS", buildingId: "building-1", memberIds: ["mon-1", "mon-2"] })).toBe(started);
  });

  it("allows dual types, rejects unrelated types, and charges only for an external hire or transfer", () => {
    const farm = facility("a", "farm", 0);
    const otherFarm = facility("b", "farm", 1);
    const building = facility("c", "farm", 2, "constructing");
    const state = { ...createInitialState(), screen: "base" as const, plotCap: 3, buildings: [farm, otherFarm, building],
      roster: [worker("mon-1", 12, 11), worker("mon-2", 1), { ...worker("mon-3", 12), buildingId: "c" }], entryOrder: ["mon-1"] };
    const assign = (memberId: string, buildingId: string, jobId: "seed" | "fruit" = "seed") =>
      ({ type: "ASSIGN_JOB" as const, memberId, buildingId, jobId });
    expect(gameReducer(state, assign("mon-2", "a"))).toBe(state);
    expect(gameReducer(state, assign("mon-3", "a"))).toBe(state);
    expect(gameReducer(state, assign("mon-1", "c"))).toBe(state);
    const exhausted = { ...state, energy: 0 };
    expect(gameReducer(exhausted, assign("mon-1", "a"))).toBe(exhausted);
    const hired = gameReducer(state, assign("mon-1", "a"));
    expect(hired.energy).toBe(4);
    const changed = gameReducer(hired, assign("mon-1", "a", "fruit"));
    expect(changed.energy).toBe(4);
    expect(changed.entryOrder).toEqual(["mon-1"]);
    const moved = gameReducer(changed, assign("mon-1", "b", "fruit"));
    expect(moved.energy).toBe(3);
    expect(moved.roster[0]).toMatchObject({ buildingId: "b", jobId: "fruit" });
    const released = gameReducer(moved, { type: "RELEASE_WORKER", memberId: "mon-1", buildingId: "b" });
    expect(released.energy).toBe(3);
    expect(released.roster[0]).toMatchObject({ buildingId: null, jobId: null });
  });

  it("opens exactly one plot after a restored ground assignment and releases its worker", () => {
    const state = { ...createInitialState(), screen: "base" as const, buildings: [facility("a", "clinic", 0)],
      roster: [worker("mon-1", 1), { ...worker("mon-2", 5), buildingId: "a" }] };
    const start = { type: "START_CLEARING" as const, memberId: "mon-2", plotIndex: 1 };
    expect(gameReducer(state, { ...start, memberId: "mon-1" })).toBe(state);
    expect(gameReducer(state, { ...start, plotIndex: 2 })).toBe(state);
    const full = { ...state, plotCap: 10 };
    expect(gameReducer(full, { ...start, plotIndex: 10 })).toBe(full);
    const clearing = gameReducer(state, start);
    expect(clearing).toMatchObject({ plotCap: 1, energy: 4, clearing: { plotIndex: 1, memberId: "mon-2" } });
    expect(gameReducer(clearing, start)).toBe(clearing);
    expect(gameReducer(clearing, { type: "START_BUILDING", building: facility("b", "farm", 0, "constructing"), memberIds: ["mon-2"] })).toBe(clearing);
    const restored = restoreGameState(JSON.parse(JSON.stringify(clearing)), null);
    const complete = gameReducer(restored, { type: "NEXT_TURN" });
    expect(complete).toMatchObject({ plotCap: 2, clearing: null });
    expect(complete.roster[1]).toMatchObject({ buildingId: null, jobId: null });
    expect(gameReducer(complete, { type: "NEXT_TURN" }).plotCap).toBe(2);
  });

  it("reuses a single worker to open each successive plot and stops at ten", () => {
    let state = { ...createInitialState(), roster: [worker("mon-1", 5)] };
    for (let plotIndex = 1; plotIndex < 10; plotIndex++) {
      state = gameReducer(state, { type: "START_CLEARING", memberId: "mon-1", plotIndex });
      expect(state.clearing).toEqual({ plotIndex, memberId: "mon-1" });
      state = gameReducer(state, { type: "NEXT_TURN" });
      expect(state.plotCap).toBe(plotIndex + 1);
    }
    expect(gameReducer(state, { type: "START_CLEARING", memberId: "mon-1", plotIndex: 10 })).toBe(state);
  });

  it("migrates legacy roles only when the building and worker are eligible", () => {
    const buildings = [facility("a", "farm", 0), facility("b", "clinic", 1, "constructing")];
    const restored = restoreGameState({ v: 3, plotCap: 2, buildings, roster: [
      { ...worker("mon-1", 12), job: "seed", buildingId: "a" },
      { ...worker("mon-2", 1), job: "seed", buildingId: "a" },
      { ...worker("mon-3", 18), job: "heal", buildingId: "b" },
      { ...worker("mon-4", 5), job: "flatten", buildingId: "a" },
    ] }, null);
    expect(restored.roster.map(mon => [mon.buildingId, mon.jobId])).toEqual([
      ["a", "seed"], ["a", null], ["b", null], ["a", null],
    ]);
    expect(restored.roster.every(mon => !("job" in mon))).toBe(true);
  });

  it("guarantees an ordinary matching candidate with the requested detected type", () => {
    const normal = worker("mon-1", 1).pokemon;
    const water = worker("mon-2", 11).pokemon;
    const ground = worker("mon-3", 11, 5).pokemon;
    const rare = { ...worker("mon-4", 5).pokemon, details: { isLegendary: true } };
    const candidates = huntCandidates([normal, water, ground, rare], [{ typeRowid: 5, nameKr: "땅" }], 3, 5);
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map(item => item.pokemon.pokemonRowid)).size).toBe(3);
    expect(candidates.find(item => item.pokemon === ground)?.shownType).toBe("땅");
  });

  it("uses same-turn seeds and local tilling without consuming materials that cannot fit", () => {
    const base = createInitialState();
    const state = { ...base, plotCap: 3, storageCap: 4, buildings: [facility("a", "farm", 0), facility("b", "farm", 1), facility("c", "restaurant", 2)],
      resources: { ...base.resources, food: 4 },
      roster: [
        { ...worker("mon-1", 12), buildingId: "a", jobId: "seed" as const },
        { ...worker("mon-2", 7), buildingId: "a", jobId: "till" as const },
        { ...worker("mon-3", 11), buildingId: "a", jobId: "fruit" as const },
        { ...worker("mon-4", 11), buildingId: "b", jobId: "fruit" as const },
        { ...worker("mon-5", 10), buildingId: "c", jobId: "cook" as const },
      ] };
    const preview = forecastProduction(state);
    expect(preview.workers.get("mon-3")).toMatchObject({ potential: 3, produced: 3, consumed: 3 });
    expect(preview.workers.get("mon-4")).toMatchObject({ potential: 2, produced: 0, consumed: 0 });
    expect(preview.workers.get("mon-5")).toMatchObject({ produced: 0, consumed: 0, storageLimited: true });
    let current: GameState = state;
    for (let turn = 0; turn < 10; turn++) {
      const forecast = forecastProduction(current);
      current = gameReducer(current, { type: "NEXT_TURN" });
      expect(current.resources).toEqual(forecast.resources);
      for (const amount of Object.values(current.resources).filter(value => typeof value === "number")) {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(4);
      }
    }
    expect(current.resources).toMatchObject({ seed: 4, fruit: 4, food: 4 });
  });

  it("gives the earlier assignment the last material, applying storage and held-item bonuses", () => {
    const base = createInitialState();
    const roster = [
      { ...worker("mon-2", 13), buildingId: "a", jobId: "craft" as const, jobOrder: 2 },
      { ...worker("mon-1", 9), buildingId: "a", jobId: "mint" as const, jobOrder: 1, heldItem: "amulet_coin" },
      { ...worker("mon-3", 15), buildingId: "b", jobId: "chill" as const },
      { ...worker("mon-4", 18), buildingId: "c", jobId: "heal" as const, heldItem: "choice_band", aptitude: 100 },
    ];
    const state = { ...base, roster, plotCap: 3, storageCap: 1,
      buildings: [facility("a", "workshop", 0), facility("b", "restaurant", 1), facility("c", "clinic", 2)],
      resources: { ...base.resources, material: 1, healItem: 1 },
    };
    const preview = forecastProduction(state);
    expect(preview.storageCap).toBe(11);
    expect(preview.workers.get("mon-1")).toMatchObject({ potential: 3, produced: 1, consumed: 1 });
    expect(preview.workers.get("mon-2")).toMatchObject({ produced: 0, materialLimited: true });
    expect(preview.resources).toMatchObject({ gold: 1, material: 0, tool: 0, healItem: 3 });
    expect(gameReducer(state, { type: "NEXT_TURN" })).toMatchObject({ storageCap: 11, resources: preview.resources });
  });

  it("produces the growth and spending items with same-turn inputs from both supply chains", () => {
    const state: GameState = { ...createInitialState(), plotCap: 5,
      buildings: [facility("farm", "farm", 0), facility("restaurant", "restaurant", 1), facility("workshop", "workshop", 2),
        facility("dojo", "dojo", 3), facility("clinic", "clinic", 4)],
      roster: [
        { ...worker("mon-1", 12), buildingId: "farm", jobId: "seed" },
        { ...worker("mon-2", 11), buildingId: "farm", jobId: "fruit" },
        { ...worker("mon-3", 10), buildingId: "restaurant", jobId: "cook" },
        { ...worker("mon-4", 6), buildingId: "workshop", jobId: "mine" },
        { ...worker("mon-5", 9), buildingId: "workshop", jobId: "mint", jobOrder: 1 },
        { ...worker("mon-6", 13), buildingId: "workshop", jobId: "craft", jobOrder: 2 },
        { ...worker("mon-7", 2), buildingId: "dojo", jobId: "train" },
        { ...worker("mon-8", 14), buildingId: "dojo", jobId: "research" },
        { ...worker("mon-9", 18), buildingId: "clinic", jobId: "heal" },
      ],
    };
    const expected = { seed: 1, fruit: 0, food: 1, material: 0, gold: 2, tool: 1, tm: 1, candy: 1, healItem: 1 };
    expect(forecastProduction(state).resources).toMatchObject(expected);
    expect(gameReducer(state, { type: "NEXT_TURN" }).resources).toMatchObject(expected);
  });

  it("assigns poison workers to battle cures and limits their production to the existing storage cap", () => {
    const base = createInitialState();
    const state: GameState = {
      ...base, screen: "base", storageCap: 1, buildings: [facility("clinic", "clinic", 0)],
      roster: [worker("mon-1", 12, 4), worker("mon-2", 18)],
    };
    const assign = { type: "ASSIGN_JOB" as const, buildingId: "clinic", memberId: "mon-1", jobId: "cure" as const };
    expect(gameReducer(state, { ...assign, memberId: "mon-2" })).toBe(state);
    const staffed = gameReducer(state, assign);
    expect(staffed.roster[0]).toMatchObject({ buildingId: "clinic", jobId: "cure" });
    expect(forecastProduction(staffed).workers.get("mon-1")).toMatchObject({ produced: 1, consumed: 0 });
    const produced = gameReducer(staffed, { type: "NEXT_TURN" });
    expect(produced.resources.cureItem).toBe(1);
    expect(forecastProduction(produced).workers.get("mon-1")).toMatchObject({ produced: 0, storageLimited: true });
    expect(gameReducer(produced, { type: "NEXT_TURN" }).resources.cureItem).toBe(1);
  });
});
