import { JOBS, jobDefinitions, supportsJob, type JobId } from "./jobs";
import type { BuildingState, ResourceState, RosterMember } from "./types";
import type { FrontierOperations, TerritoryState } from "../game/gameTypes";
import { suppliedTerritories, territoryIncome } from "./territorySupply";
import { HOME_SITE, settlementRank } from "./settlements";
import { candyCostToLevel } from "./economy";
import { activeIntrusion } from "./frontierOperations";

export interface ProductionReading {
  potential: number;
  produced: number;
  consumed: number;
  materialLimited: boolean;
  storageLimited: boolean;
}

type ProductionState = {
  buildings: BuildingState[];
  roster: RosterMember[];
  resources: ResourceState;
  storageCap: number;
  territories: Record<string, Pick<TerritoryState, "owner" | "active">>;
  frontier?: FrontierOperations;
};

function stage(jobId: JobId) {
  if (jobId === "cook") return 2;
  return jobDefinitions[jobId].recipe?.input ? 1 : 0;
}

function productionPotential(member: RosterMember, jobId: JobId, base: number, farmBonus = 1) {
  const aptitude = Math.min(100, Math.max(0, Number.isFinite(member.aptitude) ? member.aptitude : 50));
  const level = Number.isFinite(member.level) ? Math.max(1, member.level) : 1;
  const coinBonus = jobId === "mint" && member.heldItem === "amulet_coin" ? 1.5 : 1;
  const bandBonus = member.heldItem === "choice_band" ? 1.2 : 1;
  return Math.round(base * (.5 + aptitude / 100) * (1 + level * .1) * farmBonus * coinBonus * bandBonus);
}

export function nextResearchIncrease(member: RosterMember) {
  const base = JOBS.research.recipe.base;
  const current = productionPotential(member, "research", base);
  // At the minimum aptitude, raw research output rises by one within 20 levels.
  for (let offset = 1; offset <= 20; offset++) {
    const level = member.level + offset;
    const potential = productionPotential({ ...member, level }, "research", base);
    if (potential > current) return { level, candy: candyCostToLevel(member, level), current, potential };
  }
  return null;
}

function calculateProduction(state: ProductionState, ignoreGoldCap: boolean) {
  const resources = { ...state.resources };
  const supplied = suppliedTerritories(state.territories);
  const buildings = new Map(state.buildings.filter(building => !building.siteId || building.siteId === HOME_SITE || supplied.has(building.siteId))
    .map(building => [building.id, building]));
  const assigned = state.roster.flatMap((member, rosterIndex) => {
    const building = member.buildingId ? buildings.get(member.buildingId) : undefined;
    const { jobId } = member;
    return building && jobId && supportsJob(building, member.pokemon, jobId)
      ? [{ member, jobId, building, rosterIndex }] : [];
  });
  const chilled = assigned.filter(({ jobId }) => jobId === "chill").length;
  const storageCap = state.storageCap + chilled * 10;
  const goldCap = ignoreGoldCap ? Infinity : storageCap;
  const intrusion = activeIntrusion(state.territories, state.frontier?.intrusion);
  const income = Math.max(0, Math.min(territoryIncome(state.territories, intrusion?.defenderId ? undefined : intrusion?.targetId), goldCap - resources.gold));
  resources.gold += income;
  const tillers = new Map<string, number>();
  for (const { building, jobId } of assigned) {
    if (jobId === "till") tillers.set(building.id, (tillers.get(building.id) ?? 0) + 1);
  }
  const workers = new Map<string, ProductionReading>();
  const order = assigned.sort((a, b) => stage(a.jobId) - stage(b.jobId) ||
    settlementRank(a.building.siteId) - settlementRank(b.building.siteId) ||
    a.building.plotIndex - b.building.plotIndex ||
    (a.member.jobOrder ?? 0) - (b.member.jobOrder ?? 0) || a.rosterIndex - b.rosterIndex);
  for (const { member, jobId, building } of order) {
    const recipe = jobDefinitions[jobId].recipe;
    if (!recipe) continue;
    const farmBonus = jobId === "fruit" ? 1 + .2 * (tillers.get(building.id) ?? 0) : 1;
    const potential = productionPotential(member, jobId, recipe.base, farmBonus);
    const available = recipe.input ? Math.max(0, Math.floor(resources[recipe.input.key] / recipe.input.amount)) : potential;
    const outputCap = recipe.output === "gold" ? goldCap : storageCap;
    const room = Math.max(0, Math.floor(outputCap - resources[recipe.output]));
    const produced = Math.min(potential, available, room);
    const consumed = recipe.input ? produced * recipe.input.amount : 0;
    resources[recipe.output] += produced;
    if (recipe.input) resources[recipe.input.key] -= consumed;
    workers.set(member.id, {
      potential, produced, consumed,
      materialLimited: available < Math.min(potential, room),
      storageLimited: room < potential,
    });
  }
  return { resources, storageCap, workers, income };
}

export function forecastProduction(state: ProductionState) {
  return calculateProduction(state, false);
}

export function forecastGold(state: ProductionState) {
  const { resources, storageCap } = forecastProduction(state);
  // Reuse the production order so mint workers compete for the same material in both readings.
  const uncappedGold = storageCap - resources.gold < 1 ? calculateProduction(state, true).resources.gold : resources.gold;
  return { received: resources.gold - state.resources.gold, overflow: uncappedGold - resources.gold, storageCap };
}
