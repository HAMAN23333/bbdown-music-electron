import type { DownloadFormValues } from "@/lib/schema";
import { apiFetch } from "@/lib/api-client";
import type {
  CookieInspectResponse,
  CreateJobResponse,
  HealthResponse,
  JobView,
} from "@/lib/types";

export function getHealth() {
  return apiFetch<HealthResponse>("/api/health", { method: "GET" });
}

export function createJob(values: DownloadFormValues) {
  return apiFetch<CreateJobResponse>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function getJob(jobId: string) {
  return apiFetch<JobView>(`/api/jobs/${jobId}`, { method: "GET" });
}

export function inspectCookie(cookie: string, apply = true) {
  return apiFetch<CookieInspectResponse>("/api/cookie/inspect", {
    method: "POST",
    body: JSON.stringify({ cookie, apply }),
  });
}
