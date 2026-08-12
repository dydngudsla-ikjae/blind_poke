export const BASE_CONSTRUCTION_TURNS = 3;
export const MAX_BUILD_SPEED_WORKERS = 3;

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
