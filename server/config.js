const path = require("path");
const os = require("os");

const HOST = "127.0.0.1";
const PORT = 5050;
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const NEXT_OUT_DIR = path.join(ROOT_DIR, "out");
const DEFAULT_OUTPUT_DIR = os.homedir();

const TOOLS_DIR = path.join(ROOT_DIR, "tools");
const BBDOWN_DIR = path.join(TOOLS_DIR, "bbdown");
const BBDOWN_BIN_NAME = process.platform === "win32" ? "BBDown.exe" : "BBDown";
const BBDOWN_BIN_PATH = path.join(BBDOWN_DIR, BBDOWN_BIN_NAME);
const FFMPEG_DIR = path.join(TOOLS_DIR, "ffmpeg");
const FFMPEG_BIN_NAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const FFMPEG_BIN_PATH = path.join(FFMPEG_DIR, FFMPEG_BIN_NAME);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

module.exports = {
  HOST,
  PORT,
  ROOT_DIR,
  PUBLIC_DIR,
  NEXT_OUT_DIR,
  DEFAULT_OUTPUT_DIR,
  TOOLS_DIR,
  BBDOWN_DIR,
  BBDOWN_BIN_PATH,
  FFMPEG_DIR,
  FFMPEG_BIN_PATH,
  USER_AGENT,
};
