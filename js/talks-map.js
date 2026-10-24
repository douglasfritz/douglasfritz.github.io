// Progressive enhancement: the conference map on the talk page. The archive
// below it is the full, readable list; the map mirrors the records that list
// currently shows and is never the only way to reach a talk.
//
// Markup contract (templates/talk.ejs.md):
//   section[data-talk-map]            hidden until this module runs (no dead box
//                                     without JavaScript)
//     data-talk-map-data="<url>"      talks.geojson, relative to the page
//     data-talk-map-records="<id>"    the archive's records container
//     data-map-state                  set here: loading | ready | unavailable
//     [data-talk-map-message]         role="status": the unavailable or
//                                     tile-error note
//     [data-talk-map-body]            everything else; hidden if the map fails.
//                                     Its "Skip map and view talks" and "View
//                                     talks as a list" links are plain links
//                                     to the archive heading (tabindex="-1",
//                                     so the browser moves focus there)
//       [data-talk-map-canvas]        the Leaflet container (role="region");
//                                     data-marker-keys holds the keys of the
//                                     markers on the map as a sorted JSON array,
//                                     updated on every sync (a test hook)
//       [data-talk-map-coverage]      "N of M listed talks have a map location"
//       [data-pillar][data-pillar-number]  the map key's pillars, in order
//   #<records> [data-key]             the talk cards; .record-title (tabindex
//                                     -1) receives focus from the map
//
// Synchronization: the map never filters. js/archive-filters.js dispatches
// "archive:filtered" (detail.keys: the keys shown) on document after every
// render; this module listens first, then dispatches "archive:request", which
// the archive answers with its current keys. If no archive answers (its
// script failed), nothing is hidden, so every card counts as listed.
//
// Markers: one per mappable listed talk, clustered (Leaflet.markercluster);
// co-located talks spread out (spiderfy) instead of zooming in. Selecting a
// marker opens its popup and moves focus to the talk's card; a card's
// "Show on map" button reveals and highlights its marker and opens the popup.
// Libraries are self-hosted in assets/vendor/ and loaded here, so that a
// missing library, a failed fetch or invalid data only replaces the map with a
// short message. Errors never leave this module.
import {
  boundsOf,
  clusterModel,
  coverageText,
  locationKey,
  markerModel,
  popupModel,
  readTalkFeatures,
  visibleMappableKeys
} from "./map-state.js";

const LEAFLET_SRC = new URL("../assets/vendor/leaflet/leaflet.js", import.meta.url).href;
const CLUSTER_SRC = new URL("../assets/vendor/leaflet.markercluster/leaflet.markercluster.js", import.meta.url).href;
// OpenStreetMap's tile servers: the page's only third-party requests.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const WORLD_VIEW = { center: [20, 0], zoom: 1 };
const MESSAGES = {
  unavailable: "The map could not be loaded. Every talk is still listed below.",
  tiles: "Some background map tiles could not be loaded. The markers and the list below still work."
};

const prefersReducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const scrollBehavior = () => (prefersReducedMotion() ? "auto" : "smooth");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`could not load ${src}`)), { once: true });
    document.head.append(script);
  });
}

async function loadLeaflet() {
  if (!window.L) await loadScript(LEAFLET_SRC);
  if (typeof window.L?.map !== "function") throw new Error("Leaflet is unavailable");
  if (!window.L.markerClusterGroup) await loadScript(CLUSTER_SRC);
  if (typeof window.L.markerClusterGroup !== "function") throw new Error("Leaflet.markercluster is unavailable");
  return window.L;
}

async function loadFeatures(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`talks.geojson: HTTP ${response.status}`);
  return readTalkFeatures(await response.json());
}

