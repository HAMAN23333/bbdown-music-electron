const fs = require("fs");
const path = require("path");

class ToolResolver {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  resolvePath(...parts) {
    return path.join(this.rootDir, ...parts);
  }

  exists(filePath) {
    return fs.existsSync(filePath);
  }
}

module.exports = {
  ToolResolver,
};
