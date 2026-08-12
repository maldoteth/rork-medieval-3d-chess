import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { flagstoneTexture, marbleTexture, normalFromCanvas, shaftTexture, sparkTexture } from "./textures";
import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import type { QualityPreset } from "./quality";
import { QUALITY_SETTINGS } from "./quality";

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  seed: number;
  base: number;
}

/**
 * Rescales a part's UVs in place, so one course of stone comes out the same
 * size on a ten-metre column as it does on a half-metre moulding.
 *
 * Every three.js primitive hands back UVs running 0–1 across itself, which is
 * why a shared stone map used to stretch to fit whatever it was put on: one
 * whole tile wrapped around a pillar, and the same tile squeezed onto an
 * abacus. Anything that *wraps* (a lathe or a torus around its own axis) must
 * be given a whole number here or the seam will not meet.
 */
function scaleUv(geometry: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Merges a pile of already-positioned parts into one geometry and releases
 * them, so a ring of twelve columns is one draw call rather than forty-eight.
 */
function weldParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) return parts[0];
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * The torch-lit stone hall the board sits in: flagstone floor, pillar ring with
 * arches, high windows with volumetric-feeling shafts, drifting dust, ember
 * particles and four flickering torches against one warm key light.
 *
 * The ring, the wall and the sconces are each *merged* into a single mesh at
 * boot. Nothing moves in the hall, so there was never a reason for a hundred
 * separate objects to be transformed, culled and submitted every frame — and
 * the budget that buys back is what pays for the columns having a real profile
 * (plinth, entasis, necking, capital, keystone) instead of being tubes with
 * boxes on top.
 */
export class CastleHall {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;

  private hemi: THREE.HemisphereLight;
  private fillLight: THREE.DirectionalLight;
  private torches: Torch[] = [];
  private dust: THREE.Points | null = null;
  private embers: THREE.Points | null = null;
  private shafts: THREE.Mesh[] = [];
  /** One per shaft card, so the beams do not all breathe in step. */
  private shaftPhases: number[] = [];
  private emberVelocities: Float32Array = new Float32Array(0);
  private dustPhase: Float32Array = new Float32Array(0);
  private disposables: { dispose: () => void }[] = [];
  private elapsed = 0;

  /** Painted once, cloned per surface — see {@link stoneMap}. */
  private stoneAlbedo: THREE.CanvasTexture | null = null;
  private stoneNormal: THREE.CanvasTexture | null = null;

