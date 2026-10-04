import { describe, expect, it } from 'vitest'
import { buildLoopShapes, LOOP_SHAPE_COUNT } from '@/components/loop-shapes'

describe('home page point cloud', () => {
  it('gives every form the same points, all finite and in frame', () => {
    // #given a cloud the size the mobile scene draws
    const shapes = buildLoopShapes(5200)

    // #then each step has one position per point, and none escape the camera's view
    expect(shapes.positions).toHaveLength(LOOP_SHAPE_COUNT)
    for (const form of shapes.positions) {
      expect(form).toHaveLength(5200 * 3)
      for (const value of form) {
        expect(Number.isFinite(value)).toBe(true)
        expect(Math.abs(value)).toBeLessThan(1.7)
      }
    }
  })

  it('draws the same cloud on every visit', () => {
    // #given two builds with the default seed
    const a = buildLoopShapes(300)
    const b = buildLoopShapes(300)

    // #then they match point for point
    expect(Array.from(a.positions[1]!)).toEqual(Array.from(b.positions[1]!))
    expect(Array.from(a.seeds)).toEqual(Array.from(b.seeds))
  })

  it('marks a small knot of points as the recurring failure', () => {
    // #given a cloud of a thousand points
    const { failure, count } = buildLoopShapes(1000)

    // #when counting the points flagged as failing
    const share = failure.reduce((sum, f) => sum + f, 0) / count

    // #then they are a visible few, not the cloud
    expect(share > 0 && share < 0.1).toBe(true)
  })
})
