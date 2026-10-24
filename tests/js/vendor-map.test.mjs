// The talk map's libraries are served from assets/vendor/ (committed copies,
// made by `npm run vendor:map`). These tests check that every vendored file
// exists, that the copies are the pinned packages from package.json, and that
// the site config ships them.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VENDOR_FILES, vendor } from "../../scripts/vendor-map.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (...parts) => readFileSync(path.join(root, ...parts));
const pinned = JSON.parse(read("package.json")).devDependencies;

test("the map libraries are exact-pinned devDependencies", () => {
  assert.deepEqual(Object.keys(VENDOR_FILES).sort(), ["leaflet", "leaflet.markercluster"]);
  for (const name of Object.keys(VENDOR_FILES)) {
    assert.match(pinned[name] ?? "", /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version`);
  }
});

test("every vendored file exists, including the licences and Leaflet's images", () => {
  const expected = [
    "leaflet/leaflet.js", "leaflet/leaflet.css", "leaflet/LICENSE",
    "leaflet/images/layers.png", "leaflet/images/layers-2x.png",
    "leaflet/images/marker-icon.png", "leaflet/images/marker-icon-2x.png", "leaflet/images/marker-shadow.png",
    "leaflet.markercluster/leaflet.markercluster.js", "leaflet.markercluster/MarkerCluster.css",
    "leaflet.markercluster/MIT-LICENCE.txt"
  ];
  const listed = Object.entries(VENDOR_FILES).flatMap(([name, files]) => Object.values(files).map((file) => `${name}/${file}`));
  assert.deepEqual(listed.sort(), [...expected].sort());
  for (const file of expected) {
    assert.ok(existsSync(path.join(root, "assets", "vendor", file)), `assets/vendor/${file} exists`);
    assert.ok(read("assets", "vendor", file).length > 0, `assets/vendor/${file} is not empty`);
  }
  // Every image the vendored Leaflet CSS refers to is vendored too.
  const css = read("assets", "vendor", "leaflet", "leaflet.css").toString("utf8");
  const images = [...css.matchAll(/url\((images\/[^)]+)\)/g)].map((match) => match[1]);
  assert.ok(images.length > 0);
  for (const image of images) assert.ok(existsSync(path.join(root, "assets", "vendor", "leaflet", image)), image);
});

test("the vendored Leaflet's version banner matches package.json", () => {
  const banner = read("assets", "vendor", "leaflet", "leaflet.js").toString("utf8").slice(0, 200);
  const match = /\* Leaflet (\d+\.\d+\.\d+),/.exec(banner);
  assert.ok(match, "leaflet.js starts with its version banner");
  assert.equal(match[1], pinned.leaflet);
});

test("the vendored files are byte-identical to the installed, pinned packages", () => {
  for (const [name, files] of Object.entries(VENDOR_FILES)) {
    const installed = JSON.parse(read("node_modules", name, "package.json")).version;
    assert.equal(installed, pinned[name], `node_modules/${name} is the pinned version (run npm ci)`);
    for (const [from, to] of Object.entries(files)) {
      assert.ok(read("node_modules", name, from).equals(read("assets", "vendor", name, to)),
        `assets/vendor/${name}/${to} differs from the package; run npm run vendor:map`);
    }
  }
});

test("the site config publishes the vendored files and the map data", () => {
  const config = read("_quarto.yml").toString("utf8");
  assert.match(config, /^\s*- "assets\/vendor\/\*\*"\s*$/m);
  assert.match(config, /^\s*- "data\/generated\/talks\.geojson"\s*$/m);
  // Only the GeoJSON among the generated files is published.
  assert.equal(/data\/generated\/(?!talks\.geojson")/.test(config), false);
});

// Every file under `directory`, recursively.
const filesUnder = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
  entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]
));

test("the vendored files are not executable (mode 644)", () => {
  const files = filesUnder(path.join(root, "assets", "vendor"));
  assert.equal(files.length, Object.values(VENDOR_FILES).reduce((sum, list) => sum + Object.keys(list).length, 0));
  for (const file of files) assert.equal(statSync(file).mode & 0o777, 0o644, path.relative(root, file));
});

test("vendoring swaps in a complete copy with mode 644, or leaves the old copy untouched", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "vendor-map-"));
  try {
    const from = path.join(scratch, "node_modules");
    const to = path.join(scratch, "vendor");
    mkdirSync(path.join(from, "lib", "dist", "images"), { recursive: true });
    writeFileSync(path.join(from, "lib", "dist", "lib.js"), "new script");
    writeFileSync(path.join(from, "lib", "dist", "images", "icon.png"), "new image", { mode: 0o755 });
    mkdirSync(path.join(to, "lib"), { recursive: true });
    writeFileSync(path.join(to, "lib", "lib.js"), "old script");
    writeFileSync(path.join(to, "lib", "stale.txt"), "a file the new copy no longer has");
    const quiet = { from, to, log: () => {} };

    // A missing source file: the old copy stays as it was, and no temporary
    // directory is left behind.
    assert.throws(() => vendor({ ...quiet, files: { lib: { "dist/lib.js": "lib.js", "dist/missing.js": "missing.js" } } }), /ENOENT/);
    assert.deepEqual(readdirSync(to), ["lib"]);
    assert.deepEqual(readdirSync(path.join(to, "lib")).sort(), ["lib.js", "stale.txt"]);
    assert.equal(readFileSync(path.join(to, "lib", "lib.js"), "utf8"), "old script");

    // A complete copy replaces the old one (stale files go) with fixed modes.
    vendor({ ...quiet, files: { lib: { "dist/lib.js": "lib.js", "dist/images/icon.png": "images/icon.png" } } });
    assert.deepEqual(readdirSync(to), ["lib"]);
    assert.deepEqual(filesUnder(path.join(to, "lib")).map((file) => path.relative(path.join(to, "lib"), file)).sort(), ["images/icon.png", "lib.js"]);
    assert.equal(readFileSync(path.join(to, "lib", "lib.js"), "utf8"), "new script");
    for (const file of filesUnder(path.join(to, "lib"))) assert.equal(statSync(file).mode & 0o777, 0o644, file);
    assert.equal(statSync(path.join(to, "lib", "images")).mode & 0o777, 0o755);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