function createTalkMap({ L, section, canvas, records, features }) {
  const reducedMotion = prefersReducedMotion();
  const pillarNames = Array.from(section.querySelectorAll("[data-pillar]"))
    .sort((a, b) => Number(a.dataset.pillarNumber) - Number(b.dataset.pillarNumber))
    .map((item) => item.dataset.pillar);
  const coverage = section.querySelector("[data-talk-map-coverage]");
  const cards = new Map(Array.from(records.querySelectorAll("[data-key]"), (card) => [card.dataset.key, card]));
  const featureByKey = new Map(features.map((feature) => [feature.properties.key, feature]));

  // Leaflet has no map-wide switch for pan animation; popups, keyboard
  // panning and markercluster all pan through panBy.
  const TalkMap = L.Map.extend({
    panBy(offset, options) {
      return L.Map.prototype.panBy.call(this, offset, reducedMotion ? { ...options, animate: false } : options);
    }
  });
  const map = new TalkMap(canvas, {
    minZoom: 1,
    maxZoom: 18,
    scrollWheelZoom: false,
    zoomAnimation: !reducedMotion,
    fadeAnimation: !reducedMotion,
    markerZoomAnimation: !reducedMotion,
    inertia: !reducedMotion
  });
  map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom, { animate: false });

  const tiles = L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTRIBUTION });
  tiles.once("tileerror", () => onTileError());
  tiles.addTo(map);

  // A div icon built with DOM nodes (never HTML strings) whose accessible
  // name and tooltip are its label. Leaflet makes every marker icon, cluster
  // icons included, a focusable button (tabindex="0", role="button").
  const TalkIcon = L.DivIcon.extend({
    createIcon(oldIcon) {
      const div = L.DivIcon.prototype.createIcon.call(this, oldIcon);
      const { label, content, key } = this.options;
      div.replaceChildren(...content());
      div.setAttribute("aria-label", label);
      div.title = label;
      if (key !== undefined) div.dataset.key = key;
      return div;
    }
  });

  const markerIcon = (key, selected) => {
    const model = markerModel(featureByKey.get(key), pillarNames);
    return new TalkIcon({
      className: `${model.className}${selected ? " is-selected" : ""}`,
      iconSize: [30, 30],
      label: model.label,
      key,
      content: () => {
        const number = element("span", "talk-marker-number", model.text);
        number.setAttribute("aria-hidden", "true");
        if (!model.virtual) return [number];
        const tag = element("span", "talk-marker-virtual-tag", "V");
        tag.setAttribute("aria-hidden", "true");
        return [number, tag];
      }
    });
  };

  const clusters = L.markerClusterGroup({
    animate: !reducedMotion,
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    spiderfyDistanceMultiplier: 1.6,
    spiderLegPolylineOptions: { weight: 2, className: "talk-spider-leg" },
    iconCreateFunction: (cluster) => {
      const model = clusterModel(cluster.getChildCount());
      return new TalkIcon({
        className: model.className,
        iconSize: [38, 38],
        label: model.label,
        content: () => {
          const count = element("span", "talk-cluster-count", model.text);
          count.setAttribute("aria-hidden", "true");
          return [count];
        }
      });
    }
  });
  clusters.addTo(map);

  // One marker per mappable talk, keyed by talk key (and back).
  const markers = new Map();
  const markerKey = new Map();
  for (const feature of features) {
    const { key } = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lon], { icon: markerIcon(key, false), riseOnHover: true });
    marker.on("click", guard(() => activateMarker(key)));
    markers.set(key, marker);
    markerKey.set(marker, key);
  }

  let visibleFeatures = [];
  let markerKeys = null;
  let selectedKey = null;
  let popupOpener = null;
  // The top-left padding keeps popups clear of the zoom buttons, which sit
  // above them.
  const popup = L.popup({
    maxWidth: 280,
    minWidth: 200,
    autoPanPaddingTopLeft: [60, 16],
    autoPanPaddingBottomRight: [16, 16],
    offset: [0, -12],
    className: "talk-popup-container"
  });

  const select = (key) => {
    if (key === selectedKey) return;
    const previous = selectedKey;
    selectedKey = key;
    if (previous !== null) {
      markers.get(previous)?.setIcon(markerIcon(previous, false)).setZIndexOffset(0);
      cards.get(previous)?.classList.remove("is-map-selected");
    }
    if (key !== null) {
      markers.get(key).setIcon(markerIcon(key, true)).setZIndexOffset(1000);
      cards.get(key)?.classList.add("is-map-selected");
    }
  };

  const focusCard = (key) => {
    const card = cards.get(key);
    const heading = card?.querySelector(".record-title");
    if (card && heading && !card.hidden) {
      heading.focus({ preventScroll: true });
      card.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    }
  };

  const popupContent = (key) => {
    const here = locationKey(featureByKey.get(key));
    const model = popupModel(visibleFeatures.filter((feature) => locationKey(feature) === here));
    const root = element("div", "talk-popup");
    root.tabIndex = -1;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", model.label);
    if (model.place) {
      const place = element("p", "talk-popup-place");
      place.append(element("span", "talk-popup-place-label", `${model.placeLabel}: `), model.place);
      root.append(place);
    }
    if (model.note) root.append(element("p", "talk-popup-note", model.note));
    const list = element("ul", "talk-popup-talks");
    for (const talk of model.talks) {
      const item = element("li");
      item.dataset.key = talk.key;
      // An internal link to the card; the click moves focus there.
      // (noZensmooth: Quarto's zenscroll would otherwise handle the click too,
      // since Leaflet does not stop clicks inside popups from bubbling.)
      const link = element("a", "talk-popup-title noZensmooth", talk.title);
      link.href = `#${cards.get(talk.key)?.id ?? ""}`;
      link.addEventListener("click", guard((event) => {
        event.preventDefault();
        focusCard(talk.key);
      }));
      const meta = element("p", "talk-popup-meta");
      if (talk.badge) meta.append(element("span", "virtual-badge", talk.badge), " ");
      meta.append(talk.meta);
      item.append(link, meta);
      list.append(item);
    }
    root.append(list);
    // Leaflet closes popups on Escape only while the map itself has focus.
    root.addEventListener("keydown", guard((event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        map.closePopup();
      }
    }));
    return root;
  };

  // Opens the shared popup at a marker; `opener` gets focus back when the
  // popup closes while focus is in it. The popup is sized to the map (a
  // phone's map is narrow), clear of the zoom buttons, and scrolls if its
  // talks do not fit.
  const openPopup = (key, opener) => {
    const content = popupContent(key);
    popupOpener = opener;
    const maxWidth = Math.max(150, Math.min(280, canvas.clientWidth - 112));
    Object.assign(popup.options, { maxWidth, minWidth: Math.min(200, maxWidth), maxHeight: Math.max(150, canvas.clientHeight - 64) });
    popup.setLatLng(markers.get(key).getLatLng()).setContent(content).openOn(map);
    return content;
  };

  map.on("popupclose", guard(() => {
    const opener = popupOpener;
    popupOpener = null;
    const focused = document.activeElement;
    const container = popup.getElement();
    const focusWasInPopup = !focused || focused === document.body || Boolean(container?.contains(focused));
    if (opener?.isConnected && !opener.closest("[hidden]") && focusWasInPopup) opener.focus();
  }));
  // A popup opened on a spread-out marker would float on its own once the
  // markers fold back into their cluster.
  clusters.on("unspiderfied", () => map.closePopup());

  // A marker (click, Enter or Space): open its popup, then go to its card.
  const activateMarker = (key) => {
    select(key);
    openPopup(key, null);
    focusCard(key);
  };

  // Talks at the same point spread out where they are; anything else zooms
  // (or pans) until the marker is visible.
  const reveal = (marker, done) => {
    const parent = clusters.getVisibleParent(marker);
    const here = marker.getLatLng();
    if (parent && parent !== marker && parent.getAllChildMarkers().every((child) => child.getLatLng().equals(here))) {
      clusters.once("spiderfied", done);
      parent.spiderfy();
    } else {
      clusters.zoomToShowLayer(marker, done);
    }
  };

  // A card's "Show on map": highlight the marker, bring the map into view
  // and open the popup with focus in it. Only the latest request opens a
  // popup (an earlier reveal may finish late, or never).
  let revealRequest = 0;
  const showOnMap = (key, button) => {
    const marker = markers.get(key);
    if (!marker || !clusters.hasLayer(marker)) return;
    const request = ++revealRequest;
    select(key);
    canvas.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    reveal(marker, guard(() => {
      if (request === revealRequest && clusters.hasLayer(marker)) openPopup(key, button).focus({ preventScroll: true });
    }));
  };

  // Enter or Space on a focused marker or cluster acts like a click.
  canvas.addEventListener("keydown", guard((event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const icon = event.target instanceof Element ? event.target.closest(".talk-marker, .talk-cluster") : null;
    if (!icon || !canvas.contains(icon)) return;
    event.preventDefault();
    icon.click();
    // A cluster's icon goes away as it zooms or spreads out; keep focus on
    // the map so that Tab continues into the markers.
    if (icon.classList.contains("talk-cluster")) canvas.focus({ preventScroll: true });
  }));

  // The archive's listed keys -> the markers on the map.
  const sync = (listed) => {
    const keys = visibleMappableKeys(features, listed);
    coverage.textContent = coverageText(keys.length, new Set(listed).size);
    const json = JSON.stringify(keys);
    if (json === markerKeys) return;
    markerKeys = json;
    const shown = new Set(keys);
    visibleFeatures = features.filter((feature) => shown.has(feature.properties.key));
    map.closePopup();
    if (selectedKey !== null && !shown.has(selectedKey)) select(null);
    // Take the cluster group off the map while the view changes, so that the
    // clusters are built once, at the final zoom, with no cluster animation
    // (markercluster ignores clicks while one runs).
    clusters.remove();
    clusters.clearLayers();
    // Fit the markers shown (never a fixed country); with none, a world view.
    const bounds = boundsOf(visibleFeatures);
    if (bounds) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 6, animate: false });
    else map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom, { animate: false });
    clusters.addLayers(keys.map((key) => markers.get(key)));
    clusters.addTo(map);
    // The test hook: what the cluster group holds, not what was asked for.
    canvas.dataset.markerKeys = JSON.stringify(clusters.getLayers().map((marker) => markerKey.get(marker)).sort());
  };

  // "Show on map" on every card with a marker (none without a map).
  for (const [key, card] of cards) {
    if (!markers.has(key)) continue;
    const button = element("button", "talk-map-button", "Show on map");
    button.type = "button";
    button.append(element("span", "visually-hidden", `: ${card.querySelector(".record-title")?.textContent ?? ""}`));
    button.addEventListener("click", guard(() => showOnMap(key, button)));
    const action = element("p", "talk-map-action");
    action.dataset.talkMapAction = "";
    action.append(button);
    card.append(action);
  }

  return { sync };
}

