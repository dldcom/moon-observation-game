export const MOON_VIEW = {
  // Story composition stays expressive; the scientific viewer uses its own
  // longitude-centred starting yaw below.
  yaw: -0.24,
  // The scientific equirectangular map is centered on longitude 0°; face that
  // meridian in the observation view so the marked near-side features start
  // on the visible hemisphere.
  observationYaw: -Math.PI / 2,
  pitch: 0.08,
  storyRadius: 2.05,
  observationRadius: 2.55,
  observationMaxDistance: 15.5,
  portraitMultiplier: 1.34,
} as const;

export const STORY_CAMERA_DISTANCE =
  MOON_VIEW.observationMaxDistance * (MOON_VIEW.storyRadius / MOON_VIEW.observationRadius);
