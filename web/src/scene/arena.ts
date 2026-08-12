/**
 * Arena themes — the "maps" the board can be staged in.
 *
 * Every value here is read by the hall, the battlefield, the board and the
 * colour grade, so a theme is a complete relight of the scene rather than a
 * brightness slider: sky, fog, stone tints, fire strength, tile contrast and
 * the film grade all move together.
 *
 * The palettes are cut for a **Middle-earth** register rather than a fantasy
 * one, and three rules do most of that work:
 *
 * - **Nothing is fully saturated.** One hue leads a map and everything else is
 *   pulled toward stone-grey. Lime, cyan and orange are what make a rendered
 *   world read as a game; olive, slate and ochre are what make it read as a
 *   place with weather in it.
 * - **Warm key against cool ambient.** Every map's sun is warmer than its sky,
 *   and every map's shadows fall blue — that split is what the grade's
 *   `shadow`/`highlight` pair then exaggerates on the way to the screen.
 * - **Distance is a colour, not a fade.** `haze` is the colour the ranges and
 *   the far plain wash toward, and `fog.color` is kept on top of it, so the
 *   ground dissolves into the same air the mountains stand in.
 */

export type ArenaTheme = "dawn" | "frost" | "dusk" | "jungle" | "sands" | "storm";

/**
 * Rainforest dressing. Only the jungle map stages it; every other theme carries
 * the same block with `enabled: false` so the overlay can stay a plain group
 * that is repainted and hidden in one call.
 */
export interface FloraLook {
  enabled: boolean;
  /** Crown / mid / shaded canopy greens, brightest at the top. */
  canopySun: number;
  canopy: number;
  canopyDeep: number;
  trunk: number;
  vine: number;
  frond: number;
  temple: { stone: number; moss: number; gold: number };
  /** Sunbeams punched through the canopy. */
  beam: { color: number; opacity: number };
  /** Drifting pollen caught in the light. */
  pollen: { color: number; opacity: number };
}

const NO_FLORA: FloraLook = {
  enabled: false,
  canopySun: 0x7fae3e,
  canopy: 0x4c8733,
  canopyDeep: 0x2c5c2b,
  trunk: 0x574430,
  vine: 0x4c7a35,
  frond: 0x5f9639,
  temple: { stone: 0xb1a583, moss: 0x6a7f4a, gold: 0xe0b34a },
  beam: { color: 0xffe6a6, opacity: 0 },
  pollen: { color: 0xffe9a8, opacity: 0 },
};

/**
 * What actually grows, stands and falls on a map.
 *
 * Relighting alone cannot make a desert: a snowfield and a rainswept rampart lit
 * the same way are still the same wall of ruins. So every theme also names its
 * own dressing — a grove, a scatter of rock, standing stones, standing water and
 * a weather field — and `Dressing` stages exactly the kinds asked for.
 *
 * Kinds are enumerated rather than free-form because the geometry for each is
 * built once at boot and then hidden or shown per theme; a new map picks from
 * this vocabulary instead of allocating new meshes at switch time.
 */
export interface SceneryLook {
  /** Trees on the plain. `bare` is a dead/wind-stripped trunk with branches. */
  grove: {
    kind: "none" | "pine" | "palm" | "bare";
    /** Fraction of the built instance pool to draw, 0–1. */
    density: number;
    /** Nearest a tree may stand to the board centre. */
    inner: number;
    trunk: number;
    foliage: number;
  };
  /** Ground rock: rolling dunes, boulders or snow drifts. */
  rocks: {
    kind: "none" | "dune" | "boulder" | "drift";
    density: number;
    color: number;
  };
  /** A few tall silhouettes on the skyline. */
  monoliths: { kind: "none" | "obelisk" | "menhir"; stone: number; accent: number };
  /** Standing water catching the sky — rain pools, meltwater. */
  puddles: { enabled: boolean; color: number; opacity: number };
  /**
   * Falling weather. Rain, snow and driven sand are the same streak field: what
   * separates them is the tilt off vertical, the fall speed and the streak's
   * proportions — see `dressing.ts`.
   */
  weather: {
    kind: "none" | "rain" | "snow" | "sand";
    density: number;
    color: number;
    opacity: number;
  };
}

