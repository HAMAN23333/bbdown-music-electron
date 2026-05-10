const fs = require("fs");
const path = require("path");

function resolveStaticDir({ nextOutDir, publicDir, allowPublicFallback = false }) {
  const outIndex = path.join(nextOutDir, "index.html");
  if (fs.existsSync(outIndex)) {
    return nextOutDir;
  }
  if (allowPublicFallback) {
    return publicDir;
  }
  return "";
}

function serveStatic({ res, pathname, staticDir, sendJson }) {
  if (!staticDir) {
    return sendJson(res, 503, { error: "前端静态资源未构建，请先执行 npm run build" });
  }

  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(staticDir, `.${safePath}`);
  if (!filePath.startsWith(staticDir)) {
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
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = {
  resolveStaticDir,
  serveStatic,
};
