// Copies the pinned map libraries (package.json devDependencies) from
// node_modules into assets/vendor/, where they are committed and served from
// the site itself: the talk map loads no third-party script.
//
//   npm ci && npm run vendor:map
//
// Run it after changing either version in package.json, then commit
// assets/vendor/. tests/js/vendor-map.test.mjs checks that the committed copies
// match the installed, pinned packages and are not executable.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Package name -> files to copy (source path in the package -> path in
// assets/vendor/<package>/): what the talk page loads, the images Leaflet's
// CSS refers to (so that no request 404s) and each licence. Source maps are
// left out: they do not embed their sources, and only developer tools ask
// for them.
export const VENDOR_FILES = {
  leaflet: {
    "dist/leaflet.js": "leaflet.js",
    "dist/leaflet.css": "leaflet.css",
    "dist/images/layers.png": "images/layers.png",
    "dist/images/layers-2x.png": "images/layers-2x.png",
    "dist/images/marker-icon.png": "images/marker-icon.png",
    "dist/images/marker-icon-2x.png": "images/marker-icon-2x.png",
    "dist/images/marker-shadow.png": "images/marker-shadow.png",
    LICENSE: "LICENSE"
  },
  "leaflet.markercluster": {
    "dist/leaflet.markercluster.js": "leaflet.markercluster.js",
    "dist/MarkerCluster.css": "MarkerCluster.css",
    "MIT-LICENCE.txt": "MIT-LICENCE.txt"
  }
};

// Files 0644 and directories 0755, whatever the package or umask had: the
// committed copies are data, never executables.
function normalizeModes(directory) {
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeModes(entryPath);
    else chmodSync(entryPath, 0o644);
  }
}

// Copies each package's files into assets/vendor/<package>/. Each package is
// copied into a new temporary directory beside its target first and then
// swapped in, so that a failed copy (a missing file, say) leaves the
// committed copy as it was, never half deleted. `from` is the directory that
// holds node_modules/, `to` the vendor directory.
export function vendor({ files = VENDOR_FILES, from = path.join(root, "node_modules"), to = path.join(root, "assets", "vendor"), log = (line) => process.stdout.write(line) } = {}) {
  mkdirSync(to, { recursive: true });
  for (const [name, list] of Object.entries(files)) {
    const target = path.join(to, name);
    const staging = mkdtempSync(path.join(to, `.${name}-new-`));
    try {
      for (const [source, destination] of Object.entries(list)) {
        mkdirSync(path.dirname(path.join(staging, destination)), { recursive: true });
        copyFileSync(path.join(from, name, source), path.join(staging, destination));
      }
      normalizeModes(staging);
      const previous = existsSync(target) ? `${staging}-previous` : null;
      if (previous) renameSync(target, previous);
      try {
        renameSync(staging, target);
      } catch (error) {
        if (previous) renameSync(previous, target);
        throw error;
      }
      if (previous) rmSync(previous, { recursive: true, force: true });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    log(`Copied ${Object.keys(list).length} files to ${path.relative(root, target)}/\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) vendor();