/** Bare ground: the map dresses itself with the hall and siege props only. */
const NO_SCENERY: SceneryLook = {
  grove: { kind: "none", density: 0, inner: 24, trunk: 0x574430, foliage: 0x40603a },
  rocks: { kind: "none", density: 0, color: 0x6f6a5e },
  monoliths: { kind: "none", stone: 0x8a8272, accent: 0xc9a05a },
  puddles: { enabled: false, color: 0x2a323c, opacity: 0 },
  weather: { kind: "none", density: 0, color: 0xffffff, opacity: 0 },
};

export interface ArenaLook {
  id: ArenaTheme;
  label: string;
  note: string;

  // ------------------------------------------------------------ renderer
  exposure: number;
  background: number;
  fog: { color: number; density: number };
  environment: {
    top: number;
    bottom: number;
    glow: number;
    warm: number;
    cool: number;
    intensity: number;
  };
  /**
   * Aerial perspective: the colour distance itself is, and how hard it pulls.
   *
   * Kept as its own value rather than reusing `fog.color` because the two are
   * doing different jobs at different ranges — the fog is the air between the
   * camera and the camps, this is the air stacked in front of a mountain forty
   * metres beyond the fog's useful range (the ranges run unfogged so they stay
   * readable, and take their distance from this instead). They are tuned to sit
   * within a shade of one another so the plain and the skyline agree.
   */
  haze: { color: number; strength: number };

  // ---------------------------------------------------------------- hall
  hemi: { sky: number; ground: number; intensity: number };
  keyLight: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number; position: [number, number, number] };
  /** Camera-mounted lamp so the near side of every figure stays readable. */
  lamp: { color: number; intensity: number };
  /** Scales the flickering torch point lights and their flame sprites. */
  torch: { intensity: number; flame: number };
  stone: { floor: number; dais: number; pillar: number; wall: number; rubble: number };
  window: { color: number; opacity: number };
  shaft: { color: number; opacity: number };
  dust: { color: number; opacity: number };

  // --------------------------------------------------------- battlefield
  sky: { zenith: number; horizon: number; ember: number };
  /**
   * The sun the sky draws.
   *
   * Its *direction* is deliberately absent: the sky reads that straight off
   * `keyLight.position`, so the disc in the shot, the halo around it and the
   * shadow every figure throws can never drift apart. `size` is the disc's
   * angular radius (0 hides it — an overcast map has no disc, only a bright
   * quarter of sky), `glow` scales the halo bled into the cloud around it.
   */
  sun: { color: number; size: number; glow: number };
  /**
   * The cloud sheet. `amount` is roughly the fraction of sky it closes over,
   * `speed` how fast it crosses. Clouds are lit from the sun's own direction,
   * so a low sun underlights them and a noon sun flattens them out.
   */
  cloud: { amount: number; color: number; speed: number };
  /**
   * Snow above this fraction of a range's own height. 1 keeps every peak bare.
   */
  snowline: number;
  /**
   * Fine trim over the ranges' baked vertex colours.
   *
   * These used to run as high as 1.8, because the bake was one flat near-black
   * per range and the multiplier was the only thing standing between a daylight
   * map and two black cutouts. The bake now carries the snow and the haze
   * itself, so this is back to what it should be — a nudge of a few per cent
   * toward warm or cold. Push it far past 1 and the far range will clip.
   */
  ridge: [number, number, number];
  ground: number;
  /**
   * The plain's second earth tone. The ground is a slow blend between this and
   * `ground` across tens of metres, which is what stops a 64× tiled mud texture
   * from reading as 64 copies of one square.
   */
  groundAlt: number;
  /** Scales the camp pyre lights and their glow discs. */
  fire: number;
  smoke: { color: number; opacity: number };
  ash: { color: number; opacity: number };
  troops: { ivory: number; obsidian: number; emissive: number };
  /** Wheeling birds — carrion crows at dusk, scarlet macaws in the canopy. */
  birds: number;
  /** Trebuchet, siege tower, ram and catapult. Off where they make no sense. */
  siegeEngines: boolean;
  flora: FloraLook;
  scenery: SceneryLook;

  // --------------------------------------------------------------- board
  board: { light: number; dark: number; base: number; border: number; trim: number };

  // --------------------------------------------------------------- grade
  /**
   * Bloom is what actually blows a daylight map out: the tone-mapped tiles sit
   * near the threshold, so every square starts glowing. Each theme carries its
   * own strength/threshold instead of one dusk-tuned setting for all three.
   */
  bloom: { strength: number; threshold: number; radius: number };
  /**
   * The film grade.
   *
   * `shadow` and `highlight` are the two ends of the split tone — the colour
   * the darks are pushed toward and the colour the lights are pushed toward.
   * Every map runs its shadows cooler than its highlights, because that split
   * is most of what separates a photographed world from a rendered one.
   * `saturation` shapes the *highlights* only (1 leaves them alone, lower
   * bleaches them), which is how a bright sky stays bright without going
   * poster-coloured.
   */
  grade: {
    vignette: number;
    grain: number;
    lift: number;
    strength: number;
    shadow: number;
    highlight: number;
    saturation: number;
  };
  /** Screen-space CSS vignette strength (0–1). */
  screenVignette: number;
}

