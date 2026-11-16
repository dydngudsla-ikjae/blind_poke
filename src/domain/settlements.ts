import type { GameState, OutpostState } from "../game/gameTypes";
import { BUILDING_TYPES } from "./construction";
import { suppliedTerritories } from "./territorySupply";
import { worldMapNodes } from "./worldMap";
import type { BuildingState } from "./types";

export const HOME_SITE = "home";
export const OUTPOST_INITIAL_PLOTS = 2;
const outpostNodes = worldMapNodes.filter(node => node.region > 1);
const outpostRanks = new Map(outpostNodes.map((node, index) => [node.id, index + 1]));

export function settlementRank(siteId: string | undefined) {
  return outpostRanks.get(siteId ?? HOME_SITE) ?? 0;
}

export function settlementName(siteId: string) {
  return worldMapNodes.find(node => node.id === siteId)?.name ?? siteId;
}

export function outpostIsOwned(state: Pick<GameState, "territories">, id: string) {
  return outpostRanks.has(id) && state.territories[id]?.active && state.territories[id].owner === "player";
}

export function canOperateSettlement(state: Pick<GameState, "territories">, id = HOME_SITE) {
  return id === HOME_SITE || (outpostIsOwned(state, id) && suppliedTerritories(state.territories).has(id));
}

export function settlementAt(state: GameState, id: string): OutpostState | undefined {
  return id === HOME_SITE ? { plotCap: state.plotCap, clearing: state.clearing, inheritancePending: false } : state.outposts[id];
}

export function clearingSiteOf(state: Pick<GameState, "clearing" | "outposts">, memberId: string) {
  if (state.clearing?.memberId === memberId) return HOME_SITE;
  return Object.keys(state.outposts).find(id => state.outposts[id].clearing?.memberId === memberId);
}

export function makeOutpost(inheritancePending = false): OutpostState {
  return { plotCap: OUTPOST_INITIAL_PLOTS, clearing: null, inheritancePending };
}

export function inheritanceCandidates(siteId: string) {
  const rank = outpostRanks.get(siteId);
  if (!rank) return [];
  const offset = rank - 1;
  return [BUILDING_TYPES[offset % BUILDING_TYPES.length],
    BUILDING_TYPES[(offset + 1 + Math.floor(offset / BUILDING_TYPES.length) % (BUILDING_TYPES.length - 1)) % BUILDING_TYPES.length]];
}

export function isOutpostDojo(building: BuildingState): building is BuildingState & { siteId: string } {
  return building.type === "dojo" && !!building.siteId && outpostRanks.has(building.siteId);
}

export function isInheritedDojo(building: BuildingState): building is BuildingState & { siteId: string } {
  return isOutpostDojo(building) && building.inherited === true && building.plotIndex === 0 && building.status === "active";
}
