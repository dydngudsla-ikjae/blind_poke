import { worldMapNodes } from "../domain/worldMap";
import { RESOURCE_LABELS } from "../domain/economy";
import { MAX_PLOTS, type ResourceKey } from "../domain/jobs";
import { forecastProduction } from "../domain/production";
import { inheritanceCandidates, isInheritedDojo, isOutpostDojo, outpostIsOwned } from "../domain/settlements";
import { suppliedTerritories } from "../domain/territorySupply";
import type { GameState, TerritoryState } from "./gameTypes";

export const REGION_NAMES = ["시작 지역", "북서 지역", "남동 지역", "북동 지역"];
export const ENDING_SPECIES = 25;
export const FIRST_VICTORY_REWARD = { gold: 5, candy: 1 };
export const INHERITED_RESEARCH_REWARD = { candy: 2 };
export const DEX_REWARDS: ReadonlyArray<{ threshold: number; resources: Partial<Record<ResourceKey, number>> }> = [
  { threshold: 10, resources: { candy: 3 } },
  { threshold: 25, resources: { tm: 3, gold: 10 } },
  { threshold: 50, resources: { candy: 5, tool: 3 } },
];

export function regionProgress(territories: GameState["territories"]) {
  return REGION_NAMES.map((name, index) => {
    const nodes = worldMapNodes.filter(node => node.region === index + 1);
    return { name, total: nodes.length, owned: nodes.filter(node => territories[node.id]?.owner === "player").length };
  });
}

export function unlockRegions(territories: Record<string, TerritoryState>) {
  const upcoming = regionProgress(territories).findIndex(region => region.owned < region.total);
  return Object.fromEntries(worldMapNodes.map(node => {
    const territory = territories[node.id];
    return [node.id, { ...territory, active: territory.active || upcoming === -1 || node.region <= upcoming + 1 || territory.owner === "player" }];
  }));
}

export function hasFirstVictory(state: Pick<GameState, "territories">) {
  return worldMapNodes.some(node => node.id !== "home" && state.territories[node.id]?.owner === "player");
}

export function endingReady(state: GameState) {
  return state.caughtSpeciesIds.length >= ENDING_SPECIES &&
    worldMapNodes.every(node => state.territories[node.id]?.owner === "player");
}

type InheritedDojoProgress =
  ({ step: "inherit" | "unavailable" | "complete" | "buildUnavailable"; siteId?: never }
  | { step: "recapture" | "supply" | "build" | "clear" | "constructing" | "assign" | "storage" | "produce"; siteId: string })
  & { outpostRoute?: true };

export function dojoResearchChallengeRoute(state: GameState) {
  const inheritedDojos = state.buildings.filter(isInheritedDojo);
  if (inheritedDojos.length) return { kind: "inherited", dojos: inheritedDojos } as const;
  const canStillInherit = worldMapNodes.some(({ id }) => {
    const outpost = state.outposts[id];
    const site = state.territories[id];
    return inheritanceCandidates(id).includes("dojo") &&
      (outpost ? outpost.inheritancePending : !site.active || site.owner === "trainer");
  });
  if (canStillInherit) return { kind: "inherit", dojos: [] } as const;
  if (state.legacyOutpostResearch) return { kind: "outpost", dojos: state.buildings.filter(isOutpostDojo) } as const;
  return { kind: "unavailable", dojos: [] } as const;
}

function outpostDojoConstruction(state: GameState, supplied: ReadonlySet<string>): InheritedDojoProgress {
  let clearingSite: string | undefined;
  let isolatedSite: string | undefined;
  for (const [id, outpost] of Object.entries(state.outposts)) {
    if (!outpostIsOwned(state, id)) continue;
    const occupied = new Set(state.buildings.filter(building => building.siteId === id).map(building => building.plotIndex));
    if (outpost.inheritancePending) occupied.add(0);
    const hasFreePlot = occupied.size < outpost.plotCap;
    const canClearPlot = outpost.plotCap < MAX_PLOTS;
    if (!hasFreePlot && !canClearPlot) continue;
    if (!supplied.has(id)) {
      isolatedSite ??= id;
      continue;
    }
    if (hasFreePlot) return { step: "build", siteId: id, outpostRoute: true };
    clearingSite ??= id;
  }
  if (clearingSite) return { step: "clear", siteId: clearingSite, outpostRoute: true };
  if (isolatedSite) return { step: "supply", siteId: isolatedSite, outpostRoute: true };
  return { step: "buildUnavailable", outpostRoute: true };
}

export function inheritedDojoProgress(state: GameState): InheritedDojoProgress {
  const route = dojoResearchChallengeRoute(state);
  const display = route.kind === "outpost" ? { outpostRoute: true as const } : {};
  if (state.inheritedResearchCompleted) return { step: "complete", ...display };
  if (route.kind === "inherit" || route.kind === "unavailable") return { step: route.kind };
  const supplied = suppliedTerritories(state.territories);
  if (!route.dojos.length) return outpostDojoConstruction(state, supplied);
  const owned = route.dojos.filter(building => outpostIsOwned(state, building.siteId));
  if (!owned.length) return { step: "recapture", siteId: route.dojos[0].siteId, ...display };
  const connected = owned.filter(building => supplied.has(building.siteId));
  if (!connected.length) return { step: "supply", siteId: owned[0].siteId, ...display };
  const operating = connected.filter(building => building.status === "active");
  if (!operating.length) return { step: "constructing", siteId: connected[0].siteId, ...display };

  const researchers = state.roster.filter(member => member.jobId === "research");
  const staffed = operating.filter(building => researchers.some(member => member.buildingId === building.id));
  if (!staffed.length) return { step: "assign", siteId: operating[0].siteId, ...display };
  const { workers } = forecastProduction(state);
  const producing = staffed.find(building => researchers.some(member => member.buildingId === building.id &&
    (workers.get(member.id)?.produced ?? 0) > 0));
  return producing ? { step: "produce", siteId: producing.siteId, ...display }
    : { step: "storage", siteId: staffed[0].siteId, ...display };
}

export function rewardEntries(rewards: Partial<Record<ResourceKey, number>>) {
  return Object.entries(rewards) as Array<[ResourceKey, number]>;
}

export function awardResources(state: GameState, rewards: Partial<Record<ResourceKey, number>>, mustFit = false) {
  const entries = rewardEntries(rewards);
  if (mustFit && entries.some(([key, amount]) => state.resources[key] + amount > state.storageCap)) return null;
  const resources = { ...state.resources };
  for (const [key, amount] of entries) {
    resources[key] += Math.max(0, Math.min(amount, state.storageCap - resources[key]));
  }
  return resources;
}

export function describeFirstVictoryReward(state: GameState) {
  const after = awardResources(state, FIRST_VICTORY_REWARD);
  if (!after) return "저장 공간 부족";

  const received: string[] = [];
  let limited = false;
  for (const [key, amount] of rewardEntries(FIRST_VICTORY_REWARD)) {
    const gain = after[key] - state.resources[key];
    if (gain > 0) received.push(`${RESOURCE_LABELS[key]} +${gain}`);
    if (gain < amount) limited = true;
  }
  if (limited) received.push("저장 공간 부족");
  return received.join(" · ");
}
