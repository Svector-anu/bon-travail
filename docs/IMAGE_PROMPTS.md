# Scene images

The UI ships with low-resolution stand-ins cropped from the reference board.
Generate the real ones (GPT Image 2 via Hailuo worked best on the board) and
drop them in `public/scenes/` with the exact file names below. No code changes
are needed; the pages pick them up on reload.

All images: photorealistic, cinematic soft light, large negative space, no
text, no logos, no people, no watermarks. Export JPEG at ~85% quality.

| File | Size | Used on |
|---|---|---|
| `hero-field.jpg` | 2400 x 1500 (landscape, subject in right half) | Home hero, full bleed |
| `task-stage.jpg` | 2400 x 800 (wide band) | Task detail, scene under the Claim button |
| `monolith-tall.jpg` | 900 x 1700 (portrait) | Submit screen, Agent page |
| `monolith-refund.jpg` | 900 x 1100 | Refund receipt, behind the amount |
| `glass-ring.jpg` | 800 x 600 | Paid receipt proof object |

## hero-field.jpg

The current file is a close-up cropped from the reference board, so no crop can
produce the reference composition. Regenerate it as a wide scene:

- 16:9, at least 2400 x 1350, cinematic landscape photograph
- camera pulled far back, low-ish horizon, environmental depth
- an old beige Macintosh-style computer, small and distant, standing in the grass
- computer around right-center (about 62-70% across, horizon on the lower third),
  roughly 20-30% of the image height
- at least the top half is open blue sky with soft warm clouds, brightest upper right
- grassy field with small wildflowers running across the full width of the foreground
- warm low sunlight from the right, soft rim light on the computer
- left 40% calm (sky and grass only) so the headline can sit there
- no close-up, no UI, no text, no logos, no people

> Wide cinematic 16:9 landscape photograph at golden hour. A vast grassy meadow
> with small white and lilac wildflowers stretches across the whole foreground.
> Far away, slightly right of center, a lone beige 1980s all-in-one personal
> computer stands in the grass, small in the frame. Above, a huge open blue sky
> with soft warm clouds fills more than half the image, brightest toward the
> upper right where low sunlight rims the computer. The left side is calm, open
> sky and grass. Camera pulled far back, shallow depth of field on the
> foreground grass, 35mm film look, quiet and surreal. No text, no people.

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
