import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber';
import { Environment, Float, Lightformer, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';

/**
 * The landing hero centrepiece (Doc 1 section 2.3).
 *
 * A low-poly blood drop in a glass-like transmission material, rotating slowly
 * and leaning towards the pointer. Doc 1 is explicit that this must not be
 * "spinning for spinning's sake" -- the rotation is slow enough to read as
 * ambient, and the parallax makes it feel responsive rather than decorative.
 *
 * This module is the ONLY place three.js is imported, and it is loaded through
 * React.lazy so the ~400kb 3D chunk can never block the landing page's first
 * paint. Callers must check useCanRender3D() before mounting it.
 */

/**
 * A teardrop built as a lathe: a profile curve revolved around Y.
 *
 * The profile is the standard teardrop curve, swept from the top pole to the
 * bottom pole:
 *
 *   y = cos(theta)
 *   r = sin(theta) * sin(theta / 2) ^ POINT
 *
 * Each factor does one job. `sin(theta)` alone is a sphere. Multiplying by
 * `sin(theta / 2) ^ POINT` leaves the bottom pole untouched (that factor tends
 * to 1 there, so the base stays a round hemisphere) while driving the radius to
 * zero as theta ^ (1 + POINT) at the top, which is the cusp.
 *
 * Getting this wrong inverts the drop. A profile of `sin(t ^ k * PI)` returns
 * to zero at BOTH ends, so the base comes to a second point, and for k < 1 the
 * widest ring sits above centre -- the silhouette then reads as a map pin
 * rather than a drop. The widest ring belongs below centre.
 */
function useDropGeometry() {
  return useMemo(() => {
    const points: THREE.Vector2[] = [];
    const SEGMENTS = 40; // The cusp needs the resolution; the base does not care.
    const HEIGHT = 1.35;
    const RADIUS = 1.2;
    const POINT = 0.8; // Higher is a sharper, longer-drawn tip.

    for (let i = 0; i <= SEGMENTS; i += 1) {
      const theta = (i / SEGMENTS) * Math.PI; // 0 at the tip, PI at the base
      const y = Math.cos(theta) * HEIGHT;
      const r = Math.sin(theta) * Math.pow(Math.sin(theta / 2), POINT) * RADIUS;
      points.push(new THREE.Vector2(Math.max(r, 0.001), y));
    }
    return new THREE.LatheGeometry(points, 64);
  }, []);
}

function Drop(props: ThreeElements['mesh']) {
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useDropGeometry();

  useFrame((state, delta) => {
    if (!mesh.current) return;
    // Constant auto-rotation.
    mesh.current.rotation.y += delta * 0.55;
    // Gentle parallax: lean toward the pointer, eased so it never snaps.
    const { x, y } = state.pointer;
    mesh.current.rotation.z = THREE.MathUtils.lerp(mesh.current.rotation.z, -x * 0.22, 0.09);
    mesh.current.rotation.x = THREE.MathUtils.lerp(mesh.current.rotation.x, y * 0.18, 0.09);
  });

  return (
    <mesh ref={mesh} geometry={geometry} castShadow {...props}>
      {/* Thick, doubly-refracted and strongly absorbing on purpose. Thinning
          the volume or dropping `backside` lets the environment's light panels
          show through the glass as flat grey quads; the deep read with a bright
          crimson rim is the intended look. */}
      <MeshTransmissionMaterial
        /* Transmission renders the scene to an offscreen buffer once per
           sample. The defaults (10 samples at 2048) are film settings; at hero
           size behind a scrim the difference is invisible and the setup cost
           is not. */
        samples={4}
        resolution={256}
        thickness={1.1}
        roughness={0.08}
        transmission={1}
        ior={1.42}
        chromaticAberration={0.06}
        anisotropy={0.25}
        distortion={0.25}
        distortionScale={0.4}
        temporalDistortion={0.1}
        color="#E63946"
        attenuationColor="#800020"
        attenuationDistance={1.6}
        backside
      />
    </mesh>
  );
}

/** Orbiting cells, so the drop is not alone in the frame. */
function Cells() {
  const group = useRef<THREE.Group>(null);

  const cells = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const angle = (i / 7) * Math.PI * 2;
        const radius = 2.2 + (i % 3) * 0.42;
        return {
          key: i,
          position: [
            Math.cos(angle) * radius,
            Math.sin(angle * 1.7) * 0.9,
            Math.sin(angle) * radius,
          ] as [number, number, number],
          scale: 0.1 + (i % 4) * 0.035,
        };
      }),
    []
  );

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y -= delta * 0.2;
  });

  return (
    <group ref={group}>
      {cells.map((c) => (
        <Float key={c.key} speed={2} rotationIntensity={0.6} floatIntensity={1}>
          <mesh position={c.position} scale={c.scale}>
            <icosahedronGeometry args={[1, 1]} />
            <meshStandardMaterial
              color="#D90429"
              roughness={0.35}
              metalness={0.1}
              emissive="#800020"
              emissiveIntensity={0.35}
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

/**
 * The environment map the transmission material refracts.
 *
 * Built from Lightformers rendered into a cube target rather than drei's
 * `preset="city"`. A preset fetches an HDR from a CDN (raw.githack.com), which
 * the app's `connect-src 'self'` CSP blocks -- the loader then throws past
 * drei's own error boundary and takes the whole landing route down with it.
 * Generating the map in-scene keeps the glass reading as glass with no network
 * request and no CSP exception.
 *
 * `frames={1}` renders it once: nothing in here moves, so re-rendering the cube
 * every frame would be pure cost on a decorative element.
 */
function StudioEnvironment() {
  return (
    <Environment resolution={128} frames={1}>
      {/* An enclosing box of dim light. A preset HDR lights from every
          direction at once; three lightformers alone cover a narrow solid
          angle and leave a transmission material reading as a black blob.
          This is the ambient floor everything else sits on top of. The
          material is DoubleSide, so the cube camera inside sees it lit. */}
      <Lightformer form="box" intensity={0.85} color="#5b79a7" scale={[40, 40, 40]} position={[0, 0, 0]} />
      {/* Key: the broad highlight that gives the drop its wet edge. */}
      <Lightformer form="rect" intensity={10} color="#ffffff" scale={[10, 7, 1]} position={[5, 6, 5]} target={[0, 0, 0]} />
      {/* Fill from below in the brand red, so the refraction picks up colour. */}
      <Lightformer form="circle" intensity={6} color="#E63946" scale={[8, 8, 1]} position={[-6, -4, -3]} target={[0, 0, 0]} />
      {/* Rim behind, deep red, to separate the silhouette from the backdrop. */}
      <Lightformer form="rect" intensity={3.5} color="#C1121F" scale={[9, 4, 1]} position={[0, 1, -7]} target={[0, 0, 0]} />
      {/* A second, cooler key opposite the first, so rotation never swings the
          drop through a dead unlit quarter. */}
      <Lightformer form="rect" intensity={3} color="#cfe0ff" scale={[8, 6, 1]} position={[-5, 3, 5]} target={[0, 0, 0]} />
    </Environment>
  );
}

export default function BloodDropScene() {
  return (
    <Canvas
      // Capped device pixel ratio: a retina display would otherwise render 4x
      // the pixels for a decorative element.
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6.2], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 5]} intensity={2.1} color="#ffffff" />
        <directionalLight position={[-5, -2, -4]} intensity={1.2} color="#E63946" />
        <pointLight position={[0, -3, 2]} intensity={2.4} color="#800020" />

        <Float speed={2.2} rotationIntensity={0.28} floatIntensity={0.75}>
          <Drop scale={1.05} position={[0, 0.15, 0]} />
        </Float>
        <Cells />

        <StudioEnvironment />
      </Suspense>
    </Canvas>
  );
}
