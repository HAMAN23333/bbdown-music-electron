const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  HOST,
  PORT,
  ROOT_DIR,
  PUBLIC_DIR,
  NEXT_OUT_DIR,
  DEFAULT_OUTPUT_DIR,
  TOOLS_DIR,
  BBDOWN_DIR,
  BBDOWN_BIN_PATH,
  FFMPEG_DIR,
  FFMPEG_BIN_PATH,
  USER_AGENT,
} = require("./server/config");
const { HttpError } = require("./server/http-error");
const { clampInt, normalizeText, ensureDir } = require("./server/utils/common");
const { ToolResolver } = require("./server/infra/tool-resolver");
const { BinaryManager } = require("./server/infra/binary-manager");
const { ProcessRunner } = require("./server/infra/process-runner");
const { PlatformApiClient } = require("./server/infra/platform-api-client");
const { BilibiliSearchService } = require("./server/services/bilibili-search-service");
const { AudioDownloadService } = require("./server/services/audio-download-service");
const { JobStore, mapLimit } = require("./server/services/job-store");
const { resolveStaticDir, serveStatic } = require("./server/services/static-file-service");
const {
  parseSongs,
  parseDownloadOptions,
  parseSearchOptions,
  resolveOutputDir,
} = require("./server/services/request-parser");

const staticDir = resolveStaticDir({
  nextOutDir: NEXT_OUT_DIR,
  publicDir: PUBLIC_DIR,
  allowPublicFallback: false,
});

const toolResolver = new ToolResolver(ROOT_DIR);
const binaryManager = new BinaryManager({
  toolResolver,
  platform: process.platform,
});
const processRunner = new ProcessRunner();
const platformApiClient = new PlatformApiClient();
const searchService = new BilibiliSearchService({
  platformApiClient,
  userAgent: USER_AGENT,
});
const audioDownloadService = new AudioDownloadService({
  processRunner,
  rootDir: ROOT_DIR,
});
const jobStore = new JobStore();

function main() {
  ensureDir(fs, DEFAULT_OUTPUT_DIR);
  ensureDir(fs, TOOLS_DIR);
  ensureDir(fs, BBDOWN_DIR);
  ensureDir(fs, FFMPEG_DIR);

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
    const staticDesc = staticDir || "(not built)";
    console.log(`[bbdown-ui] running on http://${HOST}:${PORT} (static: ${staticDesc})`);
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
      bundledFfmpegPath: FFMPEG_BIN_PATH,
      bundledFfmpegReady: fs.existsSync(FFMPEG_BIN_PATH),
      defaultOutputDir: DEFAULT_OUTPUT_DIR,
      staticBuilt: Boolean(staticDir),
    });
  }

  if (req.method === "GET" && pathname === "/api/search/suggest") {
    const keyword = normalizeText(url.searchParams.get("keyword"));
    if (!keyword) {
      return sendJson(res, 200, { keyword: "", suggestions: [] });
    }
    const suggestions = await searchService.getSuggestKeywords(keyword);
    return sendJson(res, 200, { keyword, suggestions });
  }

  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readJsonBody(req);
    const songs = parseSongs(body.songs);
    if (songs.length === 0) {
      return sendJson(res, 400, { error: "请至少输入一首歌名（每行一首）" });
    }

    const maxConcurrent = clampInt(body.maxConcurrent, 2, 1, 8);
    const outputDir = resolveOutputDir(ROOT_DIR, DEFAULT_OUTPUT_DIR, body.outputDir);
    const cookie = normalizeText(body.cookie);
    searchService.applyCookieToSearchCache(cookie);

    const searchOptions = parseSearchOptions(body);
    const downloadOptions = parseDownloadOptions(body);

    ensureDir(fs, outputDir);

    const job = jobStore.createJob({
      songs,
      outputDir,
      maxConcurrent,
      cookie,
      searchOptions,
      downloadOptions,
    });
    jobStore.save(job);
    jobStore.trimOldJobs();

    runJob(job).catch((err) => {
      jobStore.setStatus(job, "failed");
      jobStore.addLog(job, `任务异常终止: ${err.message}`);
    });

    return sendJson(res, 201, { jobId: job.id });
  }

  if (req.method === "POST" && pathname === "/api/cookie/inspect") {
    const body = await readJsonBody(req);
    const cookie = normalizeText(body.cookie);
    const inspect = searchService.inspectCookieText(cookie);
    if (cookie && body.apply !== false) {
      searchService.applyCookieToSearchCache(cookie);
    }
    return sendJson(res, 200, {
      ...inspect,
      appliedToSearch: Boolean(cookie && body.apply !== false),
    });
  }

  if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
    const jobId = pathname.replace("/api/jobs/", "");
    const job = jobStore.get(jobId);
    if (!job) {
      return sendJson(res, 404, { error: "任务不存在或已过期" });
    }
    return sendJson(
      res,
      200,
      jobStore.toView(job, {
        bbdownPath: BBDOWN_BIN_PATH,
        ffmpegPath: FFMPEG_BIN_PATH,
      })
    );
  }

  if (req.method === "GET") {
    return serveStatic({ res, pathname, staticDir, sendJson });
  }

  sendJson(res, 404, { error: "Not Found" });
}

