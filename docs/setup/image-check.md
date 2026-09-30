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

## Billed prices, 2026-09-30

The balance-based costs above overstate today's calls. The gateway keeps a billing record for each generation (`GET https://ai-gateway.vercel.sh/v1/generation?id=<gen_…>` with the gateway key; `total_cost` in dollars). These are billed amounts at `quality: "medium"`, which the app sends for designs and model photos:

| Call | Size | Output tokens | Billed |
|---|---|---|---|
| Design from text (Flare) | 1024×1536 | 343 | $0.0107 |
| Design from an image (Sunburst) | 1024×1536 | 343, plus about 1,630 input | $0.0231 |
| Four-up grid from text (Flare) | 1920×1920 | 819 | $0.0252 |
| Four-up grid from an image (Sunburst) | 1920×1920 | 819, plus about 1,690 input | $0.0376 |

Today's batch of four single designs is $0.043 from text and $0.092 from an image; four calls at once took 13 s and 33 s. One grid took 25 s and 38 s. Output tokens cost $30 per million, and an input image adds about $0.013 each time the model reads it. With quality left unset the model chose `high` for four of five grids: 3,276 output tokens, $0.099 from text and $0.111 from an image.
