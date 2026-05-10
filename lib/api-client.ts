const DEFAULT_API_ORIGIN = "http://127.0.0.1:5050";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveApiOrigin() {
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window === "undefined") {
    return trimTrailingSlash(envBase || DEFAULT_API_ORIGIN);
  }

  const runtimeOrigin = trimTrailingSlash(window.location.origin);
  if (window.location.port === "5050") {
    return runtimeOrigin;
  }
  return trimTrailingSlash(envBase || DEFAULT_API_ORIGIN);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = resolveApiOrigin();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = await response
    .json()
    .catch(() => ({ error: `接口返回非 JSON，状态码=${response.status}` }));

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return payload as T;
}
