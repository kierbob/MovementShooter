// Pooled cartoon particles: chunky low-poly puffs and cubes. Fire/sparks are unlit (bright),
// smoke/debris use toon shading so they read as solid cartoon blobs.
import * as THREE from 'three';

const GEO = {
  puff: new THREE.IcosahedronGeometry(1, 0),
  cube: new THREE.BoxGeometry(1, 1, 1),
};

let gradient;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const tmpColor = new THREE.Color();

export class Particles {
  constructor(scene, perKind = 160) {
    this.live = [];
    this.free = { basic: [], toon: [] };
    for (const kind of ['basic', 'toon']) {
      for (let i = 0; i < perKind; i++) {
        const mat = kind === 'basic'
          ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
          : new THREE.MeshToonMaterial({ transparent: true, gradientMap: toonGradient() });
        const mesh = new THREE.Mesh(GEO.puff, mat);
        mesh.visible = false;
        mesh.userData.kind = kind;
        scene.add(mesh);
        this.free[kind].push(mesh);
      }
    }
  }

  // o: { pos, vel?, gravity?, drag?, life, delay?, size: [from, to], color, color2?,
  //      opacity?: [from, to], fadeStart? (0..1 of life), lit?, geo?: 'puff'|'cube', spin? }
  spawn(o) {
    const kind = o.lit ? 'toon' : 'basic';
    let mesh = this.free[kind].pop();
    if (!mesh) {
      // Pool exhausted: recycle the oldest live particle of this kind.
      const i = this.live.findIndex((p) => p.mesh.userData.kind === kind);
      if (i < 0) return;
      mesh = this.live.splice(i, 1)[0].mesh;
    }
    mesh.geometry = GEO[o.geo ?? 'puff'];
    mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    mesh.visible = !(o.delay > 0);
    this.live.push({
      mesh, age: 0, delay: o.delay ?? 0, life: o.life,
      vel: o.vel ? { ...o.vel } : { x: 0, y: 0, z: 0 },
      gravity: o.gravity ?? 0, drag: o.drag ?? 0,
      size: o.size, color: new THREE.Color(o.color), color2: o.color2 != null ? new THREE.Color(o.color2) : null,
      opacity: o.opacity ?? [1, 0], fadeStart: o.fadeStart ?? 0,
      spin: o.spin ?? 0,
    });
  }

  update(dt) {
    this.live = this.live.filter((p) => {
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) return true;
        p.mesh.visible = true;
      }
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.mesh.visible = false;
        this.free[p.mesh.userData.kind].push(p.mesh);
        return false;
      }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vel.x *= damp; p.vel.z *= damp;
      p.vel.y = p.vel.y * damp - p.gravity * dt;
      const m = p.mesh;
      m.position.x += p.vel.x * dt;
      m.position.y += p.vel.y * dt;
      m.position.z += p.vel.z * dt;
      if (p.spin) { m.rotation.x += p.spin * dt; m.rotation.y += p.spin * 0.7 * dt; }
      // Ease-out growth reads as a cartoon "poof".
      const g = 1 - (1 - t) * (1 - t);
      m.scale.setScalar(p.size[0] + (p.size[1] - p.size[0]) * g);
      if (p.color2) m.material.color.copy(tmpColor.copy(p.color).lerp(p.color2, t));
      else m.material.color.copy(p.color);
      const ft = t <= p.fadeStart ? 0 : (t - p.fadeStart) / (1 - p.fadeStart);
      m.material.opacity = p.opacity[0] + (p.opacity[1] - p.opacity[0]) * ft;
      return true;
    });
  }
}
