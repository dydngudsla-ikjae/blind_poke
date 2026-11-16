import { useEffect, useState } from "react";
import { Beam, CustomShader, FilmGrain, LinearGradient, RadialGradient, Ring, Shader, SimplexNoise } from "shaders/react";
import { defineShader, transformPosition, wgsl } from "shaders/std";

type Point = { x: number; y: number };

const sunbeams = [
  { start: { x: .87, y: .11 }, end: { x: .53, y: .63 }, width: .19, speed: .16, opacity: .46 },
  { start: { x: .91, y: .18 }, end: { x: .63, y: .67 }, width: .13, speed: .11, opacity: .36 },
  { start: { x: .80, y: .09 }, end: { x: .50, y: .54 }, width: .10, speed: .22, opacity: .28 },
];

const scannerReturn = defineShader({
  name: "ForestScannerReturn",
  animatedTime: { speed: "speed" },
  props: {
    center: { default: { x: .5, y: .6 }, transform: transformPosition },
    acquisition: { default: 0 },
    aperture: { default: 0.13 },
    confirmed: { default: 0 },
    speed: { default: 1 },
  },
  paint: wgsl`
    let p = (uv - center) * vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    let radius = aperture + acquisition * 0.045;
    let distance = length(p);
    let rim = 1.0 - smoothstep(0.0007, 0.0024, abs(distance - radius));
    let inside = 1.0 - smoothstep(radius - 0.018, radius, distance);

    // Sweep once during acquisition; keep the fine readout lines live after the lock.
    let row = p.y + (2.0 * acquisition - 1.0) * radius;
    let sweep = exp(-abs(row) * 110.0) * acquisition;
    let lines = pow(0.5 + 0.5 * sin(uv.y * viewport.y * 1.65 - time * 2.4), 5.0);
    let cell = floor(uv * vec2f(200.0, 155.0));
    let grain = fract(sin(dot(cell, vec2f(12.9898, 78.233)) + floor(time * 15.0)) * 43758.5453);
    let response = inside * (0.018 + lines * 0.077 + grain * 0.026 + sweep * 0.42);
    let color = mix(vec3f(0.65, 0.95, 0.75), vec3f(0.98, 0.83, 0.49), confirmed);
    return vec4f(color, rim * (0.46 + acquisition * 0.38) + response * (1.0 - confirmed * 0.45));
  `,
});

export default function DraftShader({
  target,
  trainerRevealed,
  fieldScan,
  analysisPass,
  analysisResolved,
}: {
  target?: Point;
  trainerRevealed: boolean;
  fieldScan: boolean;
  analysisPass?: number;
  analysisResolved: boolean;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState(0);
  const analyzing = analysisPass !== undefined;

  useEffect(() => {
    if (!target && !trainerRevealed) return;
    let frame: number;
    const start = performance.now();
    const duration = trainerRevealed ? 620 : analyzing ? 370 : 200;
    function animate(time: number) {
      const elapsed = Math.min(1, Math.max(0, (time - start) / duration));
      setPulse(trainerRevealed ? (1 - elapsed) ** 2 : 1 - elapsed);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, trainerRevealed, analyzing, analysisPass]);

  if (unavailable) return null;
  const center = { x: (target?.x ?? 50) / 100, y: (target?.y ?? 50) / 100 };
  return (
    <Shader
      className={ready ? "draft-shader is-ready" : "draft-shader"}
      disableTelemetry
      onReady={() => setReady(true)}
      onUnavailable={() => setUnavailable(true)}
    >
      {fieldScan && (
        <LinearGradient
          id="field-ground"
          visible={false}
          start={{ x: .5, y: .42 }}
          end={{ x: .5, y: .92 }}
          colorA="transparent"
          colorB="#ffffff"
        />
      )}
      <SimplexNoise
        colorA={fieldScan ? "#d9e9bc" : "#cde9c0"}
        colorB={fieldScan ? "#728a5733" : "#12231a"}
        scale={fieldScan ? 2.0 : 2.4}
        speed={fieldScan ? 0.15 : 0.23}
        opacity={fieldScan ? 0.26 : 0.28}
        maskSource={fieldScan ? "field-ground" : undefined}
      />
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
      {fieldScan ? (
        <CustomShader src={scannerReturn} center={center} acquisition={pulse} visible={Boolean(target)}
          aperture={analyzing ? .33 : .13} confirmed={analysisResolved ? 1 : 0} />
      ) : (
        <Ring
          center={trainerRevealed ? { x: .43, y: .53 } : center}
          radius={trainerRevealed ? 0.22 + pulse * 0.18 : 0.135 + pulse * 0.055}
          color={trainerRevealed ? "#f5dda3" : "#e1fbe2"}
          thickness={0.0025}
          softness={0.002}
          visible={trainerRevealed ? pulse > 0 : Boolean(target)}
          opacity={trainerRevealed ? pulse * 0.46 : target ? 0.24 + pulse * 0.56 : 0}
        />
      )}
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
