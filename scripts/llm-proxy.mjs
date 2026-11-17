// A small lock in front of Ollama. Only requests carrying the right Bearer key get through,
// and only the two calls SHELLY needs (chat completions and the model list).
//
//   node scripts/llm-proxy.mjs
//
// Key: SHELLY_LLM_KEY env var, or the first line of %USERPROFILE%\.shelly-keys\llm-key.txt.
// Listens on 127.0.0.1:11435 and forwards to Ollama on 127.0.0.1:11434. Point the tunnel at 11435.
import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.SHELLY_LLM_PORT ?? 11435);
const UPSTREAM = { host: "127.0.0.1", port: Number(process.env.OLLAMA_PORT ?? 11434) };
const MAX_BODY = 1_000_000;

function loadKey() {
  if (process.env.SHELLY_LLM_KEY) return process.env.SHELLY_LLM_KEY.trim();
  try {
    return readFileSync(join(homedir(), ".shelly-keys", "llm-key.txt"), "utf8").split(/\r?\n/)[0].trim();
  } catch {
    return "";
  }
}
const KEY = loadKey();
if (KEY.length < 24) {
  console.error("No usable key (need 24+ characters). Set SHELLY_LLM_KEY or create ~/.shelly-keys/llm-key.txt");
  process.exit(1);
}

const ALLOWED = new Set(["POST /v1/chat/completions", "GET /v1/models"]);
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const deny = (res, code, msg) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
};

createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  if (!same(given, KEY)) return deny(res, 401, "unauthorized");
  if (!ALLOWED.has(`${req.method} ${path}`)) return deny(res, 404, "not_found");
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return deny(res, 413, "too_large");

  const headers = { "content-type": req.headers["content-type"] ?? "application/json" };
  if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
  const up = request({ ...UPSTREAM, path: req.url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, { "content-type": r.headers["content-type"] ?? "application/json" });
    r.pipe(res);
  });
  up.on("error", () => deny(res, 502, "ollama_unreachable"));
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => console.log(`SHELLY LLM proxy on 127.0.0.1:${PORT} -> Ollama ${UPSTREAM.port}`));

process.on("uncaughtException", (e) => console.error("proxy error:", e.message));
