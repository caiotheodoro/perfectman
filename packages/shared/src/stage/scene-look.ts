/**
 * The drawn places a scene can name, and how a scene's look is validated.
 * A scene says where it happens (`setting`), what is lying around (`props`),
 * and which other places the cast can slip into (`rooms`). Everything here is
 * presentation: the simulation never reads it.
 */
export const SCENE_SETTINGS = [
  "rooftop",
  "stairwell",
  "elevator",
  "kitchen",
  "living",
  "lobby",
  "street",
  "office",
] as const;

export type SceneSetting = (typeof SCENE_SETTINGS)[number];

export type SceneLook = {
  setting?: SceneSetting;
  props?: string[];
  rooms?: SceneSetting[];
};

export const MAX_SCENE_PROPS = 12;
export const MAX_SCENE_ROOMS = 3;

export function isSceneSetting(value: unknown): value is SceneSetting {
  return typeof value === "string" && (SCENE_SETTINGS as readonly string[]).includes(value);
}

/** Lowercase kebab-case, so props stay stable keys for the artwork lookup. */
export function isSceneProp(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}
