import type { MouseEvent } from "react";

const REPEAT_WINDOW_MS = 350;
const REPEAT_DISTANCE_PX = 16;

export type PointerClick = { x: number; y: number; time: number };

export function readPointerClick(event: MouseEvent): PointerClick | null {
  return event.detail === 0 ? null : { x: event.clientX, y: event.clientY, time: event.timeStamp };
}

export function isRapidPointerRepeat(previous: PointerClick | null, current: PointerClick | null) {
  return previous !== null && current !== null && current.time - previous.time < REPEAT_WINDOW_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <= REPEAT_DISTANCE_PX;
}
