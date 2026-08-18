export const MOON_VIEW = {
  // Both pages use the same front-facing Moon composition.
  yaw: -0.24,
  pitch: 0.08,
  storyRadius: 2.05,
  observationRadius: 2.55,
  observationMaxDistance: 15.5,
  portraitMultiplier: 1.34,
} as const;

export const STORY_CAMERA_DISTANCE =
  MOON_VIEW.observationMaxDistance * (MOON_VIEW.storyRadius / MOON_VIEW.observationRadius);
