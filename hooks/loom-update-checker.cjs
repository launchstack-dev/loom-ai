// loom-update-checker.cjs — Background update check for Loom
// Spawned as a detached process by the statusline renderer.
// Fetches library.yaml from GitHub, compares catalog_version with local copy.
// Writes results to ~/.cache/loom/update-check.toon
// Always exits 0. All errors caught.

const fs = require('fs');
const https = require('https');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CACHE_DIR = path.join(os.homedir(), '.cache', 'loom');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.toon');
const LOG_FILE = path.join(CACHE_DIR, 'update-checker.log');
const LOCAL_CATALOG = path.join(os.homedir(), '.claude', 'skills', 'library', 'library.yaml');
const REMOTE_URL = 'https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/skills/library.yaml';
const THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours

function log(msg) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

function main() {
  try {
    // Check throttle
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      const lastChecked = toonGet(content, 'lastChecked');
      if (lastChecked) {
        const elapsed = Date.now() - new Date(lastChecked).getTime();
        if (!isNaN(elapsed) && elapsed < THROTTLE_MS) {
          process.exit(0);
        }
      }
    }

    // Read local catalog_version
    let localVersion = 0;
    try {
      const local = fs.readFileSync(LOCAL_CATALOG, 'utf-8');
      const v = local.match(/^catalog_version:\s*(\d+)/m);
      if (v) localVersion = parseInt(v[1], 10);
    } catch (e) {
      if (e.code !== 'ENOENT') log(`local catalog: ${e.code || e.message}`);
    }

    // Fetch remote catalog_version
    fetchText(REMOTE_URL, 3000, (err, body) => {
      try {
        let remoteVersion = localVersion;
        let updateAvailable = false;

        if (!err && body) {
          const v = body.match(/^catalog_version:\s*(\d+)/m);
          if (v) remoteVersion = parseInt(v[1], 10);
          updateAvailable = remoteVersion > localVersion;
        } else {
          // Fetch failed — don't update cache so we retry sooner
          if (err) log(`fetch: ${err.message}`);
          process.exit(0);
          return;
        }

        // Ensure cache dir exists
        fs.mkdirSync(CACHE_DIR, { recursive: true });

        // Write cache (atomic: write tmp, rename)
        const now = new Date().toISOString();
        const toon = [
          `lastChecked: ${now}`,
          `localVersion: ${localVersion}`,
          `remoteVersion: ${remoteVersion}`,
          `updateAvailable: ${updateAvailable}`,
        ].join('\n') + '\n';

        const tmp = CACHE_FILE + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
        fs.writeFileSync(tmp, toon);
        fs.renameSync(tmp, CACHE_FILE);
      } catch (e) {
        log(`cache write: ${e.code || e.message}`);
        try { fs.unlinkSync(tmp); } catch {}
      }
      process.exit(0);
    });
  } catch (e) {
    log(e.message);
    process.exit(0);
  }
}

function fetchText(url, timeoutMs, cb) {
  let done = false;
  function finish(err, data) {
    if (done) return;
    done = true;
    cb(err, data);
  }
  const req = https.get(url, { timeout: timeoutMs }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return finish(new Error(`HTTP ${res.statusCode}`));
    }
    let data = '';
    res.setEncoding('utf-8');
    res.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) {
        res.destroy();
        finish(null, data);
      }
    });
    res.on('end', () => finish(null, data));
    res.on('error', (e) => finish(e));
  });
  req.on('timeout', () => { req.destroy(); finish(new Error('timeout')); });
  req.on('error', (e) => finish(e));
}

function toonGet(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = content.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

main();
