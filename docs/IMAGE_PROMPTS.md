# Scene images

The UI ships with low-resolution stand-ins cropped from the reference board.
Generate the real ones (GPT Image 2 via Hailuo worked best on the board) and
drop them in `public/scenes/` with the exact file names below. No code changes
are needed; the pages pick them up on reload.

All images: photorealistic, cinematic soft light, large negative space, no
text, no logos, no people, no watermarks. Export JPEG at ~85% quality.

| File | Size | Used on |
|---|---|---|
| `task-stage.jpg` | 2400 x 800 (wide band) | Task detail, scene under the Claim button |
| `monolith-tall.jpg` | 900 x 1700 (portrait) | Submit screen, Agent page |
| `monolith-refund.jpg` | 900 x 1100 | Refund receipt, behind the amount |
| `glass-ring.jpg` | 800 x 600 | Paid receipt proof object |

## Home hero: proofwork-meadow.mp4

The landing hero is a video now: `public/scenes/proofwork-meadow.mp4` (1920x1080,
desktop) and `proofwork-meadow-sm.mp4` (1280x720, phones), both cut from the
supplied 8 s clip as a forward-then-reverse 16 s ping-pong so the loop has no
jump, H.264 with faststart and no audio. `proofwork-meadow.jpg` is its first
frame, used as the poster and as the fallback when video cannot play.

## task-stage.jpg

> Wide cinematic landscape: a single tall weathered concrete pillar standing
> in tall grass at the far right of the frame, sun low on the horizon, wide
> dusk sky in deep blue fading to warm peach at the horizon, soft clouds, a
> distant bird, wildflower silhouettes in the foreground, the left two thirds
> almost empty sky.

## monolith-tall.jpg

> Vertical composition of the same weathered concrete pillar in a meadow at
> dusk, pillar centered in the lower half, blurred warm wildflowers in the
> foreground, deep blue sky above with a few glowing clouds, quiet and
> monumental.

## monolith-refund.jpg

> Close view of a weathered concrete pillar at sunset, warm rim light on one
> edge, deep slate sky, the lower third fading into darkness so white text can
> sit on it.

## glass-ring.jpg

> A single translucent sea-green glass torus floating at a slight angle,
> soft studio light with gentle caustics, centered on a near-black charcoal
> background (#0c111c), minimal, premium 3D product render.
