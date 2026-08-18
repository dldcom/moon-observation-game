import * as THREE from 'three';

export class Meteor {
  readonly group = new THREE.Group();
  readonly target: THREE.Vector3;
  readonly index: number;

  private readonly rock: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly direction = new THREE.Vector3();
  private readonly start: THREE.Vector3;
  private readonly duration: number;
  private elapsed = 0;
  private impacted = false;

  constructor(index: number, start: THREE.Vector3, target: THREE.Vector3, delay: number, scale: number) {
    this.index = index;
    this.start = start.clone();
    this.target = target.clone();
    this.duration = 1.02 + index * 0.08;
    this.elapsed = -delay;

    const rockGeometry = new THREE.IcosahedronGeometry(0.28, 1);
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: index % 2 === 0 ? '#a56e5e' : '#c58c67',
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    });
    this.rock = new THREE.Mesh(rockGeometry, rockMaterial);
    this.rock.scale.setScalar(scale);
    this.rock.castShadow = true;

    const trailGeometry = new THREE.ConeGeometry(0.18 * scale, 1.5 * scale, 6, 1, true);
    const trailMaterial = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? '#ffd36b' : '#ff9a56',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.trail = new THREE.Mesh(trailGeometry, trailMaterial);
    this.trail.position.y = 0.78 * scale;

    this.group.add(this.rock, this.trail);
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
    this.trail.scale.y = 0.72 + Math.sin(this.elapsed * 28) * 0.12;

    if (progress >= 1) {
      this.impacted = true;
      this.group.visible = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.rock.geometry.dispose();
    if (Array.isArray(this.rock.material)) {
      this.rock.material.forEach((material) => material.dispose());
    } else {
      this.rock.material.dispose();
    }
    this.trail.geometry.dispose();
    if (Array.isArray(this.trail.material)) {
      this.trail.material.forEach((material) => material.dispose());
    } else {
      this.trail.material.dispose();
    }
  }
}
