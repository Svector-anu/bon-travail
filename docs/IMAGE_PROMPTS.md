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

> A beige 1980s all-in-one personal computer standing alone in a grassy meadow
> at golden hour, low camera angle from the grass, deep blue sky with a few
> soft clouds, warm sunlight rimming the right edge of the computer, small
> white and lilac wildflowers in the foreground slightly out of focus, shallow
> depth of field, 35mm film look, calm and surreal, plenty of empty sky above
> and to the left.

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
