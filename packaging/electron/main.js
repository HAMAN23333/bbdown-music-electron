"use strict";

const path = require("path");
const http = require("http");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const HOST = "127.0.0.1";
const PORT = 5050;
const HEALTH_URL = `http://${HOST}:${PORT}/api/health`;
const APP_URL = `http://${HOST}:${PORT}`;

const LOG_FILE = path.join(__dirname, "electron-launcher.log");

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
