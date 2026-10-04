# CultRemix

**Remix culture, get paid.**

CultRemix is a studio and shop for remixable t-shirt art. Add a few images, mix their styles, say what you want, and Generate makes four print-ready designs at once. Publish one and it gets a permanent CR number, like **CR 101-001**, a photo of someone wearing it, and a shop page. Anyone can remix a published design; the remix joins its family as the next number, **CR 101-002**, so every shirt carries its lineage, and the people upstream share in what it earns.

Built for the Monad hackathon (Social, Attention & Culture track). Live at [cultremix.com](https://cultremix.com).

## How it fits together

| Piece | What it does |
| --- | --- |
| **TanStack Start on Cloudflare Workers** | The site: feed, studio, shop pages (`/cr/<number>`), sign-in, settings, and `/admin`. Routes live in `src/routes/`. |
| **Convex** | The database and every server function: studio batches, publishing, the feed, credits, flags, metrics (`convex/`). Tables are in `convex/schema.ts` and `convex/schema/`. |
| **Better Auth** (on Convex) | Email code sign-in for everyone; email and password only for accounts an admin made (judges). Public password sign-up is refused. |
| **CultRemix Gateway** | Image generation (GPT Image 2.5) and the notes we read from style images. Prompts and style notes stay on the server and never reach the browser. |
| **Cloudflare R2** | One public bucket per environment. Each image lives in its own folder with a thumbnail and a medium copy; anything not published sits under an unguessable 128-bit code. |
| **Monad** | Provenance for published designs: each work's fingerprint (SHA-256) and remix lineage, recorded on chain. See below. |

More detail: [Architecture](docs/architecture.md), [Image generation](docs/image-generation/README.md), [Onchain provenance ADR](docs/adr/0001-onchain-provenance.md).

## Running it

You need [Bun](https://bun.sh) and a Convex account.

```bash
bun install
bun run setup        # asks which Convex team to use; writes env files
bun run dev          # Convex + the site on http://localhost:3000
```

Then set up the new deployment once:

```bash
bun run seed:environment      # app settings, every switch at its default, CR counters
```

Sign in with the `FIRST_SUPER_ADMIN_EMAIL` address and claim the owner account in Settings. You're Creator № 1, and `/admin` is yours.

Without image keys, dev uses a stand-in generator so the whole flow still works. Real images need `AI_GATEWAY_API_KEY` and the R2 values in [Environment variables](docs/environment-variables.md).

### Everyday commands

```bash
bun run typecheck    # TypeScript (and Convex, when a deployment is configured)
bun run test         # unit tests and Convex tests on an in-memory backend
bun run build        # production build
bun run test:e2e     # browser smoke test
```

### Launch scripts

```bash
bun run seed:environment                        # set up a fresh environment (safe to rerun)
bun run judges:provision -- --file judges.txt   # make judge accounts with passwords
```

Both target your dev deployment by default, staging when `CONVEX_DEPLOY_KEY` is set for the command, and production with `--prod` (they ask first). Neither ever copies data between environments. See [Judges](docs/judges.md) and the [Launch checklist](docs/launch-checklist.md).

## Admin

`/admin` is for the owner and staff:

- **Overview**: switches for each part of the product (studio, publishing, checkout, chain writes, backs, upscale) and app settings (signup credits, the daily image budget, photo shoots per member).
- **Members**: search by username, email, or creator number; give credits; turn creator access on or off.
- **Metrics**: counts by day and in total (members, members who generated, batches, designs, published works, remixes, families, credits used, model photos).
- **Judges**: make a judge account with a password (owner only).

Support staff can look but not change anything.

## What the registry proves

When a design is published, CultRemix records its fingerprint and its place in a remix family on Monad. In plain words, that record proves this:

> A CultRemix-run service submitted a record, signed by the key of a CultRemix-held wallet assigned to that account, at that time, with that lineage and that fingerprint.

What it does **not** prove: because CultRemix holds the wallet keys for members, the record doesn't independently prove that a person agreed to it, and the limit on Backs is per account, not per human. It does prove the design existed with that exact content at that time, and which design it was remixed from, in a public record no one can quietly rewrite.

Only finalized blocks count. Staging uses Monad testnet (and shows a **Testnet** badge on CR numbers); production uses Monad mainnet. The full reasoning is in [ADR 0001](docs/adr/0001-onchain-provenance.md).

> The registry contract and the chain writer aren't in this repository yet; the `chain.writes` switch stays off until they land.

## More docs

- [Judges](docs/judges.md)
- [Launch checklist](docs/launch-checklist.md)
- [Hackathon submission](docs/hackathon/submission.md) and [build log](docs/hackathon/log.md)
- [Launch metrics](docs/launch/metrics.md) and [cohort notes](docs/launch/cohort.md)
- [Environment variables](docs/environment-variables.md)
- [Auth](docs/auth.md) and [Authorization](docs/authorization.md)
- [Cloudflare deployment](docs/deployment-cloudflare.md)
- [Testing](docs/testing.md)
- [Setup](docs/setup.md) and [Starter improvements](docs/starter-improvements.md)