  /** Materials the arena theme repaints. */
  private floorMaterial: THREE.MeshStandardMaterial | null = null;
  private daisMaterial: THREE.MeshStandardMaterial | null = null;
  private pillarMaterial: THREE.MeshStandardMaterial | null = null;
  private wallMaterial: THREE.MeshStandardMaterial | null = null;
  private rubbleMaterial: THREE.MeshStandardMaterial | null = null;
  private windowMaterial: THREE.MeshBasicMaterial | null = null;
  private flameMaterials: THREE.MeshBasicMaterial[] = [];
  private look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA];

  constructor(private quality: QualityPreset, look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA]) {
    this.group.name = "castle_hall";
    this.look = look;

    this.hemi = new THREE.HemisphereLight(0x4a5f8a, 0x140f0b, 0.55);
    this.group.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xffd7a1, 2.6);
    this.keyLight.position.set(-9, 15, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 45;
    this.keyLight.shadow.camera.left = -9;
    this.keyLight.shadow.camera.right = 9;
    this.keyLight.shadow.camera.top = 9;
    this.keyLight.shadow.camera.bottom = -9;
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.02;
    this.group.add(this.keyLight);
    this.group.add(this.keyLight.target);

    // A cool fill from the opposite side separates the black army from the fog.
    this.fillLight = new THREE.DirectionalLight(0x5f7fbf, 0.5);
    this.fillLight.position.set(8, 6, -9);
    this.group.add(this.fillLight);

    this.buildFloor();
    this.buildColonnade();
    this.buildTorches();
    this.applyQuality(quality);
    this.applyArena(look);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  /**
   * One painted stone canvas for the whole hall, handed out as clones.
   *
   * The floor, the colonnade and the curtain wall each used to paint their own
   * 512² ashlar and then run a per-pixel grain pass over it — three identical
   * quarter-megapixel canvases, and three grain loops, before the first frame.
   * A clone shares the canvas but keeps its own repeat, which is the only thing
   * the three of them ever disagreed about.
   */
  private stoneMap(repeatU: number, repeatV: number): THREE.CanvasTexture {
    if (!this.stoneAlbedo) {
      this.stoneAlbedo = this.track(flagstoneTexture());
      this.stoneNormal = this.track(normalFromCanvas(this.stoneAlbedo.image as HTMLCanvasElement, 2.6));
    }
    const map = this.track(this.stoneAlbedo.clone());
    map.needsUpdate = true;
    map.repeat.set(repeatU, repeatV);
    return map;
  }

  /** The matching relief, cloned so it can carry the albedo's own repeat. */
  private stoneRelief(map: THREE.Texture): THREE.Texture {
    const normal = this.track((this.stoneNormal as THREE.CanvasTexture).clone());
    normal.needsUpdate = true;
    normal.repeat.copy(map.repeat);
    return normal;
  }

  private buildFloor(): void {
    const map = this.stoneMap(12, 12);
    // A paved courtyard rather than an endless floor: the war plain takes over
    // past the ruined wall line.
    const geometry = this.track(new THREE.CircleGeometry(20.5, 64));
    const material = this.track(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: this.stoneRelief(map),
        // Held well under 1: the paving is being read at a grazing angle from a
        // low camera, where an honest normal scale turns every joint into a
        // trench and the floor into corrugated iron.
        normalScale: new THREE.Vector2(0.55, 0.55),
        color: 0x6a6155,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    this.floorMaterial = material;
    const floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Dais the board rests on.
    const daisGeo = this.track(new THREE.CylinderGeometry(9.4, 10.4, 0.5, 48, 1));
    const daisMat = this.track(
      new THREE.MeshStandardMaterial({ map: this.track(marbleTexture(true)), color: 0x5b5449, roughness: 0.85 }),
    );
    this.daisMaterial = daisMat;
    const dais = new THREE.Mesh(daisGeo, daisMat);
    dais.position.y = -0.62;
    dais.receiveShadow = true;
    this.group.add(dais);
  }

  /**
   * One column of the ring, built at the origin and returned as loose parts.
   *
   * The old column was a tapered tube with a box balanced on either end, which
   * reads as scaffolding from anywhere closer than the far camp. This is the
   * same envelope — nothing moves, nothing gets taller — cut into the five
   * pieces a mason would actually lay: a plinth, a base moulding, a shaft with
   * a slight swell to it, a necking ring, and a two-part capital. The swell is
   * the part that does the work: a perfectly straight taper always looks like
   * a lathe turned it, because in the real world it looks *concave*.
   */
  private columnParts(): THREE.BufferGeometry[] {
    const parts: THREE.BufferGeometry[] = [];

    const plinth = new THREE.BoxGeometry(2.02, 0.46, 2.02);
    plinth.translate(0, -0.44, 0);
    parts.push(scaleUv(plinth, 1.4, 0.4));

    const baseRing = new THREE.TorusGeometry(0.76, 0.11, 6, 18);
    baseRing.rotateX(Math.PI / 2);
    baseRing.translate(0, -0.14, 0);
    parts.push(scaleUv(baseRing, 3, 1));

    // Profile of the shaft, bottom to top: a hair under a tenth of a metre of
    // entasis spread over nine metres. Any more and it reads as a barrel.
    const profile: [number, number][] = [
      [0.72, -0.2],
      [0.717, 0.9],
      [0.706, 2.9],
      [0.681, 5.1],
      [0.645, 7.2],
      [0.616, 8.6],
      [0.606, 9.16],
    ];
    const shaft = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    );
    parts.push(scaleUv(shaft, 3, 8));

    const necking = new THREE.TorusGeometry(0.64, 0.075, 6, 18);
    necking.rotateX(Math.PI / 2);
    necking.translate(0, 9.2, 0);
    parts.push(scaleUv(necking, 3, 1));

    // Echinus: a square block flaring out of the round shaft, which is what
    // makes the joint between column and arch read as carried rather than glued.
    const echinus = new THREE.CylinderGeometry(0.86, 0.64, 0.38, 4, 1);
    echinus.rotateY(Math.PI / 4);
    echinus.translate(0, 9.42, 0);
    parts.push(scaleUv(echinus, 2, 0.4));

    const abacus = new THREE.BoxGeometry(1.74, 0.26, 1.74);
    abacus.translate(0, 9.73, 0);
    parts.push(scaleUv(abacus, 1.2, 0.25));

    return parts;
  }

  private buildColonnade(): void {
    const stoneMap = this.stoneMap(4, 6);
    const stone = this.track(
      new THREE.MeshStandardMaterial({
        map: stoneMap,
        normalMap: this.stoneRelief(stoneMap),
        normalScale: new THREE.Vector2(0.7, 0.7),
        color: 0x554e44,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );
    this.pillarMaterial = stone;

    // A torus lays U along its ring and V around its tube, so the arch's
    // voussoirs are the U count and the two courses across its soffit are V.
    const archGeo = scaleUv(new THREE.TorusGeometry(2.1, 0.34, 8, 22, Math.PI), 5, 2);
    const keystoneGeo = scaleUv(new THREE.CylinderGeometry(0.34, 0.26, 0.86, 4, 1), 1, 0.7);
    keystoneGeo.rotateY(Math.PI / 4);

    const radius = 12.5;
    const count = 12;
    const parts: THREE.BufferGeometry[] = [];
    const place = new THREE.Matrix4();
    const spin = new THREE.Matrix4();

    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // The column's own parts, turned to face the middle and set on the ring.
      place.makeRotationY(-angle).setPosition(x, 0, z);
      for (const part of this.columnParts()) parts.push(part.applyMatrix4(place));

      // Arch spanning to the next column, with a keystone at its crown.
      const mid = angle + Math.PI / count;
      place.makeRotationY(-mid + Math.PI / 2).setPosition(Math.cos(mid) * radius, 9.5, Math.sin(mid) * radius);
      parts.push(archGeo.clone().applyMatrix4(place));

      spin.makeRotationY(-mid).setPosition(Math.cos(mid) * radius, 11.72, Math.sin(mid) * radius);
      parts.push(keystoneGeo.clone().applyMatrix4(spin));
    }
    archGeo.dispose();
    keystoneGeo.dispose();

    const colonnade = new THREE.Mesh(this.track(weldParts(parts)), stone);
    colonnade.castShadow = true;
    colonnade.receiveShadow = true;
    this.group.add(colonnade);

    // Curtain wall: one intact stretch carrying the high windows, the rest
    // battered down to waist-height stumps so the war outside reads through.
    const wallMap = this.stoneMap(1, 1);
    const wallMat = this.track(
      new THREE.MeshStandardMaterial({
        map: wallMap,
        normalMap: this.stoneRelief(wallMap),
        normalScale: new THREE.Vector2(0.85, 0.85),
        color: 0x2e2a26,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    this.wallMaterial = wallMat;

    const wallParts: THREE.BufferGeometry[] = [];

    /**
     * Arc of curtain wall centred on `centre` (same angle space as the pillars).
     *
     * The UVs are scaled by the arc's own length and height rather than left at
     * 0–1, so a two-metre stump is built of the same size stone as the twenty
     * metres of intact wall behind the windows — under one shared repeat the
     * stumps used to come out with courses four times too fine.
     */
    const wallArc = (centre: number, span: number, height: number): void => {
      const geometry = new THREE.CylinderGeometry(
        17,
        17.4,
        height,
        Math.max(6, Math.round(span * 12)),
        1,
        true,
        Math.PI / 2 - centre - span / 2,
        span,
      );
      geometry.translate(0, height / 2 - 0.6, 0);
      wallParts.push(scaleUv(geometry, Math.max(1, Math.round((span * 17.2) / 3.4)), Math.max(1, height / 2.6)));

      // A coping course along the top of every stretch: the one line that says
      // the wall was built to a height and then knocked back down to this one.
      const coping = new THREE.TorusGeometry(17.2, 0.28, 5, Math.max(6, Math.round(span * 14)), span);
      // Laid flat, then swung so its sweep starts where this stretch of wall
      // does: a Y rotation of β carries a bearing ψ to ψ − β, and the torus is
      // born sweeping from ψ = 0.
      coping.rotateX(Math.PI / 2);
      coping.rotateY(span / 2 - centre);
      coping.translate(0, height - 0.6, 0);
      wallParts.push(scaleUv(coping, Math.max(1, Math.round((span * 17.2) / 3.4)), 2));
    };

    // Intact northern wall behind the windows.
    wallArc(-Math.PI / 2, 1.9, 20);

    // Ruined remainder: alternating stumps and open breaches.
    const ruins: [number, number, number][] = [
      [-0.28, 0.72, 6.4],
      [0.62, 0.5, 3.1],
      [1.42, 0.66, 5.2],
      [2.15, 0.42, 2.2],
      [2.95, 0.8, 7.1],
      [3.72, 0.34, 1.8],
      [4.35, 0.62, 4.6],
      [5.1, 0.44, 2.6],
    ];
    for (const [centre, span, height] of ruins) wallArc(centre, span, height);

    const wall = new THREE.Mesh(this.track(weldParts(wallParts)), wallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);

    // Rubble heaped where the wall came down.
    const rubbleGeo = this.track(new THREE.IcosahedronGeometry(0.9, 0));
    const rubbleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3b352d, roughness: 1 }));
    this.rubbleMaterial = rubbleMat;
    const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, 54);
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 54; i += 1) {
      const angle = (i / 54) * Math.PI * 2 + Math.sin(i * 3.7) * 0.05;
      const distance = 16.4 + Math.sin(i * 2.3) * 1.6;
      dummy.position.set(Math.cos(angle) * distance, -0.62 + Math.abs(Math.sin(i * 5.1)) * 0.4, Math.sin(angle) * distance);
      dummy.rotation.set(i * 1.7, i * 0.9, i * 2.3);
      dummy.scale.set(0.4 + Math.abs(Math.sin(i)) * 0.9, 0.3 + Math.abs(Math.cos(i * 1.3)) * 0.5, 0.4 + Math.abs(Math.cos(i)) * 0.9);
      dummy.updateMatrix();
      rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.instanceMatrix.needsUpdate = true;
    this.group.add(rubble);

    // High windows: emissive lancets that read as openings and feed the bloom
    // pass, each set back behind a carved surround.
    //
    // The opening used to be a bright rectangle, which is the one shape a
    // window in a wall like this is never cut to — and with nothing around it,
    // it read as a poster rather than a hole. A two-centred head and a stone
    // reveal in front of it cost four hundred triangles between the three of
    // them and are most of what makes the north wall look built.
    const lancet = (halfWidth: number, sill: number, spring: number, apex: number): THREE.Shape => {
      const shape = new THREE.Shape();
      shape.moveTo(-halfWidth, sill);
      shape.lineTo(-halfWidth, spring);
      shape.quadraticCurveTo(-halfWidth, apex - (apex - spring) * 0.28, 0, apex);
      shape.quadraticCurveTo(halfWidth, apex - (apex - spring) * 0.28, halfWidth, spring);
      shape.lineTo(halfWidth, sill);
      shape.closePath();
      return shape;
    };

    const windowGeo = this.track(new THREE.ShapeGeometry(lancet(1.1, -2.2, 0.9, 2.2), 10));
    const windowMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0xffd9a6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    this.windowMaterial = windowMat;

    // The reveal: one lancet with a smaller lancet punched out of it, extruded
    // back toward the wall so the key light rakes across a real jamb.
    const reveal = lancet(1.42, -2.5, 1, 2.56);
    reveal.holes.push(new THREE.Path(lancet(1.06, -2.16, 0.88, 2.16).getPoints(10)));
    // An extrusion's UVs come out in metres, so they need the same 3.4 m stone
    // the wall arcs were scaled to or the jamb is built of gravel.
    const revealGeo = this.track(
      scaleUv(new THREE.ExtrudeGeometry(reveal, { depth: 0.34, bevelEnabled: false, curveSegments: 10 }), 0.3, 0.3),
    );

    const shaftMat = this.track(
      new THREE.MeshBasicMaterial({
        map: this.track(shaftTexture()),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.75,
      }),
    );
    const shaftGeo = this.track(new THREE.PlaneGeometry(3.4, 18));
    const mullionGeo = this.track(scaleUv(new THREE.BoxGeometry(0.15, 4.5, 0.3), 0.1, 1.6));

    for (let i = 0; i < 3; i += 1) {
      const angle = -Math.PI / 2 + (i - 1) * 0.42;
      const x = Math.cos(angle) * 16.4;
      const z = Math.sin(angle) * 16.4;
      const win = new THREE.Mesh(windowGeo, windowMat);
      win.position.set(x, 11.5, z);
      win.lookAt(0, 11.5, 0);
      this.group.add(win);

      // Surround and mullion stand a little in front of the glow, so the light
      // is what comes through them rather than what sits on top of them.
      const surround = new THREE.Mesh(revealGeo, wallMat);
      surround.position.set(Math.cos(angle) * 16.02, 11.5, Math.sin(angle) * 16.02);
      surround.lookAt(0, 11.5, 0);
      surround.castShadow = true;
      surround.receiveShadow = true;
      this.group.add(surround);

      const mullion = new THREE.Mesh(mullionGeo, wallMat);
      mullion.position.set(Math.cos(angle) * 16.1, 11.4, Math.sin(angle) * 16.1);
      mullion.lookAt(0, 11.4, 0);
      this.group.add(mullion);

      // The shaft falling from it. Two cards crossed about the beam's own axis
      // rather than one, because a single card seen edge-on from the far side
      // of the board is a line — and the board is orbited.
      const beam = new THREE.Group();
      beam.position.set(x * 0.55, 6.4, z * 0.55);
      beam.rotation.set(-0.42, angle + Math.PI / 2, 0);
      for (const roll of [0, Math.PI / 2]) {
        const card = new THREE.Mesh(shaftGeo, this.track(shaftMat.clone()));
        card.rotation.y = roll;
        card.renderOrder = 2;
        this.shafts.push(card);
        this.shaftPhases.push(i * 2.3 + roll);
        beam.add(card);
      }
      this.group.add(beam);
    }
  }

  /**
   * The four braziers, at exactly the corners they always stood on.
   *
   * The ironwork is merged into a single mesh — nothing about a stand moves,
   * only the fire in it — and given a smith's profile rather than a stick with
   * a cup on it: a splayed foot, a tapered stem, a collar, a flared bowl and a
   * rim. All of it is the same forged iron, so it costs one draw call for the
   * set of four and reads as metal because it has edges for the flame to catch.
   */
  private buildTorches(): void {
    const bracketMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.55, metalness: 0.72 }));
    const flameGeo = this.track(new THREE.SphereGeometry(0.3, 12, 12));

    const positions: [number, number][] = [
      [-8.6, 8.6],
      [8.6, 8.6],
      [-8.6, -8.6],
      [8.6, -8.6],
    ];

    const iron: THREE.BufferGeometry[] = [];
    positions.forEach(([x, z], index) => {
      const at = (geometry: THREE.BufferGeometry, y: number): void => {
        geometry.translate(x, y, z);
        iron.push(geometry);
      };
      /** A ring laid flat, so it bands the stem instead of sticking out of it. */
      const hoop = (radius: number, tube: number, segments: number): THREE.BufferGeometry => {
        const ring = new THREE.TorusGeometry(radius, tube, 5, segments);
        ring.rotateX(Math.PI / 2);
        return ring;
      };
      // Foot, stem, collar, bowl, rim — the stand spans the same ground-to-bowl
      // height the old stick did, so the light and the flame have not moved.
      at(new THREE.CylinderGeometry(0.2, 0.34, 0.16, 10), -0.54);
      at(new THREE.CylinderGeometry(0.09, 0.13, 3.4, 8), 1.1);
      at(hoop(0.12, 0.035, 10), 2.42);
      at(new THREE.CylinderGeometry(0.42, 0.2, 0.44, 12, 1), 2.95);
      at(hoop(0.42, 0.045, 14), 3.16);

      const flameMat = this.track(
        new THREE.MeshBasicMaterial({ color: 0xffa63c, transparent: true, opacity: 0.95 }),
      );
      this.flameMaterials.push(flameMat);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, 3.25, z);
      flame.scale.set(1, 1.6, 1);
      this.group.add(flame);

      const light = new THREE.PointLight(0xff7a2a, 26, 22, 2);
      light.position.set(x, 3.4, z);
      this.group.add(light);

      this.torches.push({ light, flame, seed: index * 12.7, base: 26 });
    });

    const braziers = new THREE.Mesh(this.track(weldParts(iron)), bracketMat);
    braziers.castShadow = true;
    this.group.add(braziers);
  }

  private buildParticles(dustCount: number, emberCount: number): void {
    this.disposeParticles();
    const sprite = this.track(sparkTexture());

    if (dustCount > 0) {
      const positions = new Float32Array(dustCount * 3);
      this.dustPhase = new Float32Array(dustCount);
      for (let i = 0; i < dustCount; i += 1) {
        positions[i * 3] = (Math.random() - 0.5) * 22;
        positions[i * 3 + 1] = Math.random() * 9;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 22;
        this.dustPhase[i] = Math.random() * Math.PI * 2;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.055,
        map: sprite,
        color: this.look.dust.color,
        transparent: true,
        opacity: this.look.dust.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      this.dust = new THREE.Points(geometry, material);
      this.dust.frustumCulled = false;
      this.group.add(this.dust);
    }

    if (emberCount > 0) {
      const positions = new Float32Array(emberCount * 3);
      this.emberVelocities = new Float32Array(emberCount);
      const anchors: [number, number][] = [
        [-8.6, 8.6],
        [8.6, 8.6],
        [-8.6, -8.6],
        [8.6, -8.6],
      ];
      for (let i = 0; i < emberCount; i += 1) {
        const [ax, az] = anchors[i % anchors.length];
        positions[i * 3] = ax + (Math.random() - 0.5) * 0.7;
        positions[i * 3 + 1] = 3.2 + Math.random() * 3;
        positions[i * 3 + 2] = az + (Math.random() - 0.5) * 0.7;
        this.emberVelocities[i] = 0.35 + Math.random() * 0.7;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        size: 0.09,
        map: sprite,
        color: 0xff9a3c,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.embers = new THREE.Points(geometry, material);
      this.embers.frustumCulled = false;
      this.group.add(this.embers);
    }
  }

  private disposeParticles(): void {
    for (const points of [this.dust, this.embers]) {
      if (!points) continue;
      this.group.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    }
    this.dust = null;
    this.embers = null;
  }

  applyQuality(preset: QualityPreset): void {
    this.quality = preset;
    const settings = QUALITY_SETTINGS[preset];
    this.keyLight.castShadow = settings.shadows;
    this.keyLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
    if (this.keyLight.shadow.map) {
      this.keyLight.shadow.map.dispose();
      this.keyLight.shadow.map = null;
    }
    for (const shaft of this.shafts) shaft.visible = settings.lightShafts;
    this.buildParticles(settings.dustCount, settings.emberCount);
  }

  /**
   * Relights the hall for an arena theme: lamps, stone tints, glass, shafts and
   * torch strength. Daylight themes keep the torches burning but pull them right
   * back so they read as decoration rather than the only source of light.
   */
  applyArena(look: ArenaLook): void {
    this.look = look;

    this.hemi.color.setHex(look.hemi.sky);
    this.hemi.groundColor.setHex(look.hemi.ground);
    this.hemi.intensity = look.hemi.intensity;

    this.keyLight.color.setHex(look.keyLight.color);
    this.keyLight.intensity = look.keyLight.intensity;
    this.keyLight.position.set(...look.keyLight.position);

    this.fillLight.color.setHex(look.fill.color);
    this.fillLight.intensity = look.fill.intensity;
    this.fillLight.position.set(...look.fill.position);

    this.floorMaterial?.color.setHex(look.stone.floor);
    this.daisMaterial?.color.setHex(look.stone.dais);
    this.pillarMaterial?.color.setHex(look.stone.pillar);
    this.wallMaterial?.color.setHex(look.stone.wall);
    this.rubbleMaterial?.color.setHex(look.stone.rubble);

    if (this.windowMaterial) {
      this.windowMaterial.color.setHex(look.window.color);
      this.windowMaterial.opacity = look.window.opacity;
    }
    for (const shaft of this.shafts) {
      const material = shaft.material as THREE.MeshBasicMaterial;
      material.color.setHex(look.shaft.color);
    }
    for (const flame of this.flameMaterials) flame.opacity = 0.95 * look.torch.flame;

    if (this.dust) {
      const material = this.dust.material as THREE.PointsMaterial;
      material.color.setHex(look.dust.color);
      material.opacity = look.dust.opacity;
    }
    if (this.embers) {
      const material = this.embers.material as THREE.PointsMaterial;
      material.opacity = 0.85 * Math.max(0.35, look.torch.flame);
    }
  }

  update(delta: number): void {
    this.elapsed += delta;

    const torchScale = this.look.torch.intensity;
    for (const torch of this.torches) {
      // Layered sines approximate flame noise without a texture lookup.
      const t = this.elapsed * 6 + torch.seed;
      const flicker = 0.72 + Math.sin(t) * 0.12 + Math.sin(t * 2.37) * 0.09 + Math.sin(t * 5.11) * 0.06;
      torch.light.intensity = torch.base * flicker * torchScale;
      const scale = 0.9 + flicker * 0.28;
      torch.flame.scale.set(scale, scale * 1.65, scale);
    }

    if (this.dust) {
      const attribute = this.dust.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < this.dustPhase.length; i += 1) {
        const phase = this.dustPhase[i] + this.elapsed * 0.25;
        array[i * 3] += Math.sin(phase) * 0.0016;
        array[i * 3 + 1] += 0.0035 + Math.cos(phase * 0.7) * 0.001;
        array[i * 3 + 2] += Math.cos(phase * 1.3) * 0.0016;
        if (array[i * 3 + 1] > 9.5) array[i * 3 + 1] = 0.1;
      }
      attribute.needsUpdate = true;
    }

    if (this.embers) {
      const attribute = this.embers.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < this.emberVelocities.length; i += 1) {
        array[i * 3 + 1] += this.emberVelocities[i] * delta;
        array[i * 3] += Math.sin(this.elapsed * 2 + i) * 0.004;
        if (array[i * 3 + 1] > 8.5) {
          array[i * 3 + 1] = 3.1;
        }
      }
      attribute.needsUpdate = true;
    }

    const shaftPeak = this.look.shaft.opacity;
    this.shafts.forEach((shaft, index) => {
      const material = shaft.material as THREE.MeshBasicMaterial;
      material.opacity = shaftPeak * (0.78 + Math.sin(this.elapsed * 0.7 + this.shaftPhases[index]) * 0.17);
    });
  }

  dispose(): void {
    this.disposeParticles();
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.group.clear();
  }
}

