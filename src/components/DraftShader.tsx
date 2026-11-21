import { useEffect, useState } from "react";
import { Beam, RadialGradient, Shader, SimplexNoise } from "shaders/react";

const sunbeams = [
  { start: { x: .87, y: .11 }, end: { x: .53, y: .63 }, width: .19, speed: .16, opacity: .46 },
  { start: { x: .91, y: .18 }, end: { x: .63, y: .67 }, width: .13, speed: .11, opacity: .36 },
  { start: { x: .80, y: .09 }, end: { x: .50, y: .54 }, width: .10, speed: .22, opacity: .28 },
];

export default function DraftShader({ reveal, focus, arrival }: {
  reveal: boolean;
  focus?: { x: number; y: number };
  arrival: { x: number; y: number; round: number } | null;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState(0);

  const arrivalRound = arrival?.round;
  useEffect(() => {
    if (!arrivalRound) return;
    let frame: number;
    const start = performance.now();
    function animate(time: number) {
      const elapsed = Math.min(1, Math.max(0, (time - start) / 850));
      setPulse((1 - elapsed) ** 2);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [arrivalRound]);

  if (unavailable) return null;
  return (
    <Shader
      className={ready ? "draft-shader is-ready" : "draft-shader"}
      disableTelemetry
      onReady={() => setReady(true)}
      onUnavailable={() => setUnavailable(true)}
    >
      <SimplexNoise colorA="#f1ddb0" colorB="transparent" scale={3.2} speed={0.15} opacity={reveal ? .09 : .12} />
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
      <RadialGradient
        center={focus ?? { x: .5, y: .6 }}
        radius={.14}
        aspect={1.9}
        colorA="#e3c98380"
        colorB="#e3c98300"
        opacity={focus ? .45 : 0}
        blendMode="screen"
      />
      {arrival && <RadialGradient
        center={{ x: arrival.x, y: arrival.y - .045 }}
        radius={.09 + (1 - pulse) * .08}
        aspect={1.4}
        colorA="#ffe7a9"
        colorB="transparent"
        opacity={pulse * .65}
        blendMode="screen"
      />}
    </Shader>
  );
}
