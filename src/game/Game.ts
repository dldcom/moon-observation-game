import * as THREE from 'three';
import { ImpactBurst } from '../entities/ImpactBurst';
import { createMeteorResources, disposeMeteorResources, Meteor } from '../entities/Meteor';
import { getCraterTarget, Moon, STORY_CRATER_COUNT, type MoonMode } from '../entities/Moon';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { ObservationScene } from '../scenes/ObservationScene';
import { MOON_VIEW, STORY_CAMERA_DISTANCE } from '../scenes/moonComposition';
import { Dialogue } from '../systems/Dialogue';

type StoryStage = Exclude<MoonMode, 'smooth'> | 'smooth';
type FadeState = 'idle' | 'out' | 'in';
type MeteorWave = 'formation' | 'late';
type FormationPointerState = {
  active: boolean;
  id: number | null;
  lastX: number;
  lastY: number;
};

type StoryLine = {
  stage: StoryStage;
  kicker: string;
  title: string;
  text: string;
};

const STORY: StoryLine[] = [
  {
    stage: 'character',
    kicker: '달의 이야기',
    title: '나는 달이야!',
    text: '안녕! 나는 달이야.',
  },
  {
    stage: 'character',
    kicker: '달의 이야기',
    title: '내 비밀을 알려줄게',
    text: '내가 어쩌다 이런 모양이 되었는지 알려줄게.',
  },
  {
    stage: 'smooth',
    kicker: '시간을 거슬러',
    title: '약 45억 년 전…',
    text: '약 45억 년 전…',
  },
  {
    stage: 'smooth',
    kicker: '첫 번째 모습',
    title: '매끈한 달',
    text: '그때의 나는 매끈한 얼굴이었어.',
  },
  {
    stage: 'impacts',
    kicker: '두 번째 이야기',
    title: '돌들이 날아왔어!',
    text: '그런데… 우주에서 날아온 돌들이 나를 쿵! 하고 때렸지.',
  },
  {
    stage: 'lava',
    kicker: '세 번째 이야기',
    title: '달의 바다가 생겼어',
    text: '부딪힌 곳은 움푹 패이고, 갈라진 틈으로 뜨거운 용암이 흘러나왔어.',
  },
  {
    stage: 'cratered',
    kicker: '마지막 모습',
    title: '울퉁불퉁한 달',
    text: '시간이 흐를수록 돌들은 계속 나를 때렸고, 나는 지금처럼 울퉁불퉁해졌어.',
  },
  {
    stage: 'cratered',
    kicker: '이제 직접 볼 차례',
    title: '진짜 달을 만나볼까?',
    text: '실제 내 모습을 봐볼래?',
  },
];

const STAGE_LINE_INDEX: Record<string, number> = {
  intro: 0,
  'active-play': 3,
  smooth: 3,
  impacts: 4,
  lava: 5,
  cratered: 6,
  complete: 7,
};

