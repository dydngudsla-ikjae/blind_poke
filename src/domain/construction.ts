export const BASE_CONSTRUCTION_TURNS = 3;
export const MAX_BUILD_SPEED_WORKERS = 3;
export const BUILDING_TYPES = ["farm", "restaurant", "dojo", "workshop", "clinic"] as const;
export type BuildingType = typeof BUILDING_TYPES[number];

export function isBuildingType(type: string): type is BuildingType {
  return BUILDING_TYPES.some(building => building === type);
}

export function constructionTurns(workerCount: number): number {
  const effectiveWorkers = Math.min(MAX_BUILD_SPEED_WORKERS, Math.max(1, workerCount));
  return Math.max(1, BASE_CONSTRUCTION_TURNS - (effectiveWorkers - 1));
}

export function projectedConstructionTurns(
  currentRemaining: number,
  totalWorkerCount: number,
): number {
  return Math.min(currentRemaining, constructionTurns(totalWorkerCount));
}
