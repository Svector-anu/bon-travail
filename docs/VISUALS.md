# Visual world

One continuous place: a meadow at golden hour, a cracked stone monolith at
sunset, and one crystalline ring. Every image has a job; none carries text,
so typography, links and motion stay in HTML.

| File | Source | Used on | Why |
|---|---|---|---|
| `proofwork-meadow.mp4`, `-sm.mp4`, `.jpg` | supplied 8 s clip, ping-pong 16 s loop; first frame as poster | Home hero | The world the product lives in |
| `task-stage.jpg` | monolith at sunset, 2172 x 724 | Work package page, under the claim | The work waits in the same landscape |
| `monolith-close.jpg` | crop of the same scene, 560 x 724 | Agent page, home chapter "aeon investigates", submit screen | Aeon looks closely at one thing |
| `glass-ring.jpg` | supplied render, 900 x 826 | Paid receipts, home chapter "proofwork pays" | The proof object of a payout |
| `monolith-refund.jpg` | supplied render, 900 x 756 | Refunded receipts | The same stone, money returned |
| `footer-macintosh.mp4`, `.jpg` | supplied 8 s clip, 1280 x 720, audio stripped, faststart; poster is the "bon travail" screen at 6.9 s | Footer on every page | The final scene: the Macintosh boots into a paid fix |

The footer video plays at its own 16:9 with nothing laid over it; phones get a
4:5 crop of the centre that keeps the whole Macintosh. It loads nothing until
the footer is near and plays only while on screen. Images below the fold load
lazily; both videos keep their poster frame for reduced motion.

## Type and motion

- Large statements use Geist at 200–300 weight. Body text stays Helvetica Neue.
- Brand and navigation are lowercase (`bon travail`, `work`, `receipts`,
  `agent`, `docs`); system labels stay uppercase (`AGENTS PAY HUMANS`,
  `VERIFIED`, `SETTLED`).
- Buttons roll their label on hover with a critically damped spring
  (stiffness 100, damping 20) encoded as a CSS `linear()` easing.
- Scrolling is Lenis (`lerp 0.075`) for wheel and trackpad only; touch and
  keyboard stay native, and it is off under `prefers-reduced-motion`.
- Sections fade in once as they enter view; the footer landscape settles and
  its words arrive as it scrolls in. Motion marks state (verifying, paid,
  sealed), never decoration.
