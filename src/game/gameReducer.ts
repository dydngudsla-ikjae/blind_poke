import type { BuildingState, GameDataBundle, ResourceState, RosterMember } from "../domain/types";
import type { ClearingOrder, GameAction, GameState, OutpostState } from "./gameTypes";
import { advanceMemberFavor, canUseGrowthItem, ENERGY_CHARGE_COST, ENERGY_CHARGE_GAIN, GROWTH_ITEMS, GROWTH_ITEM_ENERGY_COST, HELD_ITEM_COST, isHeldItemId, RESOURCE_LABELS } from "../domain/economy";
import { BUILDING_TYPES, constructionTurns, isBuildingType, projectedConstructionTurns } from "../domain/construction";
import { GROUND_TYPE, HUNT_ENERGY_COST, MAX_PLOTS, MAX_RESEARCH_WORKERS, hasPokemonType, isJobId, jobDefinitions, researcherCount, supportsJob } from "../domain/jobs";
import { forecastProduction } from "../domain/production";
import { advanceTerritoryLoyalty, MAX_LOYALTY, suppliedTerritories } from "../domain/territorySupply";
import { canOperateSettlement, clearingSiteOf, HOME_SITE, inheritanceCandidates, makeOutpost, outpostIsOwned,
  settlementAt, settlementName } from "../domain/settlements";
import { activeIntrusion, activeObservation, activeSabotage, advanceFrontier, availableFrontierWorkers, DARK_TYPE, DRAGON_TYPE,
  FLYING_TYPE, FRONTIER_ENERGY_COST, frontierSources, GHOST_TYPE, isOnFrontierDuty, restoreFrontier, validIntelRoster } from "../domain/frontierOperations";
import { BATTLE_ENERGY_COST, canBattle, canScoutTerritory, canSearchForCounter, canTargetTerritory } from "./territoryBattle";
import { STARTING_TERRITORY_IDS, worldMapNodes } from "../domain/worldMap";
import { awardResources, DEX_REWARDS, dojoResearchChallengeRoute, endingReady, FIRST_VICTORY_REWARD, hasFirstVictory, INHERITED_RESEARCH_REWARD } from "./campaign";
import { createTerritories, restoreTerritories } from "./territories";
import { openCampaignRegions } from "./territoryFactions";
import type { ParsedMapSave } from "../services/saveSchemas";

export const ENERGY_PER_TURN = 5;

const initialResources: ResourceState = {
  seed:0, fruit:0, food:0, material:0, gold:0, tool:0, tm:0, candy:0,
  healItem:0, cureItem:0, items:{},
};

export function createInitialState(
  trainerId: string | null = null, opponentTrainerIds: string[] = [], random = Math.random,
  factionDefenderIds: readonly string[] = opponentTrainerIds,
): GameState {
  return {
    screen:"draft", roster:[], buildings:[], resources:{...initialResources}, plotCap:1,
    storageCap:50, entryCap:6, entryOrder:[], turnCount:0, energy:ENERGY_PER_TURN, regionOpenedTurns:{ 1: 0 },
    nextMemberId:1, nextBuildingId:1, draftRound:0, selectedPokemonId:null, selectedTypeName:null, selectedScan:null,
    caughtSpeciesIds:[],claimedDexRewards:[],legacyOutpostResearch:false,endingSeen:false,
    frontier: { intel: {}, intrusion: null, quietTurns: 0 },
    outposts: {}, siteViewId: null,
    introPending:true, huntTypeId:null, counterHunt:null, clearing:null, territories:createTerritories(trainerId,opponentTrainerIds,random), battle:null, mapFocusId:null, message:"",lastLog:[],trainerId,factionDefenderIds,
  };
}

type LegacyMember = RosterMember & { job?: string | null; building?: string | null };

function migrateRoster(raw: unknown[], nextStart=1): { roster:LegacyMember[]; nextMemberId:number } {
  const members = raw as LegacyMember[];
  let next = nextStart;
  for (const member of members) {
    const numeric = Number(member.id && /^mon-(\d+)$/.exec(member.id)?.[1]);
    if (Number.isSafeInteger(numeric)) next = Math.max(next, numeric + 1);
  }
  const ids = new Set<string>();
  const roster: LegacyMember[] = [];
  for (const member of members) {
    const id = member.id?.trim() ? member.id : `mon-${next++}`;
    if (ids.has(id)) continue;
    ids.add(id);
    roster.push({ ...member, id });
  }
  return {roster,nextMemberId:next};
}