export const ARENA_LOOKS: Record<ArenaTheme, ArenaLook> = {
  /**
   * A temple clearing swallowed by old forest.
   *
   * This map used to be the one that gave the game away: jade and lime under a
   * cyan sky is a *rendered* rainforest, not a wood anybody has stood in. The
   * canopy is now bronze-green over bottle-green, the light through it is gold
   * rather than white, and the sky has lost most of its cyan — a high summer
   * wood with a ruin in it. The surround is still the complement of the Sun
   * Empire's crimson, so the red army separates from the world as sharply as it
   * ever did; it simply does it against olive now instead of against neon.
   */
  jungle: {
    id: "jungle",
    label: "Sun Temple",
    note: "Old forest over a drowned temple — bronze canopy, gold light, deep shade",
    exposure: 0.95,
    background: 0x7ba0b2,
    fog: { color: 0x9fb098, density: 0.0108 },
    environment: {
      top: 0x4d86b0,
      bottom: 0x64704a,
      glow: 0xe2bd74,
      warm: 0xffecc0,
      cool: 0x87a97e,
      intensity: 0.88,
    },
    haze: { color: 0xa9b8a2, strength: 0.66 },
    hemi: { sky: 0x9ac6dc, ground: 0x4a5436, intensity: 0.95 },
    keyLight: { color: 0xfff0cb, intensity: 2.5, position: [-7, 18, 6] },
    fill: { color: 0x86ac74, intensity: 0.7, position: [9, 6, -8] },
    lamp: { color: 0xffeed0, intensity: 0.3 },
    torch: { intensity: 0.4, flame: 0.6 },
    stone: { floor: 0x8a8c76, dais: 0x95957c, pillar: 0x86886f, wall: 0x5c6152, rubble: 0x6a6c58 },
    window: { color: 0xfff0c0, opacity: 0.52 },
    shaft: { color: 0xffe4a2, opacity: 0.3 },
    dust: { color: 0xffe9b0, opacity: 0.32 },
    sky: { zenith: 0x2c6a9e, horizon: 0xcfcb9e, ember: 0x9ab069 },
    sun: { color: 0xfff0c8, size: 0.005, glow: 0.7 },
    cloud: { amount: 0.36, color: 0xefe7cd, speed: 0.004 },
    snowline: 1,
    ridge: [1.02, 1.08, 0.98],
    ground: 0x596546,
    groundAlt: 0x6b7350,
    fire: 0.5,
    smoke: { color: 0x9aa88e, opacity: 0.22 },
    ash: { color: 0xffe8a6, opacity: 0.3 },
    troops: { ivory: 0x6b7a92, obsidian: 0x6a4a3e, emissive: 0.14 },
    birds: 0xd8532c,
    siegeEngines: false,
    flora: {
      enabled: true,
      canopySun: 0x84983f,
      canopy: 0x4e7434,
      canopyDeep: 0x2d4c2c,
      trunk: 0x53412e,
      vine: 0x4c6d33,
      frond: 0x5f8236,
      temple: { stone: 0xada088, moss: 0x687a4c, gold: 0xd8b055 },
      beam: { color: 0xffe4a2, opacity: 0.34 },
      pollen: { color: 0xffe6a8, opacity: 0.4 },
    },
    /** The forest overlay already dresses this one, top to bottom. */
    scenery: NO_SCENERY,
    board: { light: 0xd8ceaa, dark: 0x2e4539, base: 0x505842, border: 0xbda667, trim: 0xcaa246 },
    bloom: { strength: 0.26, threshold: 0.92, radius: 0.6 },
    grade: {
      vignette: 0.55,
      grain: 0.02,
      lift: 0.012,
      strength: 0.68,
      shadow: 0x2c4a5e,
      highlight: 0xffeeb8,
      saturation: 0.88,
    },
    screenVignette: 0.24,
  },

  /**
   * Morning over the horse-country: dry ochre grass, a pale gold sun and
   * blue-grey ranges stacked into the haze behind the camps.
   *
   * This is the map the game opens on, so it carries the clearest read of both
   * armies as well as the establishing shot: warm key, cool fill, and a sky
   * with enough cloud in it to have somewhere for the light to come from.
   */
  dawn: {
    id: "dawn",
    label: "Dawn Court",
    note: "Gold morning over the plains — pale sun, blue ranges, every figure legible",
    exposure: 0.94,
    background: 0x93a8bc,
    fog: { color: 0xb7c2c9, density: 0.0082 },
    environment: {
      top: 0x6f8faf,
      bottom: 0xa89877,
      glow: 0xd8bb8c,
      warm: 0xe8d9b6,
      cool: 0x93a9c2,
      intensity: 0.84,
    },
    haze: { color: 0xb9c6cf, strength: 0.62 },
    hemi: { sky: 0xa9c0d6, ground: 0x7a6f57, intensity: 0.85 },
    keyLight: { color: 0xffe9c0, intensity: 2.35, position: [-9, 16, 8] },
    fill: { color: 0x93a9c6, intensity: 0.62, position: [8, 7, -9] },
    lamp: { color: 0xffeeda, intensity: 0.3 },
    torch: { intensity: 0.45, flame: 0.65 },
    stone: { floor: 0x8a8474, dais: 0x968f7c, pillar: 0x878170, wall: 0x6a655c, rubble: 0x736d62 },
    window: { color: 0xffedcc, opacity: 0.5 },
    shaft: { color: 0xffe2ba, opacity: 0.18 },
    dust: { color: 0xffeeda, opacity: 0.2 },
    sky: { zenith: 0x2f5f96, horizon: 0xd8c9a8, ember: 0xe0ab6a },
    sun: { color: 0xfff2d2, size: 0.006, glow: 0.55 },
    cloud: { amount: 0.42, color: 0xf4e9d6, speed: 0.0035 },
    snowline: 0.62,
    ridge: [1, 1.01, 1.06],
    ground: 0x7c7460,
    groundAlt: 0x8d8259,
    fire: 0.6,
    smoke: { color: 0x8f8a83, opacity: 0.2 },
    ash: { color: 0xe3bd8b, opacity: 0.22 },
    troops: { ivory: 0x6c7994, obsidian: 0x5e4a44, emissive: 0.16 },
    birds: 0x141317,
    siegeEngines: true,
    flora: NO_FLORA,
    /** A far conifer line and a few glacial boulders — the court has a country. */
    scenery: {
      ...NO_SCENERY,
      grove: { kind: "pine", density: 0.55, inner: 46, trunk: 0x483a2d, foliage: 0x3c5540 },
      rocks: { kind: "boulder", density: 0.4, color: 0x87806f },
      monoliths: { kind: "menhir", stone: 0x8b8474, accent: 0xc3a97e },
    },
    board: { light: 0xd7cdb6, dark: 0x3a4150, base: 0x544d41, border: 0xb0a07c, trim: 0x93733a },
    bloom: { strength: 0.24, threshold: 0.94, radius: 0.6 },
    grade: {
      vignette: 0.6,
      grain: 0.02,
      lift: 0.01,
      strength: 0.72,
      shadow: 0x2f4a6e,
      highlight: 0xffe6bd,
      saturation: 0.9,
    },
    screenVignette: 0.28,
  },

  /**
   * A snowbound pass under the grey mountains: no sun disc at all, a sky closed
   * over with cloud, and a near-monochrome field where the only warmth in the
   * frame is the torches. The snowline sits low, so every range in shot is
   * white above a third of its height — this is the map the mountains carry.
   */
  frost: {
    id: "frost",
    label: "Frostfall",
    note: "A snowbound pass — shut sky, white ranges, the torches the only warmth",
    exposure: 0.98,
    background: 0xa8b6c6,
    fog: { color: 0xbcc8d4, density: 0.0125 },
    environment: {
      top: 0x87a0bd,
      bottom: 0xbfc9d5,
      glow: 0x8fa3b8,
      warm: 0xd9e3ee,
      cool: 0xa6b9cf,
      intensity: 0.95,
    },
    haze: { color: 0xc4cfdb, strength: 0.8 },
    hemi: { sky: 0xc0d2e8, ground: 0x8f99a6, intensity: 1.2 },
    keyLight: { color: 0xeaf2ff, intensity: 2.15, position: [7, 16, -6] },
    fill: { color: 0xb2c1d4, intensity: 0.75, position: [-8, 7, 9] },
    lamp: { color: 0xe6eeff, intensity: 0.28 },
    torch: { intensity: 0.7, flame: 0.9 },
    stone: { floor: 0x9ba3ae, dais: 0xa5adb8, pillar: 0x929ba7, wall: 0x747d88, rubble: 0x838c96 },
    window: { color: 0xf2f7ff, opacity: 0.5 },
    shaft: { color: 0xd2dff0, opacity: 0.16 },
    dust: { color: 0xf2f8ff, opacity: 0.42 },
    sky: { zenith: 0x5f7796, horizon: 0xc2cdd9, ember: 0x8fa2b6 },
    /** Overcast: the sun is a bright quarter of sky, never a disc. */
    sun: { color: 0xe8f1ff, size: 0, glow: 0.3 },
    cloud: { amount: 0.78, color: 0xd6dfea, speed: 0.006 },
    snowline: 0.28,
    ridge: [1.02, 1.05, 1.1],
    ground: 0xacb4be,
    groundAlt: 0xc6d1dc,
    fire: 0.85,
    smoke: { color: 0xa5abb3, opacity: 0.24 },
    ash: { color: 0xd7e2f0, opacity: 0.38 },
    troops: { ivory: 0x62708a, obsidian: 0x554644, emissive: 0.13 },
    birds: 0x1b1d24,
    siegeEngines: true,
    flora: NO_FLORA,
    /** Snow-laden firs, drifts banked against everything, and steady snowfall. */
    scenery: {
      ...NO_SCENERY,
      grove: { kind: "pine", density: 1, inner: 27, trunk: 0x3d3934, foliage: 0x2e3f47 },
      rocks: { kind: "drift", density: 1, color: 0xdde7f2 },
      monoliths: { kind: "menhir", stone: 0x8f9caa, accent: 0xd4e0ee },
      puddles: { enabled: true, color: 0x9fb6cc, opacity: 0.5 },
      weather: { kind: "snow", density: 1, color: 0xf2f8ff, opacity: 0.75 },
    },
    board: { light: 0xdae2ec, dark: 0x2f3644, base: 0x4b5260, border: 0xb3bdc8, trim: 0x77869a },
    bloom: { strength: 0.28, threshold: 0.9, radius: 0.62 },
    grade: {
      vignette: 0.52,
      grain: 0.018,
      lift: 0.008,
      strength: 0.66,
      shadow: 0x33506e,
      highlight: 0xe6f0ff,
      saturation: 0.82,
    },
    screenVignette: 0.22,
  },

  /**
   * Noon over a fortress in the southern waste: the harshest light on the board.
   * The sky is almost white at the horizon and the stone is bleached to bone, so
   * both armies read as silhouettes first and colour second — the opposite
   * problem to dusk, and the reason the tiles are pushed to the darkest brown of
   * any map.
   *
   * The yellow has been taken out of the sand deliberately. Real desert at noon
   * is bone and dust-rose with a violet-blue shadow, not butter; the old lemon
   * cast was the one thing on this map that could not be photographed.
   */
  sands: {
    id: "sands",
    label: "Dune Bastion",
    note: "Blinding southern noon — bone stone, hard violet shadows, sand in the air",
    exposure: 0.9,
    background: 0xc4b490,
    fog: { color: 0xd2c2a2, density: 0.0118 },
    environment: {
      top: 0x5d86b4,
      bottom: 0xb5a077,
      glow: 0xecd6a4,
      warm: 0xfff0d2,
      cool: 0xbcae8e,
      intensity: 0.98,
    },
    haze: { color: 0xd8caa8, strength: 0.7 },
    hemi: { sky: 0xbacfe4, ground: 0x968157, intensity: 1.05 },
    keyLight: { color: 0xfff2d8, intensity: 2.75, position: [2, 20, 3] },
    fill: { color: 0xd2bb92, intensity: 0.68, position: [-8, 5, -8] },
    lamp: { color: 0xfff2da, intensity: 0.26 },
    torch: { intensity: 0.3, flame: 0.45 },
    stone: { floor: 0xa39268, dais: 0xac9d74, pillar: 0x9b8b64, wall: 0x776a4e, rubble: 0x877858 },
    window: { color: 0xfff4d2, opacity: 0.46 },
    shaft: { color: 0xffe9b8, opacity: 0.22 },
    dust: { color: 0xffeec4, opacity: 0.44 },
    sky: { zenith: 0x3a6ea8, horizon: 0xe4d6b2, ember: 0xd0a874 },
    /** High and small: a noon sun is a hot pinhole, not a soft lamp. */
    sun: { color: 0xfff6de, size: 0.0035, glow: 0.85 },
    cloud: { amount: 0.16, color: 0xf4ecd8, speed: 0.002 },
    snowline: 1,
    ridge: [1.04, 1, 0.94],
    ground: 0xb09a6a,
    groundAlt: 0xc2ad7d,
    fire: 0.45,
    smoke: { color: 0xb0a184, opacity: 0.2 },
    ash: { color: 0xf0dca8, opacity: 0.42 },
    troops: { ivory: 0x74809a, obsidian: 0x6b5340, emissive: 0.12 },
    /** Vultures, not crows. */
    birds: 0x3a2f26,
    siegeEngines: true,
    flora: NO_FLORA,
    /** Date palms, dune backs, two obelisks, and sand coming off the crests. */
    scenery: {
      ...NO_SCENERY,
      grove: { kind: "palm", density: 0.7, inner: 25, trunk: 0x796648, foliage: 0x788245 },
      rocks: { kind: "dune", density: 1, color: 0xc0a574 },
      monoliths: { kind: "obelisk", stone: 0xb8a37a, accent: 0xd8b96a },
      weather: { kind: "sand", density: 0.85, color: 0xf0dca8, opacity: 0.34 },
    },
    board: { light: 0xe9dcb6, dark: 0x453a2a, base: 0x6d5c3d, border: 0xd1b87c, trim: 0xc08c36 },
    bloom: { strength: 0.3, threshold: 0.9, radius: 0.58 },
    grade: {
      vignette: 0.48,
      grain: 0.02,
      lift: 0.008,
      strength: 0.62,
      shadow: 0x3c5a7a,
      highlight: 0xffeec6,
      saturation: 0.86,
    },
    screenVignette: 0.2,
  },

  /**
   * A downpour on the deeping wall. Everything is desaturated and wet: the one
   * map where the torches are losing, which is what the sputtering flame and the
   * cold key light are for. The falling motes are rain, not ash.
   *
   * Near-monochrome on purpose — the sky is shut, the ranges are almost gone in
   * the haze, and the only colour left in the frame is the blue in the shadows
   * and whatever the fires can still hold.
   */
  storm: {
    id: "storm",
    label: "Stormwatch",
    note: "Rain on the deeping wall — shut sky, wet stone, torches barely holding",
    exposure: 1,
    background: 0x525c6a,
    fog: { color: 0x646e7c, density: 0.017 },
    environment: {
      top: 0x4e5b70,
      bottom: 0x4b4a46,
      glow: 0x76808f,
      warm: 0xc2c9d2,
      cool: 0x74879f,
      intensity: 0.86,
    },
    haze: { color: 0x6f7986, strength: 0.92 },
    hemi: { sky: 0x8798ac, ground: 0x494c46, intensity: 0.92 },
    keyLight: { color: 0xd2dcea, intensity: 1.75, position: [-6, 17, -8] },
    fill: { color: 0x76849a, intensity: 0.72, position: [9, 6, 8] },
    lamp: { color: 0xe0e9f3, intensity: 0.32 },
    /** Wind-beaten: strong light, small flame. */
    torch: { intensity: 0.9, flame: 0.6 },
    stone: { floor: 0x686c73, dais: 0x71757c, pillar: 0x61656c, wall: 0x44474d, rubble: 0x53565c },
    window: { color: 0xd9e5f3, opacity: 0.42 },
    shaft: { color: 0xbac9db, opacity: 0.12 },
    dust: { color: 0xcad7e5, opacity: 0.46 },
    sky: { zenith: 0x2f3947, horizon: 0x7e8894, ember: 0x56606e },
    /** No disc gets through this: only a lighter quarter of cloud. */
    sun: { color: 0xc8d4e4, size: 0, glow: 0.22 },
    cloud: { amount: 0.92, color: 0x8b95a2, speed: 0.011 },
    snowline: 1,
    ridge: [0.97, 1, 1.06],
    ground: 0x565a54,
    groundAlt: 0x62675e,
    fire: 0.7,
    smoke: { color: 0x7b8189, opacity: 0.3 },
    /** Rain, not cinders. */
    ash: { color: 0xcdd8e6, opacity: 0.6 },
    troops: { ivory: 0x5d6981, obsidian: 0x463c3b, emissive: 0.2 },
    birds: 0x14161b,
    siegeEngines: true,
    flora: NO_FLORA,
    /** Stripped wind-bent trees, wet boulders, standing water, driving rain. */
    scenery: {
      ...NO_SCENERY,
      grove: { kind: "bare", density: 1, inner: 26, trunk: 0x393834, foliage: 0x393834 },
      rocks: { kind: "boulder", density: 0.8, color: 0x5b6067 },
      monoliths: { kind: "menhir", stone: 0x565d65, accent: 0x8a95a1 },
      puddles: { enabled: true, color: 0x76889c, opacity: 0.78 },
      weather: { kind: "rain", density: 1, color: 0xd6e4f5, opacity: 0.5 },
    },
    board: { light: 0xd3d9df, dark: 0x2a313b, base: 0x464c54, border: 0xa9b3bd, trim: 0x6d7b89 },
    bloom: { strength: 0.34, threshold: 0.86, radius: 0.66 },
    grade: {
      vignette: 0.82,
      grain: 0.03,
      lift: 0.014,
      strength: 0.84,
      shadow: 0x243a58,
      highlight: 0xd6e2f2,
      saturation: 0.72,
    },
    screenVignette: 0.36,
  },

  /**
   * The siege at dusk — the ash country. Dramatic, dark, torch-lit, and the one
   * map where the light in the sky is *fire* rather than sun: a broad red disc
   * burning through the smoke, ash banks lit from underneath by it, and a
   * horizon still glowing from whatever is alight below it.
   */
  dusk: {
    id: "dusk",
    label: "Siege at Dusk",
    note: "The ash country — a burning horizon, soot overhead, torchlight holding the walls",
    exposure: 1.05,
    background: 0x07080b,
    fog: { color: 0x14120f, density: 0.019 },
    environment: {
      top: 0x121a29,
      bottom: 0x120c07,
      glow: 0x8a4218,
      warm: 0xffa855,
      cool: 0x2b467f,
      intensity: 0.75,
    },
    haze: { color: 0x231a15, strength: 0.55 },
    hemi: { sky: 0x44598a, ground: 0x120e0a, intensity: 0.6 },
    keyLight: { color: 0xffd39a, intensity: 2.7, position: [-9, 15, 7] },
    fill: { color: 0x5c7cbc, intensity: 0.55, position: [8, 6, -9] },
    lamp: { color: 0xffe6c4, intensity: 0.3 },
    torch: { intensity: 1, flame: 1 },
    stone: { floor: 0x655d52, dais: 0x575046, pillar: 0x524b42, wall: 0x2c2824, rubble: 0x393328 },
    window: { color: 0xffd9a6, opacity: 0.55 },
    shaft: { color: 0xffffff, opacity: 0.7 },
    dust: { color: 0xffe6bd, opacity: 0.5 },
    sky: { zenith: 0x080b16, horizon: 0x2a1a13, ember: 0xb44a16 },
    /** Twice the disc of any other map, and the only one burning rather than shining. */
    sun: { color: 0xff9a44, size: 0.012, glow: 1 },
    cloud: { amount: 0.66, color: 0x2a2320, speed: 0.008 },
    snowline: 1,
    ridge: [1, 0.97, 0.94],
    ground: 0x655b50,
    groundAlt: 0x554b41,
    fire: 1,
    smoke: { color: 0x6b6560, opacity: 0.3 },
    ash: { color: 0xffb066, opacity: 0.55 },
    troops: { ivory: 0x3a4055, obsidian: 0x342a28, emissive: 0.5 },
    birds: 0x0d0c0f,
    siegeEngines: true,
    flora: NO_FLORA,
    /** Burnt stumps at the edge of the firelight — the siege took the wood. */
    scenery: {
      ...NO_SCENERY,
      grove: { kind: "bare", density: 0.5, inner: 30, trunk: 0x2a241e, foliage: 0x2a241e },
      rocks: { kind: "boulder", density: 0.45, color: 0x4a423a },
    },
    board: { light: 0xf6efe0, dark: 0x2b2f38, base: 0x3b342b, border: 0xbfae8e, trim: 0x8a6a33 },
    bloom: { strength: 0.62, threshold: 0.72, radius: 0.75 },
    grade: {
      vignette: 1.05,
      grain: 0.045,
      lift: 0.02,
      strength: 1,
      shadow: 0x1e3560,
      highlight: 0xffb877,
      saturation: 0.88,
    },
    screenVignette: 0.55,
  },
};

/** Brightest hall first, darkest last — the picker reads as a dimmer. */
export const ARENA_ORDER: ArenaTheme[] = ["jungle", "dawn", "sands", "frost", "storm", "dusk"];

/**
 * The map the game opens on.
 *
 * The arena is *not* remembered between visits — the shell boots every session
 * on this one — and the arcade's online seat never shows the muster picker at
 * all, so for most players this is not a default so much as the only map they
 * will ever see. Dawn Court has the establishing shot: a low warm sun, ranges
 * stacked in the haze behind the camps, and the clearest read of both armies.
 */
export const DEFAULT_ARENA: ArenaTheme = "dawn";
