import { useEffect, useState } from "react";
import { Beam, CustomShader, LinearGradient, RadialGradient, Shader, SimplexNoise } from "shaders/react";
import { defineShader, transformColor, transformPosition, wgsl } from "shaders/std";

type Point = { x: number; y: number };
export type BattleEffect = "contact" | "projectile" | "status" | "miss" | "immune";
const effects: Record<BattleEffect, number> = { contact: 0, projectile: 1, status: 2, miss: 3, immune: 4 };

const battleTrace = defineShader({
  name: "BattleTrace",
  props: {
    originPoint: { default: { x: .28, y: .64 }, transform: transformPosition },
    impactPoint: { default: { x: .73, y: .43 }, transform: transformPosition },
    tint: { default: "#ffe1a6", transform: transformColor },
    traceKind: { default: 0 },
    progress: { default: 1 },
  },
  paint: wgsl`
    let aspectScale = vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    let direction = (impactPoint - originPoint) * aspectScale;
    let forward = direction / max(length(direction), 0.001);
    let across = vec2f(-forward.y, forward.x);
    let travel = smoothstep(0.0, 0.53, progress);
    let beside = select(vec2f(0.0), vec2f(0.035, -0.104), traceKind == 3.0);
    let flight = (uv - mix(originPoint, impactPoint + beside, travel)) * aspectScale;
    let along = dot(flight, forward);
    let cross = dot(flight, across);
    let tail = exp(-abs(along + 0.016) * 38.0 - abs(cross) * 108.0);
    let head = exp(-length(flight) * 93.0);
    let projectile = (tail * 0.52 + head * 0.58) * smoothstep(0.0, 0.09, progress)
      * (1.0 - smoothstep(0.45, 0.72, progress));

    let hit = smoothstep(0.28, 1.0, progress);
    let p = (uv - impactPoint) * aspectScale;
    let distance = length(p);
    let theta = atan2(p.y, p.x + 0.000001);
    let radius = 0.02 + hit * 0.17;
    let broken = 0.35 + 0.65 * smoothstep(0.0, 1.0, sin(theta * 9.0 + hit * 5.0));
    let ring = exp(-abs(distance - radius) * 115.0) * select(1.0, broken, traceKind == 2.0);
    let core = exp(-distance * 46.0) * (1.0 - hit);
    let spoke = pow(clamp(0.5 + 0.5 * cos(theta * 11.0 + 1.4), 0.0, 1.0), 12.0);
    let shards = spoke * exp(-abs(distance - radius * 1.19) * 23.0)
      * (1.0 - exp(-distance * 64.0)) * select(0.46, 0.14, traceKind == 2.0);
    let impact = (ring * 0.82 + core * 0.56 + shards) * smoothstep(0.26, 0.39, progress) * (1.0 - hit);
    let ward = exp(-abs(distance - 0.074 * (1.0 - hit)) * 125.0) * broken
      * smoothstep(0.40, 0.57, progress) * (1.0 - hit);
    let glow = select(0.0, projectile, traceKind == 1.0 || traceKind == 3.0 || traceKind == 4.0)
      + select(impact, 0.0, traceKind == 3.0 || traceKind == 4.0)
      + select(0.0, ward, traceKind == 4.0);
    return vec4f(mix(tint.rgb, vec3f(1.0, 0.91, 0.71), core * 0.63), min(glow, 0.91));
  `,
});

export default function BattleShader({ effect, from, to, cue, color }: {
  effect?: BattleEffect; from?: Point; to?: Point; cue: string; color: string;
}) {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!effect) return;
    const start = performance.now();
    let frame: number;
    function animate(time: number) {
      const elapsed = time - start;
      setProgress(Math.max(0, Math.min(1, elapsed / 320)));
      if (elapsed < 320) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [effect, cue]);

  if (unavailable) return null;
  return (
    <Shader className="duel-shader" data-ready={ready} aria-hidden="true" disableTelemetry
      onReady={() => setReady(true)} onUnavailable={() => setUnavailable(true)}>
      <LinearGradient id="duel-ground" visible={false} start={{ x:.5, y:.46 }} end={{ x:.5, y:1 }}
        colorA="transparent" colorB="#ffffff" />
      <SimplexNoise opacity={.20} scale={2.2} speed={.16} colorA="#e4edbf" colorB="#b8c8a100" maskSource="duel-ground" />
      <RadialGradient id="duel-light" visible={false} center={{ x:.8, y:.23 }} radius={.7} colorA="#fff" colorB="transparent" />
      <Beam startPosition={{ x:.92, y:.04 }} endPosition={{ x:.54, y:.68 }}
        startThickness={.035} endThickness={{ type:"auto-animate", mode:"ping-pong", outputMin:.12, outputMax:.25, speed:.15 }}
        startSoftness={2.5} endSoftness={4.2} insideColor="#ffe2a8" outsideColor="#e8bd7830" opacity={.30} maskSource="duel-light" />
      <CustomShader src={battleTrace} originPoint={from} impactPoint={to}
        traceKind={effect ? effects[effect] : 0} progress={effect && from && to ? progress : 1} tint={color} />
    </Shader>
  );
}
