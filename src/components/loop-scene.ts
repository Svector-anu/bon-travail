import { BufferAttribute, BufferGeometry, Color, Group, PerspectiveCamera, Points, Scene, ShaderMaterial, WebGLRenderer } from 'three'
import { buildLoopShapes, LOOP_SHAPE_COUNT } from './loop-shapes'

/** Ink on paper that warms into copper at the payout; the failure is terracotta. */
const STEP_COLORS = ['#3b3027', '#2a231c', '#c47a22']
const FAILURE_COLOR = '#c4532f'
/** How far the camera looks down on each form. */
const TILT = [0.18, 0.08, 0.42]

const vertexShader = /* glsl */ `
  attribute vec3 p1;
  attribute vec3 p2;
  attribute float aSeed;
  attribute float aFailure;
  uniform float uMorph;
  uniform float uTime;
  uniform float uSize;
  uniform float uDistance;
  uniform vec3 uColors[${LOOP_SHAPE_COUNT}];
  uniform vec3 uFailure;
  varying vec3 vColor;
  varying float vAlpha;

  vec3 shape(int i) {
    if (i == 0) return position;
    if (i == 1) return p1;
    return p2;
  }

  void main() {
    float base = floor(uMorph);
    int from = int(base);
    int to = min(from + 1, ${LOOP_SHAPE_COUNT - 1});
    // Each point leaves on its own delay, so a change ripples through the cloud.
    float t = smoothstep(0.0, 1.0, clamp((uMorph - base - aSeed * 0.4) / 0.6, 0.0, 1.0));
    vec3 pos = mix(shape(from), shape(to), t);
    float flight = sin(3.14159 * t);
    pos += flight * 0.35 * (aSeed - 0.5) * normalize(pos + vec3(0.0001));
    pos += 0.012 * vec3(sin(uTime * 0.9 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 31.0), sin(uTime * 0.8 + aSeed * 17.0));

    vec3 color = mix(uColors[from], uColors[to], t);
    float failing = aFailure * (from == 0 ? 1.0 - t : 0.0);
    vColor = mix(color, uFailure, failing);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uDistance * (1.0 + failing * 0.6) / -mv.z;
    vAlpha = clamp(1.25 - (-mv.z - uDistance + 1.0) * 0.45, 0.25, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, d));
  }
`

export interface LoopScene {
  /** Where the cloud should be: 0 is the first form, 4 the last; fractions are between forms. */
  setTarget(morph: number): void
  setActive(active: boolean): void
  dispose(): void
}

/** The point cloud behind "how it works". Runs only while visible; never touches the DOM outside its canvas. */
export function createLoopScene(canvas: HTMLCanvasElement, options: { reduceMotion: boolean }): LoopScene {
  const small = canvas.clientWidth < 520
  const shapes = buildLoopShapes(small ? 5200 : 9000)

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 50)
  camera.position.set(0, 0, 4.6)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(shapes.positions[0]!, 3))
  for (let i = 1; i < LOOP_SHAPE_COUNT; i++) geometry.setAttribute(`p${i}`, new BufferAttribute(shapes.positions[i]!, 3))
  geometry.setAttribute('aSeed', new BufferAttribute(shapes.seeds, 1))
  geometry.setAttribute('aFailure', new BufferAttribute(shapes.failure, 1))

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMorph: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: 0 },
      uDistance: { value: 4.6 },
      uColors: { value: STEP_COLORS.map((c) => new Color(c)) },
      uFailure: { value: new Color(FAILURE_COLOR) },
    },
  })

  const group = new Group()
  group.add(new Points(geometry, material))
  scene.add(group)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Narrow screens pull the camera back so the widest form (the board) still fits.
    camera.position.z = 4.6 / Math.min(1, camera.aspect * 0.9)
    camera.updateProjectionMatrix()
    material.uniforms.uSize!.value = ((small ? 7 : 8.5) / 4.6) * renderer.getPixelRatio()
    material.uniforms.uDistance!.value = camera.position.z
  }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)

  let target = 0
  let morph = 0
  let running = false
  let frame = 0
  let last = 0
  let elapsed = 0

  const tiltAt = (m: number) => {
    const i = Math.min(Math.floor(m), LOOP_SHAPE_COUNT - 2)
    const f = m - i
    return TILT[i]! + (TILT[i + 1]! - TILT[i]!) * f
  }

  const tick = (now: number) => {
    const dt = Math.min((now - (last || now)) / 1000, 0.05)
    last = now
    morph += (target - morph) * (options.reduceMotion ? 1 : Math.min(1, dt * 5))
    if (!options.reduceMotion) {
      elapsed += dt
      // A slow sway rather than a spin: every form stays readable from the front.
      group.rotation.y = Math.sin(elapsed * 0.32) * 0.55
    }
    group.rotation.x = tiltAt(Math.min(Math.max(morph, 0), LOOP_SHAPE_COUNT - 1))
    material.uniforms.uMorph!.value = morph
    material.uniforms.uTime!.value = elapsed
    renderer.render(scene, camera)
    frame = running ? requestAnimationFrame(tick) : 0
  }

  return {
    setTarget(next) {
      target = Math.min(Math.max(next, 0), LOOP_SHAPE_COUNT - 1)
      if (!running) {
        morph = target
        tick(performance.now())
      }
    },
    setActive(active) {
      if (active === running) return
      running = active
      last = 0
      if (active) frame = requestAnimationFrame(tick)
      else cancelAnimationFrame(frame)
    },
    dispose() {
      running = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
