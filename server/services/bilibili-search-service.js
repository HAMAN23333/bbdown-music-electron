const {
  sleep,
  normalizeText,
  stripHtml,
  clampInt,
  dedupe,
  parseCookieHeader,
  parseSetCookieKV,
} = require("../utils/common");

const SEARCH_API_TYPE = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const SEARCH_API_ALL = "https://api.bilibili.com/x/web-interface/wbi/search/all/v2";
const SEARCH_API_SUGGEST = "https://s.search.bilibili.com/main/suggest";

const VIDEO_ORDER_TYPES = new Set(["totalrank", "click", "pubdate", "dm", "stow", "scores"]);
const REQUIRED_BILIBILI_COOKIE_KEYS = ["SESSDATA", "bili_jct", "DedeUserID"];

class BilibiliSearchService {
  constructor({ platformApiClient, userAgent }) {
    this.platformApiClient = platformApiClient;
    this.userAgent = userAgent;
    this.cachedSearchCookie = "";
  }

  inspectCookieText(cookieText) {
    const map = parseCookieHeader(cookieText);
    const keys = Array.from(map.keys());
    const missingKeys = REQUIRED_BILIBILI_COOKIE_KEYS.filter((key) => !map.has(key));
    return {
      hasCookie: map.size > 0,
      hasRequired: missingKeys.length === 0,
      missingKeys,
      cookieKeys: keys.slice(0, 100),
    };
  }

  applyCookieToSearchCache(cookieText) {
    const incoming = parseCookieHeader(cookieText);
    if (incoming.size === 0) return;
    const existing = parseCookieHeader(this.cachedSearchCookie);
    for (const [k, v] of incoming.entries()) {
      existing.set(k, v);
    }
    this.cachedSearchCookie = Array.from(existing.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async getSuggestKeywords(keyword) {
    const query = new URLSearchParams({ term: keyword });
    const data = await this._requestSearchJson(SEARCH_API_SUGGEST, query, {
      requireCodeZero: false,
      allowCodeMinus412: false,
    });
    const list = Array.isArray(data?.result?.tag) ? data.result.tag : [];
    return list
      .map((x) => normalizeText(x?.value))
      .filter(Boolean)
      .slice(0, 10);
  }

  async searchVideoBySongName(song, searchOptions) {
    const tries = [
      () => this._searchByType(song, searchOptions),
      () => this._searchByAll(song, searchOptions),
      () => this._searchByType(song, { ...searchOptions, orderType: "pubdate" }),
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
          await this._warmupSearchCookie();
        }
        await sleep(180 * (i + 1));
      }
    }

    throw lastError || new Error("检索失败");
  }

  async _searchByType(song, options) {
    const query = new URLSearchParams({
      search_type: "video",
      keyword: song,
      order: sanitizeOrderType(options.orderType),
      page: String(options.page),
      page_size: String(options.pageSize),
    });

    query.set("duration", String(toDurationCode(options.timeRange)));

    if (Number.isInteger(options.videoZoneType)) {
      query.set("tids", String(options.videoZoneType));
    }
    if (options.timeStart && options.timeEnd) {
      const [beginS, endS] = toPubTimeRange(options.timeStart, options.timeEnd);
      query.set("pubtime_begin_s", String(beginS));
      query.set("pubtime_end_s", String(endS));
    }

    const data = await this._requestSearchJson(SEARCH_API_TYPE, query);
    const rows = Array.isArray(data?.data?.result) ? data.data.result : [];
    return rows.map(normalizeVideoItem).filter((x) => Boolean(x.bvid));
  }

  async _searchByAll(song, options) {
    const query = new URLSearchParams({
      keyword: song,
      page: String(options.page),
      page_size: String(options.pageSize),
    });
    const data = await this._requestSearchJson(SEARCH_API_ALL, query);
    const modules = Array.isArray(data?.data?.result) ? data.data.result : [];
    const videoModule = modules.find((x) => x?.result_type === "video" && Array.isArray(x?.data));
    const rows = Array.isArray(videoModule?.data) ? videoModule.data : [];
    return rows.map(normalizeVideoItem).filter((x) => Boolean(x.bvid));
  }

  async _requestSearchJson(api, query, options = {}) {
    const requireCodeZero = options.requireCodeZero !== false;
    const allowCodeMinus412 = options.allowCodeMinus412 !== false;

    const response = await this.platformApiClient.getJson({
      url: api,
      query,
      headers: this._buildSearchHeaders(),
      timeoutMs: 10000,
    });

    this._mergeSetCookieFromResponse(response.setCookieList || []);

    if (response.status === 412) {
      throw makeRiskError("检索接口返回异常状态: 412");
    }
    if (!response.ok) {
      throw new Error(`检索接口返回异常状态: ${response.status}`);
    }

    const data = response.data;
    if (allowCodeMinus412 && Number(data?.code) === -412) {
      throw makeRiskError("检索被风控拦截(code=-412)，将自动重试");
    }
    if (requireCodeZero && data?.code !== 0) {
      throw new Error(`检索接口报错(code=${data.code}): ${data.message || "未知错误"}`);
    }

    return data;
  }

  _buildSearchHeaders() {
    const headers = {
      "user-agent": this.userAgent,
      referer: "https://www.bilibili.com/",
      origin: "https://www.bilibili.com",
      accept: "application/json,text/plain,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
    };
    if (this.cachedSearchCookie) {
      headers.cookie = this.cachedSearchCookie;
    }
    return headers;
  }

  async _warmupSearchCookie() {
    try {
      const resp = await this.platformApiClient.requestHeaders({
        url: "https://www.bilibili.com/",
        headers: {
          "user-agent": this.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeoutMs: 6000,
      });
      this._mergeSetCookieFromResponse(resp.setCookieList || []);
    } catch {
      // ignore warmup failures
    }
  }

  _mergeSetCookieFromResponse(setCookieList) {
    if (!Array.isArray(setCookieList) || setCookieList.length === 0) {
      return;
    }

    const incoming = new Map();
    for (const row of setCookieList) {
      const kv = parseSetCookieKV(row);
      if (!kv) continue;
      incoming.set(kv.key, kv.value);
    }

    const existing = parseCookieHeader(this.cachedSearchCookie);
    for (const [k, v] of incoming.entries()) {
      existing.set(k, v);
    }
    this.cachedSearchCookie = Array.from(existing.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
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

module.exports = {
  BilibiliSearchService,
  sanitizeOrderType,
  toPubTimeRange,
};
