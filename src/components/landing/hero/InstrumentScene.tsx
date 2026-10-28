"use client";

// The hero's 3D centrepiece: an armillary of machined rings around a smoked
// glass ₹ core. Idle, the rings drift out of true; scrolling through the hero
// brings them into alignment (the page's metaphor for financial clarity).
// Everything is procedural: no models, textures or fonts are downloaded.

import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

export interface SceneInput {
  /** 0 at the top of the hero, 1 once it has been scrolled through. */
  progress: number;
  /** Pointer position, -1..1 on both axes (0 when there's no fine pointer). */
  px: number;
  py: number;
}

export interface InstrumentSceneProps {
  input: RefObject<SceneInput>;
  quality: "high" | "low";
  /** Reduced motion: a single still pose, rendered on demand. */
  still: boolean;
  /** False while the hero is off screen (stops the render loop). */
  active: boolean;
  onReady: () => void;
  onLost: () => void;
}

const STEEL = "#c9ccd1";
const BRASS = "#c9a46b";
const GUNMETAL = "#34373d";
const PAPER = "#ece6da";
const MINT = "#8fd9bf";

type RingSpec = {
  radius: number;
  /** Tube radius for a round ring, or band depth for a flat bezel. */
  tube: number;
  flat?: boolean;
  metal: "steel" | "brass" | "gunmetal";
  ticks: number;
  /** Euler offset (x, y) when fully out of alignment. */
  off: [number, number];
  spin: number;
};

const RINGS: RingSpec[] = [
  { radius: 2.05, tube: 0.03, metal: "steel", ticks: 120, off: [1.05, 0.42], spin: 0.045 },
  { radius: 1.72, tube: 0.052, metal: "brass", ticks: 0, off: [-0.48, 1.08], spin: -0.07 },
  { radius: 1.36, tube: 0.15, flat: true, metal: "gunmetal", ticks: 60, off: [0.36, -0.86], spin: 0.11 },
];

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const smoothstep = (t: number) => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** Circumferential brushing: streaks that vary across the tube, not along it. */
function useBrushedTexture() {
  const tex = useMemo(() => {
    const h = 128;
    const data = new Uint8Array(h * 4);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < h; i++) {
      const v = Math.round(150 + rand() * 105);
      data.set([v, v, v, 255], i * 4);
    }
    const t = new THREE.DataTexture(data, 1, h);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 3);
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function Ticks({ radius, count, color }: { radius: number; count: number; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const major = i % (count / 12) === 0;
      const len = major ? 0.16 : 0.06;
      const r = radius - 0.09 - len / 2;
      m.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.012);
      m.rotation.set(0, 0, a);
      m.scale.set(len, major ? 0.014 : 0.008, 0.012);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [radius, count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <boxGeometry />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.45} />
    </instancedMesh>
  );
}

