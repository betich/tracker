/**
 * The shared-deployment path: creating trackers, keeping them apart, and making
 * sure one tracker's key can never drive another's.
 *
 *   pnpm build && npx wrangler dev --env hosted --port 8789
 *   ADMIN_KEY=<dev key> BASE=http://localhost:8789 node test/hosted.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:8789";
const OWN_KEY = process.env.ADMIN_KEY;
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok?"ok  ":"FAIL"}  ${n}${d?`  — ${d}`:""}`); };

/*
 * A bucket of our own for the creation rate limit. Cloudflare overwrites this
 * header at the edge, so it changes nothing in production — it only stops
 * repeated local runs from exhausting one shared allowance.
 */
const RUN_IP = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;

const make = (body) => fetch(`${BASE}/api/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": RUN_IP },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const wsBase = BASE.replace(/^http/, "ws");
function open(query) {
  const ws = new WebSocket(`${wsBase}/ws?${query}`);
  ws.inbox = [];
  ws.addEventListener("message", (e) => ws.inbox.push(JSON.parse(e.data)));
  return new Promise((r) => { ws.addEventListener("open", () => r(ws)); setTimeout(() => r(ws), 2500); });
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);

// --- creation --------------------------------------------------------------
const alice = await make({ subject: "alice", phone: "+66000000001", lineId: "0000000001" });
check("a tracker can be created", alice.status === 200 && /^[0-9a-z]{6}$/.test(alice.body.slug),
  JSON.stringify(alice.body.slug));
check("an admin key comes back once", /^[0-9a-f]{32}$/.test(alice.body.adminKey ?? ""));

const nameless = await make({ subject: "   " });
check("a nameless tracker is refused", "error" in nameless.body);

const bob = await make({ subject: "bob", phone: null, lineId: null });
check("a second tracker gets a different slug", bob.body.slug !== alice.body.slug);

// --- public config ---------------------------------------------------------
const config = await fetch(`${BASE}/api/tracker?slug=${alice.body.slug}`).then((r) => r.json());
check("its public config is readable", config.subject === "alice" && config.phone === "+66000000001");
check("the config never carries the key", !JSON.stringify(config).includes(alice.body.adminKey));
check("an unknown slug 404s", (await fetch(`${BASE}/api/tracker?slug=zzzzzz`)).status === 404);

// --- pages -----------------------------------------------------------------
check("a hosted viewer page is served", (await fetch(`${BASE}/t/${alice.body.slug}`)).status === 200);
check("a hosted admin page is served", (await fetch(`${BASE}/t/${alice.body.slug}/admin`)).status === 200);
check("the create page is served", (await fetch(`${BASE}/new`)).status === 200);

// --- isolation and auth ----------------------------------------------------
const aliceAdmin = await open(`role=admin&key=${alice.body.adminKey}&tracker=${alice.body.slug}`);
await settle();
check("a hosted key opens its own tracker", last(aliceAdmin, "hello")?.role === "admin");

const crossed = await open(`role=admin&key=${alice.body.adminKey}&tracker=${bob.body.slug}`);
await settle();
check("one tracker's key cannot drive another", last(crossed, "denied")?.reason === "auth",
  JSON.stringify(crossed.inbox));

const instanceKeyOnHosted = await open(`role=admin&key=${OWN_KEY}&tracker=${alice.body.slug}`);
await settle();
check("the instance key cannot drive a hosted tracker",
  last(instanceKeyOnHosted, "denied")?.reason === "auth");

const hostedKeyOnOwn = await open(`role=admin&key=${alice.body.adminKey}`);
await settle();
check("a hosted key cannot drive the instance's own tracker",
  last(hostedKeyOnOwn, "denied")?.reason === "auth");

const ownAdmin = await open(`role=admin&key=${OWN_KEY}`);
await settle();
check("the instance's own tracker still works", last(ownAdmin, "hello")?.role === "admin");

// --- separate state --------------------------------------------------------
const aliceViewer = await open(`role=viewer&tracker=${alice.body.slug}`);
const bobViewer = await open(`role=viewer&tracker=${bob.body.slug}`);
await settle();
aliceAdmin.send(JSON.stringify({ t: "fix", fix: { lat: 13.1, lon: 100.1, acc: 5, spd: null, hdg: null } }));
aliceAdmin.send(JSON.stringify({ t: "post", text: "alice is moving", photo: null }));
await settle();
check("alice's viewers see alice", last(aliceViewer, "state")?.fix?.lat === 13.1);
check("bob's viewers see nothing of alice",
  last(bobViewer, "state")?.fix === null && bobViewer.inbox.every((m) => m.t !== "update"),
  JSON.stringify(last(bobViewer, "state")));

// --- per-tracker colour ----------------------------------------------------
const tinted = await make({ subject: "tinted", color: "#22c55e" });
const tintedConfig = await fetch(`${BASE}/api/tracker?slug=${tinted.body.slug}`).then((r) => r.json());
check("a chosen colour comes back with the config", tintedConfig.color === "#22c55e",
  JSON.stringify(tintedConfig.color));

check("a tracker created without one has no colour", (await fetch(
  `${BASE}/api/tracker?slug=${alice.body.slug}`).then((r) => r.json())).color === null);

/*
 * The colour is the one field that reaches a stylesheet, so anything that is
 * not a literal hex has to be dropped rather than stored and served back.
 */
for (const [name, value] of [
  ["a CSS payload", "red;}body{display:none}"],
  ["a url()", "url(https://example.com/x)"],
  ["a bare name", "rebeccapurple"],
  ["a short hex", "#fff"],
  ["a non-string", 12345],
]) {
  const bad = await make({ subject: "bad colour", color: value });
  const stored = await fetch(`${BASE}/api/tracker?slug=${bad.body.slug}`).then((r) => r.json());
  check(`${name} is refused as a colour`, stored.color === null, JSON.stringify(stored.color));
}

// --- superadmin index ------------------------------------------------------
const SUPER_KEY = process.env.SUPERADMIN_KEY;
const index = (key) => fetch(`${BASE}/api/trackers${key === undefined ? "" : `?key=${key}`}`);

check("the index refuses a missing key", (await index()).status === 401);
check("the index refuses a wrong key", (await index("nope")).status === 401);
check("a tracker's own key cannot enumerate the rest",
  (await index(alice.body.adminKey)).status === 401);

if (SUPER_KEY) {
  const listed = await index(SUPER_KEY);
  check("the index is readable with the superadmin key", listed.status === 200);
  const rows = await listed.json();
  const alicesRow = rows.find((r) => r.slug === alice.body.slug);
  check("it lists a tracker that was created", Boolean(alicesRow));
  check("it carries no key or hash", !JSON.stringify(rows).includes(alice.body.adminKey)
    && !JSON.stringify(rows).includes("key_hash"));
  check("it reduces contacts to whether they exist",
    alicesRow?.hasPhone === true && alicesRow?.phone === undefined,
    JSON.stringify(alicesRow));
  check("it carries each tracker's colour",
    rows.find((r) => r.slug === tinted.body.slug)?.color === "#22c55e");
} else {
  console.log("skip  superadmin index — set SUPERADMIN_KEY to cover it");
}

for (const s of [aliceAdmin, crossed, instanceKeyOnHosted, hostedKeyOnOwn, ownAdmin, aliceViewer, bobViewer]) s.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
