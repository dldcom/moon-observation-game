import * as THREE from 'three';

export type MeteorResources = {
  readonly rockGeometry: THREE.IcosahedronGeometry;
  readonly trailGeometry: THREE.ConeGeometry;
  readonly coreGeometry: THREE.ConeGeometry;
  readonly rockMaterials: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  readonly trailMaterials: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  readonly coreMaterials: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
};

export function createMeteorResources(): MeteorResources {
  const rockMaterials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] = [
    new THREE.MeshStandardMaterial({
      color: '#a56e5e',
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    }),
    new THREE.MeshStandardMaterial({
      color: '#c58c67',
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    }),
  ];
  const trailMaterials: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] = [
    new THREE.MeshBasicMaterial({
      color: '#ff9a56',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
    new THREE.MeshBasicMaterial({
      color: '#ffd36b',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
  ];
  const coreMaterials: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] = [
    new THREE.MeshBasicMaterial({
      color: '#ffb25f',
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
    new THREE.MeshBasicMaterial({
      color: '#fff0a8',
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
  ];

  return {
    rockGeometry: new THREE.IcosahedronGeometry(0.28, 1),
    trailGeometry: new THREE.ConeGeometry(0.18, 1.5, 6, 1, true),
    coreGeometry: new THREE.ConeGeometry(0.08, 0.82, 6, 1, true),
    rockMaterials,
    trailMaterials,
    coreMaterials,
  };
}

export function disposeMeteorResources(resources: MeteorResources): void {
  resources.rockGeometry.dispose();
  resources.trailGeometry.dispose();
  resources.coreGeometry.dispose();
  resources.rockMaterials.forEach((material) => material.dispose());
  resources.trailMaterials.forEach((material) => material.dispose());
  resources.coreMaterials.forEach((material) => material.dispose());
}

export class Meteor {
  readonly group = new THREE.Group();
  readonly target: THREE.Vector3;
  readonly index: number;
  readonly targetIndex: number;
  readonly revealsCrater: boolean;

  private readonly rock: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly trailCore: THREE.Mesh;
  private readonly direction = new THREE.Vector3();
  private readonly start: THREE.Vector3;
  private readonly duration: number;
  private elapsed = 0;
  private impacted = false;

  constructor(
    index: number,
    start: THREE.Vector3,
    target: THREE.Vector3,
    delay: number,
    scale: number,
    resources: MeteorResources,
    options: { duration?: number; revealsCrater?: boolean; targetIndex?: number } = {},
  ) {
    this.index = index;
    this.targetIndex = options.targetIndex ?? index;
    this.revealsCrater = options.revealsCrater ?? true;
    this.start = start.clone();
    this.target = target.clone();
    this.duration = options.duration ?? 1.02 + index * 0.08;
    this.elapsed = -delay;

    this.rock = new THREE.Mesh(resources.rockGeometry, resources.rockMaterials[index % 2]);
    this.rock.scale.setScalar(scale);
    this.rock.castShadow = true;

    this.trail = new THREE.Mesh(resources.trailGeometry, resources.trailMaterials[index % 2]);
    this.trail.scale.setScalar(scale);
    // ConeGeometry's apex is at +Y. Put that apex at the meteor so the broad
    // part of the hot trail is left behind it instead of pointing forward.
    this.trail.position.y = -0.75 * scale;

    this.trailCore = new THREE.Mesh(resources.coreGeometry, resources.coreMaterials[index % 2]);
    this.trailCore.scale.setScalar(scale);
    this.trailCore.position.y = -0.41 * scale;

    this.group.add(this.rock, this.trail, this.trailCore);
    this.group.visible = false;
    this.direction.copy(this.target).sub(this.start).normalize();
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.direction);
    this.group.position.copy(this.start);
  }

  update(delta: number, reducedMotion: boolean): boolean {
    if (this.impacted) return false;
    this.elapsed += reducedMotion ? delta * 2 : delta;
    if (this.elapsed < 0) {
      this.group.visible = false;
      return false;
    }

    this.group.visible = true;
    const progress = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    this.group.position.lerpVectors(this.start, this.target, eased);
    this.rock.rotation.x += delta * 4.6;
    this.rock.rotation.z += delta * 3.2;
    this.trail.scale.y = scaleForTrail(this.rock.scale.x, 0.72 + Math.sin(this.elapsed * 28) * 0.12);
    this.trailCore.scale.y = scaleForTrail(this.rock.scale.x, 0.76 + Math.sin(this.elapsed * 31 + 0.8) * 0.1);

    if (progress >= 1) {
      this.impacted = true;
      this.group.visible = false;
      return true;
    }
    return false;
  }

  setTarget(target: THREE.Vector3): void {
    this.target.copy(target);
    this.direction.copy(this.target).sub(this.start).normalize();
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.direction);
  }

  dispose(): void {
    this.group.clear();
  }
}

function scaleForTrail(baseScale: number, pulse: number): number {
  return baseScale * pulse;
}
