// Central NPC config: metres, metres/second and kilograms.
const BASE = "./data/models/npc/civilian_002/";
export const NPC_MODELS = Object.freeze({
  civilian_002: Object.freeze({
    id: "civilian_002",
    displayName: "Ilorin Civilian 002",
    manifestUrl: BASE + "manifest.json",
    modelUrl: BASE + "civilian_002_rigged.fbx",
    targetHeight: 1.74,
    animations: Object.freeze({
      idle: BASE + "animations/idle.fbx",
      walk: BASE + "animations/walk.fbx",
      run: BASE + "animations/run.fbx",
      sprint: BASE + "animations/sprint.fbx",
      jump: BASE + "animations/jump.fbx",
      crouch_idle: BASE + "animations/crouch_idle.fbx",
      crouch_walk: BASE + "animations/crouch_walk.fbx",
      talk: BASE + "animations/talk.fbx",
      phone: BASE + "animations/phone.fbx",
      sit_idle: BASE + "animations/sit_idle.fbx",
      fall_death: BASE + "animations/fall_death.fbx",
      get_up: BASE + "animations/get_up.fbx",
      wave: BASE + "animations/wave.fbx",
      sit_down: BASE + "animations/sit_down.fbx"
    }),
    inPlace: Object.freeze(["walk", "run", "sprint", "crouch_walk"])
  })
});
export const NPC_GLOBAL_CONFIG = Object.freeze({
  modelId: "civilian_002",
  population: Object.freeze({
    maxActive: Object.freeze({ "ultra-low": 1, low: 2, medium: 4, high: 6 }),
    spawnRadius: 82, despawnRadius: 132, activeRadius: 96,
    spawnInterval: 5, minSpawnSeparation: 7, keepDeadSeconds: 7, maxSpawnAttempts: 24
  }),
  physics: Object.freeze({
    mass: 72, height: 1.74, radius: 0.32, stepHeight: 0.28, maxSlopeDegrees: 36,
    walkSpeed: 1.38, runSpeed: 3.25, sprintSpeed: 4.15,
    acceleration: 6.8, braking: 9.5, turnResponse: 8.5, groundFriction: 7.2,
    collisionSubstep: 0.16, personalSpace: 1.05, vehicleClearance: 3.8,
    vehiclePanicSpeed: 2.2, vehiclePanicDistance: 7.5, playerAvoidanceRadius: 1.55,
    idleMinSeconds: 1.5, idleMaxSeconds: 4.5, fleeSeconds: 7.5, fleeSpeed: 4.15,
    fleeRadius: 27, aimPanicRadius: 16, gunshotPanicRadius: 25, explosionPanicRadius: 36,
    interactionRadius: 2.25, interactionLookRadius: 8, headHeight: 1.58, chestHeight: 1.10
  }),
  animation: Object.freeze({
    defaultFadeSeconds: 0.18, maxTimeScale: 1.22, minTimeScale: 0.72
  }),
  interaction: Object.freeze({
    duration: 3.4, waveSeconds: 0.95, prompt: "E  TALK",
    lines: Object.freeze([
      "How far, boss?", "You good?", "Good afternoon. How's your day going?",
      "This traffic is something else today.", "I'm just heading home. Take care.",
      "Hope you're enjoying the city."
    ])
  }),
  behaviour: Object.freeze({
    lookAtPlayerDistance: 8, chooseIdleChance: 0.18, routeArrivalDistance: 1.8,
    aimDotThreshold: 0.82, objectUseDistance: 22, objectUseChance: 0.12,
    socialDistance: 2.4, socialChancePerSecond: 0.025,
    phoneCooldownMin: 22, phoneCooldownMax: 46
  })
});
export const NPC_DEFAULT_ROUTES = Object.freeze([
  { road: "Southern Ring Street", sides: [-1, 1] },
  { road: "Civic and Market Avenue", sides: [-1, 1] },
  { road: "GRA Central Boulevard", sides: [-1, 1] },
  { road: "Ahmadu Bello Way", sides: [-1, 1] },
  { road: "West GRA Avenue", sides: [-1, 1] },
  { road: "Innovation District Avenue", sides: [-1, 1] },
  { road: "East Business Avenue", sides: [-1, 1] },
  { road: "North Business Link", sides: [-1, 1] }
]);