function migrateBuildings(raw: { buildings?: BuildingState[]; underConstruction?: Record<string, number> }, roster: LegacyMember[],
  outposts: Record<string, OutpostState>): BuildingState[] {
  if (Array.isArray(raw.buildings)) {
    const ids = new Set<string>();
    const plots = new Set<string>();
    return raw.buildings.filter(building => {
      const siteId = building.siteId ?? HOME_SITE;
      const key = `${siteId}:${building.plotIndex}`;
      if (!isBuildingType(building.type) || ids.has(building.id) || plots.has(key) ||
        (siteId !== HOME_SITE && !(building.plotIndex < (outposts[siteId]?.plotCap ?? 0)))) return false;
      ids.add(building.id);
      plots.add(key);
      return true;
    });
  }
  const byType=new Map<string,BuildingState>();
  function ensureBuilding(type: string) {
    let building = byType.get(type);
    if (!building) {
      const remainingTurns = Math.max(0, Math.floor(raw.underConstruction?.[type] ?? 0));
      building = { id: `building-${byType.size + 1}`, type, plotIndex: byType.size,
        status: remainingTurns > 0 ? "constructing" : "active", remainingTurns };
      byType.set(type, building);
    }
    return building;
  }
  for (const member of roster) {
    const job = member.job;
    const type = member.building ?? (job && isJobId(job) ? jobDefinitions[job].building :
      job === "flatten" ? "farm" : job === "cure" ? "clinic" : undefined);
    if (type && isBuildingType(type)) member.buildingId = ensureBuilding(type).id;
  }
  for (const type of BUILDING_TYPES) {
    if ((raw.underConstruction?.[type] ?? 0) >= 1) ensureBuilding(type);
  }
  return [...byType.values()];
}

