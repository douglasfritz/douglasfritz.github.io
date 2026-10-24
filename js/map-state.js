// Pure logic of the talk map (no DOM, no Leaflet), used by js/talks-map.js
// and tested by tests/js/map-state.test.mjs.
//
// Features come from data/generated/talks.geojson: points at [lon, lat] whose
// properties are key, title, organization, location (absent when unknown),
// virtual_status ("Y" or "N"), primary_pillar and year. Only talks with
// verified coordinates have a feature; the archive card's data-key joins them.

// The keys that get a marker: archive keys currently shown that have a
// feature. Sorted, without duplicates; an unmapped key never becomes one.
export function visibleMappableKeys(features, visibleKeys) {
  const allowed = new Set(visibleKeys);
  return [...new Set(features
    .filter((feature) => allowed.has(feature.properties.key))
    .map((feature) => feature.properties.key))]
    .sort();
}

const isText = (value) => typeof value === "string" && value !== "";

function isTalkFeature(feature) {
  if (!feature || feature.type !== "Feature" || feature.geometry?.type !== "Point") return false;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const [lon, lat] = coordinates;
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  const properties = feature.properties;
  return Boolean(properties) && isText(properties.key) && isText(properties.title) && typeof properties.organization === "string";
}

// The usable features of a GeoJSON document: valid points with a key and a
// title, the first feature per key. A talk whose feature is unusable simply
// has no marker; it stays in the archive. Anything other than a
// FeatureCollection with a features array is a TypeError.
export function readTalkFeatures(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    throw new TypeError("talks.geojson is not a GeoJSON FeatureCollection");
  }
  const seen = new Set();
  return geojson.features.filter((feature) => {
    if (!isTalkFeature(feature) || seen.has(feature.properties.key)) return false;
    seen.add(feature.properties.key);
    return true;
  });
}

// 1-4 in the canonical pillar order (the map key lists the pillars); 0 for a
// pillar the page does not know.
export function pillarNumber(name, pillarNames) {
  return pillarNames.indexOf(name) + 1;
}

const isVirtual = (feature) => feature.properties.virtual_status === "Y";

// Host and place as one phrase: "Example University, Sampleton, Exampleland".
const hostAndPlace = ({ organization, location }) => (isText(location) ? `${organization}, ${location}` : organization);

// What a marker shows and how assistive technology names it. The number is
// the primary pillar's; the class sets fill (pillar) and shape (a circle in
// person, a double-outlined square marked "V" when virtual). The label is the
// talk title plus its host, and for a virtual talk says that the host only
// hosted it.
export function markerModel(feature, pillarNames) {
  const { key, title, primary_pillar: pillar } = feature.properties;
  const number = pillarNumber(pillar, pillarNames);
  const virtual = isVirtual(feature);
  const where = virtual ? `Virtual, hosted by ${hostAndPlace(feature.properties)}` : `In person: ${hostAndPlace(feature.properties)}`;
  return {
    key,
    number,
    virtual,
    className: `talk-marker talk-marker-p${number} talk-marker-${virtual ? "virtual" : "in-person"}`,
    text: number > 0 ? String(number) : "?",
    label: `${title}. ${where}.${number > 0 ? ` Pillar ${number}.` : ""}`
  };
}

// A cluster of markers drawn as one circle with a count.
export function clusterModel(count) {
  return {
    className: "talk-cluster",
    text: String(count),
    label: `${count} talks at the same or nearby locations. Select to zoom in or spread them out.`
  };
}

// Talks with the same coordinates and location text share a popup.
export function locationKey(feature) {
  const [lon, lat] = feature.geometry.coordinates;
  return JSON.stringify([lat, lon, feature.properties.location ?? null]);
}

const VIRTUAL_NOTE = "Virtual talks are shown at their host's location; they did not involve travel.";

// The popup for the talks at one location (features in archive order). An
// in-person talk is listed with its host; a virtual talk with a "Virtual"
// badge and "Hosted by <organization>". Nothing says the location was visited.
export function popupModel(features) {
  if (features.length === 0) throw new RangeError("a popup needs at least one talk");
  const virtualCount = features.filter(isVirtual).length;
  let placeLabel = "Event and host location";
  if (virtualCount === 0) placeLabel = "Event location";
  else if (virtualCount === features.length) placeLabel = "Host location";
  const location = features[0].properties.location;
  const place = isText(location) ? location : null;
  return {
    label: place ? `${placeLabel}: ${place}` : "Talks at this map location",
    placeLabel,
    place,
    note: virtualCount > 0 ? VIRTUAL_NOTE : null,
    talks: features.map((feature) => {
      const { key, title, organization, year } = feature.properties;
      return isVirtual(feature)
        ? { key, title, badge: "Virtual", meta: `Hosted by ${organization} · ${year}` }
        : { key, title, badge: null, meta: `In person · ${organization} · ${year}` };
    })
  };
}

// [[south, west], [north, east]] around the features, or null for none.
export function boundsOf(features) {
  if (features.length === 0) return null;
  const lats = features.map((feature) => feature.geometry.coordinates[1]);
  const lons = features.map((feature) => feature.geometry.coordinates[0]);
  return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
}

// The note under the map: how many of the talks listed have a marker.
export function coverageText(mapped, listed) {
  if (mapped > listed) throw new RangeError("more mapped talks than listed talks");
  if (listed === 0) return "No talks are listed, so the map shows no markers.";
  const text = `${mapped} of ${listed} listed ${listed === 1 ? "talk" : "talks"} ${mapped === 1 ? "has" : "have"} a map location.`;
  return mapped < listed ? `${text} Talks without one appear only in the list.` : text;
}