const FORMATION_METEOR_COUNT = 30;
const LATE_CRATER_REVEAL_COUNT = STORY_CRATER_COUNT - 4;
const LATE_METEOR_COUNT = LATE_CRATER_REVEAL_COUNT * 2;
const METEOR_SHOWER_DIRECTION = new THREE.Vector3(-0.34, -0.22, -0.91).normalize();
const METEOR_SHOWER_SIDE = new THREE.Vector3().crossVectors(
  METEOR_SHOWER_DIRECTION,
  new THREE.Vector3(0, 1, 0),
).normalize();

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private readonly moon = new Moon();
  private readonly observation: ObservationScene;
  private readonly dialogue = new Dialogue();
  private readonly meteors: Meteor[] = [];
  private readonly bursts: ImpactBurst[] = [];
  private readonly meteorResources = createMeteorResources();
  private readonly eraLabel = this.getElement<HTMLElement>('#era-label');
  private readonly dialoguePanel = this.getElement<HTMLElement>('#dialogue-panel');
  private readonly eraKicker = this.getElement('#era-kicker');
  private readonly eraValue = this.getElement('#era-value');
  private readonly app = this.getElement('#app');
  private readonly cta = this.getElement<HTMLElement>('#observation-cta');
  private readonly observeButton = this.getElement<HTMLButtonElement>('#observe-button');
  private readonly ctaNote = this.getElement<HTMLElement>('#cta-note');
  private readonly observationUi = this.getElement<HTMLElement>('#observation-ui');
  private readonly observationBackButton = this.getElement<HTMLButtonElement>('#observation-back');
  private readonly observationResetButton = this.getElement<HTMLButtonElement>('#observation-reset');
  private readonly observationStatus = this.getElement<HTMLElement>('#observation-status');
  private readonly fadeOverlay = this.getElement<HTMLElement>('#fade-overlay');
  private readonly halo: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly lavaLight: THREE.PointLight;
  private readonly observationFill: THREE.HemisphereLight;
  private readonly loop = new Loop(
    (delta) => this.update(delta),
    () => this.render(),
  );

  private readonly cameraGoal = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private frame = 0;
  private elapsed = 0;
  private lineIndex = 0;
  private stage: StoryStage = 'character';
  private fadeState: FadeState = 'idle';
  private fadeProgress = 0;
  private pendingStage: StoryStage | null = null;
  private cameraShake = 0;
  private ctaVisible = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private observationMode = false;
  private readonly formationPointer: FormationPointerState = {
    active: false,
    id: null,
    lastX: 0,
    lastY: 0,
  };

  private readonly onAppPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (this.observationMode) {
      if (target instanceof Element && target.closest('#observation-back, #observation-reset')) return;
      event.preventDefault();
      this.observation.handlePointerDown(event);
      return;
    }
    if (target instanceof Element && target.closest('#observe-button')) return;
    if (target instanceof Node && this.dialoguePanel.contains(target)) {
      event.preventDefault();
      this.advanceStory();
      return;
    }
    if (!this.canRotateStoryMoon()) return;

    event.preventDefault();
    this.formationPointer.active = true;
    this.formationPointer.id = event.pointerId;
    this.formationPointer.lastX = event.clientX;
    this.formationPointer.lastY = event.clientY;
    try {
      this.app.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events do not always have a capturable pointer id.
    }
  };

  private readonly onAppPointerMove = (event: PointerEvent) => {
    if (this.formationPointer.active) {
      if (event.pointerId !== this.formationPointer.id) return;
      event.preventDefault();
      this.moon.rotateStory(
        event.clientX - this.formationPointer.lastX,
        event.clientY - this.formationPointer.lastY,
      );
      this.retargetMeteors();
      this.formationPointer.lastX = event.clientX;
      this.formationPointer.lastY = event.clientY;
      return;
    }
    if (!this.observationMode) return;
    event.preventDefault();
    this.observation.handlePointerMove(event);
  };

  private readonly onAppPointerUp = (event: PointerEvent) => {
    if (this.formationPointer.active) {
      if (event.pointerId !== this.formationPointer.id) return;
      event.preventDefault();
      this.formationPointer.active = false;
      this.formationPointer.id = null;
      try {
        this.app.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already have been released by the browser.
      }
      return;
    }
    if (!this.observationMode) return;
    event.preventDefault();
    this.observation.handlePointerUp(event.pointerId);
  };

  private readonly onAppWheel = (event: WheelEvent) => {
    if (!this.observationMode) return;
    event.preventDefault();
    this.observation.handleWheel(event.deltaY);
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.observationMode) {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.exitObservationMode();
      }
      return;
    }
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    this.advanceStory();
  };

  private canRotateStoryMoon(): boolean {
    return !this.observationMode && !this.ctaVisible && this.fadeState === 'idle' && this.stage !== 'character';
  }

  private readonly onObserveClick = (event: MouseEvent) => {
    event.stopPropagation();
    this.enterObservationMode();
  };

  private readonly onObservationBackClick = (event: MouseEvent) => {
    event.stopPropagation();
    this.exitObservationMode();
  };

  private readonly onObservationResetClick = (event: MouseEvent) => {
    event.stopPropagation();
    this.observation.reset();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.observation = new ObservationScene(this.renderer);
    this.renderer.setClearColor('#081321', 1);
    this.renderer.toneMappingExposure = 1.08;

    this.lavaLight = new THREE.PointLight('#ff672d', 0, 12, 2);
    this.lavaLight.position.set(-0.55, 0.25, 3.1);
    this.observationFill = new THREE.HemisphereLight('#fff8df', '#3c4658', 0);

    this.halo = this.createHalo();
    this.stars = this.createStarfield();
    this.createScene();
    this.installInput();
    this.installTestHooks();
    this.applyLine(0, false);
    resizeRenderer(this.renderer, this.camera, 1.5);
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.app.removeEventListener('pointerdown', this.onAppPointerDown);
    this.app.removeEventListener('pointermove', this.onAppPointerMove);
    this.app.removeEventListener('pointerup', this.onAppPointerUp);
    this.app.removeEventListener('pointercancel', this.onAppPointerUp);
    this.app.removeEventListener('wheel', this.onAppWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    this.observeButton.removeEventListener('click', this.onObserveClick);
    this.observationBackButton.removeEventListener('click', this.onObservationBackClick);
    this.observationResetButton.removeEventListener('click', this.onObservationResetClick);
    this.clearMeteors();
    this.clearBursts();
    disposeMeteorResources(this.meteorResources);
    this.moon.dispose();
    this.observation.dispose();
    this.halo.geometry.dispose();
    (this.halo.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number): void {
    this.frame += 1;
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }

    this.elapsed += delta;
    resizeRenderer(this.renderer, this.camera, 1.5);
    this.dialogue.update(delta);
    this.updateFade(delta);
    if (this.observationMode) {
      this.observation.update(delta, this.reducedMotion);
    } else {
      this.moon.update(delta, this.elapsed, !this.reducedMotion);
      this.updateMeteors(delta);
      this.updateBursts(delta);
    }
    this.updateCamera(delta);
    this.lavaLight.intensity = !this.observationMode && this.stage === 'lava' ? 1.05 + Math.sin(this.elapsed * 7) * 0.12 : 0;
    this.observationFill.intensity = this.observationMode ? 1.25 : 0;
    this.stars.rotation.y = this.reducedMotion ? 0 : this.elapsed * 0.004;
    this.halo.rotation.z = this.reducedMotion ? 0 : this.elapsed * 0.025;

    if (!this.observationMode && this.lineIndex === STORY.length - 1 && !this.dialogue.isTyping() && this.fadeState === 'idle') {
      this.showObservationCta();
    }
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#081321');
    this.scene.fog = new THREE.Fog('#081321', 20, 42);

    const hemisphere = new THREE.HemisphereLight('#e9f4ff', '#111a2a', 1.75);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight('#fff0c6', 3.15);
    sun.position.set(-4.5, 6.8, 7.2);
    this.scene.add(sun);

    const rim = new THREE.PointLight('#5e9bc5', 1.9, 20, 2);
    rim.position.set(4.5, 1.5, -2.8);
    this.scene.add(rim);

    this.scene.add(this.stars, this.halo, this.moon.group, this.observation.group, this.lavaLight, this.observationFill);
  }

  private createStarfield(): THREE.Points {
    const count = 210;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const colorA = new THREE.Color('#d6edf0');
    const colorB = new THREE.Color('#f5c86b');

    for (let index = 0; index < count; index += 1) {
      const angle = index * 2.399963;
      const radius = 8.5 + (index % 11) * 0.82;
      const height = ((index * 37) % 19) - 9.5;
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = height + Math.sin(angle * 0.7) * 1.2;
      positions[offset + 2] = -5 - (index % 7) * 1.7;

      const tint = index % 5 === 0 ? colorB : colorA;
      colors[offset] = tint.r;
      colors[offset + 1] = tint.g;
      colors[offset + 2] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.075,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    return new THREE.Points(geometry, material);
  }

  private createHalo(): THREE.Mesh {
    const geometry = new THREE.RingGeometry(2.6, 2.64, 64);
    const material = new THREE.MeshBasicMaterial({
      color: '#79b9cf',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(geometry, material);
    halo.position.z = -0.45;
    return halo;
  }

  private installInput(): void {
    this.app.addEventListener('pointerdown', this.onAppPointerDown, { passive: false });
    this.app.addEventListener('pointermove', this.onAppPointerMove, { passive: false });
    this.app.addEventListener('pointerup', this.onAppPointerUp, { passive: false });
    this.app.addEventListener('pointercancel', this.onAppPointerUp, { passive: false });
    this.app.addEventListener('wheel', this.onAppWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    this.observeButton.addEventListener('click', this.onObserveClick);
    this.observationBackButton.addEventListener('click', this.onObservationBackClick);
    this.observationResetButton.addEventListener('click', this.onObservationResetClick);
  }

  private advanceStory(): void {
    if (this.fadeState !== 'idle' || this.ctaVisible) return;
    if (this.dialogue.isTyping()) {
      this.dialogue.finish();
      return;
    }
    if (this.lineIndex >= STORY.length - 1) return;
    this.applyLine(this.lineIndex + 1, true);
  }

  private applyLine(index: number, allowTransition: boolean): void {
    const line = STORY[index];
    if (!line) return;

    this.lineIndex = index;
    this.cta.hidden = true;
    this.ctaVisible = false;
    this.ctaNote.hidden = true;
    this.setEra(line);
    this.dialogue.start(line.text, index, STORY.length);

    const needsFade = allowTransition && this.stage === 'character' && line.stage === 'smooth';
    if (needsFade) {
      this.beginFade(line.stage);
    } else {
      this.setStage(line.stage);
    }
  }

  private setEra(line: StoryLine): void {
    this.eraKicker.textContent = line.kicker;
    this.eraValue.textContent = line.title;
  }

  private setStage(stage: StoryStage): void {
    this.stage = stage;
    // The ring is a friendly character accent, not part of the natural moon.
    this.halo.visible = stage === 'character';
    this.clearMeteors();

    if (stage === 'character') {
      this.moon.setMode('character');
      this.moon.setCraterCount(0);
      this.lavaLight.intensity = 0;
    } else if (stage === 'smooth') {
      this.moon.setMode('smooth');
      this.moon.setCraterCount(0);
      this.lavaLight.intensity = 0;
    } else if (stage === 'impacts') {
      this.moon.setMode('impacts');
      this.moon.setCraterCount(0);
      this.launchMeteors('formation');
    } else if (stage === 'lava') {
      this.moon.setMode('lava');
      this.moon.setCraterCount(4);
    } else {
      this.moon.setMode('cratered');
      if (this.lineIndex === STORY.length - 1) {
        this.moon.setCraterCount(STORY_CRATER_COUNT);
      } else {
        this.moon.setCraterCount(4);
        this.launchMeteors('late');
      }
      this.lavaLight.intensity = 0;
    }
  }

  private beginFade(stage: StoryStage): void {
    this.pendingStage = stage;
    this.fadeState = 'out';
    this.fadeProgress = 0;
  }

  private updateFade(delta: number): void {
    if (this.fadeState === 'idle') {
      this.fadeOverlay.style.opacity = '0';
      return;
    }

    this.fadeProgress += delta / 0.42;
    if (this.fadeState === 'out') {
      this.fadeOverlay.style.opacity = String(THREE.MathUtils.clamp(this.fadeProgress, 0, 1));
      if (this.fadeProgress >= 1) {
        if (this.pendingStage) this.setStage(this.pendingStage);
        this.pendingStage = null;
        this.fadeState = 'in';
        this.fadeProgress = 0;
      }
    } else {
      this.fadeOverlay.style.opacity = String(1 - THREE.MathUtils.clamp(this.fadeProgress, 0, 1));
      if (this.fadeProgress >= 1) {
        this.fadeState = 'idle';
        this.fadeProgress = 0;
        this.fadeOverlay.style.opacity = '0';
      }
    }
  }

  private launchMeteors(wave: MeteorWave): void {
    const count = wave === 'formation' ? FORMATION_METEOR_COUNT : LATE_METEOR_COUNT;
    const firstTargetIndex = wave === 'formation' ? 0 : 4;

    for (let index = 0; index < count; index += 1) {
      const targetIndex = firstTargetIndex + (wave === 'formation' ? index % STORY_CRATER_COUNT : index);
      const band = index % 6;
      const row = Math.floor(index / 6);
      const distance = 5.25 + (index % 3) * 0.48 + row * 0.22;
      const lateral = (band - 2.5) * 0.28;
      const vertical = (row - 1) * 0.24 + (index % 2 === 0 ? -0.05 : 0.05);
      const target = getCraterTarget(targetIndex, this.moon.group.rotation.x, this.moon.group.rotation.y);
      const start = target
        .clone()
        .addScaledVector(METEOR_SHOWER_DIRECTION, -distance)
        .addScaledVector(METEOR_SHOWER_SIDE, lateral)
        .add(new THREE.Vector3(0, vertical, 0));
      const delay = index * (wave === 'formation' ? 0.095 : 0.12);
      const scale = wave === 'formation' ? 0.28 + (index % 5) * 0.035 : 0.3 + (index % 3) * 0.04;
      const duration = wave === 'formation' ? 1.05 + (index % 4) * 0.07 : 0.96 + (index % 3) * 0.06;
      const meteor = new Meteor(index, start, target, delay, scale, this.meteorResources, {
        duration,
        targetIndex,
        revealsCrater:
          wave === 'late' ? index < LATE_CRATER_REVEAL_COUNT : index < STORY_CRATER_COUNT,
      });
      this.meteors.push(meteor);
      this.scene.add(meteor.group);
    }
  }

  private retargetMeteors(): void {
    if (this.meteors.length === 0) return;

    const pitch = this.moon.group.rotation.x;
    const yaw = this.moon.group.rotation.y;
    for (const meteor of this.meteors) {
      meteor.setTarget(getCraterTarget(meteor.targetIndex, pitch, yaw));
    }
  }

  private updateMeteors(delta: number): void {
    for (let index = this.meteors.length - 1; index >= 0; index -= 1) {
      const meteor = this.meteors[index];
      const impacted = meteor.update(delta, this.reducedMotion);
      if (!impacted) continue;

      const normal = meteor.target.clone().normalize();
      if (meteor.revealsCrater) this.moon.revealNextCrater();
      this.cameraShake = 1;
      const burst = new ImpactBurst(meteor.target.clone().addScaledVector(normal, 0.02), normal, meteor.index);
      this.bursts.push(burst);
      this.scene.add(burst.group);
      this.scene.remove(meteor.group);
      meteor.dispose();
      this.meteors.splice(index, 1);
    }
  }

  private updateBursts(delta: number): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      if (!burst.update(delta, this.reducedMotion)) continue;
      this.scene.remove(burst.group);
      burst.dispose();
      this.bursts.splice(index, 1);
    }
  }

  private clearMeteors(): void {
    for (const meteor of this.meteors) {
      this.scene.remove(meteor.group);
      meteor.dispose();
    }
    this.meteors.length = 0;
  }

  private clearBursts(): void {
    for (const burst of this.bursts) {
      this.scene.remove(burst.group);
      burst.dispose();
    }
    this.bursts.length = 0;
  }

  private updateCamera(delta: number): void {
    if (this.observationMode) {
      this.cameraGoal.set(0, 0, this.observation.getCameraDistance(this.camera.aspect));
      const cameraSmoothing = 1 - Math.exp(-delta * 4.6);
      this.camera.position.lerp(this.cameraGoal, cameraSmoothing);
      this.cameraShake = 0;
      this.lookTarget.set(0, 0, 0);
      this.camera.lookAt(this.lookTarget);
      return;
    }

    const characterCamera = this.stage === 'character';
    const portrait = this.camera.aspect < 0.9;
    const characterDistance = portrait ? 12.2 : 9.65;
    const storyDistance = portrait ? STORY_CAMERA_DISTANCE * MOON_VIEW.portraitMultiplier : STORY_CAMERA_DISTANCE;
    this.cameraGoal.set(characterCamera ? 0 : 0.12, characterCamera ? 0.2 : 0.12, characterCamera ? characterDistance : storyDistance);
    const cameraSmoothing = 1 - Math.exp(-delta * 3.2);
    this.camera.position.lerp(this.cameraGoal, cameraSmoothing);

    this.cameraShake = Math.max(0, this.cameraShake - delta * 3.4);
    const shake = this.reducedMotion ? 0 : this.cameraShake * this.cameraShake * 0.1;
    this.camera.position.x += Math.sin(this.elapsed * 87) * shake;
    this.camera.position.y += Math.cos(this.elapsed * 71) * shake;
    this.lookTarget.set(0, characterCamera ? 0.03 : 0, 0);
    this.camera.lookAt(this.lookTarget);
  }

  private showObservationCta(): void {
    if (this.ctaVisible) return;
    this.ctaVisible = true;
    this.cta.hidden = false;
  }

  private enterObservationMode(): void {
    if (this.observationMode) return;

    this.observationMode = true;
    this.ctaVisible = false;
    this.cta.hidden = true;
    this.ctaNote.hidden = true;
    this.eraLabel.hidden = true;
    this.dialoguePanel.hidden = true;
    this.observationUi.hidden = false;
    this.observationStatus.textContent = '달 표면 자료를 불러오는 중…';

    this.clearMeteors();
    this.clearBursts();
    this.halo.visible = false;
    this.moon.group.visible = false;
    this.observation.reset();
    this.observation.group.visible = true;

    void this.observation.load().then((ready) => {
      if (!this.observationMode) return;
      this.observationStatus.textContent = ready
        ? '드래그해서 돌려 보고, 두 손가락으로 확대해 보세요.'
        : '달 표면 자료를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';
    });
  }

  private exitObservationMode(): void {
    if (!this.observationMode) return;

    this.observationMode = false;
    this.observation.group.visible = false;
    this.moon.group.visible = true;
    this.eraLabel.hidden = false;
    this.dialoguePanel.hidden = false;
    this.observationUi.hidden = true;
    this.applyLine(STORY.length - 1, false);
    this.dialogue.finish();
    this.showObservationCta();
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        void value;
      },
      setState: (name: string) => {
        if (name === 'observation') {
          this.jumpToLine(STORY.length - 1);
          this.dialogue.finish();
          this.showObservationCta();
          this.enterObservationMode();
          return;
        }
        if (this.observationMode) this.exitObservationMode();
        const index = STAGE_LINE_INDEX[name];
        if (index === undefined) {
          console.warn(`Unknown test state: ${name}`);
          return;
        }
        this.jumpToLine(index);
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: (hidden: boolean) => {
        void hidden;
      },
    };
  }

  private jumpToLine(index: number): void {
    this.fadeState = 'idle';
    this.fadeProgress = 0;
    this.pendingStage = null;
    this.fadeOverlay.style.opacity = '0';
    this.clearBursts();
    this.applyLine(THREE.MathUtils.clamp(index, 0, STORY.length - 1), false);
    if (index === STORY.length - 1) {
      this.dialogue.finish();
      this.showObservationCta();
    }
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.lineIndex,
      targetScore: STORY.length - 1,
      complete: this.ctaVisible || this.observationMode,
      stage: this.observationMode ? 'observation' : this.stage,
      lineIndex: this.lineIndex,
      typing: this.dialogue.isTyping(),
      player: {
        position: {
          x: this.moon.group.position.x,
          y: this.moon.group.position.y,
          z: this.moon.group.position.z,
        },
        speed: 0,
      },
      moon: {
        position: {
          x: this.moon.group.position.x,
          y: this.moon.group.position.y,
          z: this.moon.group.position.z,
        },
        rotation: {
          yaw: this.moon.group.rotation.y,
          pitch: this.moon.group.rotation.x,
        },
        mode: this.moon.getMode(),
        craterCount: this.moon.getCraterCount(),
        lavaFlowProgress: this.moon.getLavaFlowProgress(),
        lavaCoolingProgress: this.moon.getLavaCoolingProgress(),
      },
      observation: {
        active: this.observationMode,
        ...this.observation.getSnapshot(),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      meteorCount: this.meteors.length,
      burstCount: this.bursts.length,
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      },
    };
  }

  private getElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
