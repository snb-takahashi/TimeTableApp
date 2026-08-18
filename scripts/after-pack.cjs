// electron-builder's extraResources copying silently drops node_modules
// even with an explicit filter, so we copy it ourselves after packaging.
const fs = require("fs");
const path = require("path");

module.exports = async function (context) {
  const projectDir = context.packager.info.projectDir;
  const src = path.join(projectDir, ".next", "standalone", "node_modules");
  const dest = path.join(context.appOutDir, "resources", "app", "node_modules");

  if (!fs.existsSync(src)) {
    throw new Error(`afterPack: standalone node_modules not found at ${src}`);
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`afterPack: copied node_modules -> ${dest}`);
};