// ---- Start-up --------------------------------------------------------------

const section = document.querySelector("[data-talk-map]");
let failed = false;
let controller = null;
let listedKeys = null;

function setMessage(text) {
  const message = section.querySelector("[data-talk-map-message]");
  if (message && message.textContent !== text) message.textContent = text;
}

// Replaces the map with one short message; the archive is untouched.
function fail() {
  if (failed) return;
  failed = true;
  controller = null;
  section.hidden = false;
  section.dataset.mapState = "unavailable";
  const body = section.querySelector("[data-talk-map-body]");
  if (body) body.hidden = true;
  for (const action of document.querySelectorAll("[data-talk-map-action]")) action.remove();
  setMessage(MESSAGES.unavailable);
}

function onTileError() {
  if (!failed) setMessage(MESSAGES.tiles);
}

// Runs a handler; any error disables the map instead of reaching the page.
function guard(handler) {
  return (...args) => {
    if (failed) return undefined;
    try {
      return handler(...args);
    } catch {
      fail();
      return undefined;
    }
  };
}

const allCardKeys = (records) => Array.from(records.querySelectorAll("[data-key]"), (card) => card.dataset.key);

async function start() {
  section.hidden = false;
  section.dataset.mapState = "loading";
  const canvas = section.querySelector("[data-talk-map-canvas]");
  const records = document.getElementById(section.dataset.talkMapRecords ?? "");
  if (!canvas || !records || !section.dataset.talkMapData) throw new Error("the map markup is incomplete");

  const dataUrl = new URL(section.dataset.talkMapData, document.baseURI);
  const [L, features] = await Promise.all([loadLeaflet(), loadFeatures(dataUrl)]);
  if (failed) return;
  const talkMap = createTalkMap({ L, section, canvas, records, features });
  talkMap.sync(listedKeys ?? allCardKeys(records));
  controller = talkMap;
  section.dataset.mapState = "ready";
}

if (section) {
  // Listen before asking: the archive may answer at once, or render later.
  document.addEventListener("archive:filtered", guard((event) => {
    const keys = event.detail?.keys;
    if (!Array.isArray(keys)) return;
    listedKeys = keys.map(String);
    controller?.sync(listedKeys);
  }));
  document.dispatchEvent(new CustomEvent("archive:request"));
  start().catch(() => fail());
}
