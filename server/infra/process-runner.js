const { spawn } = require("child_process");

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

class ProcessRunner {
  async run(options) {
    const {
      command,
      args,
      cwd,
      env,
      windowsHide = true,
      epremHint = "",
      startErrorPrefix,
      exitErrorPrefix,
      lineLimit = 200,
    } = options;

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(command, Array.isArray(args) ? args : [], {
          cwd,
          env,
          windowsHide,
        });
      } catch (err) {
        reject(new Error(this.#formatStartError(startErrorPrefix, err, epremHint)));
        return;
      }

      const lines = [];
      const onData = (buf) => {
        const chunks = splitLines(buf);
        for (const line of chunks) {
          lines.push(line);
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      child.on("error", (err) => {
        reject(new Error(this.#formatStartError(startErrorPrefix, err, epremHint)));
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({
            code,
            lines: lineLimit > 0 ? lines.slice(Math.max(0, lines.length - lineLimit)) : lines,
          });
          return;
        }
        const clue = lines.slice(Math.max(0, lines.length - 8)).join(" | ");
        const reason = clue ? `: ${clue}` : "";
        reject(new Error(`${exitErrorPrefix} ${code}${reason}`));
      });
    });
  }

  #formatStartError(prefix, err, epremHint) {
    const hint = err && err.code === "EPERM" && epremHint ? epremHint : "";
    const message = err && err.message ? err.message : "unknown";
    return `${prefix}: ${message}${hint}`;
  }
}

module.exports = {
  ProcessRunner,
};
