/**
 * End-to-end checks against a running tracker.
 *
 *   pnpm build && npx wrangler dev --port 8788      # in one shell
 *   ADMIN_KEY=<your dev key> node test/api.mjs      # in another
 *
 * Everything runs against a throwaway `?tracker=` id, so it never touches the
 * timeline a real deployment is serving.
 */

const BASE = process.env.BASE ?? "http://localhost:8788";
const KEY = process.env.ADMIN_KEY;
const SCRATCH = `test-${Date.now().toString(36)}`;

if (!KEY) {
  console.error("Set ADMIN_KEY to the value in .dev.vars");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const wsBase = BASE.replace(/^http/, "ws");
function open(query) {
  const ws = new WebSocket(`${wsBase}/ws?${query}&tracker=${SCRATCH}`);
  ws.inbox = [];
  ws.addEventListener("message", (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.closed = new Promise((r) => ws.addEventListener("close", (e) => r(e.code)));
  return new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(ws));
    setTimeout(() => resolve(ws), 3000);
  });
}
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);
const all = (ws, t) => ws.inbox.filter((m) => m.t === t);

/** 1x1 red PNG. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------- serving ---
const page = await fetch(`${BASE}/`);
check("the app is served at /", page.status === 200 && (await page.text()).includes("<html"));
check("the admin page is served", (await fetch(`${BASE}/admin/`)).status === 200);
check("an unknown path 404s", (await fetch(`${BASE}/nope`)).status === 404);

const foreign = await fetch(`${BASE}/state`, { headers: { Origin: "https://evil.example" } });
check("a foreign origin is refused", foreign.status === 403);
const own = await fetch(`${BASE}/state`, { headers: { Origin: BASE } });
check("our own origin is allowed without configuring it", own.status === 200);

// ------------------------------------------------------------------- lock ---
const viewer = await open("role=viewer");
await settle();
check("a viewer gets state on connect", last(viewer, "state") !== undefined);

const badKey = await open("role=admin&key=wrong");
await settle();
check("a wrong key is refused", last(badKey, "denied")?.reason === "auth");

const admin = await open(`role=admin&key=${KEY}`);
await settle();
check("the key admits an admin", last(admin, "hello")?.role === "admin");
check("viewers see tracking go live", last(viewer, "state")?.tracking === true);

admin.send(JSON.stringify({ t: "fix", fix: { lat: 13.7402, lon: 100.5331, acc: 8, spd: null, hdg: null } }));
await settle();
check("a fix reaches viewers", last(viewer, "state")?.fix?.lat === 13.7402);

viewer.send(JSON.stringify({ t: "fix", fix: { lat: 0, lon: 0, acc: null, spd: null, hdg: null } }));
admin.send(JSON.stringify({ t: "fix", fix: { lat: 999, lon: 0, acc: null, spd: null, hdg: null } }));
await settle();
check("viewers cannot move the marker, and nonsense is rejected",
  last(viewer, "state")?.fix?.lat === 13.7402);

const second = await open(`role=admin&key=${KEY}`);
await settle();
check("a second admin is locked out", last(second, "denied")?.reason === "locked");

const taker = await open(`role=admin&key=${KEY}&takeover=1`);
await settle();
check("takeover is accepted", last(taker, "hello")?.role === "admin");
check("the displaced admin is told why", last(admin, "denied")?.reason === "superseded");
check("tracking stays live through the handover", last(viewer, "state")?.tracking === true);

// ---------------------------------------------------------------- updates ---
taker.send(JSON.stringify({ t: "post", text: "on my way", photo: null }));
await settle();
check("a text update reaches viewers", last(viewer, "update")?.update.text === "on my way");

taker.send(JSON.stringify({ t: "post", text: "found it", photo: PNG }));
await settle();
const withPhoto = last(viewer, "update").update;
check("a photo update is flagged", withPhoto.hasPhoto === true);

const image = await fetch(`${BASE}/photo?id=${withPhoto.id}&tracker=${SCRATCH}`);
const bytes = new Uint8Array(await image.arrayBuffer());
check("the photo is served and cached immutably",
  image.status === 200 && bytes[0] === 0x89 &&
  (image.headers.get("cache-control") ?? "").includes("immutable"));

const postsBefore = all(viewer, "update").length;
viewer.send(JSON.stringify({ t: "post", text: "not allowed", photo: null }));
taker.send(JSON.stringify({ t: "post", text: "   ", photo: null }));
await settle();
check("viewers cannot post, and empty posts are ignored",
  all(viewer, "update").length === postsBefore);

taker.send(JSON.stringify({ t: "post", text: "x".repeat(400), photo: null }));
await settle();
check("text is capped", last(viewer, "update").update.text.length === 280);

// ------------------------------------------------------------------ likes ---
const target = withPhoto.id;
viewer.send(JSON.stringify({ t: "like", id: target, viewer: "alice", on: true }));
await settle();
check("a viewer can like", last(viewer, "likes")?.likes === 1);

viewer.send(JSON.stringify({ t: "like", id: target, viewer: "alice", on: true }));
await settle();
check("the same device cannot inflate the count", last(viewer, "likes")?.likes === 1);

viewer.send(JSON.stringify({ t: "like", id: target, viewer: "bob", on: true }));
await settle();
check("a second device counts", last(viewer, "likes")?.likes === 2);

viewer.send(JSON.stringify({ t: "like", id: target, viewer: "bob", on: false }));
viewer.send(JSON.stringify({ t: "like", id: "nope", viewer: "alice", on: true }));
viewer.send(JSON.stringify({ t: "like", id: target, viewer: "", on: true }));
await settle();
check("unliking works and junk is ignored", last(viewer, "likes")?.likes === 1);

// ------------------------------------------------------------- close-down ---
taker.send(JSON.stringify({ t: "fix", fix: { lat: 13.75, lon: 100.54, acc: null, spd: null, hdg: null } }));
await settle();
taker.close();
await settle(700);
const ended = last(viewer, "state");
check("tracking ends when the last admin leaves", ended.tracking === false);
check("the final location survives", ended.fix.lat === 13.75);
check("a hand-pinned fix keeps its null accuracy", ended.fix.acc === null);

const rejoin = await open("role=viewer");
await settle();
check("a later joiner gets the final spot and the timeline",
  last(rejoin, "state").fix.lat === 13.75 && last(rejoin, "updates").updates.length >= 3);
check("history carries like counts but no photo bodies",
  last(rejoin, "updates").updates.every((u) => "likes" in u && !("photo" in u)));

for (const socket of [viewer, admin, second, taker, rejoin]) socket.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
