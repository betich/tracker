# tracker

A live "where are you" tracker for one person and everyone waiting on them.
One device broadcasts its position; everyone else gets a compass pointing at it,
a distance in metres, a map, and a running feed of photo updates.

Built for a graduation day, where "I'm near the arch" means nothing to five
people in a crowd of two thousand.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/betich/tracker)

One Cloudflare Worker serves the pages, the API, and the state — no second
service, no database to provision. The deploy button clones this repo into your
own account, creates the Durable Object, asks you for an admin key, and hands
you a URL.

**Don't want to host it?** [track.betich.me/new](https://track.betich.me/new)
makes one in a few seconds.

---

## The client — `/`

Mobile-first, and designed to be readable at a glance while walking.

**Compass.** A rotating card holding true north with a needle on the subject,
plus an amber beacon on the rim in the direction to walk. It tells you how to
turn in words — *turn left a bit*, *turn hard right*, *turn around* — and the
whole cue goes green on *straight ahead* once you are within 8°. iOS needs one
tap to release the magnetometer; without a compass it falls back to course over
ground, then to north-up.

**Distance, absurdly large.** Metres up to a kilometre, then km. Readable at
arm's length while moving.

**The screen is the readout.** The indigo ground brightens on a logarithmic
curve as the gap closes — you can tell you are getting warmer without reading
anything.

**It refuses to lie about precision.** Two phones sitting on the same table
disagree by metres. Once the gap falls inside the combined accuracy of both
fixes, the headline switches to **HERE** and the raw number moves to the small
print as *reads 11 m*. The needle parks too, because a bearing between two
overlapping fixes is whatever the noise says.

**Map.** Both pins and the line between them, tiles tinted into the surface.

**Updates.** A horizontally snapping reel of full-screen cards — photo and text,
newest first — with a like on each. Likes are deduplicated per browser by a
throwaway id in local storage. No accounts; a new browser is a new person.

**Call and LINE buttons**, fixed bottom right, both copying their number —
off by default, since they publish a personal phone number to every visitor.
See *Configure*.

## The admin — `/admin?key=…`

The device being tracked. It holds a lock: **only one session can broadcast at a
time.**

**Claiming is connecting.** Opening the page takes nothing. Pressing *start
broadcasting* opens the socket, and that is what claims the tracker. A second
device is refused with a clear reason and offered a takeover, which disconnects
the incumbent and tells it why.

**Pin an exact spot.** GPS is often too vague to be useful — inside a building,
or picking one stall out of a market row. Pan a building-level map under a fixed
crosshair and save that point; it then overrides GPS until you tap *back to
GPS*. A pinned fix is broadcast with a null accuracy, which is what tells
viewers it was placed by hand rather than measured.

**It keeps talking when nothing changes.** A heartbeat re-sends the position
every few seconds so a stationary tracker never looks stale, and the session
flushes one last reading on stop, on backgrounding, and on page close — so
whoever is watching is never left holding a position from a minute ago.

**Post updates** with a photo, downscaled in the browser to fit a WebSocket
frame, EXIF rotation honoured. Only the lock holder can post.

**A live viewer count**, so you know who is still waiting.

---

## Two ways to run it

**One person, self-hosted** — the default. The instance tracks whoever
`tracker.config.ts` and `TRACKER_ID` say, served at `/` and `/admin`. That is
all the deploy button gives you, and it is all most people want.

**Many people, shared** — the `hosted` environment additionally exposes `/new`,
where anyone can mint their own tracker and get back a share link plus an admin
key. Each lives at `/t/<slug>`, in its own Durable Object, controlled by its own
key: one tracker's key cannot drive another, the instance's `ADMIN_KEY` cannot
drive a hosted one, and no hosted key can drive the instance's own. Hosted
trackers are swept a week after they were last opened, taking their photos with
them.

```sh
npx wrangler deploy              # one person
npx wrangler deploy --env hosted # plus /new and /t/<slug>
```

The multi-tenant routes simply do not exist unless `MULTI_TENANT` is set, so a
self-host has no creation endpoint and no registry.

---

## Deploy

Press the button above. You will be asked for `ADMIN_KEY` — the secret in the
admin URL's `?key=`. Generate one:

```sh
openssl rand -hex 20
```

Then open `https://<your-worker>/admin?key=<that key>` on the phone doing the
walking, and share the bare URL with everyone else.

To deploy from a clone instead:

```sh
pnpm install
npx wrangler secret put ADMIN_KEY
pnpm deploy
```

## Configure

[`tracker.config.ts`](./tracker.config.ts) holds the subject's name, whether the
footer portrait appears, and where the map opens before any position is known.

**Contacts live in the environment, not in this file**, so a public repo never
carries somebody's phone number. Copy [`.env.example`](./.env.example) to `.env`
locally, or set the same variables in the Worker's build configuration:

```sh
PUBLIC_CONTACTS=1                  # off by any other value
PUBLIC_CONTACT_PHONE=+66…          # either may be blank to show just the other
PUBLIC_CONTACT_LINE=08…
```

`PUBLIC_CONTACTS` is a switch rather than an implication of the numbers being
set, so you can leave them configured and still turn the buttons off between
outings. It is read at build time: with the switch off, the numbers are not
compiled into the pages at all. A tracker created through `/new` is separate —
its contacts are whatever its creator typed in, since supplying them is the
opt-in.

Two things live in [`wrangler.jsonc`](./wrangler.jsonc) because the server needs
them: `TRACKER_ID`, which picks the Durable Object — changing it starts a clean
timeline — and `ALLOWED_ORIGINS`, only needed if you host the frontend somewhere
other than the Worker. Same-origin is always allowed, so a normal deployment
never has to be told its own URL.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars     # put any key in it
pnpm dev                           # pages on :4321
pnpm dev:worker                    # API on :8787
```

In development the two run apart and the frontend points at `:8787`; in
production the Worker serves both, so the client talks to relative URLs.

To exercise the built app as it actually ships:

```sh
pnpm build && npx wrangler dev --port 8788
ADMIN_KEY=<your dev key> node test/api.mjs
```

`test/api.mjs` covers the admin lock and takeover, viewers being read-only,
photo storage and caching, like deduplication, and the final-position flush. It
runs against a throwaway tracker — minting a real one when pointed at a shared
deployment — so it never touches a live timeline.

`test/hosted.mjs` covers the shared deployment: creation, per-tracker config,
state isolation, and every direction of the key-crossing checks above. Point it
at a worker running `--env hosted`.

## How it works

A Durable Object per tracked subject holds the last fix and the timeline, and
allows at most one admin socket. Everyone else connects as a read-only viewer
and is pushed state on every change. Liking is the single exception — the one
write a viewer may make.

Photos are stored as data URLs in the object's SQLite and served from a
cacheable `/photo` route rather than pushed down the socket, so a viewer joining
mid-journey does not replay megabytes of history.

On a shared deployment a second Durable Object holds the registry — one row per
hosted tracker, storing only a hash of its admin key. Every `/t/<slug>` is the
same built page; the slug comes out of the URL at runtime and the tracker's name
and contacts are fetched from the registry, which is what lets a static build
serve an unbounded number of trackers.

## Licence

MIT.
