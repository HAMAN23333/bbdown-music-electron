const { randomUUID } = require("crypto");

const MAX_LOG_ENTRIES = 300;

class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  createJob(options) {
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

  save(job) {
    this.jobs.set(job.id, job);
  }

  get(id) {
    return this.jobs.get(id);
  }

  trimOldJobs() {
    const now = Date.now();
    const ttl = 8 * 60 * 60 * 1000;
    for (const [id, job] of this.jobs.entries()) {
      const ts = new Date(job.updatedAt).getTime();
      if (Number.isFinite(ts) && now - ts > ttl && job.status !== "running") {
        this.jobs.delete(id);
      }
    }
  }

  touch(job) {
    job.updatedAt = new Date().toISOString();
  }

  setStatus(job, status) {
    job.status = status;
    this.touch(job);
  }

  addLog(job, message) {
    job.logs.push({
      time: new Date().toISOString(),
      message,
    });
    if (job.logs.length > MAX_LOG_ENTRIES) {
      job.logs = job.logs.slice(job.logs.length - MAX_LOG_ENTRIES);
    }
    this.touch(job);
  }

  toView(job, binaries) {
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
        bundledBbdownPath: binaries.bbdownPath,
        bundledFfmpegPath: binaries.ffmpegPath,
        searchOptions: job.options.searchOptions,
        downloadOptions: job.options.downloadOptions,
      },
      items: job.items,
      logs: job.logs,
    };
  }
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

module.exports = {
  JobStore,
  mapLimit,
};
