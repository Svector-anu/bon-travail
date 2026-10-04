/**
 * The three forms of the home page's point cloud: a failure noticed, a fix
 * made, a payment sealed.
 * Every form has the same number of points in the same order, so the scene can
 * morph between any two of them by blending positions on the GPU.
 */

export const LOOP_SHAPE_COUNT = 3

export interface LoopShapes {
  count: number
  /** One xyz array per step, each `count * 3` long, roughly within a unit sphere. */
  positions: Float32Array[]
  /** 0..1 per point: when each point starts moving, so a morph ripples instead of snapping. */
  seeds: Float32Array
  /** 1 for the points that are the recurring failure in the first form. */
  failure: Float32Array
}

/** Small deterministic PRNG, so the server-rendered page and every visit draw the same cloud. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FAILURE_SHARE = 0.06

/** Noticed: a loose cloud of CI runs, with one tight knot of the same failure. */
function cloud(out: Float32Array, n: number, rand: () => number, failure: Float32Array) {
  const knot = Math.floor(n * FAILURE_SHARE)
  for (let i = 0; i < n; i++) {
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(2 * rand() - 1)
    const inKnot = i < knot
    const r = inKnot ? 0.13 * Math.cbrt(rand()) : 1.05 * Math.pow(rand(), 0.6)
    const cx = inKnot ? 0.38 : 0
    const cy = inKnot ? 0.22 : 0
    const cz = inKnot ? 0.2 : 0
    out[i * 3] = cx + r * Math.sin(phi) * Math.cos(theta) * 1.15
    out[i * 3 + 1] = cy + r * Math.cos(phi) * 0.8
    out[i * 3 + 2] = cz + r * Math.sin(phi) * Math.sin(theta)
    failure[i] = inKnot ? 1 : 0
  }
}

/** Fixed: a branch leaves main, carries commits, and merges back. */
function branch(out: Float32Array, n: number, rand: () => number) {
  const tube = () => (rand() - 0.5) * 0.06
  const commits = [-1.25, -0.62, 0, 0.62, 1.25]
  for (let i = 0; i < n; i++) {
    const pick = rand()
    let x: number
    let y: number
    let z: number
    if (pick < 0.38) {
      x = -1.55 + rand() * 3.1
      y = 0
      z = 0
    } else if (pick < 0.7) {
      const t = rand()
      x = -0.9 + t * 1.8
      y = 0.62 * Math.sin(Math.PI * t)
      z = 0.34 * Math.sin(Math.PI * t)
    } else {
      const onBranch = rand() < 0.5
      const c = commits[Math.floor(rand() * commits.length)]!
      const t = (c + 0.9) / 1.8
      const theta = rand() * Math.PI * 2
      const phi = Math.acos(2 * rand() - 1)
      const r = 0.075 * Math.cbrt(rand())
      x = c + r * Math.sin(phi) * Math.cos(theta)
      y = (onBranch && t > 0 && t < 1 ? 0.62 * Math.sin(Math.PI * t) : 0) + r * Math.cos(phi)
      z = (onBranch && t > 0 && t < 1 ? 0.34 * Math.sin(Math.PI * t) : 0) + r * Math.sin(phi) * Math.sin(theta)
      out[i * 3] = x * 0.85
      out[i * 3 + 1] = y - 0.2
      out[i * 3 + 2] = z
      continue
    }
    out[i * 3] = (x + tube()) * 0.85
    out[i * 3 + 1] = y + tube() - 0.2
    out[i * 3 + 2] = z + tube()
  }
}

/** Paid: a ring, the coin and the seal. */
function ring(out: Float32Array, n: number, rand: () => number) {
  const major = 0.82
  const minor = 0.26
  for (let i = 0; i < n; i++) {
    const u = rand() * Math.PI * 2
    const v = rand() * Math.PI * 2
    const r = minor * (0.92 + rand() * 0.08)
    out[i * 3] = (major + r * Math.cos(v)) * Math.cos(u)
    out[i * 3 + 1] = (major + r * Math.cos(v)) * Math.sin(u)
    out[i * 3 + 2] = r * Math.sin(v)
  }
}

export function buildLoopShapes(count: number, seed = 7): LoopShapes {
  const rand = mulberry32(seed)
  const positions = Array.from({ length: LOOP_SHAPE_COUNT }, () => new Float32Array(count * 3))
  const failure = new Float32Array(count)
  cloud(positions[0]!, count, rand, failure)
  branch(positions[1]!, count, rand)
  ring(positions[2]!, count, rand)
  const seeds = new Float32Array(count)
  for (let i = 0; i < count; i++) seeds[i] = rand()
  return { count, positions, seeds, failure }
}
