import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import type { ArenaLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";

/**
 * The film grade: a per-map split tone, bleached highlights, lifted blacks,
 * grain that lives in the shadows, and a vignette. Runs after tone mapping,
 * before SMAA.
 *
 * The split tone used to be two constants — one warm, one cool — which meant
 * every map got the same dusk-siege look laid over the top of whatever it had
 * carefully been lit as. `uShadow` and `uHighlight` now come from the theme.
 *
 * They arrive **luminance-normalised** (see {@link PostFX.pushGrade}), which is
 * the whole trick: a tint is a direction, not a brightness. Divided through by
 * its own luma, a colour multiplies as a pure hue shift, so pushing the shadows
 * hard into blue cannot also crush the picture — which is what makes it safe to
 * run this at full strength on the dark maps.
 *
 * `uSaturation` shapes the highlights alone. Real film loses colour as it
 * approaches its shoulder; a renderer does not, which is why a bright sky comes
 * out of a naive grade looking like poster paint.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.05 },
    uGrain: { value: 0.045 },
    uLift: { value: 0.02 },
    uStrength: { value: 1 },
    uShadow: { value: new THREE.Vector3(0.86, 0.93, 1.1) },
    uHighlight: { value: new THREE.Vector3(1.06, 0.99, 0.88) },
    uSaturation: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uLift;
    uniform float uStrength;
    uniform vec3 uShadow;
    uniform vec3 uHighlight;
    uniform float uSaturation;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      float luma = dot(color, LUMA);

      // Split tone: the map's own sunlight into the highlights, the colour of
      // its shadows into the darks. Held to a little over half strength — past
      // that it stops reading as light and starts reading as a filter.
      vec3 tint = mix(uShadow, uHighlight, smoothstep(0.05, 0.7, luma));
      vec3 graded = color * mix(vec3(1.0), tint, 0.55);

      // Shoulder bleach: colour drains out of the brightest part of the frame.
      float bleach = smoothstep(0.55, 1.0, luma) * (1.0 - uSaturation);
      graded = mix(graded, vec3(dot(graded, LUMA)), bleach);

      // Filmic contrast with lifted blacks.
      graded = mix(vec3(uLift), graded, 1.04);
      graded = clamp((graded - 0.5) * 1.07 + 0.5, 0.0, 1.4);

      // Vignette.
      vec2 centred = vUv - 0.5;
      float vignette = 1.0 - dot(centred, centred) * uVignette;
      graded *= clamp(vignette, 0.0, 1.0);

      // Grain, weighted into the shadows — that is where emulsion actually has
      // it, and keeping it out of the sky stops a bright map looking dirty.
      float grain = (hash(vUv * 512.0 + fract(uTime) * 97.0) - 0.5) * uGrain;
      graded += grain * (1.25 - luma * 0.85);

      gl_FragColor = vec4(mix(color, graded, uStrength), texel.a);
    }
  `,
};

/**
 * A tint colour divided through by its own luminance, so multiplying by it
 * changes hue without changing exposure. Guards a black tint, which would
 * otherwise divide by nothing and take the frame with it.
 */
function normalisedTint(hex: number, into: THREE.Vector3): THREE.Vector3 {
  const color = new THREE.Color(hex);
  const luma = Math.max(0.04, color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722);
  return into.set(color.r / luma, color.g / luma, color.b / luma);
}

/**
 * Cinematic pipeline. Passes are rebuilt whenever the graphics preset changes so
 * each preset really does cost less — Low bypasses the composer entirely.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private gradePass: ShaderPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private preset: QualityPreset;
  private grade: ArenaLook["grade"] = ARENA_LOOKS[DEFAULT_ARENA].grade;
  private bloom: ArenaLook["bloom"] = ARENA_LOOKS[DEFAULT_ARENA].bloom;
  private cinematic = false;
  /** Showcase clarity: grain, vignette and bloom pulled back so sculpts read. */
  private clarity = false;
  private elapsed = 0;
  /** Set when a pass misbehaves on this GPU — from then on we render straight. */
  private direct = false;
  /** Reversible version of the above, driven by the safe-rendering setting. */
  private bypassed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.preset = "high";
  }

  get enabled(): boolean {
    return this.composer !== null;
  }

  setPreset(preset: QualityPreset): void {
    this.preset = preset;
    this.build();
  }

  private build(): void {
    this.dispose();
    const settings = QUALITY_SETTINGS[this.preset];
    if (this.direct || this.bypassed || !settings.postFx) return;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    // SSAO only multiplies occlusion onto the buffer the RenderPass filled —
    // it never draws the beauty pass itself, so RenderPass must stay enabled.
    if (settings.ssao) {
      const ssao = new SSAOPass(this.scene, this.camera, size.x, size.y);
      ssao.kernelRadius = 0.35;
      ssao.minDistance = 0.0015;
      ssao.maxDistance = 0.12;
      composer.addPass(ssao);
      this.ssaoPass = ssao;
    }

    if (settings.bloom) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this.bloom.strength,
        this.bloom.radius,
        this.bloom.threshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
      this.pushBloom();
    }

    if (settings.dof) {
      const bokeh = new BokehPass(this.scene, this.camera, { focus: 11, aperture: 0.0016, maxblur: 0.008 });
      bokeh.enabled = false;
      composer.addPass(bokeh);
      this.bokehPass = bokeh;
    }

    composer.addPass(new OutputPass());

    if (settings.grade) {
      const grade = new ShaderPass(GradeShader);
      composer.addPass(grade);
      this.gradePass = grade;
      this.pushGrade();
    }

    if (settings.smaa) {
      composer.addPass(new SMAAPass());
    }

    this.composer = composer;
  }

  /**
   * Arena themes carry their own grade: the dusk siege keeps the heavy vignette
   * and grain, daylight maps pull both right back so the sculpts stay crisp.
   */
  setGrade(grade: ArenaLook["grade"]): void {
    this.grade = grade;
    this.pushGrade();
  }

  /**
   * Daylight maps need a much higher bloom threshold: their tiles already sit
   * near white after tone mapping, so a dusk-tuned threshold makes the whole
   * board glow and washes the sculpts out.
   */
  setBloom(bloom: ArenaLook["bloom"]): void {
    this.bloom = bloom;
    this.pushBloom();
  }

  /**
   * Presentation mode for computer-vs-computer duels, where the viewer is only
   * ever watching: the film grain, the vignette and the bloom halo are pulled
   * right back so the twelve sculpts stay sharp instead of sitting behind a
   * layer of haze. Depth of field is never used here.
   */
  setClarity(active: boolean): void {
    if (this.clarity === active) return;
    this.clarity = active;
    this.pushGrade();
    this.pushBloom();
  }

  private pushBloom(): void {
    if (!this.bloomPass) return;
    const bloom = this.bloom;
    this.bloomPass.strength = this.clarity ? bloom.strength * 0.62 : bloom.strength;
    this.bloomPass.radius = this.clarity ? bloom.radius * 0.8 : bloom.radius;
    this.bloomPass.threshold = this.clarity ? Math.min(0.98, bloom.threshold + 0.04) : bloom.threshold;
  }

  private pushGrade(): void {
    if (!this.gradePass) return;
    const uniforms = this.gradePass.uniforms as unknown as Record<string, { value: number | THREE.Vector3 }>;
    const grade = this.grade;
    const soften = this.clarity;
    uniforms.uVignette.value = soften ? grade.vignette * 0.5 : grade.vignette;
    uniforms.uGrain.value = soften ? grade.grain * 0.3 : grade.grain;
    uniforms.uLift.value = grade.lift;
    uniforms.uStrength.value = soften ? grade.strength * 0.82 : grade.strength;
    normalisedTint(grade.shadow, uniforms.uShadow.value as THREE.Vector3);
    normalisedTint(grade.highlight, uniforms.uHighlight.value as THREE.Vector3);
    // Showcase clarity keeps the map's colour: bleaching the highlights is what
    // the mode exists to *not* do.
    uniforms.uSaturation.value = soften ? Math.min(1, grade.saturation + 0.1) : grade.saturation;
  }

  /** Enables depth of field for the intro, promotion picker and checkmate dolly. */
  setCinematic(active: boolean, focus = 11): void {
    this.cinematic = active;
    if (!this.bokehPass) return;
    this.bokehPass.enabled = active;
    const uniforms = this.bokehPass.uniforms as unknown as Record<string, { value: number }>;
    if (uniforms.focus) uniforms.focus.value = focus;
  }

  get isCinematic(): boolean {
    return this.cinematic;
  }

  setSize(width: number, height: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
    if (this.ssaoPass) this.ssaoPass.setSize(width, height);
  }

  /**
   * Safe rendering: skip the composer entirely but stay able to come back, so
   * the player can try the cinematic pipeline again without a reload.
   */
  setBypassed(active: boolean): void {
    if (this.bypassed === active) return;
    this.bypassed = active;
    this.build();
  }

  get isBypassed(): boolean {
    return this.bypassed || this.direct;
  }

  /**
   * Permanently drops back to a plain forward render. Used when the composer
   * throws or produces an empty frame on the player's GPU.
   */
  forceDirect(reason: string): void {
    if (this.direct) return;
    this.direct = true;
    console.warn(`[postfx] disabling post-processing: ${reason}`);
    this.dispose();
  }

  render(delta: number): void {
    this.elapsed += delta;
    if (this.gradePass) {
      (this.gradePass.uniforms as unknown as Record<string, { value: number }>).uTime.value = this.elapsed;
    }
    if (this.composer) {
      try {
        this.composer.render(delta);
        return;
      } catch (error) {
        this.forceDirect(`composer error (${String(error)})`);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.bokehPass = null;
    this.gradePass = null;
    this.ssaoPass = null;
  }
}
