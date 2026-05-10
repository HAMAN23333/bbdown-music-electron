class BinaryManager {
  constructor({ toolResolver, platform }) {
    this.toolResolver = toolResolver;
    this.platform = platform;
  }

  resolveBbdownPath() {
    const binName = this.platform === "win32" ? "BBDown.exe" : "BBDown";
    const target = this.toolResolver.resolvePath("tools", "bbdown", binName);
    if (this.toolResolver.exists(target)) {
      return target;
    }
    const setupHint =
      this.platform === "win32"
        ? "请执行 scripts\\setup-bbdown.ps1 下载项目内置 BBDown"
        : "请将 BBDown 可执行文件放到 tools/bbdown 目录";
    throw new Error(`项目内置 BBDown 不存在: ${target}。${setupHint}`);
  }

  resolveFfmpegPath() {
    const binName = this.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const target = this.toolResolver.resolvePath("tools", "ffmpeg", binName);
    if (this.toolResolver.exists(target)) {
      return target;
    }
    const setupHint =
      this.platform === "win32"
        ? "请执行 scripts\\setup-ffmpeg.ps1 下载项目内置 FFmpeg"
        : "请将 ffmpeg 可执行文件放到 tools/ffmpeg 目录";
    throw new Error(`项目内置 FFmpeg 不存在: ${target}。${setupHint}`);
  }
}

module.exports = {
  BinaryManager,
};
