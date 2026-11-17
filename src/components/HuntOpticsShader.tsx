import { useState } from "react";
import { CustomShader, ImageTexture, Shader } from "shaders/react";
import { defineShader, transformPosition, wgsl } from "shaders/std";

const optics = defineShader({
  name: "BrassFieldOptics",
  animatedTime: { speed: "speed" },
  props: {
    center: { default: { x: .5, y: .5 }, transform: transformPosition },
    focus: { default: 0 },
    imageAspect: { default: 16 / 9 },
    imagePositionY: { default: .54 },
    speed: { default: 1 },
  },
  effect: wgsl`
    let proportions = vec2f(max(aspect, 1.0), max(1.0 / aspect, 1.0));
    let p = (uv - center) * proportions;
    let radius = length(p);
    let fog = exp(-dot(p * vec2f(19.0, 26.0), p * vec2f(19.0, 26.0)));
    let air = vec2f(sin(p.y * 84.0 - time * 2.5), cos(p.x * 65.0 + time * 2.0));
    let groundRipple = air * fog * (0.004 * focus);
    let magnification = mix(0.96, 0.91, focus);
    let bent = center + (p * (magnification + 0.58 * radius * radius) + groundRipple) / proportions;

    // Sample the same cover crop as the painted background.
    let crop = vec2f(min(1.0, aspect / imageAspect), min(1.0, imageAspect / aspect));
    let origin = (vec2f(1.0) - crop) * vec2f(0.5, imagePositionY);
    let source = bent * crop + origin;
    let glass = textureSample(childTexture, childSampler, source);
    let ray = max(0.0, 1.0 - abs(p.x + 0.55 * p.y + 0.20) * 12.0);
    let reflection = ray * smoothstep(0.15, 0.35, radius) * 0.036;
    let vignette = 1.0 - smoothstep(0.22, 0.61, radius) * 0.23;
    return vec4f(glass.rgb * vec3f(1.025, 1.005, 0.935) * vignette
      + vec3f(0.9, 0.73, 0.48) * reflection * glass.a, glass.a);
  `,
});

export default function HuntOpticsShader({ image, imageAspect, imagePositionY, center, focus }: {
  image: string;
  imageAspect: number;
  imagePositionY: number;
  center: { x: number; y: number };
  focus: number;
}) {
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return null;

  return (
    <Shader className="hunt-optics-shader" data-ready={ready} disableTelemetry
      onReady={() => setReady(true)} onUnavailable={() => setUnavailable(true)}>
      <CustomShader src={optics} center={center} focus={focus} imageAspect={imageAspect} imagePositionY={imagePositionY}>
        <ImageTexture url={image} objectFit="fill" />
      </CustomShader>
    </Shader>
  );
}
