const fs = require('node:fs/promises');
const path = require('node:path');

const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak']);
const DROP_FILES = new Set(['LICENSES.chromium.html']);

// electron-builder calls this after the app dir is prepared and before the
// portable archive is compressed, so anything removed here is not packed.
module.exports = async function afterPack(context) {
  const outDir = context.appOutDir;
  const removed = [];

  for (const name of await fs.readdir(outDir).catch(() => [])) {
    if (DROP_FILES.has(name)) {
      await fs.rm(path.join(outDir, name), { force: true });
      removed.push(name);
    }
  }

  const localesDir = path.join(outDir, 'locales');
  for (const name of await fs.readdir(localesDir).catch(() => [])) {
    if (!KEEP_LOCALES.has(name)) {
      await fs.rm(path.join(localesDir, name), { force: true, recursive: true });
      removed.push('locales/' + name);
    }
  }

  if (removed.length) {
    console.log(`[after-pack] removed ${removed.length} item(s) from ${outDir}`);
  }
};
