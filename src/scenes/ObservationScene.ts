import * as THREE from 'three';
import { MOON_VIEW } from './moonComposition';

const MOON_TEXTURE_PATH = '/assets/moon/moon-global.png';
const MIN_DISTANCE = 7.25;

export type ObservationStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ObservationSnapshot = {
  status: ObservationStatus;
  yaw: number;
  pitch: number;
  distance: number;
};

type PointerPosition = {
  x: number;
  y: number;
};

/**
 * The real-Moon viewer is deliberately isolated from the story Moon. That
 * lets the formation scene stay expressive while this scene stays faithful to
 * the source map and only spends its extra geometry/texture budget when open.
 */
export class ObservationScene {
  readonly group = new THREE.Group();

  private readonly moonGroup = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(MOON_VIEW.observationRadius, 72, 48);
  private readonly material = new THREE.MeshStandardMaterial({
    color: '#f1eee5',
    emissive: '#252723',
    emissiveIntensity: 0.3,
    roughness: 0.98,
    metalness: 0,
    bumpScale: 0.028,
  });
  private readonly moon = new THREE.Mesh(this.geometry, this.material);
  private readonly loader = new THREE.TextureLoader();
  private readonly pointers = new Map<number, PointerPosition>();
  private readonly renderer: THREE.WebGLRenderer;

