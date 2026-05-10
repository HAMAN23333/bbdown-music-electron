export type JobStatus = "running" | "completed" | "failed" | "partial_success";

export interface HealthResponse {
  ok: boolean;
  time: string;
  bundledBbdownPath: string;
  bundledBbdownReady: boolean;
  bundledFfmpegPath: string;
  bundledFfmpegReady: boolean;
  defaultOutputDir: string;
}

export interface SearchMatch {
  bvid: string;
  title: string;
  author?: string;
  duration?: string;
  score?: number;
  url?: string;
}

export interface JobItem {
  id: number;
  song: string;
  status: "pending" | "searching" | "downloading" | "post_processing" | "success" | "failed";
  message: string;
  search: SearchMatch | null;
  output: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobLog {
  time: string;
  message: string;
}

export interface JobView {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  completed: number;
  success: number;
  failed: number;
  options: {
    outputDir: string;
    maxConcurrent: number;
    bundledBbdownPath: string;
    bundledFfmpegPath: string;
    searchOptions: {
      orderType: string;
      timeRange: number;
      page: number;
      pageSize: number;
      maxCandidates: number;
      videoZoneType: number | null;
      timeStart: string;
      timeEnd: string;
    };
    downloadOptions: {
      audioFormat: string;
      audioBitrateKbps: number;
      bitrateIgnored: boolean;
    };
  };
  items: JobItem[];
  logs: JobLog[];
}

export interface CreateJobResponse {
  jobId: string;
}

export interface CookieInspectResponse {
  hasCookie: boolean;
  hasRequired: boolean;
  missingKeys: string[];
  cookieKeys: string[];
  appliedToSearch: boolean;
}