export function restoreGameState(
  raw: any, mapRaw: ParsedMapSave | null, fallbackTrainerId: string | null = null, opponentTrainerIds?: string[],
  factionDefenderIds: readonly string[] = opponentTrainerIds ?? [],
): GameState {
  if (!Array.isArray(raw?.roster) || (!raw.roster.length && raw.introPending !== false)) {
    return createInitialState(fallbackTrainerId, opponentTrainerIds, Math.random, factionDefenderIds);
  }
  const trainerId: string | null = raw.trainerId ?? fallbackTrainerId;
  const base=createInitialState(trainerId,[],Math.random,factionDefenderIds);
  const migrated=migrateRoster(raw.roster,raw.nextMemberId||1);
  const territories = restoreTerritories(mapRaw,trainerId,opponentTrainerIds,Math.random,factionDefenderIds);
  const outposts: Record<string, OutpostState> = {};
  for (const node of worldMapNodes) {
    if (node.region === 1) continue;
    const saved: OutpostState | undefined = raw.outposts?.[node.id];
    if (saved) outposts[node.id] = { ...saved, clearing: null };
    else if (outpostIsOwned({ territories }, node.id)) outposts[node.id] = makeOutpost();
  }
  const buildings=migrateBuildings(raw,migrated.roster,outposts);
  const validIds=new Set(migrated.roster.map(member=>member.id));
  const legacyOrder=migrated.roster.filter(member=>member.inEntry).map(member=>member.id);
  const entryOrder=(Array.isArray(raw.entryOrder)?raw.entryOrder:legacyOrder).filter((id:string,index:number,list:string[])=>validIds.has(id)&&list.indexOf(id)===index).slice(0,6);
  const homeBuildings = buildings.filter(building => (building.siteId ?? HOME_SITE) === HOME_SITE);
  const plotCap = Math.min(MAX_PLOTS, Math.max(1, raw.plotCap ?? 1, ...homeBuildings.map(building => building.plotIndex + 1)));
  const roster = migrated.roster.map(({ job, building: _legacyBuilding, inEntry: _legacyEntry, ...member }, index) => {
    const facility = buildings.find(building => building.id === member.buildingId &&
      (!building.siteId || building.siteId === HOME_SITE || outpostIsOwned({ territories }, building.siteId)));
    const savedJob = member.jobId === undefined ? job : member.jobId;
    const jobId = facility && typeof savedJob === "string" && isJobId(savedJob) &&
      supportsJob(facility, member.pokemon, savedJob) ? savedJob : null;
    return { ...member, buildingId: facility?.id ?? null, jobId, jobOrder: jobId ? member.jobOrder ?? index + 1 : undefined };
  });
  const clearingWorkers = new Set<string>();
  function restoreClearing(order: ClearingOrder | null | undefined, cap: number) {
    const worker = order && roster.find(member => member.id === order.memberId);
    if (!order || !worker || worker.buildingId || clearingWorkers.has(worker.id) || !hasPokemonType(worker.pokemon, GROUND_TYPE) ||
      order.plotIndex !== cap || cap >= MAX_PLOTS) return null;
    clearingWorkers.add(worker.id);
    return { plotIndex: cap, memberId: worker.id };
  }
  const clearing = restoreClearing(raw.clearing, plotCap);
  for (const [id, outpost] of Object.entries(outposts)) {
    if (outpostIsOwned({ territories }, id)) outpost.clearing = restoreClearing(raw.outposts?.[id]?.clearing, outpost.plotCap);
  }
  const resources = { ...base.resources, items: {} };
  const storageCap = raw.storageCap ?? base.storageCap;
  for (const key of Object.keys(RESOURCE_LABELS) as (keyof typeof RESOURCE_LABELS)[]) {
    const amount = raw.resources?.[key];
    if (typeof amount === "number" && Number.isFinite(amount)) resources[key] = Math.max(0, Math.floor(amount));
  }
  resources.items = Object.fromEntries(Object.entries(raw.resources?.items ?? {}).filter(([id, amount]) =>
    isHeldItemId(id) && typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0));
  const highestBuildingId = Math.max(0, ...buildings.map(building => Number(/^building-(\d+)$/.exec(building.id)?.[1] ?? 0)));
  const introPending = raw.introPending === true;
  const draftRound = introPending ? Math.min(roster.length, 3) : 3;
  const screen = introPending ? (draftRound === 3 ? "trainerReveal" : "draft") : "base";
  const caughtSpeciesIds = [...new Set<number>([...(raw.caughtSpeciesIds ?? []), ...roster.map(member => member.pokemon.pokemonRowid)])];
  const claimedDexRewards = DEX_REWARDS.filter(reward => raw.claimedDexRewards?.includes(reward.threshold)).map(reward => reward.threshold);
  const turnCount = raw.turnCount ?? base.turnCount;
  const regionOpenedTurns = openedRegionTurns(territories, raw.regionOpenedTurns, turnCount);
  const restored = {...base,roster,nextMemberId:migrated.nextMemberId,turnCount,regionOpenedTurns,energy:raw.energy??base.energy,
    buildings,plotCap,storageCap,clearing,nextBuildingId:Math.max(raw.nextBuildingId||1,highestBuildingId+1),resources,
    territories,outposts,caughtSpeciesIds,claimedDexRewards,entryOrder,
    inheritedResearchCompleted: raw.inheritedResearchCompleted === true ? true : undefined,
    inheritedResearchRewardClaimed: raw.inheritedResearchCompleted === true && raw.inheritedResearchRewardClaimed === true ? true : undefined,
    legacyOutpostResearch: typeof raw.legacyOutpostResearch === "boolean"
      ? raw.legacyOutpostResearch : raw.v === 4 && Object.keys(outposts).length > 0,
    screen,draftRound,introPending,endingSeen:raw.endingSeen===true,lastLog:raw.lastLog??[]} satisfies GameState;
  return { ...restored, frontier: restoreFrontier(restored, raw.frontier) };
}

function openedRegionTurns(territories: GameState["territories"], saved: GameState["regionOpenedTurns"] = {}, turn: number) {
  const result: GameState["regionOpenedTurns"] = {};
  for (const { id, region } of worldMapNodes) {
    if (!territories[id]?.active || result[region] !== undefined) continue;
    const previous = saved?.[region];
    result[region] = previous !== undefined && Number.isSafeInteger(previous) && previous >= 0 && previous <= turn ? previous : turn;
  }
  return result;
}

export function isFreeWorker(state: GameState, member: RosterMember) {
  return !member.buildingId && !member.jobId && !clearingSiteOf(state, member.id) && !isOnFrontierDuty(state.frontier, member.id);
}

export function canReassignWorker(state: GameState, member: RosterMember) {
  const current = member.buildingId && state.buildings.find(building => building.id === member.buildingId);
  return !clearingSiteOf(state, member.id) && !isOnFrontierDuty(state.frontier, member.id) &&
    (!current || (current.status !== "constructing" && canOperateSettlement(state, current.siteId)));
}

function setClearing(state: GameState, siteId: string, order: ClearingOrder | null): GameState {
  return siteId === HOME_SITE ? { ...state, clearing: order }
    : { ...state, outposts: { ...state.outposts, [siteId]: { ...state.outposts[siteId], clearing: order } } };
}

