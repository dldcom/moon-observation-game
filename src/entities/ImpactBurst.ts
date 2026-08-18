import * as THREE from 'three';

type Shard = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
};

export class ImpactBurst {
  readonly group = new THREE.Group();

  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe08a',
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  private readonly flashMaterial = new THREE.MeshBasicMaterial({
    color: '#fff4c2',
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  private readonly ring: THREE.Mesh;
  private readonly flash: THREE.Mesh;
  private readonly shards: Shard[] = [];
  private age = 0;

  constructor(position: THREE.Vector3, normal: THREE.Vector3, index: number) {
    this.group.position.copy(position);

    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 6, 20), this.ringMaterial);
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    this.group.add(this.ring);

    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), this.flashMaterial);
    this.group.add(this.flash);

    const shardGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    for (let shardIndex = 0; shardIndex < 7; shardIndex += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: shardIndex % 2 === 0 ? '#ffb25f' : '#f7e2a1',
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(shardGeometry, material);
      const angle = ((shardIndex + index * 1.7) / 7) * Math.PI * 2;
      const speed = 0.75 + ((shardIndex + index) % 3) * 0.24;
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.2 + (shardIndex % 2) * 0.15);
      mesh.rotation.set(angle, angle * 0.7, angle * 0.35);
      this.group.add(mesh);
      this.shards.push({ mesh, velocity });
    }
  }

  update(delta: number, reducedMotion: boolean): boolean {
    this.age += reducedMotion ? delta * 2 : delta;
    const progress = THREE.MathUtils.clamp(this.age / 0.58, 0, 1);
    this.ring.scale.setScalar(0.45 + progress * 3.1);
    this.ringMaterial.opacity = (1 - progress) * 0.86;
    this.flash.scale.setScalar(1 + (1 - progress) * 1.8);
    this.flashMaterial.opacity = (1 - progress) * 0.82;

    for (const shard of this.shards) {
      shard.mesh.position.addScaledVector(shard.velocity, delta);
      shard.mesh.rotation.x += delta * 6;
      shard.mesh.rotation.y += delta * 5;
      const material = shard.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - progress) * 0.9;
    }

    return progress >= 1;
  }

  dispose(): void {
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
    for (const shard of this.shards) {
      shard.mesh.geometry.dispose();
      (shard.mesh.material as THREE.Material).dispose();
    }
  }
}
