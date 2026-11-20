import { lazy, Suspense } from "react";
import useFieldMotion from "./useFieldMotion";

const DraftShader = lazy(() => import("./DraftShader").catch(() => ({ default: () => null })));

export default function DraftAtmosphere({
  target,
  trainerRevealed = false,
}: {
  target?: { x: number; y: number };
  trainerRevealed?: boolean;
}) {
  const enabled = useFieldMotion();

  return enabled ? (
    <div className="draft-atmosphere" aria-hidden="true">
      <Suspense fallback={null}>
        <DraftShader target={target} trainerRevealed={trainerRevealed} />
      </Suspense>
    </div>
  ) : null;
}