function freeBuilders(state: GameState, ids: string[]) {
  const unique = new Set(ids);
  return state.roster.filter(member => unique.has(member.id) && isFreeWorker(state, member));
}

function nextTurn(state: GameState, data?: GameDataBundle): GameState {
  const production = forecastProduction(state);
  const { territories, lost } = advanceTerritoryLoyalty(state.territories);
  const supplied = suppliedTerritories(state.territories);
  const lostSites = new Set(Object.keys(state.outposts).filter(id => outpostIsOwned(state, id) && !outpostIsOwned({ territories }, id)));
  const lastLog: string[] = [];
  let inheritedResearchCompleted = state.inheritedResearchCompleted;
  const challengeDojos = new Set(inheritedResearchCompleted ? [] : dojoResearchChallengeRoute(state).dojos.map(dojo => dojo.id));
  if (production.income) lastLog.push("확보 지역 수입 · 자금 +" + production.income);
  for (const name of lost) lastLog.push(`${name} 상실 · 충성도 0 · 미점령 전환`);
  const frontierLogStart = lastLog.length;
  if (production.storageCap > state.storageCap) lastLog.push("냉장 · 저장 상한 +" + (production.storageCap - state.storageCap));
  for (const member of state.roster) {
    const reading = production.workers.get(member.id);
    const job = member.jobId && jobDefinitions[member.jobId];
    const recipe = job && job.recipe;
    const building = state.buildings.find(item => item.id === member.buildingId);
    if (!reading || !job || !recipe || !building) continue;
    if (member.jobId === "research" && reading.produced > 0 && challengeDojos.has(building.id)) {
      inheritedResearchCompleted = true;
    }
    const change = [RESOURCE_LABELS[recipe.output] + " +" + reading.produced];
    if (recipe.input && reading.consumed) change.push(RESOURCE_LABELS[recipe.input.key] + " −" + reading.consumed);
    if (reading.materialLimited) change.push("재료 부족");
    if (reading.storageLimited) change.push("저장 공간 부족");
    const plot = `${building.plotIndex + 1}번 부지`;
    lastLog.push([building.siteId && building.siteId !== HOME_SITE ? `${settlementName(building.siteId)} ${plot}` : plot,
      job.name, member.pokemon.nameKr, ...change].join(" · "));
  }
  const returning = new Set<string>();
  const buildings = state.buildings.map(building => {
    const siteId = building.siteId ?? HOME_SITE;
    if (lostSites.has(siteId)) returning.add(building.id);
    if (building.status !== "constructing") return building;
    if (siteId !== HOME_SITE && !supplied.has(siteId)) return building;
    if (!state.roster.some(member => member.buildingId === building.id)) return building;
    const remainingTurns = Math.max(0, building.remainingTurns - 1);
    if (remainingTurns === 0) lastLog.push(`${siteId === HOME_SITE ? "" : settlementName(siteId) + " "}${building.plotIndex + 1}번 부지 시설 완공`);
    return { ...building, remainingTurns, status: remainingTurns === 0 ? "active" as const : "constructing" as const };
  });
  if (state.clearing) lastLog.push((state.clearing.plotIndex + 1) + "번 부지 개척 완료");
  const roster: RosterMember[] = [];
  const departedIds = new Set<string>();
  const items = { ...production.resources.items };
  for (const previous of state.roster) {
    const carry = production.carry.get(previous.id);
    const { member, departed, protectedBySash } = advanceMemberFavor(carry ? { ...previous, productionCarry: carry } : previous);
    const name = member.pokemon.nameKr;
    if (departed) {
      departedIds.add(member.id);
      const item = member.heldItem;
      if (item && isHeldItemId(item)) items[item] = (items[item] ?? 0) + 1;
      lastLog.push(`${name} · 우호도 하한 · 이탈`);
      continue;
    }
    roster.push(member.buildingId && returning.has(member.buildingId) ?
      { ...member, buildingId: null, jobId: null, jobOrder: undefined } : member);
    if (protectedBySash) lastLog.push(`${name} · 기합의띠로 이탈 방지`);
    if (member.departurePending) lastLog.push(`${name} · 우호도 하한 · 다음 턴 이탈 예정`);
  }
  const outposts = { ...state.outposts };
  for (const [id, outpost] of Object.entries(outposts)) {
    if (!outpost.clearing) continue;
    if (lostSites.has(id)) outposts[id] = { ...outpost, clearing: null };
    else if (supplied.has(id)) {
      lastLog.push(`${settlementName(id)} ${outpost.clearing.plotIndex + 1}번 부지 개척 완료`);
      outposts[id] = { ...outpost, plotCap: Math.min(MAX_PLOTS, outpost.plotCap + 1), clearing: null };
    } else if (departedIds.has(outpost.clearing.memberId)) outposts[id] = { ...outpost, clearing: null };
  }
  const entryOrder = state.entryOrder.filter(id => !departedIds.has(id));
  const { frontier, log } = advanceFrontier({ ...state, roster, entryOrder }, territories, data);
  lastLog.splice(frontierLogStart, 0, ...log);
  if (!lastLog.length) lastLog.push("턴이 진행되고 행동력이 회복되었습니다.");
  return { ...state, buildings, lastLog, territories, frontier, roster, outposts, inheritedResearchCompleted,
    siteViewId: state.siteViewId && outpostIsOwned({ territories }, state.siteViewId) ? state.siteViewId : null,
    turnCount: state.turnCount + 1, energy: ENERGY_PER_TURN,
    resources: { ...production.resources, items }, storageCap: production.storageCap,
    plotCap: state.clearing ? Math.min(MAX_PLOTS, state.plotCap + 1) : state.plotCap, clearing: null,
    entryOrder,
  };
}

