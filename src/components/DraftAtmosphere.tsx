import { lazy, Suspense } from "react";
import useFieldMotion from "./useFieldMotion";

const DraftShader = lazy(() => import("./DraftShader").catch(() => ({ default: () => null })));

export default function DraftAtmosphere({
  target,
  trainerRevealed = false,
  fieldScan = false,
  analysisPass,
  analysisResolved = false,
  recruited = false,
}: {
  target?: { x: number; y: number };
  trainerRevealed?: boolean;
  fieldScan?: boolean;
  analysisPass?: number;
  analysisResolved?: boolean;
  recruited?: boolean;
}) {
  const enabled = useFieldMotion();

  return enabled ? (
    <div className="draft-atmosphere" aria-hidden="true">
      <Suspense fallback={null}>
        <DraftShader target={target} trainerRevealed={trainerRevealed} fieldScan={fieldScan}
          analysisPass={analysisPass} analysisResolved={analysisResolved} recruited={recruited} />
      </Suspense>
    </div>
  ) : null;
}