/** The rupee sign, built from bars and an arc (extruded type would need a font file). */
function RupeeGlyph({ material }: { material: THREE.Material }) {
  const s = 0.055; // stroke
  const d = 0.05; // depth
  return (
    <group scale={0.92}>
      <mesh material={material} position={[0.03, 0.42, 0]}>
        <boxGeometry args={[0.66, s, d]} />
      </mesh>
      <mesh material={material} position={[0.03, 0.25, 0]}>
        <boxGeometry args={[0.66, s, d]} />
      </mesh>
      {/* Bowl: right half of a ring joining the top bar to the waist. */}
      <mesh material={material} position={[0.08, 0.25, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <torusGeometry args={[0.17, s / 2, 10, 32, Math.PI]} />
      </mesh>
      <mesh material={material} position={[-0.11, 0.08, 0]}>
        <boxGeometry args={[0.38, s, d]} />
      </mesh>
      {/* Leg */}
      <mesh material={material} position={[0.03, -0.24, 0]} rotation={[0, 0, -Math.atan2(0.64, 0.5)]}>
        <boxGeometry args={[0.81, s, d]} />
      </mesh>
    </group>
  );
}

function Armillary({ input, quality, still, onReady }: Omit<InstrumentSceneProps, "active" | "onLost">) {
  const group = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Group | null)[]>([]);
  const needle = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const brushed = useBrushedTexture();
  const { viewport, camera, invalidate } = useThree();
  const started = useRef<number | null>(null);
  const k = useRef(still ? 0.35 : 0); // damped alignment
  const tilt = useRef({ x: 0, y: 0 });
  const readyFired = useRef(false);

  const mats = useMemo(() => {
    const metal = (color: string, roughness: number, map = true) =>
      new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, roughnessMap: map ? brushed : null, envMapIntensity: 1.1 });
    const glass =
      quality === "high"
        ? new THREE.MeshPhysicalMaterial({
            color: "#9aa0ab",
            metalness: 0,
            roughness: 0.14,
            transmission: 1,
            thickness: 0.45,
            ior: 1.45,
            attenuationColor: new THREE.Color("#2b2e35"),
            attenuationDistance: 0.9,
            clearcoat: 1,
            clearcoatRoughness: 0.1,
          })
        : new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.72 });
    return {
      steel: metal(STEEL, 0.5),
      brass: metal(BRASS, 0.42),
      gunmetal: metal(GUNMETAL, 0.55),
      glass,
      glyph: new THREE.MeshStandardMaterial({ color: BRASS, metalness: 1, roughness: 0.28, emissive: "#3a2a12", emissiveIntensity: 0.6 }),
      needle: new THREE.MeshStandardMaterial({ color: MINT, emissive: MINT, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.4 }),
    };
  }, [brushed, quality]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // Wide screens: the instrument sits to the right of the headline, then
  // drifts to centre as it aligns. Narrow screens: centred, above the copy.
  const wide = viewport.aspect > 1.15;

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (started.current === null) started.current = t;
    const e = still ? 1 : ease((t - started.current - 0.15) / 2.2);
    const inp = input.current ?? { progress: 0, px: 0, py: 0 };

    const target = still ? 0.35 : smoothstep(inp.progress * 1.15);
    k.current = still ? target : THREE.MathUtils.damp(k.current, target, 5, dt);
    const mis = 1 - k.current;

    tilt.current.x = THREE.MathUtils.damp(tilt.current.x, inp.py * 0.22, 3, dt);
    tilt.current.y = THREE.MathUtils.damp(tilt.current.y, inp.px * 0.32, 3, dt);

    const g = group.current;
    if (g) {
      const baseX = wide ? Math.min(viewport.width * 0.24, 2.8) : 0;
      const baseY = wide ? 0 : 0.95;
      g.position.x = baseX * (1 - k.current * 0.85);
      g.position.y = baseY * (1 - k.current) + (1 - e) * -0.35 + (still ? 0 : Math.sin(t * 0.6) * 0.04);
      g.rotation.x = -0.18 + tilt.current.x + 0.18 * k.current;
      g.rotation.y = tilt.current.y * mis + (wide ? -0.22 : 0) * mis;
      const sc = (wide ? 0.84 : 0.74) * (0.86 + 0.14 * e) * (1 + 0.04 * k.current);
      g.scale.setScalar(sc);
    }

    RINGS.forEach((r, i) => {
      const ring = rings.current[i];
      if (!ring) return;
      const wob = still ? 0 : Math.sin(t * 0.32 + i * 1.7) * 0.07;
      ring.rotation.x = (r.off[0] + wob) * mis + (1 - e) * 0.6;
      ring.rotation.y = (r.off[1] - wob) * mis;
      if (!still) ring.rotation.z += dt * r.spin * (1 - 0.85 * k.current);
    });

    if (needle.current) {
      const swing = still ? 0.5 : Math.sin(t * 0.45) * 0.55 + 0.7;
      needle.current.rotation.z = THREE.MathUtils.damp(needle.current.rotation.z, -swing * mis, 6, dt);
    }
    if (core.current && !still) core.current.rotation.y = Math.sin(t * 0.4) * 0.28 * mis;

    camera.position.z = 9.6 - 0.7 * k.current;
    camera.lookAt(0, 0, 0);

    if (!readyFired.current) {
      readyFired.current = true;
      requestAnimationFrame(onReady);
    }
  });

  // Still mode renders on demand: draw once more after the first layout.
  useEffect(() => {
    if (still) invalidate();
  }, [still, invalidate, wide]);

  return (
    <group ref={group}>
      {RINGS.map((r, i) => (
        <group key={i} ref={(el) => void (rings.current[i] = el)}>
          {r.flat ? (
            <mesh material={mats[r.metal]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[r.radius, r.radius, r.tube, quality === "high" ? 128 : 72, 1, true]} />
            </mesh>
          ) : (
            <mesh material={mats[r.metal]}>
              <torusGeometry args={[r.radius, r.tube, quality === "high" ? 24 : 14, quality === "high" ? 200 : 110]} />
            </mesh>
          )}
          {r.ticks > 0 && <Ticks radius={r.flat ? r.radius + 0.06 : r.radius} count={r.ticks} color={r.metal === "gunmetal" ? BRASS : PAPER} />}
        </group>
      ))}

      <group ref={core}>
        <mesh material={mats.glass} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.8, 0.8, 0.16, quality === "high" ? 96 : 56]} />
        </mesh>
        <mesh material={mats.brass}>
          <torusGeometry args={[0.8, 0.022, 12, 96]} />
        </mesh>
        {/* Set into the front face of the glass, so it reads through the tint. */}
        <group position={[0, 0.02, 0.07]}>
          <RupeeGlyph material={mats.glyph} />
        </group>
      </group>

      {/* Index needle: swings while things are out of true, settles at twelve. */}
      <group ref={needle}>
        <mesh material={mats.needle} position={[0, 1.42, 0.1]}>
          <boxGeometry args={[0.022, 0.62, 0.022]} />
        </mesh>
        <mesh material={mats.needle} position={[0, 1.78, 0.1]}>
          <sphereGeometry args={[0.04, 16, 16]} />
        </mesh>
      </group>
    </group>
  );
}

