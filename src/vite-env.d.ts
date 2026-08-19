/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  stage: string;
  mainMenu: boolean;
  gamePlaceholder: boolean;
  lineIndex: number;
  typing: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  moon: {
    position: { x: number; y: number; z: number };
    rotation: { yaw: number; pitch: number };
    mode: string;
    craterCount: number;
    lavaFlowProgress: number;
    lavaCoolingProgress: number;
    lavaSourceCount: number;
    activeLavaSourceCount: number;
    activeLavaCraterCount: number;
  };
  meteorCount: number;
  meteorTargetIndices: number[];
  burstCount: number;
  observation: {
    active: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    yaw: number;
    pitch: number;
    distance: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): void;
  /** Jump to a named state for baselines (scaffold: 'active-play' | 'complete'). */
  setState(name: string): void;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide debug UI (lil-gui) before capturing. */
  hideDebugUi(hidden: boolean): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
