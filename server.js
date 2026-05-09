const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const HOST = "127.0.0.1";
const PORT = 5050;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEFAULT_OUTPUT_DIR = os.homedir();
const TOOLS_DIR = path.join(ROOT_DIR, "tools");
const BBDOWN_DIR = path.join(TOOLS_DIR, "bbdown");
const BBDOWN_BIN_NAME = process.platform === "win32" ? "BBDown.exe" : "BBDown";
const BBDOWN_BIN_PATH = path.join(BBDOWN_DIR, BBDOWN_BIN_NAME);
// 对齐 Nemo2011/bilibili-api: web_search_by_type + web_search (均使用 wbi 路径)
const SEARCH_API_TYPE = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const SEARCH_API_ALL = "https://api.bilibili.com/x/web-interface/wbi/search/all/v2";
const SEARCH_API_SUGGEST = "https://s.search.bilibili.com/main/suggest";
const VIDEO_ORDER_TYPES = new Set(["totalrank", "click", "pubdate", "dm", "stow", "scores"]);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const MAX_LOG_ENTRIES = 300;
let cachedSearchCookie = "";

/** @type {Map<string, any>} */
const jobs = new Map();

function main() {
  ensureDir(DEFAULT_OUTPUT_DIR);
  ensureDir(BBDOWN_DIR);
  const server = http.createServer((req, res) => route(req, res).catch((err) => handleRouteError(res, err)));
  server.on("error", (err) => {
    const code = err && err.code ? err.code : "UNKNOWN";
    if (code === "EADDRINUSE") {
      console.error(`[bbdown-ui] listen failed: port ${PORT} is already in use`);
    } else {
      console.error(`[bbdown-ui] listen failed: ${err && err.message ? err.message : code}`);
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`[bbdown-ui] running on http://${HOST}:${PORT}`);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      time: new Date().toISOString(),
      bundledBbdownPath: BBDOWN_BIN_PATH,
      bundledBbdownReady: fs.existsSync(BBDOWN_BIN_PATH),
      defaultOutputDir: DEFAULT_OUTPUT_DIR,
    });
  }

  if (req.method === "GET" && pathname === "/api/search/suggest") {
    const keyword = normalizeText(url.searchParams.get("keyword"));
    if (!keyword) {
      return sendJson(res, 200, { keyword: "", suggestions: [] });
    }
    const suggestions = await getSuggestKeywords(keyword);
    return sendJson(res, 200, { keyword, suggestions });
  }

  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readJsonBody(req);
    const songs = parseSongs(body.songs);
    if (songs.length === 0) {
      return sendJson(res, 400, { error: "请至少输入一首歌名（每行一首）" });
    }

    const maxConcurrent = clampInt(body.maxConcurrent, 2, 1, 8);
    const outputDir = resolveOutputDir(body.outputDir);
    const cookie = normalizeText(body.cookie);
    const searchOptions = parseSearchOptions(body);

    ensureDir(outputDir);

    const job = createJob({
      songs,
      outputDir,
      maxConcurrent,
      cookie,
      searchOptions,
    });
    jobs.set(job.id, job);
    trimOldJobs();

    runJob(job).catch((err) => {
      setJobStatus(job, "failed");
      addJobLog(job, `任务异常终止: ${err.message}`);
    });

    return sendJson(res, 201, { jobId: job.id });
  }

  if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
    const jobId = pathname.replace("/api/jobs/", "");
    const job = jobs.get(jobId);
    if (!job) {
      return sendJson(res, 404, { error: "任务不存在或已过期" });
    }
    return sendJson(res, 200, toJobView(job));
  }

  if (req.method === "GET") {
    return serveStatic(res, pathname);
  }

  sendJson(res, 404, { error: "Not Found" });
}

