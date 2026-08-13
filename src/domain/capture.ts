export type CaptureResult="captured"|"fled";

export function resolveCapture(favor:number,roll=Math.random()*100):CaptureResult{
  const chance=Math.max(0,Math.min(100,favor));
  return roll<chance?"captured":"fled";
}
