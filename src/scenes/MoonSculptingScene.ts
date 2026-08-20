import * as THREE from 'three';
import { ImpactBurst } from '../entities/ImpactBurst';

export type MeteorSize = 'small' | 'medium' | 'large';
export type SculptingState = 'ready' | 'aiming' | 'flying' | 'reloading';
export type CraterState = 'fresh' | 'erupting' | 'cooling' | 'mare';

export type SculptingSnapshot = {
  active: boolean;
  state: SculptingState;
  meteorSize: MeteorSize;
  craterCount: number;
  mareCount: number;
  selectedCraterId: number | null;
  selectedCraterState: CraterState | null;
  canErupt: boolean;
  lavaAction: 'erupt' | 'stop' | null;
  lavaProgress: number;
  projectileSpeed: number;
  lastImpactNormal: { x: number; y: number; z: number } | null;
  physics: {
    engine: 'custom-fixed-step';
    timestep: number;
    bodies: number;
    colliders: number;
    ccd: boolean;
  };
};

type CraterRecord = {
  id: number;
  normal: THREE.Vector3;
  radius: number;
  depth: number;
  state: CraterState;
  lavaProgress: number;
  coolingProgress: number;
  fillScale: number;
  group: THREE.Group;
  basin: THREE.Mesh;
  lava: THREE.Mesh;
  mare: THREE.Mesh;
  selection: THREE.LineSegments;
};

const MOON_RADIUS = 2.45;
const FIXED_STEP = 1 / 120;
const MAX_CRATERS = 40;
const MAX_PULL = 1.55;
const LAUNCH_POWER = 4.85;
const LAUNCH_DEPTH = 3.2;
const INWARD_LAUNCH_RATIO = 0.24;
const MOON_GRAVITY = 1.35;
const LAVA_DURATION = 7.2;
const COOLING_DURATION = 2.4;
const LAVA_SPILL_START = 0.44;
const LAVA_RIM_LEVEL = 0.022;
const LAVA_OVERFLOW_LEVEL = 0.044;
const FRONT = new THREE.Vector3(0, 0, 1);
const HOT_LAVA = new THREE.Color('#ff9a45');
const COOL_LAVA = new THREE.Color('#2b211d');
const HOT_EMISSIVE = new THREE.Color('#ff4b1f');
const COOL_EMISSIVE = new THREE.Color('#100d0c');

const SIZE_TUNING: Record<MeteorSize, { meteor: number; crater: number; depth: number }> = {
  small: { meteor: 0.72, crater: 0.12, depth: 0.055 },
  medium: { meteor: 1, crater: 0.17, depth: 0.08 },
  large: { meteor: 1.3, crater: 0.24, depth: 0.115 },
};

/**
 * Tablet-first creative sandbox scene. Physics deliberately stays custom and
 * deterministic: one projectile, one spherical collider, and a fixed step.
 */
export class MoonSculptingScene {
  readonly group = new THREE.Group();

