import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import useFieldMotion from "./useFieldMotion";

const HuntOpticsShader = lazy(() => import("./HuntOpticsShader").catch(() => ({ default: () => null })));

type Point = { x: number; y: number };
const restingAim = { x: 50, y: 52 };

export default function HuntOptics({ target, image, imageAspect, imagePositionY }: {
  target?: Point; image: string; imageAspect: number; imagePositionY: number;
}) {
  const motion = useFieldMotion();
  const aim = target ?? restingAim;
  const lock = target ? 1 : 0;
  const [frame, setFrame] = useState({ ...aim, focus: lock });
  const latest = useRef(frame);

  useEffect(() => {
    if (!motion) return;
    const origin = latest.current;
    if (origin.x === aim.x && origin.y === aim.y && origin.focus === lock) return;
    const start = performance.now();
    let animation: number;
    function settle(now: number) {
      const time = Math.max(0, Math.min(1, (now - start) / 250));
      const ease = 1 - (1 - time) ** 3;
      const next = {
        x: origin.x + (aim.x - origin.x) * ease,
        y: origin.y + (aim.y - origin.y) * ease,
        focus: origin.focus + (lock - origin.focus) * ease,
      };
      latest.current = next;
      setFrame(next);
      if (time < 1) animation = requestAnimationFrame(settle);
    }
    animation = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(animation);
  }, [aim, lock, motion]);

  const view = motion ? frame : { ...aim, focus: lock };
  const style = {
    "--optics-x": `${view.x}%`,
    "--optics-y": `${view.y}%`,
    "--optics-focus": view.focus,
  } as CSSProperties;

  return (
    <div className="hunt-optics" style={style} aria-hidden="true">
      <div className="hunt-optics-glass">
        {motion && (
          <Suspense fallback={null}>
            <HuntOpticsShader image={image} imageAspect={imageAspect} imagePositionY={imagePositionY}
              center={{ x: view.x / 100, y: view.y / 100 }} focus={view.focus} />
          </Suspense>
        )}
      </div>
      <div className="hunt-optics-housing field-optic-bezel">
        <div className="field-optic-rim" />
        <div className="hunt-optics-focus-mark" />
      </div>
    </div>
  );
}
