# CultRemix submission

**Monad hackathon, Social, Attention & Culture track.** Due 2026-10-13, 20:59 PDT.

## Links

Jon fills these in.

- Live (staging, Monad testnet): (link)
- Production: https://cultremix.com
- Code: (public GitHub link, shared with metropolis@hackathon.monad.xyz)
- Demo video (3 minutes or less): (link)
- Pitch video (2 minutes or less): (link)
- Logo: (file, JPG/PNG/WEBP, 3 MB or less)
- Monad registry contract: (explorer link)
- Judge sign-in: each judge gets an email and password privately (see [Judges](../judges.md)). On the sign-in page, tap **Have a password? Sign in with it**.

## Pitch

**Remix culture, get paid.**

CultRemix is a studio and shop for remixable t-shirt art. Add a few images, mix their styles, say what you want, and get four print-ready designs at once. Publish one and it gets a permanent CR number, like CR 101-001, a photo of someone wearing it, and a shop page. Anyone can remix a published design; the remix joins its family as the next number, CR 101-002, so every shirt carries its lineage, and when it sells, the creators upstream share in it.

## Why this track

- **Social:** remixing is the conversation. Every design invites the next one, and families grow in public.
- **Attention:** a CR number is a name people can say, share, and collect. The feed puts new work and its remixes side by side.
- **Culture:** the lineage is the point. Monad holds each work's fingerprint and family tree, so credit follows the design wherever it goes.

## What works today

From the [build log](log.md):

- **Sign-in:** email code sign-in, a username step, and starting credits. Sign-ins last 400 days.
- **Studio:** up to 8 numbered images (“draw image 1 in the style of image 2”) and a style mixer with up to 4 styles, each with a slider for its share. What we read from each image stays on the server.
- **Generate:** one press makes four designs at once, transparent and print-ready, for 2 credits a batch. Credits come back for any design that doesn't arrive, and a filtered request says so plainly.
- **Sessions:** each run of batches is a session you can name, reopen, and keep working in. Every design has a menu to view it large, download it, use it as an image or a style, or publish it. Works on phones, including saving to Photos.
- **Publish:** an optional title, then a full-screen CR number reveal. A photo of someone wearing the design arrives a moment later, with a different person, pose, and place each time.
- **Feed and shop pages:** newest first, the design beside its photo; each shop page has sizes, $36 (checkout opening soon), the design's SHA-256 fingerprint, and its remix family.
- **Remix:** “Remix this” opens the studio with the design as image 1; publishing makes the next number in its family (CR 101-002).
- **Storage:** every image lives in its own folder with a thumbnail and a medium copy, so pages load fast. Images carry no hidden metadata.
- **Live:** cultremix.com since 2026-09-30.

Built for launch:

- Judge accounts with a password, made by an admin (nobody else can sign up with a password).
- Admin: switches for each part of the product, app settings, member search with credit grants, and launch metrics by day.
- Labels: production shows **Early access** until checkout opens; staging shows a **Testnet** badge on every CR number.

Stack: TanStack Start on Cloudflare Workers, Convex with Better Auth, GPT Image 2.5 through the CultRemix Gateway, Cloudflare R2, Monad.

## What the registry proves

A CultRemix-run service submits each record, signed by the key of a CultRemix-held wallet assigned to the member's account, with the work's fingerprint and lineage. That proves the design existed with that exact content at that time and which design it came from, in a public record. Because CultRemix holds the keys, it doesn't independently prove that a person agreed to it, and the Back limit is per account. More in the [README](../../README.md#what-the-registry-proves).

## What's next

- Checkout and print on demand for every published design.
- Creator earnings paid out from the 15% creator pool.
- Backs: members back the works they love.
- Print-size art for every published design.
- Monad mainnet records in production.

## 90-second demo script

| Time | On screen | Say |
|---|---|---|
| 0:00–0:08 | The feed on a phone, scrolling past a family of remixes | “Every great shirt is a remix. CultRemix makes the remix the product, and pays the people it came from.” |
| 0:08–0:25 | Studio: add a portrait as image 1 and a 70s concert poster as image 2; open the Style mixer and set the poster to 70; type “Draw image 1 as a concert poster that says FAR OUT” | “Add a few images, mix their styles, and say what you want.” |
| 0:25–0:38 | Press Generate; cut to the four designs filling in together | “One press, four print-ready designs at once, transparent and ready for a shirt.” |
| 0:38–0:52 | Pick one, ⋯ → Publish, add a title; the full-screen CR reveal; the shop page as the model photo arrives | “Publish, and it gets a permanent number and a photo of someone wearing it.” |
| 0:52–1:05 | Signed in as a second member: Remix this, “make it neon at night”, Generate, publish; the next number in the family | “Anyone can remix it. The remix joins the family as the next number, so every shirt carries its lineage.” |
| 1:05–1:15 | The remix's shop page, the Economics panel | “Every sale sets aside 15% for creators. On a remix, half goes to the original's creator and half to the remixer, and anyone can check the math.” |
| 1:15–1:27 | The work's record on the Monad explorer, its fingerprint matching the shop page | “Each work's fingerprint and family tree are recorded on Monad, so anyone can see where a design came from.” |
| 1:27–1:30 | The feed with both works side by side | “Remix culture, get paid. This is CultRemix.” |

Recording notes:

- Generate takes 20–40 seconds. Record the press, then cut to the finished designs.
- Use images you have the rights to. Pick a portrait and a poster with strong, simple shapes.
- Record on staging, so the Testnet badge shows on the CR numbers and the Monad record is on testnet.
- The Economics panel and the Monad record need their builds merged and the **Monad records** switch on. If either isn't ready on recording day, show the shop page's fingerprint instead and say it's coming.

## Event requirements

Jon: paste the event's submission fields here, and check each one.

- [ ] Public GitHub repo, shared with metropolis@hackathon.monad.xyz
- [ ] Live staging link on Monad testnet, with judge sign-in instructions (checkout labeled as a test payment)
- [ ] Demo video, 3 minutes or less (YouTube, Loom, or Vimeo)
- [ ] Pitch video, 2 minutes or less
- [ ] Logo, JPG/JPEG/PNG/WEBP, 3 MB or less
