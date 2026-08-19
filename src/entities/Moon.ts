import * as THREE from 'three';
import { MOON_VIEW } from '../scenes/moonComposition';

export type MoonMode = 'character' | 'smooth' | 'impacts' | 'lava' | 'cratered';

const BODY_RADIUS = MOON_VIEW.storyRadius;
const FRONT = new THREE.Vector3(0, 0, 1);
const LAVA_FLOW_DURATION = 1.35;
const LAVA_COOLING_DURATION = 1.1;
const HOT_LAVA_COLOR = new THREE.Color('#ff7a35');
const COOL_LAVA_COLOR = new THREE.Color('#34251f');
const HOT_LAVA_EMISSIVE = new THREE.Color('#e64920');
const COOL_LAVA_EMISSIVE = new THREE.Color('#120f0e');
const MOON_SURFACE_BASE_COLOR = '#b6b8bb';

const CRATER_NORMALS = [
  // A few medium landmarks, followed by many smaller impacts. The uneven
  // distribution is intentional: the Moon is not covered in equal circles.
  new THREE.Vector3(-0.54, 0.46, 0.70).normalize(),
  new THREE.Vector3(-0.18, 0.62, 0.76).normalize(),
  new THREE.Vector3(0.30, 0.48, 0.82).normalize(),
  new THREE.Vector3(0.62, 0.24, 0.74).normalize(),
  new THREE.Vector3(-0.68, 0.08, 0.73).normalize(),
  new THREE.Vector3(-0.26, 0.12, 0.96).normalize(),
  new THREE.Vector3(0.18, 0.02, 0.98).normalize(),
  new THREE.Vector3(0.48, -0.22, 0.85).normalize(),
  new THREE.Vector3(-0.54, -0.36, 0.76).normalize(),
  new THREE.Vector3(-0.08, -0.56, 0.82).normalize(),
  new THREE.Vector3(0.30, -0.62, 0.72).normalize(),
  new THREE.Vector3(0.74, -0.44, 0.52).normalize(),
];

const CRATER_RADII = [0.27, 0.2, 0.17, 0.14, 0.12, 0.1, 0.09, 0.14, 0.11, 0.085, 0.1, 0.075];
const CRATER_DEPTHS = [0.065, 0.05, 0.043, 0.035, 0.03, 0.026, 0.023, 0.035, 0.028, 0.021, 0.025, 0.018];
export const STORY_CRATER_COUNT = CRATER_NORMALS.length;

type CraterSlot = {
  group: THREE.Group;
  basin: THREE.Mesh;
  lava: THREE.Mesh;
};

export function getCraterTarget(index: number, pitch: number = MOON_VIEW.pitch, yaw: number = MOON_VIEW.yaw): THREE.Vector3 {
  return CRATER_NORMALS[index % CRATER_NORMALS.length]
    .clone()
    .multiplyScalar(BODY_RADIUS + 0.02)
    .applyEuler(new THREE.Euler(pitch, yaw, 0));
}

export class Moon {
  readonly group = new THREE.Group();