function createJob(options) {
  const now = new Date().toISOString();
  const items = options.songs.map((song, idx) => ({
    id: idx + 1,
    song,
    status: "pending",
    message: "等待处理",
    search: null,
    output: [],
    startedAt: null,
    finishedAt: null,
  }));

  return {
    id: randomUUID(),
    status: "running",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    options,
    total: items.length,
    completed: 0,
    success: 0,
    failed: 0,
    items,
    logs: [],
  };
}

async function runJob(job) {
  job.startedAt = new Date().toISOString();
  setJobStatus(job, "running");
  addJobLog(job, `任务开始，共 ${job.total} 首，最大并发 ${job.options.maxConcurrent}`);
  const bundledBbdownPath = resolveBundledBbdownPath();
  addJobLog(job, `使用项目内置 BBDown: ${bundledBbdownPath}`);

  await mapLimit(job.items, job.options.maxConcurrent, async (item) => {
    await processSong(job, item, bundledBbdownPath);
  });

  job.finishedAt = new Date().toISOString();
  if (job.failed > 0 && job.success > 0) {
    setJobStatus(job, "partial_success");
  } else if (job.failed > 0 && job.success === 0) {
    setJobStatus(job, "failed");
  } else {
    setJobStatus(job, "completed");
  }
  addJobLog(job, `任务结束，成功 ${job.success}，失败 ${job.failed}`);
}

async function processSong(job, item, bundledBbdownPath) {
  item.startedAt = new Date().toISOString();
  item.status = "searching";
  item.message = "正在检索 B 站视频";
  touchJob(job);

  try {
    const match = await searchVideoBySongName(item.song, job.options.searchOptions);
    item.search = match;
    item.status = "downloading";
    item.message = `命中: ${match.title} (${match.bvid})`;
    addJobLog(job, `【${item.song}】命中视频: ${match.title} (${match.bvid}), score=${match.score}`);
    touchJob(job);

    const downloadResult = await runBbdown({
      videoUrl: match.url,
      outputDir: job.options.outputDir,
      bbdownPath: bundledBbdownPath,
      cookie: job.options.cookie,
    });
    item.output = downloadResult.lines;
    item.status = "success";
    item.message = "下载成功";
    job.success += 1;
    addJobLog(job, `【${item.song}】下载成功`);
  } catch (err) {
    item.status = "failed";
    item.message = err.message;
    job.failed += 1;
    addJobLog(job, `【${item.song}】失败: ${err.message}`);
  } finally {
    item.finishedAt = new Date().toISOString();
    job.completed += 1;
    touchJob(job);
  }
}

async function searchVideoBySongName(song, searchOptions) {
  const tries = [
    () => searchByType(song, searchOptions),
    () => searchByAll(song, searchOptions),
    () => searchByType(song, { ...searchOptions, orderType: "pubdate" }),
  ];
  let lastError = null;
  for (let i = 0; i < tries.length; i += 1) {
    try {
      const candidates = await tries[i]();
      if (candidates.length === 0) {
        throw new Error("检索候选为空");
      }
      return pickBestVideo(song, candidates, searchOptions.maxCandidates);
    } catch (err) {
      lastError = err;
      if (isRiskControlError(err)) {
        await warmupSearchCookie();
      }
      await sleep(180 * (i + 1));
    }
  }
  throw lastError || new Error("检索失败");
}

async function searchByType(song, options) {
  const query = new URLSearchParams({
    search_type: "video",
    keyword: song,
    order: sanitizeOrderType(options.orderType),
    page: String(options.page),
    page_size: String(options.pageSize),
  });

  // 对齐 bilibili-api/search.py 的 time_range -> duration 映射。
  query.set("duration", String(toDurationCode(options.timeRange)));

  if (Number.isInteger(options.videoZoneType)) {
    query.set("tids", String(options.videoZoneType));
  }
  if (options.timeStart && options.timeEnd) {
    const [beginS, endS] = toPubTimeRange(options.timeStart, options.timeEnd);
    query.set("pubtime_begin_s", String(beginS));
    query.set("pubtime_end_s", String(endS));
  }

  const data = await requestSearchJson(SEARCH_API_TYPE, query);
  const rows = Array.isArray(data?.data?.result) ? data.data.result : [];
  return rows.map(normalizeVideoItem).filter((x) => Boolean(x.bvid));
}

