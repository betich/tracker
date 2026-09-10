# tracker

A live "where are you" tracker for one person and everyone waiting on them.
One device broadcasts its position; everyone else gets a compass pointing at it,
a distance in metres, a map, and a running feed of photo updates.



[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/betich/tracker)



Set your admin keys are you are good to go.  (Either set a password yourself or use `openssl rand -hex 20` -&gt; recommended)



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

**Many people, shared** — the `hosted` environment additionally serves
`/t/<slug>`: a tracker per slug, each in its own Durable Object and controlled
by its own key. One tracker's key cannot drive another, the instance's
`ADMIN_KEY` cannot drive a hosted one, and no hosted key can drive the
instance's own. Hosted trackers are swept a week after they were last opened,
taking their photos with them.

```sh
npx wrangler deploy              # one person
npx wrangler deploy --env hosted # plus /t/<slug>
```

The multi-tenant routes simply do not exist unless `MULTI_TENANT` is set, so a
self-host has no registry at all.

**Letting strangers make their own** is a second switch, deliberately not the
same one: `ALLOW_NEW_TRACKERS` in [`wrangler.jsonc`](./wrangler.jsonc), off
unless it is `"1"`. It opens `/new`, where anyone can mint a tracker and get
back a share link plus an admin key. With it off — which is how a deployment
starts, and stays unless someone types the `1` — both the page and the
`/api/create` behind it return 404, so a shared deployment can go on serving the
trackers it already has without standing open to whoever finds the URL. The
`hosted` environment here carries it on, because that environment is the
instance at [track.betich.me](https://track.betich.me), which does take
newcomers; a fork that wants the slugs but not the door sets it back to `"0"`.
That instance also keeps a private index of what it has minted, gated on a
secret of its own — nothing a deploy of this repo grows on its own.

Whoever mints a tracker also picks its colour, and the whole thing is built from
that one value — see [Colour](#colour).

---

## Deploy

Press the button above. You will be asked for `ADMIN_KEY` — the secret in the
admin URL's `?key=`, and the only one a deployment needs. Generate one:

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

### Colour

The whole UI is built from a single colour. Every shade — the ground the
proximity screen burns into, the halo behind the dial, the page background, the
ink on light buttons — is derived from it by holding its hue and sweeping
lightness, so changing one value re-hues everything and nothing drifts out of
step.

`primaryColor` in [`tracker.config.ts`](./tracker.config.ts) sets it for the
deployment. A tracker created through `/new` picks its own instead, from the
swatches or the colour picker there, and wears it on `/t/<slug>` — the form is
its own preview, so the page turns as you choose. Only a literal `#rrggbb` is
accepted, on the way in and again on the way out: that string ends up in a
stylesheet, so nothing else is ever allowed to travel.

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
state isolation, and every direction of the key-crossing checks above. It also
checks that a colour which is not a literal hex never reaches a stylesheet.
Point it at a worker running `--env hosted`, which is the environment that has
`ALLOW_NEW_TRACKERS` on — with creation closed, the checks that mint a tracker
have nothing to talk to.

## Moving a timeline

`POST /api/import` restores updates recorded elsewhere — moving between
deployments, or putting back a backup — keeping their ids, timestamps and like
counts, so history comes back as it was rather than as a pile of things posted
just now. It takes the same admin key as posting and is scoped to the tracker
that key controls.

```jsonc
POST /api/import?key=…            // add &tracker=<slug> for a hosted one
{
  "fix": { "lat": 13.7, "lon": 100.5, "acc": null, "spd": null, "hdg": null, "ts": 0 },
  "updates": [
    { "id": "…", "text": "…", "photo": "data:image/jpeg;base64,…", "ts": 0, "likes": 3 }
  ]
}
```

Ids already present are skipped, so re-running is harmless — send it in batches
rather than putting every photo in one request. Likes arrive as a number rather
than as the people who gave them, so they are recreated as placeholder rows:
the tally is preserved, but the original likers cannot take theirs back.

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