  private readonly bodyGeometry: THREE.SphereGeometry;
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.94,
    metalness: 0,
  });
  private readonly body: THREE.Mesh;
  private readonly surfaceTexture: THREE.CanvasTexture;
  private readonly mariaTexture: THREE.CanvasTexture;
  private readonly characterLayer = new THREE.Group();
  private readonly craterLayer = new THREE.Group();
  private readonly mariaLayer = new THREE.Group();
  private readonly craterSlots: CraterSlot[] = [];
  private readonly mariaPatches: THREE.Mesh[] = [];
  private readonly craterBasinMaterial = new THREE.MeshStandardMaterial({
    color: MOON_SURFACE_BASE_COLOR,
    roughness: 0.94,
    metalness: 0,
  });
  private readonly mariaMaterial: THREE.MeshStandardMaterial;
  private readonly lavaMaterial = new THREE.MeshStandardMaterial({
    color: '#ff9250',
    emissive: '#e64920',
    emissiveIntensity: 1.8,
    roughness: 0.72,
    metalness: 0,
  });
  private readonly characterMaterial = new THREE.MeshStandardMaterial({
    color: '#f4c96a',
    roughness: 0.7,
    metalness: 0.02,
  });
  private readonly faceMaterial = new THREE.MeshStandardMaterial({
    color: '#26354a',
    roughness: 0.7,
    metalness: 0,
  });
  private readonly blushMaterial = new THREE.MeshStandardMaterial({
    color: '#ed8e7c',
    roughness: 0.72,
    metalness: 0,
  });
  private readonly armGeometry = new THREE.CapsuleGeometry(0.13, 0.5, 4, 6);
  private readonly legGeometry = new THREE.CapsuleGeometry(0.15, 0.48, 4, 6);
  private readonly shoeGeometry = new THREE.BoxGeometry(0.3, 0.18, 0.44);
  private readonly eyeGeometry = new THREE.SphereGeometry(0.14, 6, 4);
  private readonly blushGeometry = new THREE.SphereGeometry(0.13, 6, 4);
  private readonly mouthGeometry = new THREE.SphereGeometry(0.18, 8, 5);
  private mode: MoonMode = 'character';
  private craterCount = 0;
  private impactFlash = 0;
  private lavaElapsed = 0;
  private lavaFlowProgress = 0;
  private lavaCoolingProgress = 0;
  private storyYaw: number = MOON_VIEW.yaw;
  private storyPitch: number = MOON_VIEW.pitch;

  constructor() {
    this.surfaceTexture = this.createSurfaceTexture();
    this.mariaTexture = this.createMariaTexture();
    this.mariaMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: this.mariaTexture,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      alphaTest: 0.02,
      depthWrite: false,
    });
    this.bodyGeometry = this.createMoonGeometry();
    this.body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);

    this.createCharacter();
    this.createCraters();
    this.createMariaPatches();

    this.group.add(this.characterLayer, this.craterLayer, this.mariaLayer);
    this.setMode('character');
  }

  update(delta: number, elapsed: number, animate: boolean): void {
    const time = animate ? elapsed : 0;
    const isCharacter = this.mode === 'character';
    this.group.rotation.y = isCharacter ? Math.sin(time * 0.48) * 0.12 : this.storyYaw;
    this.group.rotation.x = isCharacter ? Math.sin(time * 0.6) * 0.025 : this.storyPitch;
    this.group.position.y = isCharacter ? Math.sin(time * 2.1) * 0.11 : 0;

    this.impactFlash = Math.max(0, this.impactFlash - delta * 4.4);
    if (this.mode === 'lava') {
      this.lavaElapsed = Math.min(this.lavaElapsed + delta, LAVA_FLOW_DURATION + LAVA_COOLING_DURATION);
      this.lavaFlowProgress = THREE.MathUtils.clamp(this.lavaElapsed / LAVA_FLOW_DURATION, 0, 1);
      this.lavaCoolingProgress = THREE.MathUtils.clamp(
        (this.lavaElapsed - LAVA_FLOW_DURATION) / LAVA_COOLING_DURATION,
        0,
        1,
      );
    } else if (this.mode === 'cratered') {
      this.lavaElapsed = LAVA_FLOW_DURATION + LAVA_COOLING_DURATION;
      this.lavaFlowProgress = 1;
      this.lavaCoolingProgress = 1;
    }

    this.bodyMaterial.emissive.set(this.impactFlash > 0 ? '#e85a2b' : '#000000');
    this.bodyMaterial.emissiveIntensity = this.impactFlash * 0.45;
    this.updateLavaMaterials(time);

    for (const slot of this.craterSlots) {
      if (slot.lava.visible) {
        const flow = THREE.MathUtils.smoothstep(this.lavaFlowProgress, 0, 1);
        const fill = 0.16 + flow * 0.84;
        slot.lava.scale.set(fill, fill * 0.84, 1);
      }
    }
  }

  setMode(mode: MoonMode): void {
    this.mode = mode;
    const isCharacter = mode === 'character';
    const isStoryMoon = !isCharacter;
    const showsMaria = mode === 'lava' || mode === 'cratered';

    this.characterLayer.visible = isCharacter;
    this.craterLayer.visible = isStoryMoon;
    this.mariaLayer.visible = showsMaria;
    this.surfaceTexture.needsUpdate = true;

    if (isCharacter) {
      this.bodyMaterial.color.set('#f4c96a');
      this.bodyMaterial.map = null;
      this.bodyMaterial.bumpMap = null;
      this.bodyMaterial.bumpScale = 0;
      this.bodyMaterial.roughness = 0.7;
      this.setCraterCount(0);
      this.lavaElapsed = 0;
      this.lavaFlowProgress = 0;
      this.lavaCoolingProgress = 0;
      this.setLavaVisibility(false);
      this.updateLavaMaterials(0);
      this.bodyMaterial.needsUpdate = true;
      return;
    }

    this.bodyMaterial.color.set('#ffffff');
    this.bodyMaterial.map = this.surfaceTexture;
    this.bodyMaterial.bumpMap = this.surfaceTexture;
    this.bodyMaterial.bumpScale = 0.022;
    this.bodyMaterial.roughness = 0.94;
    this.bodyMaterial.needsUpdate = true;
    this.lavaElapsed = mode === 'cratered' ? LAVA_FLOW_DURATION + LAVA_COOLING_DURATION : 0;
    this.lavaFlowProgress = mode === 'cratered' ? 1 : 0;
    this.lavaCoolingProgress = mode === 'cratered' ? 1 : 0;
    this.setLavaVisibility(mode === 'lava');
    this.updateLavaMaterials(0);

    if (mode === 'smooth') this.setCraterCount(0);
    if (mode === 'impacts') this.setCraterCount(Math.min(this.craterCount, 1));
    if (mode === 'lava') this.setCraterCount(Math.max(this.craterCount, 3));
    if (mode === 'cratered') this.setCraterCount(this.craterSlots.length);
  }

  revealNextCrater(): number {
    this.craterCount = Math.min(this.craterSlots.length, this.craterCount + 1);
    this.setCraterCount(this.craterCount);
    this.impactFlash = 1;
    return this.craterCount;
  }

  setCraterCount(count: number): void {
    this.craterCount = THREE.MathUtils.clamp(Math.floor(count), 0, this.craterSlots.length);
    this.craterSlots.forEach((slot, index) => {
      slot.group.visible = index < this.craterCount;
      slot.lava.visible = this.mode === 'lava' && index < this.craterCount;
    });
  }

  getMode(): MoonMode {
    return this.mode;
  }

  rotateStory(deltaX: number, deltaY: number): void {
    this.storyYaw += deltaX * 0.008;
    this.storyPitch = THREE.MathUtils.clamp(this.storyPitch + deltaY * 0.006, -0.78, 0.78);
  }

  getCraterCount(): number {
    return this.craterCount;
  }

  getLavaFlowProgress(): number {
    return this.lavaFlowProgress;
  }

  getLavaCoolingProgress(): number {
    return this.lavaCoolingProgress;
  }

  dispose(): void {
    this.bodyGeometry.dispose();
    this.bodyMaterial.dispose();
    this.surfaceTexture.dispose();
    this.mariaTexture.dispose();
    this.armGeometry.dispose();
    this.legGeometry.dispose();
    this.shoeGeometry.dispose();
    this.eyeGeometry.dispose();
    this.blushGeometry.dispose();
    this.mouthGeometry.dispose();
    this.characterMaterial.dispose();
    this.faceMaterial.dispose();
    this.blushMaterial.dispose();
    this.craterBasinMaterial.dispose();
    this.mariaMaterial.dispose();
    this.lavaMaterial.dispose();

    for (const slot of this.craterSlots) {
      slot.basin.geometry.dispose();
      slot.lava.geometry.dispose();
    }
    for (const patch of this.mariaPatches) patch.geometry.dispose();
  }

  private createMoonGeometry(): THREE.SphereGeometry {
    const geometry = new THREE.SphereGeometry(BODY_RADIUS, 48, 32);
    const position = geometry.attributes.position;
    const point = new THREE.Vector3();

    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index);
      const noise =
        Math.sin(point.x * 4.7 + point.y * 1.9) * 0.45 +
        Math.sin(point.y * 7.1 - point.z * 3.2) * 0.3 +
        Math.sin(point.z * 10.4 + point.x * 2.6) * 0.25;
      point.normalize().multiplyScalar(BODY_RADIUS * (1 + noise * 0.0038));
      position.setXYZ(index, point.x, point.y, point.z);
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  private createSurfaceTexture(): THREE.CanvasTexture {
    const width = 192;
    const height = 96;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create moon surface texture context.');

    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const wave =
          Math.sin(x * 0.17 + y * 0.08) * 8 +
          Math.sin(x * 0.043 - y * 0.19) * 5 +
          Math.sin((x + y) * 0.63) * 2;
        const value = THREE.MathUtils.clamp(Math.round(184 + wave), 156, 212);
        const offset = (y * width + x) * 4;
        image.data[offset] = value - 2;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value + 3;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private createMariaTexture(): THREE.CanvasTexture {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create maria texture context.');

    const image = context.createImageData(size, size);
    const center = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x - center) / center;
        const dy = (y - center) / center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const edge = THREE.MathUtils.clamp((0.96 - distance) / 0.22, 0, 1);
        // Keep the maria edge soft without a repeating high-frequency pattern;
        // a tiny tiled pattern reads as a texture bug at tablet resolution.
        const alpha = Math.round(edge * edge * 175);
        const offset = (y * size + x) * 4;
        image.data[offset] = 92;
        image.data[offset + 1] = 88;
        image.data[offset + 2] = 80;
        image.data[offset + 3] = alpha;
      }
    }
    context.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private createCharacter(): void {
    const armLeft = new THREE.Mesh(this.armGeometry, this.characterMaterial);
    armLeft.position.set(-1.84, 0.05, 0.06);
    armLeft.rotation.z = -0.82;
    armLeft.castShadow = true;

    const armRight = armLeft.clone();
    armRight.position.x = 1.84;
    armRight.rotation.z = 0.82;

    const legLeft = new THREE.Mesh(this.legGeometry, this.characterMaterial);
    legLeft.position.set(-0.62, -2.03, 0.04);
    legLeft.rotation.z = -0.08;
    legLeft.castShadow = true;

    const legRight = legLeft.clone();
    legRight.position.x = 0.62;
    legRight.rotation.z = 0.08;

    const shoeLeft = new THREE.Mesh(this.shoeGeometry, this.faceMaterial);
    shoeLeft.position.set(-0.69, -2.36, 0.12);
    shoeLeft.rotation.y = -0.1;
    const shoeRight = shoeLeft.clone();
    shoeRight.position.x = 0.69;
    shoeRight.rotation.y = 0.1;

    this.characterLayer.add(armLeft, armRight, legLeft, legRight, shoeLeft, shoeRight);

    const eyeLeft = new THREE.Mesh(this.eyeGeometry, this.faceMaterial);
    eyeLeft.position.set(-0.49, 0.42, 1.87);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.x = 0.49;

    const cheekLeft = new THREE.Mesh(this.blushGeometry, this.blushMaterial);
    cheekLeft.position.set(-0.78, -0.04, 1.82);
    const cheekRight = cheekLeft.clone();
    cheekRight.position.x = 0.78;

    const mouth = new THREE.Mesh(this.mouthGeometry, this.faceMaterial);
    mouth.position.set(0, -0.16, 1.9);
    mouth.scale.set(1, 0.78, 0.28);

    this.characterLayer.add(eyeLeft, eyeRight, cheekLeft, cheekRight, mouth);
  }

  private createCraters(): void {
    CRATER_NORMALS.forEach((normal, index) => {
      const radius = CRATER_RADII[index];
      const depth = CRATER_DEPTHS[index];
      const group = new THREE.Group();
      // Keep the bowl close to the surface. Raising it by the full depth makes
      // it read like a cup or a submarine window instead of a shallow crater.
      group.position.copy(normal).multiplyScalar(BODY_RADIUS + depth * 0.5 + 0.012);
      group.quaternion.setFromUnitVectors(FRONT, normal);

      const basin = new THREE.Mesh(this.createBasinGeometry(radius, depth, index), this.craterBasinMaterial);
      basin.castShadow = true;

      const lava = new THREE.Mesh(this.createPoolGeometry(radius * 0.7, index + 17), this.lavaMaterial);
      lava.position.z = -depth * 0.38;
      lava.visible = false;

      group.add(basin, lava);
      this.craterLayer.add(group);
      this.craterSlots.push({ group, basin, lava });
    });
  }

  private createMariaPatches(): void {
    const patches = [
      // Broad maria on the near side, translated from the familiar lunar map:
      // one dominant western plain, a second upper basin, then smaller nearby
      // plains rather than three equally-sized floating decals.
      { normal: new THREE.Vector3(0.56, 0.2, 0.8).normalize(), radius: 0.82, verticalScale: 0.7, seed: 31 },
      { normal: new THREE.Vector3(0.24, 0.52, 0.82).normalize(), radius: 0.58, verticalScale: 0.68, seed: 37 },
      { normal: new THREE.Vector3(-0.08, -0.35, 0.93).normalize(), radius: 0.43, verticalScale: 0.78, seed: 43 },
      { normal: new THREE.Vector3(0.55, -0.14, 0.82).normalize(), radius: 0.36, verticalScale: 0.78, seed: 47 },
      { normal: new THREE.Vector3(0.22, -0.43, 0.88).normalize(), radius: 0.3, verticalScale: 0.76, seed: 53 },
      { normal: new THREE.Vector3(-0.48, 0.18, 0.86).normalize(), radius: 0.25, verticalScale: 0.82, seed: 59 },
    ];

    for (const patch of patches) {
      const group = new THREE.Group();
      group.position.copy(patch.normal).multiplyScalar(BODY_RADIUS + 0.008);
      group.quaternion.setFromUnitVectors(FRONT, patch.normal);
      const mesh = new THREE.Mesh(
        this.createPatchGeometry(patch.radius, patch.seed, patch.verticalScale),
        this.mariaMaterial,
      );
      mesh.position.z = 0.004;
      group.add(mesh);
      this.mariaLayer.add(group);
      this.mariaPatches.push(mesh);
    }
  }

  private createBasinGeometry(radius: number, depth: number, seed: number): THREE.BufferGeometry {
    const segments = 18;
    const rings = 3;
    const positions: number[] = [0, 0, -depth];
    const indices: number[] = [];

    for (let ring = 1; ring <= rings; ring += 1) {
      const t = ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * (2 + (seed % 3)) + seed) * 0.075 + Math.sin(angle * 5 - seed) * 0.035;
        const ringRadius = radius * t * wobble;
        const z = -depth * Math.pow(1 - t, 1.45);
        positions.push(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, z);
      }
    }

    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(0, 1 + segment, 1 + next);
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const currentStart = 1 + (ring - 1) * segments;
      const nextStart = currentStart + segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(
          currentStart + segment,
          nextStart + segment,
          currentStart + next,
          currentStart + next,
          nextStart + segment,
          nextStart + next,
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createPoolGeometry(radius: number, seed: number): THREE.BufferGeometry {
    const segments = 14;
    const positions: number[] = [0, 0, 0];
    const indices: number[] = [];

    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const wobble = 1 + Math.sin(angle * 2 + seed) * 0.08 + Math.sin(angle * 5) * 0.04;
      positions.push(Math.cos(angle) * radius * wobble, Math.sin(angle) * radius * wobble * 0.82, 0);
      const next = (segment + 1) % segments;
      indices.push(0, 1 + segment, 1 + next);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createPatchGeometry(radius: number, seed: number, verticalScale = 0.72): THREE.BufferGeometry {
    const segments = 28;
    const positions: number[] = [0, 0, 0];
    const uvs: number[] = [0.5, 0.5];
    const indices: number[] = [];

    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const wobble = 1 + Math.sin(angle * 2 + seed) * 0.12 + Math.sin(angle * 5 - seed) * 0.05;
      positions.push(Math.cos(angle) * radius * wobble, Math.sin(angle) * radius * wobble * verticalScale, 0);
      uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      const next = (segment + 1) % segments;
      indices.push(0, 1 + segment, 1 + next);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private setLavaVisibility(visible: boolean): void {
    this.craterSlots.forEach((slot, index) => {
      slot.lava.visible = visible && index < this.craterCount;
    });
  }

  private updateLavaMaterials(time: number): void {
    const cooling = THREE.MathUtils.smoothstep(this.lavaCoolingProgress, 0, 1);
    this.lavaMaterial.color.lerpColors(HOT_LAVA_COLOR, COOL_LAVA_COLOR, cooling);
    this.lavaMaterial.emissive.lerpColors(HOT_LAVA_EMISSIVE, COOL_LAVA_EMISSIVE, cooling);
    this.lavaMaterial.emissiveIntensity =
      this.mode === 'lava'
        ? THREE.MathUtils.lerp(1.8, 0.08, cooling) + Math.sin(time * 6.5) * 0.18 * (1 - cooling)
        : 0;
    // The dark maria are the cooled result of the flow. They fade in only
    // after the orange lava has spread, instead of existing underneath it.
    this.mariaMaterial.opacity = this.mode === 'lava' ? cooling * 0.86 : this.mode === 'cratered' ? 0.86 : 0;
  }
}