async function searchByAll(song, options) {
  const query = new URLSearchParams({
    keyword: song,
    page: String(options.page),
    page_size: String(options.pageSize),
  });
  const data = await requestSearchJson(SEARCH_API_ALL, query);
  const modules = Array.isArray(data?.data?.result) ? data.data.result : [];
  const videoModule = modules.find((x) => x?.result_type === "video" && Array.isArray(x?.data));
  const rows = Array.isArray(videoModule?.data) ? videoModule.data : [];
  return rows.map(normalizeVideoItem).filter((x) => Boolean(x.bvid));
}

function runBbdown({ videoUrl, outputDir, bbdownPath, cookie }) {
  return new Promise((resolve, reject) => {
    const args = [
      videoUrl,
      "--audio-only",
      "--work-dir",
      outputDir,
      "--skip-cover",
      "--skip-subtitle",
    ];
    if (cookie) {
      args.push("-c", cookie);
    }

    const env = { ...process.env };
    delete env.ALL_PROXY;
    delete env.all_proxy;
    delete env.HTTP_PROXY;
    delete env.http_proxy;
    delete env.HTTPS_PROXY;
    delete env.https_proxy;

    let child;
    try {
      child = spawn(bbdownPath, args, {
        cwd: ROOT_DIR,
        env,
        windowsHide: true,
      });
    } catch (err) {
      const hint =
        err && err.code === "EPERM"
          ? "（当前环境禁止 Node 启动子进程，请在本机终端直接运行）"
          : "";
      reject(new Error(`无法启动 BBDown: ${err.message}${hint}`));
      return;
    }

    /** @type {string[]} */
    const lines = [];
    const onData = (buf) => {
      const text = String(buf || "");
      const chunks = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      for (const line of chunks) {
        lines.push(line);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      const hint =
        err && err.code === "EPERM"
          ? "（当前环境禁止 Node 启动子进程，请在本机终端直接运行）"
          : "";
      reject(new Error(`无法启动 BBDown: ${err.message}${hint}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, lines: tail(lines, 40) });
      } else {
        const clue = tail(lines, 6).join(" | ");
        reject(new Error(`BBDown 退出码 ${code}${clue ? `: ${clue}` : ""}`));
      }
    });
  });
}

function resolveBundledBbdownPath() {
  if (fs.existsSync(BBDOWN_BIN_PATH)) {
    return BBDOWN_BIN_PATH;
  }
  const setupHint =
    process.platform === "win32"
      ? "请执行 scripts\\setup-bbdown.ps1 下载项目内置 BBDown"
      : "请将 BBDown 可执行文件放到 tools/bbdown 目录";
  throw new Error(`项目内置 BBDown 不存在: ${BBDOWN_BIN_PATH}。${setupHint}`);
}

async function getSuggestKeywords(keyword) {
  const query = new URLSearchParams({ term: keyword });
  const data = await requestSearchJson(SEARCH_API_SUGGEST, query, {
    requireCodeZero: false,
    allowCodeMinus412: false,
  });
  const list = Array.isArray(data?.result?.tag) ? data.result.tag : [];
  return list
    .map((x) => normalizeText(x?.value))
    .filter(Boolean)
    .slice(0, 10);
}

function pickBestVideo(song, candidates, maxCandidates) {
  const limit = clampInt(maxCandidates, 8, 1, 20);
  const uniq = dedupeByBvid(candidates).slice(0, Math.max(limit, 8));
  if (uniq.length === 0) {
    throw new Error("未检索到可用视频候选");
  }
  const ranked = uniq
    .map((item) => ({ ...item, score: scoreCandidate(song, item) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const alternatives = ranked.slice(1, Math.min(limit, ranked.length)).map((x) => ({
    bvid: x.bvid,
    title: x.title,
    author: x.author,
    score: x.score,
    url: x.url,
  }));

  return {
    bvid: top.bvid,
    title: top.title,
    author: top.author,
    duration: top.duration,
    url: top.url,
    score: top.score,
    source: top.source,
    alternatives,
  };
}

function dedupeByBvid(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.bvid || seen.has(item.bvid)) continue;
    seen.add(item.bvid);
    out.push(item);
  }
  return out;
}

function scoreCandidate(song, candidate) {
  const queryNorm = normalizeForMatch(song);
  const titleNorm = normalizeForMatch(candidate.title);
  const authorNorm = normalizeForMatch(candidate.author);
  const tagNorm = normalizeForMatch(candidate.tag);
  const typeNorm = normalizeForMatch(candidate.typename);
  const queryTokens = tokenizeQuery(song);

  let score = 0;
  if (queryNorm && titleNorm.includes(queryNorm)) score += 50;
  if (queryNorm && authorNorm.includes(queryNorm)) score += 12;

  let tokenHits = 0;
  for (const token of queryTokens) {
    const inTitle = titleNorm.includes(token);
    const inAuthor = authorNorm.includes(token);
    const inTag = tagNorm.includes(token);
    if (inTitle) {
      score += 12;
      tokenHits += 1;
    } else if (inAuthor) {
      score += 8;
      tokenHits += 1;
    } else if (inTag) {
      score += 5;
      tokenHits += 1;
    }
  }
  if (queryTokens.length > 0 && tokenHits === queryTokens.length) {
    score += 24;
  }

  if (typeNorm.includes("mv") || typeNorm.includes("音乐") || typeNorm.includes("music")) {
    score += 10;
  }
  const negativeWords = [
    "鼓谱",
    "谱",
    "教程",
    "教学",
    "cover",
    "翻唱",
    "伴奏",
    "dj",
    "remix",
    "卡拉ok",
    "karaoke",
    "live版",
    "片段",
    "试听",
  ];
  const positiveWords = ["完整版", "无损", "hires", "hi-res", "mv", "官方", "原版"];
  for (const w of negativeWords) {
    if (titleNorm.includes(normalizeForMatch(w))) {
      score -= 22;
    }
  }
  for (const w of positiveWords) {
    if (titleNorm.includes(normalizeForMatch(w))) {
      score += 6;
    }
  }

  const durationSec = parseDurationSeconds(candidate.duration);
  if (durationSec >= 90 && durationSec <= 480) {
    score += 8;
  } else if (durationSec > 0 && durationSec <= 900) {
    score += 3;
  }

  const play = parseMetricNumber(candidate.play);
  const favorites = parseMetricNumber(candidate.favorites);
  score += Math.min(Math.log10(play + 1) * 2.2, 8);
  score += Math.min(Math.log10(favorites + 1) * 2.5, 7);
  return Number(score.toFixed(2));
}

async function requestSearchJson(api, query, options = {}) {
  const requireCodeZero = options.requireCodeZero !== false;
  const allowCodeMinus412 = options.allowCodeMinus412 !== false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let resp;
  try {
    resp = await fetch(`${api}?${query.toString()}`, {
      method: "GET",
      headers: buildSearchHeaders(),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`检索请求失败: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  mergeSetCookieFromResponse(resp);
  if (resp.status === 412) {
    throw makeRiskError("检索接口返回异常状态: 412");
  }
  if (!resp.ok) {
    throw new Error(`检索接口返回异常状态: ${resp.status}`);
  }

  /** @type {any} */
  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error("检索接口返回了非 JSON 数据");
  }
  if (allowCodeMinus412 && Number(data?.code) === -412) {
    throw makeRiskError("检索被风控拦截(code=-412)，将自动重试");
  }
  if (requireCodeZero && data?.code !== 0) {
    throw new Error(`检索接口报错(code=${data.code}): ${data.message || "未知错误"}`);
  }
  return data;
}

function buildSearchHeaders() {
  const headers = {
    "user-agent": USER_AGENT,
    referer: "https://www.bilibili.com/",
    origin: "https://www.bilibili.com",
    accept: "application/json,text/plain,*/*",
    "accept-language": "zh-CN,zh;q=0.9",
  };
  if (cachedSearchCookie) {
    headers.cookie = cachedSearchCookie;
  }
  return headers;
}

async function warmupSearchCookie() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch("https://www.bilibili.com/", {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    mergeSetCookieFromResponse(resp);
  } catch {
    // 忽略预热失败，后续流程会继续尝试检索
  } finally {
    clearTimeout(timeout);
  }
}

function mergeSetCookieFromResponse(resp) {
  if (!resp || !resp.headers) return;
  /** @type {string[]} */
  const setCookieList = [];

  if (typeof resp.headers.getSetCookie === "function") {
    setCookieList.push(...resp.headers.getSetCookie());
  } else {
    const one = resp.headers.get("set-cookie");
    if (one) setCookieList.push(one);
  }

  if (setCookieList.length === 0) return;

  const incoming = new Map();
  for (const row of setCookieList) {
    const kv = parseSetCookieKV(row);
    if (!kv) continue;
    incoming.set(kv.key, kv.value);
  }

  const existing = parseCookieHeader(cachedSearchCookie);
  for (const [k, v] of incoming.entries()) {
    existing.set(k, v);
  }
  cachedSearchCookie = Array.from(existing.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
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

function makeRiskError(message) {
  const err = new Error(message);
  err.riskControl = true;
  return err;
}

function isRiskControlError(err) {
  if (!err) return false;
  if (err.riskControl) return true;
  const msg = String(err.message || "");
  return msg.includes("412") || msg.includes("风控");
}

function normalizeVideoItem(raw) {
  const row = raw || {};
  let bvid = normalizeText(row.bvid);
  const arcurl = normalizeText(row.arcurl);
  if (!bvid) {
    bvid = extractBvid(arcurl);
  }
  if (!bvid) {
    throw new Error("检索结果缺少 bvid");
  }

  let url = arcurl;
  if (!url) {
    url = `https://www.bilibili.com/video/${bvid}`;
  } else if (url.startsWith("//")) {
    url = `https:${url}`;
  } else if (url.startsWith("http://")) {
    url = `https://${url.slice("http://".length)}`;
  }

  return {
    bvid,
    title: stripHtml(row.title || ""),
    author: normalizeText(row.author),
    duration: normalizeText(row.duration),
    tag: normalizeText(row.tag),
    typename: normalizeText(row.typename),
    play: row.play ?? 0,
    favorites: row.favorites ?? 0,
    pubdate: row.pubdate ?? 0,
    source: normalizeText(row.type) || "video",
    url,
  };
}

function extractBvid(text) {
  const m = String(text || "").match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSearchOptions(body) {
  const orderType = sanitizeOrderType(normalizeText(body.orderType));
  const timeRange = clampInt(body.timeRange, -1, -1, 720);
  const page = clampInt(body.page, 1, 1, 50);
  const pageSize = clampInt(body.pageSize, 20, 1, 42);
  const maxCandidates = clampInt(body.maxCandidates, 8, 1, 20);

  const videoZoneType = parseNullableInt(body.videoZoneType);
  const timeStart = normalizeText(body.timeStart);
  const timeEnd = normalizeText(body.timeEnd);
  if ((timeStart && !timeEnd) || (!timeStart && timeEnd)) {
    throw new HttpError(400, "timeStart 和 timeEnd 需要同时提供");
  }
  if (timeStart && timeEnd) {
    if (!isDateText(timeStart) || !isDateText(timeEnd)) {
      throw new HttpError(400, "timeStart/timeEnd 格式应为 YYYY-MM-DD");
    }
    try {
      toPubTimeRange(timeStart, timeEnd);
    } catch (err) {
      throw new HttpError(400, err.message || "timeStart/timeEnd 参数无效");
    }
  }

  return {
    orderType,
    timeRange,
    page,
    pageSize,
    maxCandidates,
    videoZoneType,
    timeStart,
    timeEnd,
  };
}

function sanitizeOrderType(value) {
  if (VIDEO_ORDER_TYPES.has(value)) return value;
  return "totalrank";
}

function toDurationCode(timeRange) {
  const v = Number(timeRange);
  if (!Number.isFinite(v)) return 0;
  if (v > 60) return 4;
  if (v > 30) return 3;
  if (v > 10) return 2;
  if (v > 0) return 1;
  return 0;
}

function toPubTimeRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T23:59:59+08:00`);
  const beginS = Math.floor(start.getTime() / 1000);
  const endS = Math.floor(end.getTime() / 1000);
  if (!Number.isFinite(beginS) || !Number.isFinite(endS)) {
    throw new Error("时间筛选参数无效");
  }
  if (beginS > endS) {
    throw new Error("timeStart 不能晚于 timeEnd");
  }
  return [beginS, endS];
}

function normalizeForMatch(value) {
  return normalizeText(stripHtml(String(value || "")))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokenizeQuery(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return [];
  const raw = text
    .split(/[\s,;|/\\\-_.，。！？、：:（）()\[\]{}]+/g)
    .map((x) => normalizeForMatch(x))
    .filter(Boolean);
  return dedupe(raw);
}

function parseDurationSeconds(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  const parts = text.split(":").map((x) => Number.parseInt(x, 10));
  if (parts.some((x) => !Number.isFinite(x) || x < 0)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

function parseMetricNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim().replaceAll(",", "");
  if (!text || text === "--") return 0;
  const yi = text.match(/^([\d.]+)\s*亿$/);
  if (yi) return Number.parseFloat(yi[1]) * 100000000;
  const wan = text.match(/^([\d.]+)\s*万$/);
  if (wan) return Number.parseFloat(wan[1]) * 10000;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

function parseNullableInt(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseSongs(value) {
  if (Array.isArray(value)) {
    return dedupe(value.map((x) => normalizeText(x)).filter(Boolean));
  }
  const text = normalizeText(value);
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return dedupe(lines);
}

function resolveOutputDir(rawValue) {
  const value = normalizeText(rawValue);
  if (!value) {
    return DEFAULT_OUTPUT_DIR;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(ROOT_DIR, value);
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

function normalizeText(v) {
  if (typeof v !== "string") return "";
  return v.trim();
}

function touchJob(job) {
  job.updatedAt = new Date().toISOString();
}

function setJobStatus(job, status) {
  job.status = status;
  touchJob(job);
}

function addJobLog(job, message) {
  job.logs.push({
    time: new Date().toISOString(),
    message,
  });
  if (job.logs.length > MAX_LOG_ENTRIES) {
    job.logs = job.logs.slice(job.logs.length - MAX_LOG_ENTRIES);
  }
  touchJob(job);
}

function toJobView(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    total: job.total,
    completed: job.completed,
    success: job.success,
    failed: job.failed,
    options: {
      outputDir: job.options.outputDir,
      maxConcurrent: job.options.maxConcurrent,
      bundledBbdownPath: BBDOWN_BIN_PATH,
      searchOptions: job.options.searchOptions,
    },
    items: job.items,
    logs: job.logs,
  };
}

async function mapLimit(items, limit, worker) {
  if (items.length === 0) return;
  let index = 0;
  const size = Math.min(limit, items.length);
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new HttpError(400, `请求体不是合法 JSON: ${err.message}`);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new HttpError(413, "请求体过大"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: "Not Found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function trimOldJobs() {
  const now = Date.now();
  const ttl = 8 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    const ts = new Date(job.updatedAt).getTime();
    if (Number.isFinite(ts) && now - ts > ttl && job.status !== "running") {
      jobs.delete(id);
    }
  }
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
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

function handleRouteError(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { error: err.message });
  }
  return sendJson(res, 500, { error: err.message || "Internal Server Error" });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

main();