export default function InstrumentScene({ input, quality, still, active, onReady, onLost }: InstrumentSceneProps) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={quality === "high" ? [1, 1.75] : [1, 1.25]}
      camera={{ position: [0, 0.1, 9.6], fov: 30, near: 0.1, far: 50 }}
      gl={{ antialias: quality === "high", alpha: true, powerPreference: "high-performance" }}
      frameloop={!active ? "never" : still ? "demand" : "always"}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onLost();
        });
      }}
      aria-hidden
    >
      {/* A small studio of light panels; rendered once into the environment map. */}
      <Environment resolution={quality === "high" ? 256 : 128} frames={1}>
        <Lightformer intensity={2.2} position={[0, 5, -2]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
        <Lightformer intensity={1.4} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[12, 1.2, 1]} color="#f4e6cc" />
        <Lightformer intensity={0.9} position={[5, -1, 1]} rotation-y={-Math.PI / 2} scale={[12, 2, 1]} color="#dfe6ee" />
        <Lightformer form="ring" intensity={2.5} position={[2.5, 2.5, 5]} scale={1.6} color={BRASS} />
        <Lightformer intensity={0.5} position={[0, -4, 2]} rotation-x={-Math.PI / 2} scale={[8, 2, 1]} />
      </Environment>
      <ambientLight intensity={0.12} />
      <directionalLight position={[3, 4, 5]} intensity={0.6} color="#fff4e0" />

      <Armillary input={input} quality={quality} still={still} onReady={onReady} />

      <ContactShadows
        position={[0, -2.7, 0]}
        opacity={0.55}
        scale={11}
        blur={2.6}
        far={5}
        resolution={quality === "high" ? 512 : 256}
        color="#000000"
        frames={still ? 1 : Infinity}
      />
    </Canvas>
  );
}
