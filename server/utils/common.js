function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(v) {
  if (typeof v !== "string") return "";
  return v.trim();
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tail(arr, size) {
  if (arr.length <= size) return arr;
  return arr.slice(arr.length - size);
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function ensureDir(fsModule, dir) {
  fsModule.mkdirSync(dir, { recursive: true });
}

function parseCookieHeader(header) {
  const map = new Map();
  const text = String(header || "").trim();
  if (!text) return map;
  const parts = text.split(";");
  for (const part of parts) {
    const unit = part.trim();
    if (!unit) continue;
    const idx = unit.indexOf("=");
    if (idx <= 0) continue;
    const key = unit.slice(0, idx).trim();
    const value = unit.slice(idx + 1).trim();
    if (!key || !value) continue;
    map.set(key, value);
  }
  return map;
}

function parseSetCookieKV(setCookieLine) {
  const first = String(setCookieLine || "").split(";")[0];
  const idx = first.indexOf("=");
  if (idx <= 0) return null;
  const key = first.slice(0, idx).trim();
  const value = first.slice(idx + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

module.exports = {
  sleep,
  normalizeText,
  stripHtml,
  tail,
  clampInt,
  dedupe,
  ensureDir,
  parseCookieHeader,
  parseSetCookieKV,
};
