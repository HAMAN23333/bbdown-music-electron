"use strict";

const path = require("path");
const http = require("http");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");

const HOST = "127.0.0.1";
const PORT = 5050;
const HEALTH_URL = `http://${HOST}:${PORT}/api/health`;
const APP_URL = `http://${HOST}:${PORT}`;
const BILIBILI_LOGIN_URL = "https://passport.bilibili.com/login";
const BILIBILI_LOGIN_TIMEOUT_MS = 4 * 60 * 1000;
const BILIBILI_COOKIE_REQUIRED_KEYS = ["SESSDATA", "bili_jct", "DedeUserID"];
const BILIBILI_COOKIE_PRIORITY_KEYS = [
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "sid",
  "buvid3",
  "buvid4",
  "buvid_fp",
  "b_nut",
];

const LOG_FILE = path.join(__dirname, "electron-launcher.log");
let activeBilibiliLoginPromise = null;

function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // ignore log errors
  }
}

function appRoot() {
  return __dirname;
}

function serverEntry() {
  return path.join(appRoot(), "server.js");
}

function startServer() {
  process.env.ALL_PROXY = "";
  process.env.HTTP_PROXY = "";
  process.env.HTTPS_PROXY = "";
  process.env.all_proxy = "";
  process.env.http_proxy = "";
  process.env.https_proxy = "";
  log("startServer()");
  require(serverEntry());
}

function stopServer() {
  // server runs in-process and exits together with Electron
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitServerReady(timeoutMs) {
  const start = Date.now();
  log(`waitServerReady(timeoutMs=${timeoutMs})`);
  while (Date.now() - start < timeoutMs) {
    const ok = await requestHealth();
    if (ok) return true;
    await wait(300);
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#f7f8fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL(APP_URL);
}

function normalizeCookieDomain(domain) {
  return String(domain || "").trim().replace(/^\./, "").toLowerCase();
}

function isBilibiliCookieDomain(domain) {
  const d = normalizeCookieDomain(domain);
  return d === "bilibili.com" || d.endsWith(".bilibili.com");
}

function extractBilibiliCookieMap(cookies) {
  const map = new Map();
  for (const cookie of cookies || []) {
    if (!cookie || !cookie.name || !cookie.value) continue;
    if (!isBilibiliCookieDomain(cookie.domain)) continue;
    map.set(cookie.name, cookie.value);
  }
  return map;
}

function buildCookieHeaderText(cookieMap) {
  const names = Array.from(cookieMap.keys());
  names.sort((a, b) => {
    const ai = BILIBILI_COOKIE_PRIORITY_KEYS.indexOf(a);
    const bi = BILIBILI_COOKIE_PRIORITY_KEYS.indexOf(b);
    const rankA = ai === -1 ? 999 : ai;
    const rankB = bi === -1 ? 999 : bi;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
  return names
    .map((name) => `${name}=${cookieMap.get(name)}`)
    .filter(Boolean)
    .join("; ");
}

async function getBilibiliCookieSnapshot(targetSession = session.defaultSession) {
  const cookies = await targetSession.cookies.get({});
  const cookieMap = extractBilibiliCookieMap(cookies);
  const cookieKeys = Array.from(cookieMap.keys());
  const cookie = buildCookieHeaderText(cookieMap);
  const hasRequired = BILIBILI_COOKIE_REQUIRED_KEYS.every((key) => cookieMap.has(key));
  return {
    cookie,
    cookieKeys,
    hasRequired,
  };
}

function createBilibiliLoginWindow() {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined;
  const loginWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 900,
    minHeight: 680,
    autoHideMenuBar: true,
    parent,
    modal: false,
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loginWindow.once("ready-to-show", () => loginWindow.show());
  loginWindow.loadURL(BILIBILI_LOGIN_URL);
  return loginWindow;
}

function runBilibiliLoginFlow() {
  return new Promise((resolve, reject) => {
    const loginWindow = createBilibiliLoginWindow();
    const loginSession = loginWindow.webContents.session || session.defaultSession;

    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (!loginWindow.isDestroyed()) {
        loginWindow.destroy();
      }
    };

    const resolveOnce = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const rejectOnce = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const checkCookie = async () => {
      if (settled) return;
      try {
        const snapshot = await getBilibiliCookieSnapshot(loginSession);
        if (!snapshot.hasRequired || !snapshot.cookie) return;
        log(`[bili-login] success with keys=${snapshot.cookieKeys.join(",")}`);
        resolveOnce({
          cookie: snapshot.cookie,
          cookieKeys: snapshot.cookieKeys,
          source: "electron-login-window",
        });
      } catch (err) {
        log(`[bili-login] cookie check failed: ${err && err.message ? err.message : String(err)}`);
      }
    };

    loginWindow.on("closed", () => {
      if (settled) return;
      rejectOnce("登录窗口已关闭，未检测到有效 Cookie。");
    });

    loginWindow.webContents.on("did-finish-load", () => {
      checkCookie();
    });
    loginWindow.webContents.on("did-navigate", () => {
      checkCookie();
    });
    loginWindow.webContents.on("did-redirect-navigation", () => {
      checkCookie();
    });

    pollTimer = setInterval(checkCookie, 1200);
    timeoutTimer = setTimeout(() => {
      rejectOnce("登录超时（4分钟），请重试。");
    }, BILIBILI_LOGIN_TIMEOUT_MS);

    checkCookie();
  });
}

async function clearBilibiliCookies(targetSession = session.defaultSession) {
  const cookies = await targetSession.cookies.get({});
  const targets = cookies.filter((cookie) => isBilibiliCookieDomain(cookie.domain));
  for (const cookie of targets) {
    const protocol = cookie.secure ? "https://" : "http://";
    const domain = normalizeCookieDomain(cookie.domain);
    const cookiePath = cookie.path || "/";
    const url = `${protocol}${domain}${cookiePath}`;
    try {
      await targetSession.cookies.remove(url, cookie.name);
    } catch (err) {
      log(`[bili-cookie] remove failed name=${cookie.name} domain=${cookie.domain}: ${err.message}`);
    }
  }
  const snapshot = await getBilibiliCookieSnapshot(targetSession);
  return {
    removed: targets.length,
    hasRequired: snapshot.hasRequired,
  };
}

ipcMain.handle("pick-download-dir", async () => {
  const target = BrowserWindow.getFocusedWindow() || undefined;
  const result = await dialog.showOpenDialog(target, {
    title: "选择下载目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("get-bili-cookie-snapshot", async () => {
  return getBilibiliCookieSnapshot(session.defaultSession);
});

ipcMain.handle("clear-bili-cookies", async () => {
  return clearBilibiliCookies(session.defaultSession);
});

ipcMain.handle("bili-login-cookie", async () => {
  if (!activeBilibiliLoginPromise) {
    activeBilibiliLoginPromise = runBilibiliLoginFlow().finally(() => {
      activeBilibiliLoginPromise = null;
    });
  }
  return activeBilibiliLoginPromise;
});

async function boot() {
  log("boot()");
  startServer();
  const ready = await waitServerReady(30000);
  if (!ready) {
    log("health timeout");
    dialog.showErrorBox("启动失败", "内置服务启动超时（30秒）。");
    app.quit();
    return;
  }
  log("health ready");
  createWindow();
}

app.on("before-quit", () => {
  stopServer();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(boot).catch((err) => {
  log(`boot error: ${err && err.message ? err.message : String(err)}`);
  dialog.showErrorBox("启动失败", err && err.message ? err.message : "未知错误");
  app.quit();
});