/**
 * PMREM environment built from a procedural gradient dome plus warm emissive
 * panels, so armour and polished marble reflect the hall instead of a void.
 */
export function buildEnvironmentMap(
  renderer: THREE.WebGLRenderer,
  look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA],
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();
  const domeGeometry = new THREE.SphereGeometry(30, 24, 16);
  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(look.environment.top) },
      bottomColor: { value: new THREE.Color(look.environment.bottom) },
      glowColor: { value: new THREE.Color(look.environment.glow) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 glowColor;
      varying vec3 vPosition;
      void main() {
        float h = normalize(vPosition).y * 0.5 + 0.5;
        vec3 color = mix(bottomColor, topColor, pow(h, 0.8));
        color += glowColor * pow(1.0 - abs(h - 0.35) * 2.2, 4.0) * 0.6;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  scene.add(dome);

  const panelGeometry = new THREE.PlaneGeometry(6, 6);
  const warm = new THREE.MeshBasicMaterial({ color: look.environment.warm });
  const cool = new THREE.MeshBasicMaterial({ color: look.environment.cool });
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const panel = new THREE.Mesh(panelGeometry, i % 2 === 0 ? warm : cool);
    panel.position.set(Math.cos(angle) * 12, 4 + (i % 2) * 4, Math.sin(angle) * 12);
    panel.lookAt(0, 4, 0);
    scene.add(panel);
  }

  const target = pmrem.fromScene(scene, 0.04);
  domeGeometry.dispose();
  domeMaterial.dispose();
  panelGeometry.dispose();
  warm.dispose();
  cool.dispose();
  pmrem.dispose();
  return target.texture;
}