  private readonly moonRoot = new THREE.Group();
  private readonly moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 128, 96);
  private readonly moonBasePositions: Float32Array;
  private moonTextureCanvas: HTMLCanvasElement | null = null;
  private moonBasePixels: Uint8ClampedArray | null = null;
  private readonly moonTexture = this.createMoonTexture();
  private readonly moonMaterial = new THREE.MeshStandardMaterial({
    color: '#e5dfd0',
    map: this.moonTexture,
    bumpMap: this.moonTexture,
    bumpScale: 0.018,
    roughness: 0.98,
    metalness: 0,
    vertexColors: true,
  });
  private readonly moon = new THREE.Mesh(this.moonGeometry, this.moonMaterial);
  private readonly craterMaterial = new THREE.MeshStandardMaterial({
    color: '#bbb5aa',
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  private readonly lavaMaterial = new THREE.MeshStandardMaterial({
    color: HOT_LAVA,
    emissive: HOT_EMISSIVE,
    emissiveIntensity: 2.2,
    roughness: 0.65,
    metalness: 0,
  });
  private readonly mareMaterial = new THREE.MeshStandardMaterial({
    color: '#343638',
    roughness: 0.99,
    metalness: 0,
  });
  private readonly selectionMaterial = new THREE.LineBasicMaterial({
    color: '#ffd36b',
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });

  private readonly meteor = new THREE.Group();
  private readonly meteorRock: THREE.Mesh;
  private readonly meteorHitArea: THREE.Mesh;
  private readonly meteorTrail: THREE.Mesh;
  private readonly meteorGeometry = this.createMeteorGeometry();
  private readonly meteorMaterial = new THREE.MeshStandardMaterial({
    color: '#6f4a3e',
    roughness: 0.94,
    metalness: 0.04,
    flatShading: true,
  });
  private readonly meteorHitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly trailMaterial = new THREE.MeshBasicMaterial({
    color: '#ffab5f',
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  private readonly trajectoryGeometry = new THREE.BufferGeometry();
  private readonly trajectoryMaterial = new THREE.LineDashedMaterial({
    color: '#ffe3a0',
    transparent: true,
    opacity: 0.72,
    dashSize: 0.12,
    gapSize: 0.09,
  });
  private readonly trajectory: THREE.Line;
  private readonly sling = new THREE.Group();
  private readonly slingBandGeometry = new THREE.BufferGeometry();
  private readonly slingBandMaterial = new THREE.LineBasicMaterial({ color: '#d4a66f' });
  private readonly slingBand: THREE.Line;
  private readonly lavaLight = new THREE.PointLight('#ff6d32', 0, 8, 2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -LAUNCH_DEPTH);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly moonWorldCenter = new THREE.Vector3();
  private readonly previousProjectilePosition = new THREE.Vector3();
  private readonly projectileVelocity = new THREE.Vector3();
  private readonly craterRecords: CraterRecord[] = [];
  private readonly bursts: ImpactBurst[] = [];
  private readonly launcherAnchor = new THREE.Vector3(0, -2.26, LAUNCH_DEPTH);

  private active = false;
  private state: SculptingState = 'ready';
  private meteorSize: MeteorSize = 'medium';
  private selectedCraterId: number | null = null;
  private activeLavaId: number | null = null;
  private activePointerId: number | null = null;
  private pointerMode: 'none' | 'aim' | 'moon' = 'none';
  private pointerStartX = 0;
  private pointerStartY = 0;
  private moonStartYaw = 0;
  private moonStartPitch = 0;
  private pointerMoved = false;
  private accumulator = 0;
  private flightAge = 0;
  private reloadTimer = 0;
  private elapsed = 0;
  private craterId = 0;
  private cameraShake = 0;
  private currentAspect = 16 / 9;
  private lastImpactNormal: THREE.Vector3 | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const moonPositions = this.moonGeometry.getAttribute('position') as THREE.BufferAttribute;
    this.moonBasePositions = new Float32Array(moonPositions.array as ArrayLike<number>);
    const moonColors = new Float32Array(moonPositions.count * 3);
    moonColors.fill(1);
    this.moonGeometry.setAttribute('color', new THREE.Float32BufferAttribute(moonColors, 3));
    this.moon.receiveShadow = true;
    this.moonRoot.add(this.moon);
    this.group.add(this.moonRoot);

    this.meteorRock = new THREE.Mesh(this.meteorGeometry, this.meteorMaterial);
    this.meteorRock.castShadow = false;
    this.meteorHitArea = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.meteorHitMaterial);
    this.meteorTrail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.1, 8, 1, true), this.trailMaterial);
    this.meteorTrail.position.y = -0.55;
    this.meteorTrail.visible = false;
    this.meteor.add(this.meteorRock, this.meteorHitArea, this.meteorTrail);
    this.group.add(this.meteor);

    this.trajectoryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(38 * 3), 3));
    this.trajectory = new THREE.Line(this.trajectoryGeometry, this.trajectoryMaterial);
    this.trajectory.computeLineDistances();
    this.trajectory.visible = false;
    this.group.add(this.trajectory);

    this.slingBandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    this.slingBand = new THREE.Line(this.slingBandGeometry, this.slingBandMaterial);
    this.createSling();
    this.group.add(this.sling, this.slingBand, this.lavaLight);
    this.group.visible = false;
    this.applyLayout(this.currentAspect);
    this.resetMeteor();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.group.visible = active;
    if (!active) this.cancelPointer();
    if (active) this.resetMeteor();
  }

  isActive(): boolean {
    return this.active;
  }

  update(delta: number, reducedMotion: boolean): void {
    if (!this.active) return;
    this.elapsed += delta;
    this.applyLayout(this.camera.aspect);

    if (this.state === 'flying') {
      this.accumulator += Math.min(delta, 0.08);
      while (this.accumulator >= FIXED_STEP && this.state === 'flying') {
        this.stepProjectile(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.meteorRock.rotation.x += delta * 7.2;
      this.meteorRock.rotation.z += delta * 5.3;
      this.updateTrail();
    } else if (this.state === 'reloading') {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) this.resetMeteor();
    }

    this.updateLava(delta);
    this.updateBursts(delta, reducedMotion);
    this.cameraShake = Math.max(0, this.cameraShake - delta * 2.8);
    this.lavaLight.intensity = this.activeLavaId === null ? 0 : 1.15 + Math.sin(this.elapsed * 8) * 0.16;
  }

  applyCamera(delta: number, reducedMotion: boolean): void {
    const portrait = this.camera.aspect < 0.9;
    const target = new THREE.Vector3(0, portrait ? -0.22 : 0, portrait ? 14.3 : 11.7);
    this.camera.position.lerp(target, 1 - Math.exp(-delta * 5.2));
    const shake = reducedMotion ? 0 : this.cameraShake * this.cameraShake * 0.075;
    this.camera.position.x += Math.sin(this.elapsed * 79) * shake;
    this.camera.position.y += Math.cos(this.elapsed * 67) * shake;
    this.camera.lookAt(0, portrait ? -0.18 : 0, 0);
  }

  handlePointerDown(event: PointerEvent): boolean {
    if (!this.active || this.activePointerId !== null) return false;
    this.updateRay(event);

    if (this.state === 'ready' && this.raycaster.intersectObject(this.meteorHitArea, true).length > 0) {
      this.activePointerId = event.pointerId;
      this.pointerMode = 'aim';
      this.state = 'aiming';
      this.canvas.setPointerCapture?.(event.pointerId);
      this.dragMeteor(event);
      return true;
    }

    const moonHit = this.raycaster.intersectObject(this.moon, false)[0];
    if (moonHit) {
      this.activePointerId = event.pointerId;
      this.pointerMode = 'moon';
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.moonStartYaw = this.moonRoot.rotation.y;
      this.moonStartPitch = this.moonRoot.rotation.x;
      this.pointerMoved = false;
      this.canvas.setPointerCapture?.(event.pointerId);
      return true;
    }
    return false;
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (!this.active || event.pointerId !== this.activePointerId) return false;
    if (this.pointerMode === 'aim') {
      this.dragMeteor(event);
      return true;
    }
    if (this.pointerMode === 'moon') {
      const dx = event.clientX - this.pointerStartX;
      const dy = event.clientY - this.pointerStartY;
      this.pointerMoved ||= Math.hypot(dx, dy) > 7;
      this.moonRoot.rotation.y = this.moonStartYaw + dx * 0.007;
      this.moonRoot.rotation.x = THREE.MathUtils.clamp(this.moonStartPitch + dy * 0.005, -0.75, 0.75);
      return true;
    }
    return false;
  }

  handlePointerUp(event: PointerEvent): boolean {
    if (!this.active || event.pointerId !== this.activePointerId) return false;
    const mode = this.pointerMode;
    if (mode === 'aim') this.launchMeteor();
    if (mode === 'moon' && !this.pointerMoved) this.selectCraterAt(event);
    this.cancelPointer();
    return mode !== 'none';
  }

  setMeteorSize(size: MeteorSize): void {
    if (this.state === 'flying' || this.state === 'aiming') return;
    this.meteorSize = size;
    this.resetMeteor();
  }

  eruptSelected(): boolean {
    if (this.selectedCraterId === null) return false;
    const crater = this.craterRecords.find((candidate) => candidate.id === this.selectedCraterId);
    if (!crater) return false;
    if (crater.state === 'erupting' && crater.id === this.activeLavaId) {
      this.beginCooling(crater);
      return true;
    }
    if (this.activeLavaId !== null || crater.state !== 'fresh') return false;
    crater.state = 'erupting';
    crater.lavaProgress = 0;
    crater.coolingProgress = 0;
    crater.fillScale = 0.04;
    crater.lava.visible = true;
    crater.lava.scale.setScalar(crater.fillScale);
    crater.mare.visible = false;
    this.activeLavaId = crater.id;
    this.lavaLight.position.copy(crater.normal).multiplyScalar(MOON_RADIUS + 1.1).applyQuaternion(this.moonRoot.quaternion);
    this.lavaLight.position.add(this.moonRoot.position);
    return true;
  }

  reset(): void {
    for (const crater of this.craterRecords) {
      crater.basin.geometry.dispose();
      crater.lava.geometry.dispose();
      crater.mare.geometry.dispose();
      crater.selection.geometry.dispose();
      (crater.lava.material as THREE.Material).dispose();
      this.moonRoot.remove(crater.group);
    }
    this.craterRecords.length = 0;
    this.rebuildMoonSurface();
    this.craterId = 0;
    this.selectedCraterId = null;
    this.activeLavaId = null;
    this.lastImpactNormal = null;
    this.moonRoot.rotation.set(0.08, -0.16, 0);
    this.clearBursts();
    this.resetMeteor();
  }

  createDemoCrater(withLava = false): void {
    if (!this.active) this.setActive(true);
    const crater = this.createCrater(new THREE.Vector3(-0.22, 0.2, 0.96).normalize(), 'large');
    this.selectCrater(crater.id);
    if (withLava) this.eruptSelected();
  }

  createStressCraters(count = MAX_CRATERS): void {
    this.reset();
    const total = Math.min(count, MAX_CRATERS);
    for (let index = 0; index < total; index += 1) {
      const angle = index * 2.399963;
      const radial = 0.18 + 0.72 * Math.sqrt((index + 0.5) / total);
      const normal = new THREE.Vector3(
        Math.cos(angle) * radial,
        Math.sin(angle) * radial,
        Math.sqrt(Math.max(1 - radial * radial, 0.08)),
      ).normalize();
      const size: MeteorSize = index % 9 === 0 ? 'large' : index % 3 === 0 ? 'medium' : 'small';
      const crater = this.createCrater(normal, size);
      crater.state = 'mare';
      crater.lavaProgress = 1;
      crater.fillScale = 1;
      crater.basin.visible = false;
      crater.mare.visible = false;
      crater.mare.scale.setScalar(1);
      crater.mare.position.z = LAVA_OVERFLOW_LEVEL;
    }
    this.rebuildMoonSurface();
    this.selectCrater(this.craterRecords.at(-1)?.id ?? null);
  }

  createDemoMareImpact(): void {
    if (!this.active) this.setActive(true);
    this.reset();
    const impactNormal = new THREE.Vector3(-0.22, 0.2, 0.96).normalize();
    const sea = this.createCrater(impactNormal, 'large');
    sea.state = 'mare';
    sea.lavaProgress = 1;
    sea.fillScale = 1;
    sea.basin.visible = false;
    sea.mare.visible = false;
    this.rebuildMoonSurface();
    const newCrater = this.createCrater(impactNormal, 'medium');
    this.selectCrater(newCrater.id);
  }

  createDemoMarePatches(): void {
    if (!this.active) this.setActive(true);
    this.reset();
    const samples: Array<{ normal: THREE.Vector3; size: MeteorSize; fillScale: number }> = [
      { normal: new THREE.Vector3(-0.42, -0.12, 0.9).normalize(), size: 'large', fillScale: 0.24 },
      { normal: new THREE.Vector3(0.02, -0.02, 1).normalize(), size: 'large', fillScale: 0.43 },
      { normal: new THREE.Vector3(0.36, 0.11, 0.93).normalize(), size: 'medium', fillScale: 0.68 },
    ];
    for (const sample of samples) {
      const sea = this.createCrater(sample.normal, sample.size);
      sea.state = 'mare';
      sea.lavaProgress = sample.fillScale;
      sea.fillScale = sample.fillScale;
      sea.basin.visible = false;
      sea.mare.visible = false;
    }
    this.rebuildMoonSurface();
    this.selectCrater(null);
  }

  getSnapshot(): SculptingSnapshot {
    const selectedCrater = this.selectedCraterId === null
      ? null
      : this.craterRecords.find((crater) => crater.id === this.selectedCraterId) ?? null;
    const activeLava = this.activeLavaId === null
      ? null
      : this.craterRecords.find((crater) => crater.id === this.activeLavaId) ?? null;
    return {
      active: this.active,
      state: this.state,
      meteorSize: this.meteorSize,
      craterCount: this.craterRecords.length,
      mareCount: this.craterRecords.filter((crater) => crater.state === 'mare').length,
      selectedCraterId: this.selectedCraterId,
      selectedCraterState: selectedCrater?.state ?? null,
      canErupt: selectedCrater?.state === 'fresh' && this.activeLavaId === null,
      lavaAction: selectedCrater?.state === 'erupting' && selectedCrater.id === this.activeLavaId
        ? 'stop'
        : selectedCrater?.state === 'fresh' && this.activeLavaId === null
          ? 'erupt'
          : null,
      lavaProgress: selectedCrater?.lavaProgress ?? activeLava?.lavaProgress ?? 0,
      projectileSpeed: this.projectileVelocity.length(),
      lastImpactNormal: this.lastImpactNormal
        ? { x: this.lastImpactNormal.x, y: this.lastImpactNormal.y, z: this.lastImpactNormal.z }
        : null,
      physics: {
        engine: 'custom-fixed-step',
        timestep: FIXED_STEP,
        bodies: this.state === 'flying' ? 1 : 0,
        colliders: 1,
        ccd: true,
      },
    };
  }

  dispose(): void {
    this.reset();
    this.moonGeometry.dispose();
    this.moonTexture.dispose();
    this.moonMaterial.dispose();
    this.craterMaterial.dispose();
    this.lavaMaterial.dispose();
    this.mareMaterial.dispose();
    this.selectionMaterial.dispose();
    this.meteorGeometry.dispose();
    this.meteorMaterial.dispose();
    this.meteorHitArea.geometry.dispose();
    this.meteorHitMaterial.dispose();
    this.meteorTrail.geometry.dispose();
    this.trailMaterial.dispose();
    this.trajectoryGeometry.dispose();
    this.trajectoryMaterial.dispose();
    this.slingBandGeometry.dispose();
    this.slingBandMaterial.dispose();
    this.sling.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    });
  }

  private createMoonTexture(): THREE.CanvasTexture {
    const width = 512;
    const height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create sculpting moon texture.');
    const image = context.createImageData(width, height);
    const hash = (x: number, y: number): number => {
      let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x5bf03635;
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    };
    const valueNoise = (u: number, v: number, columns: number, rows: number): number => {
      const sampleX = u * columns;
      const sampleY = v * rows;
      const x0 = Math.floor(sampleX);
      const y0 = Math.floor(sampleY);
      const x1 = (x0 + 1) % columns;
      const y1 = Math.min(y0 + 1, rows);
      const tx = THREE.MathUtils.smoothstep(sampleX - x0, 0, 1);
      const ty = THREE.MathUtils.smoothstep(sampleY - y0, 0, 1);
      const top = THREE.MathUtils.lerp(hash(x0 % columns, y0), hash(x1, y0), tx);
      const bottom = THREE.MathUtils.lerp(hash(x0 % columns, y1), hash(x1, y1), tx);
      return THREE.MathUtils.lerp(top, bottom, ty);
    };
    const textureCraters = Array.from({ length: 64 }, (_, index) => ({
      x: hash(index + 17, 41) * width,
      y: (0.07 + hash(index + 31, 73) * 0.86) * height,
      radius: 1.15 + Math.pow(hash(index + 59, 107), 2.15) * 5.6,
    }));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const u = x / width;
        const v = y / (height - 1);
        const broad = (valueNoise(u, v, 5, 3) - 0.5) * 36;
        const regional = (valueNoise(u, v, 12, 7) - 0.5) * 22;
        const granular = (valueNoise(u, v, 34, 18) - 0.5) * 12;
        const dust = (valueNoise(u, v, 96, 48) - 0.5) * 5;
        let microRelief = 0;
        for (const crater of textureCraters) {
          const directX = Math.abs(x - crater.x);
          const dx = Math.min(directX, width - directX);
          const dy = y - crater.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= crater.radius) continue;
          const t = distance / crater.radius;
          const bowl = -9 * (1 - THREE.MathUtils.smoothstep(t, 0.08, 0.72));
          const rim = 7 * Math.exp(-Math.pow((t - 0.82) / 0.11, 2));
          microRelief += bowl + rim;
        }
        const value = THREE.MathUtils.clamp(Math.round(184 + broad + regional + granular + dust + microRelief), 150, 211);
        const offset = (y * width + x) * 4;
        image.data[offset] = value + 2;
        image.data[offset + 1] = value + 1;
        image.data[offset + 2] = value - 2;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    this.moonTextureCanvas = canvas;
    this.moonBasePixels = new Uint8ClampedArray(image.data);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private createMeteorGeometry(): THREE.IcosahedronGeometry {
    const geometry = new THREE.IcosahedronGeometry(0.24, 2);
    const positions = geometry.attributes.position;
    const point = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index);
      const distortion = 1 + Math.sin(index * 7.13) * 0.11 + Math.cos(index * 3.71) * 0.055;
      point.multiplyScalar(distortion);
      positions.setXYZ(index, point.x, point.y, point.z);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  private createSling(): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#7b5134', roughness: 0.92 });
    const postGeometry = new THREE.CylinderGeometry(0.09, 0.13, 0.95, 8);
    const left = new THREE.Mesh(postGeometry, wood);
    left.position.set(-0.2, 0.08, 0);
    left.rotation.z = -0.12;
    const right = left.clone();
    right.position.x = 0.2;
    right.rotation.z = 0.12;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.7, 8), wood);
    base.position.y = -0.65;
    this.sling.add(left, right, base);
  }

  private applyLayout(aspect: number): void {
    if (Math.abs(aspect - this.currentAspect) < 0.01 && this.group.visible) return;
    this.currentAspect = aspect;
    const portrait = aspect < 0.9;
    this.moonRoot.position.set(0, portrait ? 0.72 : 0.25, 0);
    // Perspective compensation keeps the foreground launcher at the same
    // bottom-center screen position even though it now sits in front of the moon.
    this.launcherAnchor.set(0, portrait ? -2.45 : -2.26, LAUNCH_DEPTH);
    this.sling.position.copy(this.launcherAnchor).add(new THREE.Vector3(0, -0.42, -0.05));
    if (this.state === 'ready' || this.state === 'reloading') this.meteor.position.copy(this.launcherAnchor);
    this.updateSlingBand();
  }

  private resetMeteor(): void {
    this.state = 'ready';
    this.flightAge = 0;
    this.accumulator = 0;
    this.projectileVelocity.set(0, 0, 0);
    this.meteor.visible = true;
    this.meteor.position.copy(this.launcherAnchor);
    const scale = SIZE_TUNING[this.meteorSize].meteor;
    this.meteor.scale.setScalar(scale);
    this.meteorTrail.visible = false;
    this.trajectory.visible = false;
    this.updateSlingBand();
  }

  private dragMeteor(event: PointerEvent): void {
    if (!this.pointerToPlane(event, this.pointerWorld)) return;
    const offset = this.pointerWorld.sub(this.launcherAnchor);
    if (offset.length() > MAX_PULL) offset.setLength(MAX_PULL);
    offset.x = THREE.MathUtils.clamp(offset.x, -0.9, 0.9);
    this.meteor.position.copy(this.launcherAnchor).add(offset);
    this.projectileVelocity.copy(this.launcherAnchor).sub(this.meteor.position).multiplyScalar(LAUNCH_POWER);
    const pullStrength = Math.hypot(offset.x, offset.y);
    this.projectileVelocity.z = -pullStrength * LAUNCH_POWER * INWARD_LAUNCH_RATIO;
    this.updateTrajectory();
    this.updateSlingBand();
  }

  private launchMeteor(): void {
    if (this.projectileVelocity.length() < 1.05) {
      this.resetMeteor();
      return;
    }
    this.state = 'flying';
    this.flightAge = 0;
    this.accumulator = 0;
    this.trajectory.visible = false;
    this.meteorTrail.visible = true;
    this.updateSlingBand();
  }

  private stepProjectile(delta: number): void {
    this.flightAge += delta;
    this.previousProjectilePosition.copy(this.meteor.position);
    this.getMoonWorldCenter(this.moonWorldCenter);
    const gravity = this.moonWorldCenter.clone().sub(this.meteor.position);
    const distanceSq = Math.max(gravity.lengthSq(), 2.5);
    gravity.normalize().multiplyScalar(MOON_GRAVITY * (9 / distanceSq));
    this.projectileVelocity.addScaledVector(gravity, delta);
    this.meteor.position.addScaledVector(this.projectileVelocity, delta);

    const meteorRadius = 0.19 * SIZE_TUNING[this.meteorSize].meteor;
    const hit = this.segmentSphereHit(
      this.previousProjectilePosition,
      this.meteor.position,
      this.moonWorldCenter,
      MOON_RADIUS + meteorRadius,
    );
    if (hit) {
      this.impact(hit);
      return;
    }
    if (this.flightAge > 5 || this.meteor.position.length() > 15) this.beginReload(0.45);
  }

  private impact(worldPoint: THREE.Vector3): void {
    const worldNormal = worldPoint.clone().sub(this.moonWorldCenter).normalize();
    const localNormal = worldNormal.clone().applyQuaternion(this.moonRoot.quaternion.clone().invert());
    this.lastImpactNormal = localNormal.clone();
    const crater = this.createCrater(localNormal, this.meteorSize);
    this.selectCrater(crater.id);
    const burst = new ImpactBurst(worldPoint.clone().addScaledVector(worldNormal, 0.025), worldNormal, crater.id);
    this.bursts.push(burst);
    this.group.add(burst.group);
    this.cameraShake = this.meteorSize === 'large' ? 1 : this.meteorSize === 'medium' ? 0.72 : 0.48;
    this.beginReload(0.82);
  }

  private beginReload(delay: number): void {
    this.state = 'reloading';
    this.reloadTimer = delay;
    this.meteor.visible = false;
    this.meteorTrail.visible = false;
    this.trajectory.visible = false;
    this.projectileVelocity.set(0, 0, 0);
    this.updateSlingBand();
  }

  private createCrater(normal: THREE.Vector3, size: MeteorSize): CraterRecord {
    let mareTextureChanged = false;
    if (this.craterRecords.length >= MAX_CRATERS) {
      const oldest = this.craterRecords.shift();
      if (oldest) {
        mareTextureChanged = oldest.state === 'mare';
        oldest.basin.geometry.dispose();
        oldest.lava.geometry.dispose();
        oldest.mare.geometry.dispose();
        oldest.selection.geometry.dispose();
        (oldest.lava.material as THREE.Material).dispose();
        this.moonRoot.remove(oldest.group);
      }
    }
    const id = this.craterId++;
    const tuning = SIZE_TUNING[size];
    const group = new THREE.Group();
    group.position.copy(normal).multiplyScalar(MOON_RADIUS);
    group.quaternion.setFromUnitVectors(FRONT, normal);
    const basin = new THREE.Mesh(this.createCraterGeometry(tuning.crater, tuning.depth, id), this.craterMaterial);
    basin.userData.craterId = id;
    const patchGeometry = this.createSurfacePatchGeometry(tuning.crater * 1.72, id + 71);
    const lava = new THREE.Mesh(patchGeometry, this.lavaMaterial.clone());
    lava.position.z = -tuning.depth * 0.82;
    lava.scale.setScalar(0.04);
    lava.visible = false;
    lava.userData.craterId = id;
    const mare = new THREE.Mesh(this.createSurfacePatchGeometry(tuning.crater * 1.86, id + 97), this.mareMaterial);
    mare.position.z = -tuning.depth * 0.82;
    mare.scale.setScalar(0.04);
    mare.visible = false;
    mare.userData.craterId = id;
    const selection = new THREE.LineSegments(this.createSelectionGeometry(tuning.crater * 1.62), this.selectionMaterial);
    selection.position.z = tuning.depth * 0.18 + 0.052;
    selection.visible = false;
    selection.userData.craterId = id;
    group.add(basin, mare, lava, selection);
    this.moonRoot.add(group);
    const record: CraterRecord = {
      id,
      normal: normal.clone(),
      radius: tuning.crater,
      depth: tuning.depth,
      state: 'fresh',
      lavaProgress: 0,
      coolingProgress: 0,
      fillScale: 0.04,
      group,
      basin,
      lava,
      mare,
      selection,
    };
    this.craterRecords.push(record);
    this.rebuildMoonSurface(mareTextureChanged);
    return record;
  }

  private createCraterGeometry(radius: number, depth: number, seed: number): THREE.BufferGeometry {
    const segments = 32;
    const rings = 10;
    const surfaceLift = 0.003;
    const positions: number[] = [0, 0, this.craterProfile(0, depth) + surfaceLift];
    const centerShade = this.craterSurfaceShade(0);
    const colors: number[] = [centerShade, centerShade * 0.975, centerShade * 0.93];
    const indices: number[] = [];
    for (let ring = 1; ring <= rings; ring += 1) {
      const t = ring / rings;
      const shade = this.craterSurfaceShade(t);
      for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const wobble = 1 + Math.sin(angle * (3 + (seed % 3)) + seed * 0.7) * 0.075 + Math.sin(angle * 7 - seed) * 0.026;
        const ringRadius = radius * t * wobble;
        const surfaceCurve = Math.sqrt(Math.max(MOON_RADIUS * MOON_RADIUS - ringRadius * ringRadius, 0.001)) - MOON_RADIUS;
        const relief = this.craterProfile(t, depth) + surfaceLift;
        positions.push(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, surfaceCurve + relief);
        colors.push(shade, shade * 0.975, shade * 0.93);
      }
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
    }
    for (let ring = 1; ring < rings; ring += 1) {
      const current = 1 + (ring - 1) * segments;
      const nextRing = current + segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(current + segment, nextRing + segment, current + next);
        indices.push(current + next, nextRing + segment, nextRing + next);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private craterProfile(t: number, depth: number): number {
    const normalizedBowl = Math.min(t / 0.79, 1);
    const bowl = -depth * Math.pow(Math.max(0, 1 - normalizedBowl * normalizedBowl), 1.35);
    const rim = depth * 0.045 * Math.exp(-Math.pow((t - 0.855) / 0.075, 2));
    return bowl + rim;
  }

  private craterSurfaceShade(t: number): number {
    if (t < 0.34) return THREE.MathUtils.lerp(0.38, 0.34, t / 0.34);
    if (t < 0.7) return THREE.MathUtils.lerp(0.34, 0.5, (t - 0.34) / 0.36);
    if (t < 0.84) return THREE.MathUtils.lerp(0.5, 0.68, (t - 0.7) / 0.14);
    if (t < 0.92) return THREE.MathUtils.lerp(0.72, 0.67, (t - 0.84) / 0.08);
    return THREE.MathUtils.lerp(0.72, 0.84, (t - 0.92) / 0.08);
  }

  private rebuildMoonSurface(updateTexture = true): void {
    const position = this.moonGeometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.moonGeometry.getAttribute('color') as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3;
      const baseX = this.moonBasePositions[offset];
      const baseY = this.moonBasePositions[offset + 1];
      const baseZ = this.moonBasePositions[offset + 2];
      const inverseLength = 1 / Math.hypot(baseX, baseY, baseZ);
      const nx = baseX * inverseLength;
      const ny = baseY * inverseLength;
      const nz = baseZ * inverseLength;
      let radialOffset = 0;
      let surfaceR = 1;
      let surfaceG = 1;
      let surfaceB = 1;

      for (const crater of this.craterRecords) {
        const dot = THREE.MathUtils.clamp(nx * crater.normal.x + ny * crater.normal.y + nz * crater.normal.z, -1, 1);
        const surfaceDistance = Math.sqrt(Math.max(0, 2 - 2 * dot)) * MOON_RADIUS;
        if (crater.state !== 'mare' && surfaceDistance < crater.radius * 1.48 && surfaceDistance >= crater.radius) {
          const ejectaT = (surfaceDistance / crater.radius - 1) / 0.48;
          const angle = Math.atan2(
            ny * crater.normal.z - nz * crater.normal.y,
            nx * crater.normal.y - ny * crater.normal.x + 0.0001,
          );
          const rayVariation = 0.5 + 0.5 * Math.sin(angle * (7 + (crater.id % 4)) + crater.id * 1.37);
          const coverage = (1 - THREE.MathUtils.smoothstep(ejectaT, 0, 1)) * (0.16 + rayVariation * 0.12);
          const ejectaShade = 0.9 + rayVariation * 0.055;
          surfaceR = THREE.MathUtils.lerp(surfaceR, ejectaShade, coverage);
          surfaceG = THREE.MathUtils.lerp(surfaceG, ejectaShade * 0.985, coverage);
          surfaceB = THREE.MathUtils.lerp(surfaceB, ejectaShade * 0.95, coverage);
        }
        if (surfaceDistance >= crater.radius) continue;
        const t = surfaceDistance / crater.radius;
        radialOffset += this.craterProfile(t, crater.depth);
        if (crater.state !== 'mare') {
          const craterShade = this.craterSurfaceShade(t);
          surfaceR = craterShade;
          surfaceG = craterShade * 0.975;
          surfaceB = craterShade * 0.93;
        }
      }

      const deformedRadius = MOON_RADIUS + Math.max(radialOffset, -0.28);
      position.setXYZ(index, nx * deformedRadius, ny * deformedRadius, nz * deformedRadius);
      color.setXYZ(index, surfaceR, surfaceG, surfaceB);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.moonGeometry.computeVertexNormals();
    this.moonGeometry.computeBoundingSphere();
    if (updateTexture) this.rebuildMoonTexture();
  }

  private rebuildMoonTexture(): void {
    if (!this.moonTextureCanvas || !this.moonBasePixels) return;
    const context = this.moonTextureCanvas.getContext('2d');
    if (!context) return;
    const width = this.moonTextureCanvas.width;
    const height = this.moonTextureCanvas.height;
    const image = context.createImageData(width, height);
    image.data.set(this.moonBasePixels);
    const mares = this.craterRecords
      .filter((crater) => crater.state === 'mare')
      .map((crater) => {
        const reference = Math.abs(crater.normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const tangentX = reference.cross(crater.normal).normalize();
        const tangentY = new THREE.Vector3().crossVectors(crater.normal, tangentX).normalize();
        return { crater, tangentX, tangentY };
      });

    if (mares.length === 0) {
      context.putImageData(image, 0, 0);
      this.moonTexture.needsUpdate = true;
      return;
    }

    for (let y = 0; y < height; y += 1) {
      const phi = (y / (height - 1)) * Math.PI;
      const sinPhi = Math.sin(phi);
      const ny = Math.cos(phi);
      for (let x = 0; x < width; x += 1) {
        const theta = (x / width) * Math.PI * 2;
        const nx = -Math.cos(theta) * sinPhi;
        const nz = Math.sin(theta) * sinPhi;
        const offset = (y * width + x) * 4;
        let red = image.data[offset];
        let green = image.data[offset + 1];
        let blue = image.data[offset + 2];

        for (const { crater, tangentX, tangentY } of mares) {
          const dot = THREE.MathUtils.clamp(
            nx * crater.normal.x + ny * crater.normal.y + nz * crater.normal.z,
            -1,
            1,
          );
          const surfaceDistance = Math.sqrt(Math.max(0, 2 - 2 * dot)) * MOON_RADIUS;
          const localX = nx * tangentX.x + ny * tangentX.y + nz * tangentX.z;
          const localY = nx * tangentY.x + ny * tangentY.y + nz * tangentY.z;
          const angle = Math.atan2(localY, localX);
          const coastVariation =
            Math.sin(angle * 3 + crater.id * 0.83) * 0.085 +
            Math.sin(angle * 5 - crater.id * 0.47) * 0.045 +
            Math.sin(angle * 9 + crater.id * 1.19) * 0.022;
          const mareRadius = crater.radius * 1.86 * crater.fillScale * (1 + coastVariation);
          if (surfaceDistance >= mareRadius) continue;
          const coverage = 1 - THREE.MathUtils.smoothstep(surfaceDistance / mareRadius, 0.7, 1);
          const mottling =
            Math.sin(nx * 43 + ny * 61 + nz * 37 + crater.id) * 3.5 +
            Math.sin(nx * 97 - ny * 53 + nz * 71 - crater.id * 0.7) * 2;
          const opacity = coverage * 0.86;
          red = THREE.MathUtils.lerp(red, 94 + mottling, opacity);
          green = THREE.MathUtils.lerp(green, 95 + mottling * 0.92, opacity);
          blue = THREE.MathUtils.lerp(blue, 92 + mottling * 0.78, opacity);
        }

        image.data[offset] = Math.round(red);
        image.data[offset + 1] = Math.round(green);
        image.data[offset + 2] = Math.round(blue);
      }
    }
    context.putImageData(image, 0, 0);
    this.moonTexture.needsUpdate = true;
  }

  private createSurfacePatchGeometry(radius: number, seed: number): THREE.BufferGeometry {
    const segments = 36;
    const positions: number[] = [0, 0, 0.008];
    const indices: number[] = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const wobble = 1 + Math.sin(angle * 3 + seed) * 0.1 + Math.sin(angle * 7 - seed * 0.4) * 0.035;
      const x = Math.cos(angle) * radius * wobble;
      const y = Math.sin(angle) * radius * wobble;
      const z = Math.sqrt(Math.max(MOON_RADIUS * MOON_RADIUS - x * x - y * y, 0.001)) - MOON_RADIUS + 0.01;
      positions.push(x, y, z);
      indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createSelectionGeometry(radius: number): THREE.BufferGeometry {
    const positions: number[] = [];
    for (let marker = 0; marker < 4; marker += 1) {
      const angle = marker * Math.PI * 0.5;
      const halfArc = 0.12;
      positions.push(
        Math.cos(angle - halfArc) * radius,
        Math.sin(angle - halfArc) * radius,
        0,
        Math.cos(angle + halfArc) * radius,
        Math.sin(angle + halfArc) * radius,
        0,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  private updateLava(delta: number): void {
    if (this.activeLavaId === null) return;
    const crater = this.craterRecords.find((candidate) => candidate.id === this.activeLavaId);
    if (!crater) {
      this.activeLavaId = null;
      return;
    }
    if (crater.state === 'erupting') {
      crater.lavaProgress = Math.min(1, crater.lavaProgress + delta / LAVA_DURATION);
      const filling = THREE.MathUtils.smoothstep(crater.lavaProgress, 0, LAVA_SPILL_START);
      const spilling = THREE.MathUtils.smoothstep(crater.lavaProgress, LAVA_SPILL_START, 1);
      crater.fillScale = crater.lavaProgress < LAVA_SPILL_START
        ? THREE.MathUtils.lerp(0.04, 0.58, filling)
        : THREE.MathUtils.lerp(0.58, 1, spilling);
      crater.lava.scale.setScalar(crater.fillScale);
      crater.lava.position.z = crater.lavaProgress < LAVA_SPILL_START
        ? THREE.MathUtils.lerp(-crater.depth * 0.82, LAVA_RIM_LEVEL, filling)
        : THREE.MathUtils.lerp(LAVA_RIM_LEVEL, LAVA_OVERFLOW_LEVEL, spilling);
      if (crater.lavaProgress >= 1) {
        this.beginCooling(crater);
      }
      return;
    }
    if (crater.state === 'cooling') {
      crater.coolingProgress = Math.min(1, crater.coolingProgress + delta / COOLING_DURATION);
      const cooling = THREE.MathUtils.smoothstep(crater.coolingProgress, 0, 1);
      const material = crater.lava.material as THREE.MeshStandardMaterial;
      material.color.lerpColors(HOT_LAVA, COOL_LAVA, cooling);
      material.emissive.lerpColors(HOT_EMISSIVE, COOL_EMISSIVE, cooling);
      material.emissiveIntensity = THREE.MathUtils.lerp(2.2, 0.04, cooling);
      crater.mare.scale.setScalar(crater.fillScale);
      if (crater.coolingProgress >= 1) {
        crater.state = 'mare';
        crater.lava.visible = false;
        crater.basin.visible = false;
        crater.mare.visible = false;
        material.dispose();
        this.activeLavaId = null;
        this.rebuildMoonSurface();
      }
    }
  }

  private beginCooling(crater: CraterRecord): void {
    crater.state = 'cooling';
    crater.coolingProgress = 0;
    crater.fillScale = crater.lava.scale.x;
    crater.mare.visible = true;
    crater.mare.scale.setScalar(crater.fillScale);
    crater.mare.position.z = crater.lava.position.z;
  }

  private updateBursts(delta: number, reducedMotion: boolean): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      if (!burst.update(delta, reducedMotion)) continue;
      this.group.remove(burst.group);
      burst.dispose();
      this.bursts.splice(index, 1);
    }
  }

  private clearBursts(): void {
    for (const burst of this.bursts) {
      this.group.remove(burst.group);
      burst.dispose();
    }
    this.bursts.length = 0;
  }

  private selectCraterAt(event: PointerEvent): void {
    this.updateRay(event);
    const candidates = this.craterRecords.flatMap((crater) => [crater.basin, crater.lava, crater.mare]);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    const id = typeof hit?.object.userData.craterId === 'number' ? hit.object.userData.craterId : null;
    this.selectCrater(id);
  }

  private selectCrater(id: number | null): void {
    if (this.activeLavaId !== null && id !== this.activeLavaId) return;
    this.selectedCraterId = id;
    for (const crater of this.craterRecords) crater.selection.visible = crater.id === id;
  }

  private updateTrajectory(): void {
    const attribute = this.trajectoryGeometry.getAttribute('position') as THREE.BufferAttribute;
    const point = this.meteor.position.clone();
    const velocity = this.projectileVelocity.clone();
    this.getMoonWorldCenter(this.moonWorldCenter);
    const step = 0.075;
    const meteorRadius = 0.19 * SIZE_TUNING[this.meteorSize].meteor;
    let visiblePoints = attribute.count;
    for (let index = 0; index < attribute.count; index += 1) {
      attribute.setXYZ(index, point.x, point.y, point.z);
      if (index === attribute.count - 1) break;
      const gravity = this.moonWorldCenter.clone().sub(point);
      const distanceSq = Math.max(gravity.lengthSq(), 2.5);
      gravity.normalize().multiplyScalar(MOON_GRAVITY * (9 / distanceSq));
      velocity.addScaledVector(gravity, step);
      const nextPoint = point.clone().addScaledVector(velocity, step);
      const hit = this.segmentSphereHit(point, nextPoint, this.moonWorldCenter, MOON_RADIUS + meteorRadius);
      if (hit) {
        attribute.setXYZ(index + 1, hit.x, hit.y, hit.z);
        visiblePoints = index + 2;
        break;
      }
      point.copy(nextPoint);
    }
    this.trajectoryGeometry.setDrawRange(0, visiblePoints);
    attribute.needsUpdate = true;
    this.trajectoryGeometry.computeBoundingSphere();
    this.trajectory.computeLineDistances();
    this.trajectory.visible = true;
  }

  private updateTrail(): void {
    const direction = this.projectileVelocity.clone().normalize();
    this.meteor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    this.meteorTrail.scale.y = 0.85 + Math.sin(this.elapsed * 31) * 0.12;
  }

  private updateSlingBand(): void {
    const attribute = this.slingBandGeometry.getAttribute('position') as THREE.BufferAttribute;
    const left = this.launcherAnchor.clone().add(new THREE.Vector3(-0.2, 0.08, 0));
    const right = this.launcherAnchor.clone().add(new THREE.Vector3(0.2, 0.08, 0));
    const center = this.state === 'aiming' ? this.meteor.position : this.launcherAnchor;
    attribute.setXYZ(0, left.x, left.y, left.z);
    attribute.setXYZ(1, center.x, center.y, center.z);
    attribute.setXYZ(2, right.x, right.y, right.z);
    attribute.needsUpdate = true;
    this.slingBand.visible = this.state === 'ready' || this.state === 'aiming';
  }

  private updateRay(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.group.updateWorldMatrix(true, true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  private pointerToPlane(event: PointerEvent, target: THREE.Vector3): boolean {
    this.updateRay(event);
    return this.raycaster.ray.intersectPlane(this.interactionPlane, target) !== null;
  }

  private getMoonWorldCenter(target: THREE.Vector3): THREE.Vector3 {
    return this.moonRoot.getWorldPosition(target);
  }

  private cancelPointer(): void {
    if (this.activePointerId !== null && this.canvas.hasPointerCapture?.(this.activePointerId)) {
      this.canvas.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;
    this.pointerMode = 'none';
    this.pointerMoved = false;
  }

  private segmentSphereHit(
    start: THREE.Vector3,
    end: THREE.Vector3,
    center: THREE.Vector3,
    radius: number,
  ): THREE.Vector3 | null {
    const segment = end.clone().sub(start);
    const lengthSq = segment.lengthSq();
    if (lengthSq <= 1e-8) return null;
    const t = THREE.MathUtils.clamp(center.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    const closest = start.clone().addScaledVector(segment, t);
    return closest.distanceToSquared(center) <= radius * radius ? closest : null;
  }
}
