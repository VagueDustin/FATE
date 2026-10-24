'use strict';
/**
 * storeRecovery.cjs: open the settings store even when config.json does not parse.
 *
 * Up to 1.15.0 main.cjs called `new Store()` at module load, and a config.json left empty or
 * truncated (a crash or power cut part-way through a write; under snap, conf writes in place, not
 * atomically) threw a SyntaxError before any window existed, on every launch. FATE could not
 * start again until someone deleted the file by hand.
 *
 * Free of Electron imports; test/storeRecovery.test.cjs runs it under plain node.
 */
const fs = require('fs');

/**
 * `new Store(options)`, or, when `file` does not parse, a store started on its defaults with the
 * bad file renamed beside it (`config.json.corrupt-<time>`), kept for whoever wants to look.
 *
 * `recover: false` rethrows instead. That is for a second instance, which only hands its files
 * to the running FATE and quits: what it reads may be a write the running FATE has half done, and
 * recovering would replace that FATE's settings with the defaults.
 */
function openStore(Store, file, options, { recover = true, now = Date.now, warn = console.warn } = {}) {
  try {
    return new Store(options);
  } catch (err) {
    if (!(err instanceof SyntaxError) || !recover) throw err;
    try {
      fs.renameSync(file, `${file}.corrupt-${now()}`);
    } catch {
      /* already gone, or unmovable: clearInvalidConfig rewrites it either way */
    }
    warn(`Settings file did not parse and was set aside: ${err.message}`);
    return new Store({ ...options, clearInvalidConfig: true });
  }
}

module.exports = { openStore };
