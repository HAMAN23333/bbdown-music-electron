const fs = require("fs");
const path = require("path");

const { tail, ensureDir } = require("../utils/common");

const AUDIO_DISCOVER_EXTS = new Set([".m4a", ".mp3", ".aac", ".flac", ".wav", ".ogg", ".opus", ".mka", ".webm"]);

class AudioDownloadService {
  constructor({ processRunner, rootDir }) {
    this.processRunner = processRunner;
    this.rootDir = rootDir;
  }

  async runBbdown({ videoUrl, workDir, bbdownPath, cookie, ffmpegPath }) {
    ensureDir(fs, workDir);

    const args = [videoUrl, "--audio-only", "--work-dir", workDir, "--skip-cover", "--skip-subtitle"];
    if (ffmpegPath) {
      args.push("--ffmpeg-path", ffmpegPath);
    }
    if (cookie) {
      args.push("-c", cookie);
    }

    const env = { ...process.env };
    delete env.ALL_PROXY;
    delete env.all_proxy;
    delete env.HTTP_PROXY;
    delete env.http_proxy;
    delete env.HTTPS_PROXY;
    delete env.https_proxy;

    return this.processRunner.run({
      command: bbdownPath,
      args,
      cwd: this.rootDir,
      env,
      windowsHide: true,
      epremHint: "（当前环境禁止 Node 启动子进程，请在本机终端直接运行）",
      startErrorPrefix: "无法启动 BBDown",
      exitErrorPrefix: "BBDown 退出码",
      lineLimit: 40,
    });
  }

  async finalizeDownloadedAudio({ workDir, outputDir, audioFormat, audioBitrateKbps, ffmpegPath }) {
    ensureDir(fs, outputDir);
    const sourceFiles = this.discoverDownloadedAudioFiles(workDir);
    if (sourceFiles.length === 0) {
      throw new Error("BBDown 下载完成但未在临时目录找到音频文件");
    }

    const outputFiles = [];
    const lines = [];
    lines.push(`[post] 检测到 ${sourceFiles.length} 个源音频文件，目标格式=${audioFormat}`);

    for (const sourceFile of sourceFiles) {
      const sourceExt = path.extname(sourceFile).toLowerCase() || ".m4a";
      const sourceBase = path.basename(sourceFile, path.extname(sourceFile));

      if (audioFormat === "original") {
        const outPath = ensureUniqueOutputPath(outputDir, sourceBase, sourceExt);
        moveFileSafe(sourceFile, outPath);
        outputFiles.push(outPath);
        lines.push(`[post] 保留原始格式: ${path.basename(outPath)}`);
        continue;
      }

      if (!ffmpegPath) {
        throw new Error("当前输出格式需要 FFmpeg，但未配置 ffmpeg 路径");
      }

      const outPath = ensureUniqueOutputPath(outputDir, sourceBase, `.${audioFormat}`);
      const ffmpegResult = await this.runFfmpegTranscode({
        inputPath: sourceFile,
        outputPath: outPath,
        audioFormat,
        audioBitrateKbps,
        ffmpegPath,
      });
      outputFiles.push(outPath);
      lines.push(`[post] 转码输出: ${path.basename(outPath)}`);
      lines.push(...ffmpegResult.lines);
    }

    return { outputFiles, lines: tail(lines, 60) };
  }

  discoverDownloadedAudioFiles(rootDir) {
    if (!fs.existsSync(rootDir)) return [];
    const allFiles = walkFilesRecursive(rootDir);
    const found = allFiles.filter((filePath) => AUDIO_DISCOVER_EXTS.has(path.extname(filePath).toLowerCase()));
    found.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });
    return found;
  }

  cleanupSongWorkDir(workDir) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  async runFfmpegTranscode({ inputPath, outputPath, audioFormat, audioBitrateKbps, ffmpegPath }) {
    const args = buildFfmpegTranscodeArgs({ inputPath, outputPath, audioFormat, audioBitrateKbps });
    return this.processRunner.run({
      command: ffmpegPath,
      args,
      cwd: this.rootDir,
      windowsHide: true,
      startErrorPrefix: "无法启动 FFmpeg",
      exitErrorPrefix: "FFmpeg 退出码",
      lineLimit: 20,
    });
  }
}

function walkFilesRecursive(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function moveFileSafe(srcPath, dstPath) {
  try {
    fs.renameSync(srcPath, dstPath);
  } catch (err) {
    if (err && err.code === "EXDEV") {
      fs.copyFileSync(srcPath, dstPath);
      fs.unlinkSync(srcPath);
      return;
    }
    throw err;
  }
}

function buildFfmpegTranscodeArgs({ inputPath, outputPath, audioFormat, audioBitrateKbps }) {
  const bitrateText = `${audioBitrateKbps}k`;
  const args = ["-hide_banner", "-nostdin", "-y", "-i", inputPath, "-vn"];

  switch (audioFormat) {
    case "mp3":
      args.push("-codec:a", "libmp3lame", "-b:a", bitrateText);
      break;
    case "m4a":
      args.push("-codec:a", "aac", "-b:a", bitrateText);
      break;
    case "aac":
      args.push("-codec:a", "aac", "-b:a", bitrateText);
      break;
    case "flac":
      args.push("-codec:a", "flac");
      break;
    case "wav":
      args.push("-codec:a", "pcm_s16le");
      break;
    case "ogg":
      args.push("-codec:a", "libvorbis", "-b:a", bitrateText);
      break;
    case "opus":
      args.push("-codec:a", "libopus", "-b:a", bitrateText);
      break;
    default:
      throw new Error(`不支持的输出格式: ${audioFormat}`);
  }

  args.push("-map_metadata", "0", outputPath);
  return args;
}

function ensureUniqueOutputPath(outputDir, baseName, extension) {
  const safeBase = sanitizeFileStem(baseName);
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  let candidate = path.join(outputDir, `${safeBase}${safeExt}`);
  let idx = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${safeBase} (${idx})${safeExt}`);
    idx += 1;
  }
  return candidate;
}

function sanitizeFileStem(baseName) {
  const text = String(baseName || "").trim();
  const replaced = text.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ");
  return replaced || "audio";
}

module.exports = {
  AudioDownloadService,
};
