// Pure logic of the talk map (js/map-state.js): which talks get markers, how
// markers and popups describe a talk, bounds and the coverage note.
import test from "node:test";
import assert from "node:assert/strict";
import {
  boundsOf,
  clusterModel,
  coverageText,
  locationKey,
  markerModel,
  pillarNumber,
  popupModel,
  readTalkFeatures,
  visibleMappableKeys
} from "../../js/map-state.js";

const PILLARS = ["P one", "P two", "P three", "P four"];

const feature = (key, properties = {}, coordinates = [45.6789, 12.3456]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: {
    key,
    title: `Title of ${key}`,
    organization: "Example University",
    location: "Sampleton, North Example, Exampleland",
    virtual_status: "N",
    primary_pillar: "P one",
    year: 2025,
    ...properties
  }
});

test("unmappable archive keys cannot become marker keys", () => {
  const features = [{ properties: { key: "mapped" } }];
  assert.deepEqual(visibleMappableKeys(features, ["mapped", "unmapped"]), ["mapped"]);
});

test("marker keys are the visible keys that have a feature, sorted and without duplicates", () => {
  const features = [feature("talk-b"), feature("talk-a"), feature("talk-c"), feature("talk-a")];
  assert.deepEqual(visibleMappableKeys(features, ["talk-c", "talk-a", "talk-x", "talk-a"]), ["talk-a", "talk-c"]);
  assert.deepEqual(visibleMappableKeys(features, new Set(["talk-b"])), ["talk-b"]);
  // Sorted, whatever the order of the features or the listed keys.
  assert.deepEqual(visibleMappableKeys([feature("talk-c"), feature("talk-b"), feature("talk-a")], ["talk-b", "talk-c", "talk-a"]), ["talk-a", "talk-b", "talk-c"]);
  assert.deepEqual(visibleMappableKeys(features, []), []);
  assert.deepEqual(visibleMappableKeys([], ["talk-a"]), []);
  // Keys are compared exactly.
  assert.deepEqual(visibleMappableKeys(features, ["TALK-A", " talk-a"]), []);
});