  private texture: THREE.Texture | null = null;
  private loadPromise: Promise<boolean> | null = null;
  private status: ObservationStatus = 'idle';
  private disposed = false;
  private pinchDistance = 0;
  private dragging = false;
  private yaw: number = MOON_VIEW.yaw;
  private pitch: number = MOON_VIEW.pitch;
  private distance: number = MOON_VIEW.observationMaxDistance;
  private spinVelocity = 0;
  private hasInteracted = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.moon.castShadow = false;
    this.moon.receiveShadow = true;
    this.moonGroup.add(this.moon);
    this.group.add(this.moonGroup);
    this.group.visible = false;
    this.applyRotation();
  }

  load(): Promise<boolean> {
    if (this.status === 'ready') return Promise.resolve(true);
    if (this.loadPromise) return this.loadPromise;

    this.status = 'loading';
    this.loadPromise = new Promise<boolean>((resolve) => {
      this.loader.load(
        MOON_TEXTURE_PATH,
        (texture) => {
          if (this.disposed) {
            texture.dispose();
            resolve(false);
            return;
          }

          const cleanTexture = this.createCleanTexture(texture);
          texture.dispose();

          this.texture = cleanTexture;
          this.material.map = cleanTexture;
          this.material.bumpMap = cleanTexture;
          this.material.bumpScale = 0.028;
          this.material.needsUpdate = true;
          this.status = 'ready';
          resolve(true);
        },
        undefined,
        (_error) => {
          if (!this.disposed) this.status = 'error';
          resolve(false);
        },
      );
    }).finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  update(delta: number, reducedMotion: boolean): void {
    if (!this.dragging) {
      if (reducedMotion || !this.hasInteracted) {
        this.spinVelocity = 0;
      } else {
        this.yaw += delta * 0.04;
        this.yaw += this.spinVelocity;
        this.spinVelocity *= Math.exp(-delta * 5.2);
      }
    }
    this.applyRotation();
  }

  handlePointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragging = true;
    this.hasInteracted = true;
    this.spinVelocity = 0;

    if (this.pointers.size === 2) {
      this.pinchDistance = this.getPointerDistance();
    }
  }

  handlePointerMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    previous.x = event.clientX;
    previous.y = event.clientY;

    if (this.pointers.size >= 2) {
      const nextDistance = this.getPointerDistance();
      if (this.pinchDistance > 0) {
        this.zoomBy((this.pinchDistance - nextDistance) * 0.018);
      }
      this.pinchDistance = nextDistance;
      return;
    }

    this.yaw += dx * 0.008;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, -0.78, 0.78);
    this.spinVelocity = dx * 0.00075;
    this.applyRotation();
  }

  handlePointerUp(pointerId: number): void {
    this.pointers.delete(pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.dragging = false;
  }

  handleWheel(deltaY: number): void {
    this.hasInteracted = true;
    this.zoomBy(deltaY * 0.004);
  }

  reset(): void {
    this.yaw = MOON_VIEW.yaw;
    this.pitch = MOON_VIEW.pitch;
    this.distance = MOON_VIEW.observationMaxDistance;
    this.spinVelocity = 0;
    this.hasInteracted = false;
    this.applyRotation();
  }

  getCameraDistance(aspect: number): number {
    // On a portrait tablet the sphere is limited by the narrow screen width,
    // so give it a little more breathing room without changing its scale in
    // the normal landscape layout.
    const portraitMultiplier = aspect < 0.85 ? MOON_VIEW.portraitMultiplier : 1;
    return this.distance * portraitMultiplier;
  }

  getSnapshot(): ObservationSnapshot {
    return {
      status: this.status,
      yaw: this.yaw,
      pitch: this.pitch,
      distance: this.distance,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.texture = null;
    this.pointers.clear();
  }

  private zoomBy(amount: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + amount, MIN_DISTANCE, MOON_VIEW.observationMaxDistance);
  }

  private createCleanTexture(source: THREE.Texture): THREE.CanvasTexture {
    const image = source.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create the Moon texture cleanup canvas.');

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    let sourcePixels = new Uint8ClampedArray(imageData.data);
    const radius = 5;

    // The scientific mosaic contains a small number of pure-black tile/data
    // gaps. Real maria are dark, but not isolated RGB(0, 0, 0) pixels. Only
    // repair a black pixel when enough non-black neighbours surround it, so
    // the lunar albedo pattern remains intact.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const value = (sourcePixels[offset] + sourcePixels[offset + 1] + sourcePixels[offset + 2]) / 3;
          if (value > 8) continue;

          let neighbourCount = 0;
          let neighbourRed = 0;
          let neighbourGreen = 0;
          let neighbourBlue = 0;

          for (let dy = -radius; dy <= radius; dy += 1) {
            const neighbourY = y + dy;
            if (neighbourY < 0 || neighbourY >= canvas.height) continue;
            for (let dx = -radius; dx <= radius; dx += 1) {
              const neighbourX = x + dx;
              if (neighbourX < 0 || neighbourX >= canvas.width || (dx === 0 && dy === 0)) continue;
              const neighbourOffset = (neighbourY * canvas.width + neighbourX) * 4;
              const neighbourValue =
                (sourcePixels[neighbourOffset] + sourcePixels[neighbourOffset + 1] + sourcePixels[neighbourOffset + 2]) / 3;
              if (neighbourValue < 28) continue;
              neighbourRed += sourcePixels[neighbourOffset];
              neighbourGreen += sourcePixels[neighbourOffset + 1];
              neighbourBlue += sourcePixels[neighbourOffset + 2];
              neighbourCount += 1;
            }
          }

          if (neighbourCount < 6) continue;
          imageData.data[offset] = Math.round(neighbourRed / neighbourCount);
          imageData.data[offset + 1] = Math.round(neighbourGreen / neighbourCount);
          imageData.data[offset + 2] = Math.round(neighbourBlue / neighbourCount);
        }
      }
      sourcePixels = new Uint8ClampedArray(imageData.data);
    }

    // A few mosaic strips are not pure black: they are long, thin seams that
    // are only noticeably darker than the pixels immediately beside them.
    // Detect those directional runs instead of blurring the whole map, then
    // copy the local texture colour across the seam.
    this.repairSeamRuns(imageData, canvas.width, canvas.height, true);
    this.repairSeamRuns(imageData, canvas.width, canvas.height, false);

    context.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 4);
    return texture;
  }

  private repairSeamRuns(imageData: ImageData, width: number, height: number, vertical: boolean): void {
    const sourcePixels = new Uint8ClampedArray(imageData.data);
    const alongLength = vertical ? height : width;
    const acrossLength = vertical ? width : height;
    const minimumRun = 28;

    for (let across = 2; across < acrossLength - 2; across += 1) {
      let runStart = -1;

      for (let along = 2; along < alongLength - 2; along += 1) {
        const x = vertical ? across : along;
        const y = vertical ? along : across;
        const offset = (y * width + x) * 4;
        const firstSide = vertical ? (x - 2) : x;
        const secondSide = vertical ? (x + 2) : x;
        const firstSideY = vertical ? y : y - 2;
        const secondSideY = vertical ? y : y + 2;
        const firstOffset = (firstSideY * width + firstSide) * 4;
        const secondOffset = (secondSideY * width + secondSide) * 4;
        const value = (sourcePixels[offset] + sourcePixels[offset + 1] + sourcePixels[offset + 2]) / 3;
        const sideValue =
          (sourcePixels[firstOffset] + sourcePixels[firstOffset + 1] + sourcePixels[firstOffset + 2] +
            sourcePixels[secondOffset] + sourcePixels[secondOffset + 1] + sourcePixels[secondOffset + 2]) /
          6;
        const isSeamPixel = value < 100 && sideValue - value >= 20;

        if (isSeamPixel) {
          if (runStart < 0) runStart = along;
          continue;
        }

        if (runStart >= 0 && along - runStart >= minimumRun) {
          this.fillSeamRun(imageData, sourcePixels, width, height, vertical, across, runStart, along - 1);
        }
        runStart = -1;
      }

      if (runStart >= 0 && alongLength - 2 - runStart >= minimumRun) {
        this.fillSeamRun(imageData, sourcePixels, width, height, vertical, across, runStart, alongLength - 3);
      }
    }
  }

  private fillSeamRun(
    imageData: ImageData,
    sourcePixels: Uint8ClampedArray,
    width: number,
    height: number,
    vertical: boolean,
    across: number,
    start: number,
    end: number,
  ): void {
    for (let along = start; along <= end; along += 1) {
      const x = vertical ? across : along;
      const y = vertical ? along : across;
      const offset = (y * width + x) * 4;
      const firstX = vertical ? x - 3 : x;
      const secondX = vertical ? x + 3 : x;
      const firstY = vertical ? y : y - 3;
      const secondY = vertical ? y : y + 3;
      if (firstX < 0 || secondX >= width || firstY < 0 || secondY >= height) continue;

      const firstOffset = (firstY * width + firstX) * 4;
      const secondOffset = (secondY * width + secondX) * 4;
      imageData.data[offset] = Math.round((sourcePixels[firstOffset] + sourcePixels[secondOffset]) / 2);
      imageData.data[offset + 1] = Math.round((sourcePixels[firstOffset + 1] + sourcePixels[secondOffset + 1]) / 2);
      imageData.data[offset + 2] = Math.round((sourcePixels[firstOffset + 2] + sourcePixels[secondOffset + 2]) / 2);
    }
  }

  private getPointerDistance(): number {
    const positions = [...this.pointers.values()];
    const first = positions[0];
    const second = positions[1];
    if (!first || !second) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  private applyRotation(): void {
    this.moonGroup.rotation.set(this.pitch, this.yaw, 0);
  }
}
