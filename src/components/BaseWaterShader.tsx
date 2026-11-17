import { useEffect, useRef, useState } from "react";
import { CustomShader, ImageTexture, Shader } from "shaders/react";
import { defineShader, wgsl } from "shaders/std";
import stream from "../../assets/observatory-stream.webp";
import banks from "../../assets/observatory-stream-mask.png";

// The PNG rasterizes the stream mask so WebGPU can decode it as an image texture.
// Both textures follow the same crop from the settlement painting.
const river = { x: 1360 / 1672, y: 95 / 941, width: 312 / 1672, height: 398 / 941 };
// Shaders interprets bare bounding-box numbers as pixels. The painted crop uses canvas fractions.
const riverBounds = {
  x: { unit: "uv", value: river.x },
  y: { unit: "uv", value: river.y },
  width: { unit: "uv", value: river.width },
  height: { unit: "uv", value: river.height },
} as const;

const current = defineShader({
  name: "ObservatoryCurrent",
  animatedTime: { speed: "speed" },
  props: { speed: { default: 1 } },
  effect: wgsl`
    let origin = vec2f(${river.x}, ${river.y});
    let size = vec2f(${river.width}, ${river.height});
    let local = (uv - origin) / size;
    // The upstream pools run down the screen. Below the bridge the channel bends right.
    let bend = smoothstep(0.47, 0.70, local.y);
    let downstream = normalize(vec2f(mix(-0.12, 0.72, bend), 1.0));
    let across = vec2f(downstream.y, -downstream.x);
    let along = dot(local, downstream);
    let cross = dot(local, across);

    // Let the painted texture move on the steeper faces of the three falls.
    let falls = max(
      smoothstep(0.12, 0.15, local.y) * (1.0 - smoothstep(0.202, 0.224, local.y)),
      max(
        smoothstep(0.263, 0.284, local.y) * (1.0 - smoothstep(0.35, 0.374, local.y)),
        smoothstep(0.589, 0.614, local.y) * (1.0 - smoothstep(0.667, 0.692, local.y)) *
          (1.0 - smoothstep(0.76, 0.85, local.x))
      )
    );
    let phase = along * 181.0 - time * mix(5.1, 10.4, falls);
    let ripple = sin(phase + sin(cross * 36.0 + along * 12.0) * 2.0);
    let smallRipple = sin(along * 289.0 - time * 7.3 + sin(cross * 72.0) * 2.3);
    let offset = downstream * (ripple * 0.005 + smallRipple * 0.002) * (1.0 + 0.55 * falls)
      + across * (sin(phase * 0.57 + cross * 22.0) * 0.003);
    let water = textureSample(childTexture, childSampler, origin + size * clamp(local + offset, vec2f(0.002), vec2f(0.998)));

    // Reflections and foam drift with the same current and keep the palette of the source.
    let light = dot(water.rgb, vec3f(0.2126, 0.7152, 0.0722));
    let crest = smoothstep(0.30, 0.98, ripple) * (0.38 + 0.62 * smoothstep(-0.55, 0.65, smallRipple));
    let lift = crest * mix(0.065, 0.17, falls) * smoothstep(0.03, 0.40, light);
    let shaded = water.rgb * (1.0 - (1.0 - crest) * mix(0.10, 0.21, falls));
    return vec4f(mix(shaded, vec3f(0.87, 0.91, 0.83), lift), water.a);
  `,
});

const sunlight = defineShader({
  name: "SettlementSunlight",
  animatedTime: { speed: "speed" },
  props: { speed: { default: 0.28 }, turnSweep: { default: 1 } },
  paint: wgsl`
    let breeze = 0.025 * sin(time * 1.1 + uv.y * 6.0);
    let ray = uv.x + uv.y * 0.59 + breeze;
    let broad = (ray - 0.68) * 10.0;
    let narrow = (ray - 0.94) * 18.0;
    let canopy = exp(-broad * broad) * 0.6 + exp(-narrow * narrow) * 0.4;
    let clearings = exp(-length((uv - vec2f(0.51, 0.36)) * vec2f(2.3, 2.7)) * 1.3);
    let shade = 0.76 + 0.24 * sin(uv.x * 21.0 - uv.y * 14.0 + time);
    let shafts = canopy * clearings * shade * (1.0 - smoothstep(0.45, 0.77, uv.y));

    // The settlement rolls into the next turn with a light front across the roofs and ground.
    let travel = uv.x + uv.y * 0.31 - mix(1.38, -0.16, turnSweep);
    let front = exp(-travel * travel * 57.0);
    let envelope = smoothstep(0.0, 0.2, turnSweep) * (1.0 - smoothstep(0.6, 1.0, turnSweep));
    let dawn = front * envelope * (0.11 + shafts * 0.45);

    let air = uv * vec2f(64.0, 35.0) + vec2f(time * 0.49, -time * 0.23);
    let pocket = floor(air);
    let seed = fract(sin(dot(pocket, vec2f(11.17, 49.68))) * 31714.86);
    let motePosition = vec2f(seed * 0.78 + 0.11, fract(seed * 17.1) * 0.78 + 0.11);
    let mote = (1.0 - smoothstep(0.025, 0.10, length(fract(air) - motePosition))) * step(0.94, seed);
    return vec4f(1.0, 0.86, 0.57, shafts * 0.25 + dawn + mote * shafts * 0.48);
  `,
});

export default function BaseWaterShader({ turn }: { turn: number }) {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [sweep, setSweep] = useState(1);
  const previousTurn = useRef(turn);

  useEffect(() => {
    if (previousTurn.current === turn) return;
    previousTurn.current = turn;
    const start = performance.now();
    let frame: number;
    function paint(now: number) {
      const progress = Math.min(1, (now - start) / 790);
      setSweep(progress);
      if (progress < 1) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [turn]);

  if (unavailable) return null;
  return (
    <Shader
      className="base-water-shader"
      data-ready={ready}
      disableTelemetry
      onReady={() => setReady(true)}
      onUnavailable={() => setUnavailable(true)}
    >
      <ImageTexture id="settlement-riverbanks" url={banks} objectFit="fill" boundingBox={riverBounds} visible={false} />
      <CustomShader src={current} maskSource="settlement-riverbanks" opacity={.94}>
        <ImageTexture url={stream} objectFit="fill" boundingBox={riverBounds} />
      </CustomShader>
      <CustomShader src={sunlight} turnSweep={sweep} />
    </Shader>
  );
}