test("readTalkFeatures keeps valid point features once per key and rejects non-collections", () => {
  const good = feature("talk-1");
  const virtual = feature("talk-2", { virtual_status: "Y" }, [151.1111, -33.3333]);
  const collection = {
    type: "FeatureCollection",
    features: [
      good,
      virtual,
      feature("talk-1", { title: "Duplicate key" }),
      feature("bad-lat", {}, [10, 91]),
      feature("bad-lon", {}, [-181, 10]),
      feature("bad-number", {}, ["10", 10]),
      feature("short", {}, [10]),
      { ...feature("not-point"), geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { ...feature("no-key"), properties: { ...good.properties, key: "" } },
      { ...feature("no-title"), properties: { ...good.properties, key: "no-title", title: 7 } },
      null,
      "text"
    ]
  };
  const read = readTalkFeatures(collection);
  assert.deepEqual(read.map((f) => f.properties.key), ["talk-1", "talk-2"]);
  assert.equal(read[0], good);
  assert.deepEqual(readTalkFeatures({ type: "FeatureCollection", features: [] }), []);
  for (const bad of [null, undefined, "x", [], {}, { type: "Feature" }, { type: "FeatureCollection" }, { type: "FeatureCollection", features: {} }]) {
    assert.throws(() => readTalkFeatures(bad), TypeError, JSON.stringify(bad));
  }
});

test("pillarNumber follows the canonical order; unknown pillars get 0", () => {
  assert.deepEqual(PILLARS.map((name) => pillarNumber(name, PILLARS)), [1, 2, 3, 4]);
  assert.equal(pillarNumber("P five", PILLARS), 0);
  assert.equal(pillarNumber("p one", PILLARS), 0);
  assert.equal(pillarNumber(undefined, PILLARS), 0);
});

test("an in-person marker shows its pillar number and names the talk and host", () => {
  const model = markerModel(feature("talk-1", { primary_pillar: "P three" }), PILLARS);
  assert.deepEqual(model, {
    key: "talk-1",
    number: 3,
    virtual: false,
    className: "talk-marker talk-marker-p3 talk-marker-in-person",
    text: "3",
    label: "Title of talk-1. In person: Example University, Sampleton, North Example, Exampleland. Pillar 3."
  });
});

test("a virtual marker has its own shape class and says Virtual and hosted by", () => {
  const model = markerModel(feature("talk-2", { virtual_status: "Y", primary_pillar: "P two" }), PILLARS);
  assert.equal(model.virtual, true);
  assert.equal(model.className, "talk-marker talk-marker-p2 talk-marker-virtual");
  assert.equal(model.text, "2");
  assert.equal(model.label, "Title of talk-2. Virtual, hosted by Example University, Sampleton, North Example, Exampleland. Pillar 2.");
  // Only exact "Y" is virtual.
  assert.equal(markerModel(feature("talk-3", { virtual_status: "y" }), PILLARS).virtual, false);
});

test("a marker without location text or a known pillar still describes itself", () => {
  const { location, ...rest } = feature("talk-9").properties;
  assert.equal(location, "Sampleton, North Example, Exampleland");
  const model = markerModel({ ...feature("talk-9"), properties: { ...rest, primary_pillar: "P five" } }, PILLARS);
  assert.equal(model.number, 0);
  assert.equal(model.text, "?");
  assert.equal(model.className, "talk-marker talk-marker-p0 talk-marker-in-person");
  assert.equal(model.label, "Title of talk-9. In person: Example University.");
});

test("cluster labels say how many talks are grouped", () => {
  assert.deepEqual(clusterModel(2), {
    className: "talk-cluster",
    text: "2",
    label: "2 talks at the same or nearby locations. Select to zoom in or spread them out."
  });
  assert.equal(clusterModel(12).text, "12");
});

test("talks share a popup only when coordinates and location text match", () => {
  const a = feature("a");
  assert.equal(locationKey(a), locationKey(feature("b", { virtual_status: "Y", primary_pillar: "P four" })));
  assert.notEqual(locationKey(a), locationKey(feature("c", { location: "Sampleton, Exampleland" })));
  assert.notEqual(locationKey(a), locationKey(feature("d", {}, [45.6789, 12.3457])));
  const { location, ...rest } = a.properties;
  assert.ok(location);
  assert.notEqual(locationKey(a), locationKey({ ...a, properties: rest }));
});

test("an in-person popup names the event location and each talk's host and year", () => {
  const model = popupModel([feature("talk-1")]);
  assert.deepEqual(model, {
    label: "Event location: Sampleton, North Example, Exampleland",
    placeLabel: "Event location",
    place: "Sampleton, North Example, Exampleland",
    note: null,
    talks: [{ key: "talk-1", title: "Title of talk-1", badge: null, meta: "In person · Example University · 2025" }]
  });
});

test("a virtual popup says Virtual and Hosted by and never suggests travel", () => {
  const model = popupModel([feature("talk-2", { virtual_status: "Y", organization: "Example Institute of Health", year: 2024 })]);
  assert.equal(model.placeLabel, "Host location");
  assert.equal(model.label, "Host location: Sampleton, North Example, Exampleland");
  assert.equal(model.note, "Virtual talks are shown at their host's location; they did not involve travel.");
  assert.deepEqual(model.talks, [{ key: "talk-2", title: "Title of talk-2", badge: "Virtual", meta: "Hosted by Example Institute of Health · 2024" }]);
  const text = JSON.stringify(model);
  assert.doesNotMatch(text, /visit|travel(l)?ed|presented (in|at)|\bin person\b/i);
});

test("a shared location lists every talk in order, each with its own wording", () => {
  const model = popupModel([feature("talk-1"), feature("talk-7", { virtual_status: "Y", year: 2022, title: "Remote" })]);
  assert.equal(model.placeLabel, "Event and host location");
  assert.equal(model.note, "Virtual talks are shown at their host's location; they did not involve travel.");
  assert.deepEqual(model.talks.map((talk) => [talk.key, talk.badge, talk.meta]), [
    ["talk-1", null, "In person · Example University · 2025"],
    ["talk-7", "Virtual", "Hosted by Example University · 2022"]
  ]);
});

test("a popup without location text has no place line", () => {
  const { location, ...rest } = feature("talk-9").properties;
  assert.ok(location);
  const model = popupModel([{ ...feature("talk-9"), properties: rest }]);
  assert.equal(model.place, null);
  assert.equal(model.label, "Talks at this map location");
  assert.throws(() => popupModel([]), RangeError);
});

test("boundsOf spans every feature's [lat, lon]; no features, no bounds", () => {
  assert.equal(boundsOf([]), null);
  assert.deepEqual(boundsOf([feature("a", {}, [45, 12])]), [[12, 45], [12, 45]]);
  assert.deepEqual(boundsOf([feature("a", {}, [45, 12]), feature("b", {}, [151, -33]), feature("c", {}, [-70, 40])]), [[-33, -70], [40, 151]]);
});

test("the coverage note counts listed talks with and without a map location", () => {
  assert.equal(coverageText(3, 4), "3 of 4 listed talks have a map location. Talks without one appear only in the list.");
  assert.equal(coverageText(1, 2), "1 of 2 listed talks has a map location. Talks without one appear only in the list.");
  assert.equal(coverageText(0, 2), "0 of 2 listed talks have a map location. Talks without one appear only in the list.");
  assert.equal(coverageText(2, 2), "2 of 2 listed talks have a map location.");
  assert.equal(coverageText(1, 1), "1 of 1 listed talk has a map location.");
  assert.equal(coverageText(0, 0), "No talks are listed, so the map shows no markers.");
  assert.throws(() => coverageText(3, 2), RangeError);
});
