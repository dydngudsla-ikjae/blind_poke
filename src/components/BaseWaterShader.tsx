import { useState } from "react";
import { CustomShader, ImageTexture, Shader } from "shaders/react";
import { defineShader, wgsl } from "shaders/std";
import stream from "../../assets/observatory-stream.webp";

const current = defineShader({
  name: "ObservatoryCurrent",
  animatedTime: { speed: "speed" },
  props: { speed: { default: 1 } },
  effect: wgsl`
    // The upstream pools run down the screen. Below the bridge the channel bends right.
    let bend = smoothstep(0.47, 0.70, uv.y);
    let downstream = normalize(vec2f(mix(-0.12, 0.72, bend), 1.0));
    let across = vec2f(downstream.y, -downstream.x);
    let along = dot(uv, downstream);
    let cross = dot(uv, across);

    // Let the painted texture move on the steeper faces of the three falls.
    let falls = max(
      smoothstep(0.12, 0.15, uv.y) * (1.0 - smoothstep(0.202, 0.224, uv.y)),
      max(
        smoothstep(0.263, 0.284, uv.y) * (1.0 - smoothstep(0.35, 0.374, uv.y)),
        smoothstep(0.589, 0.614, uv.y) * (1.0 - smoothstep(0.667, 0.692, uv.y)) *
          (1.0 - smoothstep(0.76, 0.85, uv.x))
      )
    );
    let phase = along * 181.0 - time * mix(5.1, 10.4, falls);
    let ripple = sin(phase + sin(cross * 36.0 + along * 12.0) * 2.0);
    let smallRipple = sin(along * 289.0 - time * 7.3 + sin(cross * 72.0) * 2.3);
    let offset = downstream * (ripple * 0.005 + smallRipple * 0.002) * (1.0 + 0.55 * falls)
      + across * (sin(phase * 0.57 + cross * 22.0) * 0.003);
    let water = textureSample(childTexture, childSampler, clamp(uv + offset, vec2f(0.002), vec2f(0.998)));

    // Reflections and foam drift with the same current and keep the palette of the source.
    let light = dot(water.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let crest = smoothstep(0.30, 0.98, ripple) * (0.38 + 0.62 * smoothstep(-0.55, 0.65, smallRipple));
    let lift = crest * mix(0.065, 0.17, falls) * smoothstep(0.03, 0.40, light);
    let shaded = water.rgb * (1.0 - (1.0 - crest) * mix(0.10, 0.21, falls));
    return vec4f(mix(shaded, vec3f(0.87, 0.91, 0.83), lift), water.a);
  `,
});

export default function BaseWaterShader() {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable) return null;
  return (
    <Shader
      className="base-water-shader"
      data-ready={ready}
      disableTelemetry
      onReady={() => setReady(true)}
      onUnavailable={() => setUnavailable(true)}
    >
      <CustomShader src={current}>
        <ImageTexture url={stream} objectFit="fill" />
      </CustomShader>
    </Shader>
  );
}
