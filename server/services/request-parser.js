const path = require("path");

const { HttpError } = require("../http-error");
const { normalizeText, clampInt, dedupe } = require("../utils/common");
const { sanitizeOrderType, toPubTimeRange } = require("./bilibili-search-service");

const AUDIO_FORMAT_TYPES = new Set(["original", "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"]);
const AUDIO_LOSSLESS_FORMATS = new Set(["flac", "wav"]);

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

function parseDownloadOptions(body) {
  const rawFormat = normalizeText(body.audioFormat).toLowerCase();
  const audioFormat = rawFormat || "mp3";
  if (!AUDIO_FORMAT_TYPES.has(audioFormat)) {
    throw new HttpError(400, `audioFormat 不支持: ${audioFormat}`);
  }

  const audioBitrateKbps = clampInt(body.audioBitrateKbps, 192, 64, 320);
  return {
    audioFormat,
    audioBitrateKbps,
    bitrateIgnored: AUDIO_LOSSLESS_FORMATS.has(audioFormat),
  };
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

function resolveOutputDir(rootDir, defaultOutputDir, rawValue) {
  const value = normalizeText(rawValue);
  if (!value) {
    return defaultOutputDir;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(rootDir, value);
}

function parseNullableInt(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

module.exports = {
  parseSongs,
  parseDownloadOptions,
  parseSearchOptions,
  resolveOutputDir,
};
