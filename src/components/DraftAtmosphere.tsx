import { lazy, Suspense } from "react";
import useFieldMotion from "./useFieldMotion";

const DraftShader = lazy(() => import("./DraftShader").catch(() => ({ default: () => null })));

export default function DraftAtmosphere(props: {
  reveal: boolean;
  focus?: { x: number; y: number };
  arrival: { x: number; y: number; round: number } | null;
}) {
  const enabled = useFieldMotion();

  return enabled ? (
    <div className="draft-atmosphere" aria-hidden="true">
      <Suspense fallback={null}>
        <DraftShader {...props} />
      </Suspense>
    </div>
  ) : null;
}
