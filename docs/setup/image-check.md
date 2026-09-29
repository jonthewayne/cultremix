# Image check (O2), 2026-09-29

Every call works through the Vercel AI Gateway with AI SDK 7 `generateImage` (`ai@7.0.122`, `@ai-sdk/gateway@4.0.100`), `maxRetries: 0`, a 240 s timeout. Run from `~/cultremix-imagecheck/check.ts` on mighteous at 3:08 p.m.; images in `~/cultremix-imagecheck/out/`.

| Call | Model | Input | Size | Background | Time | Result |
|---|---|---|---|---|---|---|
| Design from an inspiration image | `openai/gpt-image-2.5-sunburst` | image + wrapped instruction | 1024×1536 | transparent | 38.8 s | real alpha: 51.7% of pixels fully transparent, corners clear |
| Design from text | `openai/gpt-image-2.5-flare` | wrapped instruction | 1024×1536 | transparent | 17.5 s | real alpha: 40.9% fully transparent, corners clear |
| Model photo | `openai/gpt-image-2.5-sunburst` | the design + photo prompt | 1024×1024 | opaque | 20.0 s | opaque PNG |
| Inspiration photos (demo kit) | `openai/gpt-image-2.5-flare` | text | 1536×1024 | opaque | 9–16 s | opaque PNGs |

Options: designs use `providerOptions: { openai: { background: "transparent", output_format: "png" } }`; photos use `{ output_format: "png" }`. Quality was left at the default, which the gateway reported as `medium`.

Costs: ten images (these nine plus the production self-test) cost $0.14 of gateway credit ($22.16 → $22.02). The gateway's generation info reported $0.005 for a 1536×1024 opaque Flare photo; the model photo, run alone, used about $0.019; transparent designs averaged about $0.03. A batch of four tiles is roughly $0.12.

From production Convex at 3:11, `bunx convex run --prod imageGen:selfTest '{"mode":"text"}'` generated a transparent 1024×1536 Flare design through the gateway and stored it with `IMAGE_STORE=convex` (served from `/img/`).
