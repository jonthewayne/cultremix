# Judges

Hackathon judges get an account made for them, with a password, so they can sign in without waiting for an email code (KTD-15).

## What a judge gets

- An email and password sign-in. Nobody else can sign up with a password: the sign-up endpoint is turned off, so only accounts made here have one.
- A username of our choosing (for example `monad_judge_1`), so they skip the username step.
- Creator access with a creator number (№ 2, № 3, … in the order they're made; № 1 is the owner).
- 40 credits, enough for 20 batches of four designs.

Everyone else keeps signing in with an email code, exactly as before.

## How a judge signs in

1. Open `/login` on the site they're judging: staging (the link in the [submission](hackathon/submission.md#links)) or [cultremix.com/login](https://cultremix.com/login).
2. Tap **Have a password? Sign in with it**.
3. Enter the email and password we sent. The studio opens.

If the password is wrong, the page says “That email and password don’t match.” After too many tries in a row it asks them to wait a minute.

## What a judge can try

The full list, with how to check each claim, is under **Judging evidence** in the [submission](hackathon/submission.md#judging-evidence).

1. **Make designs.** In the studio, add a few images, mix their styles, say what you want, and press Generate: four designs for 2 credits. Heart the good ones and open any of them full screen.
2. **Publish one.** It gets a CR number and a work page, and a photo of someone wearing it arrives a moment later. Each member gets a few photo shoots a day (judges included); past that, the work still publishes and its photo can be taken the next day from the work page.
3. **Remix someone's work.** On any work page, **Remix this**. The design's words appear as fields (the ones its creator made remixable): change one and Generate, and the four designs keep the art while the words change. The batch says what changed. When publishing, choose a variation (the next number in the family) or a fork (a new family).
4. **Follow the lineage and the money.** On a remix's page: the **Lineage** trail, **Remixes of this**, the family tree (**See the whole tree** opens `/family/<n>`), and the Economics panel with the rules file `/economics/v1.json` and its SHA-256.
5. **Prepare a print file.** On your own work's page, **Prepare for print** opens the Print Studio: trim, knock out the background, place it on the shirt, and make the print file.
6. **Be social.** Hearts and follows on any work, profiles at `/u/<username>` with follower and following lists, and the **Trending** and **Following** tabs on the home page. Judges can follow each other: the bell in the header shows new follows, hearts, and remixes.
7. **Check the provenance.** `/onchain` explains what CultRemix records on Monad and how to check a design yourself, starting from the fingerprint on its page.

Buying isn't open yet; "Buying opens soon" takes an email. The Monad registry deploys to testnet once its relayer has testnet MON; until then work pages show each design's fingerprint, Backs stay hidden, and `/onchain` says "Not deployed yet". On staging, every CR number carries a **Testnet** badge.

## Making judge accounts

### From the admin page (owner only)

1. Sign in as the owner and open **Admin → Judges**.
2. Enter the judge's email and a username, then **Make judge account**.
3. The password shows once, under **Just made**. Copy it and send it privately. It isn't stored anywhere we can show it again.

### From the command line (several at once)

Put one judge per line in `judges.txt` (gitignored):

```text
# Monad judges
judge1@example.com monad_judge_1
judge2@example.com monad_judge_2
```

Then run it against the right deployment:

```bash
bun run judges:provision -- --dry-run --file judges.txt          # check the list
CONVEX_DEPLOY_KEY=<staging key> bun run judges:provision -- --file judges.txt   # staging
bun run judges:provision -- --prod --file judges.txt             # production (asks first)
```

New passwords go to `.judges.local.json` (gitignored, readable only by you), never the terminal. Send each judge theirs privately, then delete the file.

Running it again is safe. A judge who already exists keeps their password, credits, and creator number; only new judges get a password.

## Resetting a password

- Admin page: tick **Give an existing judge a new password** before making the account.
- Command line: add `--reset`.

Either way the old password stops working at once and the new one shows (or is saved) once.

## Things to know

- An email that already belongs to a member who signs in with codes is refused. Use a different email for the judge.
- Passwords are at least 12 characters. Generated ones are longer and random.
- Judge accounts are marked in `creatorAccess` with the note `judge`, so they're easy to find (and to switch off) after judging: **Admin → Members**, search the username, **Turn off creator access**.
- Give extra credits from **Admin → Members → Give credits** if a judge runs out.
