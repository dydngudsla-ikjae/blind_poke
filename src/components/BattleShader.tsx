import { useEffect, useState } from "react";
import { Beam, CustomShader, LinearGradient, RadialGradient, Shader, SimplexNoise } from "shaders/react";
import { defineShader, transformColor, transformPosition, wgsl } from "shaders/std";
import type { BattleSide } from "../domain/battle";

const impactWave = defineShader({
  name: "BattleImpactWave",
  props: {
    point: { default: { x: .74, y: .5 }, transform: transformPosition },
    tint: { default: "#ffe1a6", transform: transformColor },
    progress: { default: 1 },
  },
  paint: wgsl`
    let p = (uv - point) * vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    let distance = length(p);
    let radius = 0.017 + progress * 0.16;
    let ring = exp(-abs(distance - radius) * 115.0);
    let second = exp(-abs(distance - radius * 0.66) * 128.0);
    let core = exp(-distance * 39.0) * (1.0 - progress) * 0.65;
    let angle = atan2(p.y, p.x + 0.000001);
    let fleck = pow(max(0.0, sin(angle * 12.0 + 1.8)), 11.0);
    let sparks = fleck * exp(-abs(distance - 1.13 * radius) * 64.0);
    let glow = (ring * 0.54 + second * 0.16 + sparks * 0.52 + core) *
      (1.0 - smoothstep(0.22, 1.0, progress));
    return vec4f(tint.rgb, min(glow, 0.82));
  `,
});

const locations = {
  player: { x: .28, y: .64 },
  enemy: { x: .73, y: .44 },
};

export default function BattleShader({ side, impact, cue, color }: {
  side?: BattleSide; impact: boolean; cue: string; color: string;
}) {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!side || !impact) return;
    const start = performance.now();
    let frame: number;
    function animate(time: number) {
      const elapsed = time - start;
      setProgress(elapsed < 85 ? 1 : Math.min(1, (elapsed - 85) / 235));
      if (elapsed < 320) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [side, impact, cue]);

  if (unavailable) return null;
  return (
    <Shader className="duel-shader" data-ready={ready} disableTelemetry
      onReady={() => setReady(true)} onUnavailable={() => setUnavailable(true)}>
      <LinearGradient id="duel-ground" visible={false} start={{ x:.5, y:.46 }} end={{ x:.5, y:1 }}
        colorA="transparent" colorB="#ffffff" />
      <SimplexNoise opacity={.20} scale={2.2} speed={.16} colorA="#e4edbf" colorB="#b8c8a100" maskSource="duel-ground" />
      <RadialGradient id="duel-light" visible={false} center={{ x:.8, y:.23 }} radius={.7} colorA="#fff" colorB="transparent" />
      <Beam startPosition={{ x:.92, y:.04 }} endPosition={{ x:.54, y:.68 }}
        startThickness={.035} endThickness={{ type:"auto-animate", mode:"ping-pong", outputMin:.12, outputMax:.25, speed:.15 }}
        startSoftness={2.5} endSoftness={4.2} insideColor="#ffe2a8" outsideColor="#e8bd7830" opacity={.30} maskSource="duel-light" />
      <CustomShader src={impactWave}
        visible={Boolean(side && impact) && progress < 1}
        point={side === "player" ? locations.enemy : locations.player}
        progress={progress} tint={color} />
    </Shader>
  );
}
