"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopMeta", {
  platform: process.platform,
  app: "BBDownMusicApp",
});

contextBridge.exposeInMainWorld("desktopApi", {
  pickDownloadDirectory: () => ipcRenderer.invoke("pick-download-dir"),
  bilibiliLoginAndGetCookie: () => ipcRenderer.invoke("bili-login-cookie"),
  getBilibiliCookieSnapshot: () => ipcRenderer.invoke("get-bili-cookie-snapshot"),
  clearBilibiliCookies: () => ipcRenderer.invoke("clear-bili-cookies"),
});
