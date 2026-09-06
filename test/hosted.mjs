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

const make = (body) => fetch(`${BASE}/api/create`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
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

for (const s of [aliceAdmin, crossed, instanceKeyOnHosted, hostedKeyOnOwn, ownAdmin, aliceViewer, bobViewer]) s.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
