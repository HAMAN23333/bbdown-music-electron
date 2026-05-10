class PlatformApiClient {
  async request(options) {
    const {
      url,
      query,
      headers,
      timeoutMs = 10000,
      method = "GET",
      body,
      parseJson = true,
    } = options;

    const fullUrl = this.#buildUrl(url, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(fullUrl, {
        method,
        headers,
        signal: controller.signal,
        body,
      });

      let data = null;
      if (parseJson) {
        try {
          data = await response.json();
        } catch {
          throw new Error(`平台接口返回非 JSON 数据: ${fullUrl}`);
        }
      }

      return {
        status: response.status,
        ok: response.ok,
        data,
        headers: response.headers,
        setCookieList: this.#extractSetCookie(response.headers),
      };
    } catch (err) {
      throw new Error(`平台接口请求失败: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson(options) {
    return this.request({
      ...options,
      parseJson: true,
    });
  }

  async requestHeaders(options) {
    return this.request({
      ...options,
      parseJson: false,
    });
  }

  #buildUrl(baseUrl, query) {
    if (!query) return baseUrl;
    const params = query instanceof URLSearchParams ? query : new URLSearchParams(query);
    const text = params.toString();
    if (!text) return baseUrl;
    return `${baseUrl}?${text}`;
  }

  #extractSetCookie(headers) {
    const out = [];
    if (!headers) return out;
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }
    const one = headers.get("set-cookie");
    if (one) out.push(one);
    return out;
  }
}

module.exports = {
  PlatformApiClient,
};
