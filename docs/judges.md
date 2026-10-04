# Judges

Hackathon judges get an account made for them, with a password, so they can sign in without waiting for an email code (KTD-15).

## What a judge gets

- An email and password sign-in. Nobody else can sign up with a password: the sign-up endpoint is turned off, so only accounts made here have one.
- A username of our choosing (for example `monad_judge_1`), so they skip the username step.
- Creator access with a creator number (№ 2, № 3, … in the order they're made; № 1 is the owner).
- 40 credits, enough for 20 batches of four designs.

Everyone else keeps signing in with an email code, exactly as before.

## How a judge signs in

1. Open [cultremix.com/login](https://cultremix.com/login).
2. Tap **Have a password? Sign in with it**.
3. Enter the email and password we sent. The studio opens.

If the password is wrong, the page says “That email and password don’t match.” After too many tries in a row it asks them to wait a minute.

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