async function runJob(job) {
  job.startedAt = new Date().toISOString();
  jobStore.setStatus(job, "running");
  jobStore.addLog(job, `任务开始，共 ${job.total} 首，最大并发 ${job.options.maxConcurrent}`);

  const bundledBbdownPath = binaryManager.resolveBbdownPath();
  jobStore.addLog(job, `使用项目内置 BBDown: ${bundledBbdownPath}`);

  let bundledFfmpegPath = "";
  if (job.options.downloadOptions.audioFormat !== "original") {
    bundledFfmpegPath = binaryManager.resolveFfmpegPath();
    jobStore.addLog(job, `使用项目内置 FFmpeg: ${bundledFfmpegPath}`);
  }

  jobStore.addLog(
    job,
    job.options.downloadOptions.bitrateIgnored
      ? `输出格式: ${job.options.downloadOptions.audioFormat}（当前格式忽略比特率设置）`
      : `输出格式: ${job.options.downloadOptions.audioFormat}, 比特率: ${job.options.downloadOptions.audioBitrateKbps}kbps`
  );

  await mapLimit(job.items, job.options.maxConcurrent, async (item) => {
    await processSong(job, item, bundledBbdownPath, bundledFfmpegPath);
  });

  job.finishedAt = new Date().toISOString();
  if (job.failed > 0 && job.success > 0) {
    jobStore.setStatus(job, "partial_success");
  } else if (job.failed > 0 && job.success === 0) {
    jobStore.setStatus(job, "failed");
  } else {
    jobStore.setStatus(job, "completed");
  }
  jobStore.addLog(job, `任务结束，成功 ${job.success}，失败 ${job.failed}`);
}

async function processSong(job, item, bundledBbdownPath, bundledFfmpegPath) {
  const workDir = makeSongWorkDir(job.id, item.id);
  item.startedAt = new Date().toISOString();
  item.status = "searching";
  item.message = "正在检索 B 站视频";
  jobStore.touch(job);

  try {
    const match = await searchService.searchVideoBySongName(item.song, job.options.searchOptions);
    item.search = match;
    item.status = "downloading";
    item.message = `命中: ${match.title} (${match.bvid})`;
    jobStore.addLog(job, `【${item.song}】命中视频: ${match.title} (${match.bvid}), score=${match.score}`);
    jobStore.touch(job);

    const downloadResult = await audioDownloadService.runBbdown({
      videoUrl: match.url,
      workDir,
      bbdownPath: bundledBbdownPath,
      cookie: job.options.cookie,
      ffmpegPath: bundledFfmpegPath,
    });

    item.status = "post_processing";
    item.message = "正在整理音频文件";
    jobStore.touch(job);

    const postResult = await audioDownloadService.finalizeDownloadedAudio({
      workDir,
      outputDir: job.options.outputDir,
      audioFormat: job.options.downloadOptions.audioFormat,
      audioBitrateKbps: job.options.downloadOptions.audioBitrateKbps,
      ffmpegPath: bundledFfmpegPath,
    });

    item.output = [...downloadResult.lines, ...postResult.lines];
    item.status = "success";
    item.message = `下载成功，输出 ${postResult.outputFiles.length} 个文件`;
    job.success += 1;
    jobStore.addLog(job, `【${item.song}】下载成功: ${postResult.outputFiles.map((x) => path.basename(x)).join(", ")}`);
  } catch (err) {
    item.status = "failed";
    item.message = err.message;
    job.failed += 1;
    jobStore.addLog(job, `【${item.song}】失败: ${err.message}`);
  } finally {
    audioDownloadService.cleanupSongWorkDir(workDir);
    item.finishedAt = new Date().toISOString();
    job.completed += 1;
    jobStore.touch(job);
  }
}

function makeSongWorkDir(jobId, itemId) {
  return path.join(ROOT_DIR, "tmp", "jobs", jobId, `item-${itemId}`);
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function handleRouteError(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { error: err.message });
  }
  return sendJson(res, 500, { error: err.message || "Internal Server Error" });
}

main();
