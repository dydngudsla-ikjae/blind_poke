import { useEffect, useState } from "react";
import { CustomShader, ImageTexture, Shader } from "shaders/react";
import { defineShader, transformPosition, wgsl } from "shaders/std";
import atlas from "../../assets/observatory-atlas.webp";
import type { WorldMapNode } from "../domain/worldMap";

const survey = defineShader({
  name: "AtlasSurvey",
  animatedTime: { speed: "speed" },
  props: {
    speed: { default: 1 },
    scanCenter: { default: { x: .5, y: .5 }, transform: transformPosition },
    sweepProgress: { default: 1 },
  },
  effect: wgsl`
    // The atlas uses blue-green water and warm land. The color key keeps the
    // painted cliffs, forest and bridges from moving with the sea.
    let landAndSea = textureSample(childTexture, childSampler, uv);
    let water = smoothstep(0.020, 0.105, landAndSea.b - landAndSea.r) *
      smoothstep(0.005, 0.037, landAndSea.b - landAndSea.g);
    let swell = sin(uv.x * 25.0 - uv.y * 36.0 + time * 0.48);
    let wave = sin(uv.x * 82.0 + uv.y * 161.0 - time * 1.65 + swell * 3.0);
    let crossWave = sin(uv.x * 203.0 - uv.y * 57.0 + time * 0.78 + wave * 1.6);
    let current = vec2f(wave * 0.0014, crossWave * 0.0011);
    let ocean = textureSample(childTexture, childSampler, clamp(uv + current * water, vec2f(0.0), vec2f(1.0)));
    let glint = smoothstep(0.55, 0.98, wave) * smoothstep(0.08, 0.83, crossWave) * water * 0.014;
    let surface = mix(landAndSea.rgb, ocean.rgb, water * 0.83) + glint * vec3f(0.34, 0.67, 0.75);

    let distance = length((uv - scanCenter) * vec2f(aspect, 1.0));
    let radius = 0.022 + sweepProgress * 0.20;
    let rim = 1.0 - smoothstep(0.0008, 0.0045, abs(distance - radius));
    let wake = (1.0 - smoothstep(0.0, 0.04, radius - distance)) * (1.0 - step(radius, distance));
    let signal = (rim * 0.70 + wake * 0.23) * (1.0 - sweepProgress);
    return vec4f(mix(surface, vec3f(0.52, 0.98, 0.73), signal), landAndSea.a);
  `,
});

export default function AtlasShader({ target }: { target?: WorldMapNode }) {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [sweep, setSweep] = useState(1);

  useEffect(() => {
    if (!target) return;
    const start = performance.now();
    let frame: number;
    function advance(time: number) {
      const progress = Math.max(0, Math.min(1, (time - start) / 850));
      setSweep(progress);
      if (progress < 1) frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  if (unavailable) return null;
  return (
    <Shader className="atlas-shader" data-ready={ready} aria-hidden="true" disableTelemetry
      onReady={() => setReady(true)} onUnavailable={() => setUnavailable(true)}>
      <CustomShader src={survey}
        scanCenter={target ? { x: target.x / 100, y: target.y / 100 } : undefined}
        sweepProgress={target ? sweep : 1}>
        <ImageTexture url={atlas} objectFit="fill" />
      </CustomShader>
    </Shader>
  );
}
