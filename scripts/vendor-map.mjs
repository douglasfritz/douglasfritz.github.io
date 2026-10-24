// Copies the pinned map libraries (package.json devDependencies) from
// node_modules into assets/vendor/, where they are committed and served from
// the site itself: the talk map loads no third-party script.
//
//   npm ci && npm run vendor:map
//
// Run it after changing either version in package.json, then commit
// assets/vendor/. tests/js/vendor-map.test.mjs checks that the committed copies
// match the installed, pinned packages.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
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

function vendor() {
  for (const [name, files] of Object.entries(VENDOR_FILES)) {
    const target = path.join(root, "assets", "vendor", name);
    rmSync(target, { recursive: true, force: true });
    for (const [from, to] of Object.entries(files)) {
      const destination = path.join(target, to);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(root, "node_modules", name, from), destination);
    }
    process.stdout.write(`Copied ${Object.keys(files).length} files to assets/vendor/${name}/\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) vendor();
