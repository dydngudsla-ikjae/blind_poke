import { useEffect, useState } from "react";
import { Beam, FilmGrain, RadialGradient, Ring, Shader, SimplexNoise } from "shaders/react";

type Point = { x: number; y: number };

const sunbeams = [
  { start: { x: .87, y: .11 }, end: { x: .53, y: .63 }, width: .19, speed: .16, opacity: .46 },
  { start: { x: .91, y: .18 }, end: { x: .63, y: .67 }, width: .13, speed: .11, opacity: .36 },
  { start: { x: .80, y: .09 }, end: { x: .50, y: .54 }, width: .10, speed: .22, opacity: .28 },
];

export default function DraftShader({
  target,
  trainerRevealed,
}: {
  target?: Point;
  trainerRevealed: boolean;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!target && !trainerRevealed) return;
    let frame: number;
    const start = performance.now();
    const duration = trainerRevealed ? 620 : 200;
    function animate(time: number) {
      const elapsed = Math.min(1, Math.max(0, (time - start) / duration));
      setPulse(trainerRevealed ? (1 - elapsed) ** 2 : 1 - elapsed);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, trainerRevealed]);

  if (unavailable) return null;
  const center = { x: (target?.x ?? 50) / 100, y: (target?.y ?? 50) / 100 };
  return (
    <Shader
      className={ready ? "draft-shader is-ready" : "draft-shader"}
      disableTelemetry
      onReady={() => setReady(true)}
      onUnavailable={() => setUnavailable(true)}
    >
      <SimplexNoise colorA="#cde9c0" colorB="#12231a" scale={2.4} speed={0.23} opacity={0.28} />
      <FilmGrain animated strength={0.32} bias={0.45} />
      <RadialGradient
        id="draft-sunlight"
        visible={false}
        center={{ x: .76, y: .28 }}
        radius={0.69}
        aspect={0.88}
        colorA="#ffffff"
        colorB="transparent"
      />
      {sunbeams.map(({ start, end, width, speed, opacity }) => (
        <Beam
          key={start.x}
          startPosition={start}
          endPosition={end}
          startThickness={{
            type: "auto-animate",
            mode: "ping-pong",
            outputMin: width * .08,
            outputMax: width * .48,
            speed,
          }}
          endThickness={{
            type: "auto-animate",
            mode: "ping-pong",
            outputMin: width * .32,
            outputMax: width,
            speed,
          }}
          startSoftness={2.4}
          endSoftness={4.8}
          insideColor="#ffe4aa"
          outsideColor="#e9ae5e30"
          blendMode="screen"
          opacity={opacity}
          maskSource="draft-sunlight"
        />
      ))}
      <Ring
        center={trainerRevealed ? { x: .43, y: .53 } : center}
        radius={trainerRevealed ? 0.22 + pulse * 0.18 : 0.135 + pulse * 0.055}
        color={trainerRevealed ? "#f5dda3" : "#e1fbe2"}
        thickness={0.0025}
        softness={0.002}
        visible={trainerRevealed ? pulse > 0 : Boolean(target)}
        opacity={trainerRevealed ? pulse * 0.46 : target ? 0.24 + pulse * 0.56 : 0}
      />
      {trainerRevealed && (
        <Beam
          startPosition={{ x: 1.1 - pulse * .92, y: .04 }}
          endPosition={{ x: .76 - pulse * .92, y: .96 }}
          startThickness={.025}
          endThickness={.09}
          startSoftness={2.8}
          endSoftness={4.2}
          insideColor="#ffe9bc"
          outsideColor="#d5ae7030"
          opacity={pulse * .48}
          visible={pulse > 0}
        />
      )}
    </Shader>
  );
}
