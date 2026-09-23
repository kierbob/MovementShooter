// Cartoon outlines. Two flavors:
//  - screenOutline(): thickness in screen pixels (same line weight near and far) — used for the world.
//  - objectOutline(): thickness in object units — used for the first-person guns.
// Both draw an inflated, back-faces-only copy of the mesh in solid ink. The copy must use
// welded smooth normals (smoothShell), otherwise low-poly shapes tear apart at the corners.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const INK = 0x15151f;
const resolution = { value: new THREE.Vector2(window.innerWidth, window.innerHeight) };
window.addEventListener('resize', () => resolution.value.set(window.innerWidth, window.innerHeight));

const shellCache = new WeakMap();
export function smoothShell(geometry) {
  let welded = shellCache.get(geometry);
  if (welded) return welded;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) g.setIndex(geometry.index.clone());
  welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  shellCache.set(geometry, welded);
  return welded;
}

const screenMats = new Map();
export function screenOutline(px = 2.5) {
  if (screenMats.has(px)) return screenMats.get(px);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uThickness: { value: px }, uColor: { value: new THREE.Color(INK) } },
    ]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uThickness;
      uniform vec2 uResolution;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * mvPosition;
        vec3 n = normalize(normalMatrix * normal);
        vec2 dir = normalize((projectionMatrix * vec4(n, 0.0)).xy + vec2(1e-6));
        clip.xy += dir * uThickness * clip.w * 2.0 / uResolution;
        gl_Position = clip;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <fog_fragment>
      }`,
    side: THREE.BackSide,
    fog: true,
  });
  mat.uniforms.uResolution = resolution; // shared, follows window size
  screenMats.set(px, mat);
  return mat;
}

export function objectOutline(thickness) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(5)};`,
    );
  };
  return m;
}

// Give a mesh an outline child that follows it around.
export function addOutline(mesh, material = screenOutline()) {
  const o = new THREE.Mesh(smoothShell(mesh.geometry), material);
  o.renderOrder = -1;
  mesh.add(o);
  return o;
}