export function gameReducer(state:GameState, action:GameAction, data?:GameDataBundle):GameState {
  switch(action.type){
    case "PATCH": return {...state,...action.patch};
    case "ADD_MEMBER": {
      if (state.roster.some(member => member.id === action.member.id)) return state;
      const id = action.member.pokemon.pokemonRowid;
      const caughtSpeciesIds = state.caughtSpeciesIds.includes(id) ? state.caughtSpeciesIds : [...state.caughtSpeciesIds, id];
      return {...state,roster:[...state.roster,action.member],nextMemberId:state.nextMemberId+1,caughtSpeciesIds};
    }
    case "SET_ENTRY_ORDER": {const validIds=new Set(state.roster.map(member=>member.id));const entryOrder=action.memberIds.filter((id,index,list)=>validIds.has(id)&&list.indexOf(id)===index).slice(0,6);return {...state,entryOrder,message:action.memberIds.length>6?"전투 엔트리는 최대 6마리입니다.":""};}
    case "START_BUILDING": {
      const { building } = action;
      const siteId = building.siteId ?? HOME_SITE;
      const settlement = settlementAt(state, siteId);
      const workers = freeBuilders(state, action.memberIds);
      if (!settlement || !canOperateSettlement(state, siteId) || !isBuildingType(building.type) || !building.id.trim() ||
        state.energy < 1 || !workers.length || workers.length !== new Set(action.memberIds).size ||
        !Number.isInteger(building.plotIndex) || building.plotIndex < 0 || building.plotIndex >= settlement.plotCap ||
        (building.plotIndex === 0 && settlement.inheritancePending) || state.buildings.some(existing => existing.id === building.id ||
          ((existing.siteId ?? HOME_SITE) === siteId && existing.plotIndex === building.plotIndex))) return state;
      const { inherited: _inherited, ...construction } = building;
      return {...state,energy:state.energy-1,
        buildings:[...state.buildings,{...construction,status:"constructing",remainingTurns:constructionTurns(workers.length)}],
        nextBuildingId:state.nextBuildingId+1,
        roster:state.roster.map(member=>workers.includes(member)?{...member,buildingId:building.id,jobId:null}:member)};
    }
    case "ADD_BUILDERS": {
      const building = state.buildings.find(item => item.id === action.buildingId);
      const workers = freeBuilders(state, action.memberIds);
      if (building?.status !== "constructing" || !canOperateSettlement(state, building.siteId) || state.energy < 1 || !workers.length ||
        workers.length !== new Set(action.memberIds).size) return state;
      const count = state.roster.filter(member => member.buildingId === building.id).length + workers.length;
      const remainingTurns = projectedConstructionTurns(building.remainingTurns, count);
      return {...state,energy:state.energy-1,
        buildings:state.buildings.map(item=>item===building?{...item,remainingTurns}:item),
        roster:state.roster.map(member=>workers.includes(member)?{...member,buildingId:building.id,jobId:null}:member)};
    }
    case "REMOVE_BUILDER":
      if (!state.buildings.some(building => building.id === action.buildingId && building.status === "constructing")) return state;
      return {...state,roster:state.roster.map(m=>m.buildingId===action.buildingId&&m.id===action.memberId?{...m,buildingId:null}:m)};
    case "CANCEL_BUILDING":
      if (!state.buildings.some(building => building.id === action.buildingId && building.status === "constructing" &&
        canOperateSettlement(state, building.siteId))) return state;
      return {...state,buildings:state.buildings.filter(b=>b.id!==action.buildingId),
        roster:state.roster.map(m=>m.buildingId===action.buildingId?{...m,buildingId:null,jobId:null}:m)};
    case "ASSIGN_JOB": {
      const member = state.roster.find(item => item.id === action.memberId);
      const building = state.buildings.find(item => item.id === action.buildingId);
      if (!member || !building || !canOperateSettlement(state, building.siteId) || !isJobId(action.jobId) || !supportsJob(building, member.pokemon, action.jobId) ||
        !canReassignWorker(state, member)) return state;
      const cost = member.buildingId === building.id ? 0 : 1;
      if (state.energy < cost || (cost === 0 && member.jobId === action.jobId)) return state;
      if (action.jobId === "research" && researcherCount(state.roster, building.id) >= MAX_RESEARCH_WORKERS) return state;
      const jobOrder = 1 + Math.max(0, ...state.roster.map(item => item.jobOrder ?? 0));
      return {...state,energy:state.energy-cost,roster:state.roster.map(item=>item===member?
        {...item,buildingId:building.id,jobId:action.jobId,jobOrder}:item)};
    }
    case "RELEASE_WORKER":
      if (!state.buildings.some(building => building.id === action.buildingId && building.status === "active")) return state;
      return {...state,roster:state.roster.map(member=>member.id===action.memberId&&member.buildingId===action.buildingId?
        {...member,buildingId:null,jobId:null,jobOrder:undefined}:member)};
    case "START_CLEARING": {
      const siteId = action.siteId ?? HOME_SITE;
      const settlement = settlementAt(state, siteId);
      const member = state.roster.find(item => item.id === action.memberId);
      if (!settlement || !canOperateSettlement(state, siteId) || settlement.clearing || settlement.plotCap >= MAX_PLOTS ||
        action.plotIndex !== settlement.plotCap || state.energy < 1 ||
        !member || !hasPokemonType(member.pokemon, GROUND_TYPE) || !canReassignWorker(state, member)) return state;
      return {...setClearing(state, siteId, { plotIndex: action.plotIndex, memberId: member.id }), energy:state.energy-1,
        roster:state.roster.map(item=>item===member?{...item,buildingId:null,jobId:null,jobOrder:undefined}:item)};
    }
    case "RECALL_CLEARER":
      if (!outpostIsOwned(state, action.siteId) || state.outposts[action.siteId]?.clearing?.memberId !== action.memberId) return state;
      return setClearing(state, action.siteId, null);
    case "OPEN_OUTPOST":
      if (state.screen !== "map" || !outpostIsOwned(state, action.siteId) || !state.outposts[action.siteId]) return state;
      return { ...state, screen: "base", siteViewId: action.siteId, mapFocusId: action.siteId };
    case "RESOLVE_INHERITANCE": {
      const { siteId, buildingType } = action;
      const outpost = state.outposts[siteId];
      if (!outpost?.inheritancePending || !outpostIsOwned(state, siteId)) return state;
      if (buildingType !== null && (!inheritanceCandidates(siteId).includes(buildingType) ||
        state.buildings.some(building => building.siteId === siteId && building.plotIndex === 0))) return state;
      const outposts = { ...state.outposts, [siteId]: { ...outpost, inheritancePending: false } };
      if (buildingType === null) return { ...state, outposts };
      const building: BuildingState = { id: `building-${state.nextBuildingId}`, siteId, type: buildingType, inherited: true,
        plotIndex: 0, status: "active", remainingTurns: 0 };
      return { ...state, outposts, buildings: [...state.buildings, building], nextBuildingId: state.nextBuildingId + 1 };
    }
    case "START_HUNT":
      if (state.screen !== "base" || state.energy < HUNT_ENERGY_COST) return state;
      return {...state, screen:"hunt",energy:state.energy-HUNT_ENERGY_COST,huntTypeId:action.typeId??null,counterHunt:null};
    case "START_COUNTER_HUNT": {
      const { territoryId, typeIds } = action;
      if (!canSearchForCounter(state, territoryId) || state.energy < HUNT_ENERGY_COST || !typeIds.length || typeIds.length > 2 ||
        new Set(typeIds).size !== typeIds.length || typeIds.some(id => !Number.isInteger(id) || id < 1)) return state;
      return { ...state, screen:"hunt", energy:state.energy-HUNT_ENERGY_COST, huntTypeId:null, counterHunt:{ territoryId, typeIds } };
    }
    case "END_HUNT":
      if (state.screen !== "hunt" && state.screen !== "identify") return state;
      return { ...state, screen:state.counterHunt ? "map" : "base", mapFocusId:state.counterHunt?.territoryId ?? state.mapFocusId,
        selectedPokemonId:null, selectedTypeName:null, selectedScan:null, huntTypeId:null, counterHunt:null };
    case "USE_GROWTH_ITEM": {
      const { item, memberId } = action;
      const member = state.roster.find(entry => entry.id === memberId);
      if (!member || !canUseGrowthItem(state, member, item)) return state;
      return { ...state, energy: state.energy - GROWTH_ITEM_ENERGY_COST,
        resources: { ...state.resources, [item]: state.resources[item] - 1 },
        roster: state.roster.map(entry => entry === member ? GROWTH_ITEMS[item].effect(entry) : entry) };
    }
    case "CRAFT_HELD_ITEM": {
      const { item } = action;
      if (!isHeldItemId(item) || state.resources.tool < HELD_ITEM_COST) return state;
      const items = { ...state.resources.items, [item]: (state.resources.items[item] ?? 0) + 1 };
      return { ...state, resources: { ...state.resources, tool: state.resources.tool - HELD_ITEM_COST, items } };
    }
    case "EQUIP_HELD_ITEM": {
      const { item, memberId } = action;
      const member = state.roster.find(entry => entry.id === memberId);
      if (!member || !isHeldItemId(item) || member.heldItem === item || (state.resources.items[item] ?? 0) < 1) return state;
      const items = { ...state.resources.items, [item]: state.resources.items[item] - 1 };
      const previous = member.heldItem;
      if (previous && isHeldItemId(previous)) items[previous] = (items[previous] ?? 0) + 1;
      return { ...state, resources: { ...state.resources, items },
        roster: state.roster.map(entry => entry === member ? {
          ...entry, heldItem: item, departurePending: item === "focus_sash" ? undefined : entry.departurePending,
        } : entry) };
    }
    case "BUY_ENERGY_CHARGE":
      if (state.energy >= ENERGY_PER_TURN || state.resources.gold < ENERGY_CHARGE_COST) return state;
      return { ...state, energy: Math.min(ENERGY_PER_TURN, state.energy + ENERGY_CHARGE_GAIN),
        resources: { ...state.resources, gold: state.resources.gold - ENERGY_CHARGE_COST } };
    case "NEXT_TURN": return nextTurn(state, data);
    case "CLAIM_DEX_REWARD": {
      const reward = DEX_REWARDS.find(entry => entry.threshold === action.threshold);
      if (!reward || state.caughtSpeciesIds.length < reward.threshold || state.claimedDexRewards.includes(reward.threshold)) return state;
      const resources = awardResources(state, reward.resources, true);
      return resources ? { ...state, resources, claimedDexRewards: [...state.claimedDexRewards, reward.threshold] } : state;
    }
    case "CLAIM_INHERITED_RESEARCH_REWARD": {
      if (!state.inheritedResearchCompleted || state.inheritedResearchRewardClaimed) return state;
      const resources = awardResources(state, INHERITED_RESEARCH_REWARD, true);
      return resources ? { ...state, resources, inheritedResearchRewardClaimed: true } : state;
    }
    case "CONTINUE_AFTER_ENDING": return endingReady(state) ? { ...state, endingSeen: true } : state;
    case "SCOUT_TERRITORY": {
      const id = action.territoryId;
      if (!canScoutTerritory(state, id)) return state;
      return { ...state, territories: { ...state.territories, [id]: { ...state.territories[id], scouted: true } } };
    }
    case "SEND_GHOST_RECON": {
      const { sourceId, targetId, memberId, pokemonIds } = action;
      const target = state.territories[targetId];
      if (state.screen !== "map" || state.energy < FRONTIER_ENERGY_COST || !target?.scouted || state.frontier.intel[targetId] ||
        !frontierSources(state.territories, targetId).includes(sourceId) || !validIntelRoster(pokemonIds) ||
        !availableFrontierWorkers(state, GHOST_TYPE).some(member => member.id === memberId)) return state;
      const order = { sourceId, trainerId: target.trainerId, memberId, pokemonIds: [...pokemonIds] };
      return { ...state, energy: state.energy - FRONTIER_ENERGY_COST,
        frontier: { ...state.frontier, intel: { ...state.frontier.intel, [targetId]: order } } };
    }
    case "SEND_DARK_SABOTAGE": {
      const { sourceId, targetId, memberId } = action;
      const order = { sourceId, targetId, memberId, trainerId: state.territories[targetId]?.trainerId ?? null };
      if (state.screen !== "map" || state.energy < FRONTIER_ENERGY_COST || state.frontier.sabotage ||
        !activeSabotage(state.territories, order) || !availableFrontierWorkers(state, DARK_TYPE).some(member => member.id === memberId)) return state;
      return { ...state, energy: state.energy - FRONTIER_ENERGY_COST, frontier: { ...state.frontier, sabotage: order } };
    }
    case "BLOCK_INTRUSION": {
      const intrusion = activeIntrusion(state.territories, state.frontier.intrusion);
      if ((state.screen !== "map" && state.screen !== "base") || state.energy < FRONTIER_ENERGY_COST ||
        !intrusion || intrusion.defenderId || intrusion.targetId !== action.targetId ||
        !availableFrontierWorkers(state, DRAGON_TYPE).some(member => member.id === action.memberId)) return state;
      return { ...state, energy: state.energy - FRONTIER_ENERGY_COST,
        frontier: { ...state.frontier, intrusion: { ...intrusion, defenderId: action.memberId } } };
    }
    case "DETECT_ENEMY_OBSERVATION": {
      const espionage = state.frontier.espionage;
      const observation = activeObservation(state.territories, espionage?.observation);
      if (state.screen !== "map" || state.energy < FRONTIER_ENERGY_COST || !espionage || !observation ||
        observation.detectorId || observation.targetId !== action.targetId ||
        !availableFrontierWorkers(state, FLYING_TYPE).some(member => member.id === action.memberId)) return state;
      return { ...state, energy: state.energy - FRONTIER_ENERGY_COST, frontier: { ...state.frontier,
        espionage: { ...espionage, observation: { ...observation, detectorId: action.memberId } } } };
    }
    case "START_TERRITORY_BATTLE": {
      if (!action.setup.enemyTeam.length || !canBattle(state, action.setup.territoryId)) return state;
      const id = action.setup.territoryId;
      const intel = { ...state.frontier.intel };
      if (!intel[id]?.memberId) delete intel[id];
      const espionage = state.frontier.espionage;
      const consumed = espionage?.preparation?.territoryId === id ? { ...espionage, preparation: undefined } : espionage;
      return {...state, screen:"battle", energy:state.energy-BATTLE_ENERGY_COST, battle:action.setup, mapFocusId:id,
        frontier: { ...state.frontier, intel, ...(consumed ? { espionage: consumed } : {}) }};
    }
    case "USE_BATTLE_CURE": {
      if (state.screen !== "battle" || !state.battle || state.battle.territoryId !== action.territoryId ||
        !Number.isSafeInteger(action.round) || action.round <= (state.battle.lastCureRound ?? 0) ||
        state.resources.cureItem < 1 || state.territories[action.territoryId]?.owner === "player") return state;
      return { ...state, resources: { ...state.resources, cureItem: state.resources.cureItem - 1 },
        battle: { ...state.battle, lastCureRound: action.round } };
    }
    case "CONCEDE_TERRITORY":
      if (state.screen !== "battle" || state.battle?.territoryId !== action.territoryId ||
        !canTargetTerritory(state, action.territoryId)) return state;
      return { ...state, screen:"map", battle:null, mapFocusId:action.territoryId };
    case "CLAIM_TERRITORY": {
      const id = action.territoryId;
      if (state.screen !== "battle" || state.battle?.territoryId !== id || !canTargetTerritory(state, id)) return state;
      const captured = { ...state.territories[id], owner: "player" as const, trainerId: null, scouted: true };
      if (!STARTING_TERRITORY_IDS.includes(id)) captured.loyalty = MAX_LOYALTY;
      const territories = openCampaignRegions({ ...state.territories, [id]: captured }, state.trainerId, state.factionDefenderIds);
      const intel = { ...state.frontier.intel };
      delete intel[id];
      const award = !hasFirstVictory(state) && awardResources(state, FIRST_VICTORY_REWARD);
      const outposts = outpostIsOwned({ territories }, id) && !state.outposts[id]
        ? { ...state.outposts, [id]: makeOutpost(state.territories[id].owner === "trainer") } : state.outposts;
      return { ...state, territories, outposts, regionOpenedTurns: openedRegionTurns(territories, state.regionOpenedTurns, state.turnCount),
        frontier: { ...state.frontier, intel }, resources: award || state.resources };
    }
  }
}
