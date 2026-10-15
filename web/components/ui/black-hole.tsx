"use client";

import { cn } from "@/lib/utils";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type BlackHoleHandle = {
  /** Adds angular velocity in radians per second. Positive spins clockwise, negative reverses. */
  kick: (amount: number) => void;
};

const BASE_SPEED = 0.32;
const MAX_SPEED = 2.4;
const SETTLE_PER_SECOND = 0.85;
const DPR_CAP = 1.5;

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uResolution;
uniform float uRotation;
uniform float uEnergy;
uniform float uTime;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

vec3 starTint(float temp) {
  vec3 violet = vec3(0.64, 0.68, 1.0);
  vec3 white = vec3(0.96, 0.96, 1.0);
  vec3 ice = vec3(0.74, 0.84, 1.0);
  vec3 warm = vec3(1.0, 0.84, 0.68);
  if (temp < 0.28) return mix(violet, white, temp / 0.28);
  if (temp < 0.72) return mix(white, ice, (temp - 0.28) / 0.44);
  return mix(white, warm, (temp - 0.72) / 0.28);
}

vec3 starLayer(vec2 frag, vec2 drift, float scale, float cutoff, float textured) {
  vec2 p = (frag + drift) / scale;
  vec2 id = floor(p);
  float alive = step(cutoff, hash(id));
  vec2 jitter = mix(vec2(0.34), vec2(0.66), vec2(hash(id + 1.7), hash(id + 8.2)));
  vec2 gv = fract(p) - jitter;
  float d = length(gv);
  float mag = hash(id + 3.4);
  float tight = mix(90.0, 340.0, mag);
  float core = exp(-d * d * tight);
  float halo = exp(-d * mix(4.8, 10.5, mag));
  float grain = textured > 0.5 ? fbm(gv * 5.2 + id * 0.17) : noise(gv * 3.0 + id);
  halo *= 0.35 + grain * 1.05;
  float spikeReach = mix(22.0, 64.0, mag);
  float spikes = exp(-abs(gv.x) * spikeReach) * exp(-gv.y * gv.y * 16.0);
  spikes += exp(-abs(gv.y) * spikeReach) * exp(-gv.x * gv.x * 16.0);
  spikes *= smoothstep(0.58, 0.94, mag);
  float twinkle = 0.84 + 0.16 * sin(uTime * (0.35 + hash(id + 2.2) * 1.4) + hash(id) * 28.0);
  float energy = alive * twinkle * (core * 0.85 + halo * 0.38 + spikes * 0.32) * mix(0.32, 0.72, mag);
  energy *= smoothstep(0.78, 0.08, d);
  return starTint(hash(id + 5.8)) * energy;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  float radius = max(uResolution.x, uResolution.y) * 0.62;
  vec2 center = vec2(uResolution.x * 0.5, uResolution.y * 0.36 + radius);
  vec2 q = frag - center;
  float d = (length(q) - radius) / radius;
  float angle = atan(q.y, q.x);

  // Inner streaks orbit faster than outer ones, so the bands shear instead of sitting still.
  float orbit = uRotation * (1.6 + 2.2 / (0.34 + abs(d) * 5.0));
  vec2 flow = vec2(angle * 2.6 - orbit, d * 34.0 - orbit * 0.08);
  float streaks = fbm(flow) * 0.62 + fbm(flow * 2.15 + vec2(orbit * 0.35, 3.0)) * 0.38;
  float bands = 0.42 + streaks * 1.15;

  vec3 lavender = vec3(0.72, 0.71, 1.0);
  vec3 violet = vec3(0.30, 0.24, 0.98);
  vec3 color = vec3(0.006, 0.006, 0.016);

  float cover = 1.0 - smoothstep(-0.06, -0.022, d);
  color = mix(color, violet * bands, (1.0 - smoothstep(-0.5, -0.04, d)) * cover);
  color = mix(color, lavender * min(bands, 1.25), smoothstep(-0.18, -0.055, d) * cover);

  // A thin white ring, held a little off the disk, with a faint bridge so they still touch.
  float ring = exp(-pow((d - 0.016) * 150.0, 2.0));
  float bridge = exp(-pow((d + 0.004) * 22.0, 2.0));
  float beads = 0.0;
  for (int i = 0; i < 3; i++) {
    float a = uRotation * 3.2 + float(i) * 2.0944;
    float along = abs(mod(angle - a + 3.14159, 6.28318) - 3.14159);
    beads += exp(-along * along * (22.0 - uEnergy * 14.0));
  }
  color += lavender * bridge * 0.16;
  color += vec3(0.92, 0.93, 1.0) * ring * (1.15 + beads * (0.7 + uEnergy * 1.4));
  color += lavender * exp(-max(d - 0.03, 0.0) * 18.0) * (0.16 + uEnergy * 0.2);
  color *= mix(1.0, 0.08, smoothstep(-0.12, -0.72, d));
  color *= 1.0 + uEnergy * 0.2;

  vec2 drift = vec2(uRotation * 18.0, uRotation * 5.0);
  float sky = smoothstep(-0.02, 0.1, d);
  vec3 stars = starLayer(frag, drift, 72.0, 0.72, 1.0);
  stars += starLayer(frag, drift * 0.45 + 90.0, 30.0, 0.88, 1.0) * 0.75;
  stars += starLayer(frag, drift * 0.2 + 30.0, 12.0, 0.968, 0.0) * 0.45;
  color += stars * sky;
  color += (hash(frag + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export const BlackHole = forwardRef<BlackHoleHandle, { className?: string }>(function BlackHole({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const velocity = useRef(BASE_SPEED);
  const reduced = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      kick: (amount: number) => {
        if (reduced.current || amount === 0) return;
        const spinning = amount > 0 ? Math.max(velocity.current, 0) : Math.min(velocity.current, 0);
        velocity.current = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, spinning + amount));
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fallback = () => {
      canvas.style.background = "#020205 url(/black-hole.jpg) center / cover no-repeat";
    };
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return fallback();

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return fallback();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fallback();
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uRotation = gl.getUniformLocation(program, "uRotation");
    const uEnergy = gl.getUniformLocation(program, "uEnergy");
    const uTime = gl.getUniformLocation(program, "uTime");

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = motion.matches;

    let rotation = 0;
    let last = performance.now();
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      velocity.current += (BASE_SPEED - velocity.current) * (1 - Math.exp(-dt * SETTLE_PER_SECOND));
      rotation += velocity.current * dt;
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uRotation, rotation);
      gl.uniform1f(uEnergy, Math.min(1, Math.abs(velocity.current - BASE_SPEED) / 4));
      gl.uniform1f(uTime, now / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(() => {
      resize();
      if (reduced.current) draw(performance.now());
    });
    observer.observe(canvas);
    resize();
    if (reduced.current) draw(performance.now());
    else frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="A glowing black hole horizon"
      className={cn("block h-full w-full", className)}
    />
  );
});
