// Research-pillar component: progressive enhancement of the static markup
// that R renders at build time (R/pillar_cards.R, via _pillars.qmd). Without
// this script every pillar card is shown in full, stacked. With it, the four
// numbered buttons each open their pillar's panel, one pillar at a time:
// selecting the open pillar again closes it. Hover and focus only emphasise
// a pillar (CSS); nothing is revealed until a pillar is selected, by click,
// tap, Enter or Space (native buttons), the same for pointer, keyboard and
// touch.
//
// Markup contract (R/pillar_cards.R):
//   [data-pillar-component]          the component; gets "js-enhanced" once set
//                                    up, and "pillars-motion" while the reader
//                                    has not asked for reduced motion
//     [data-pillar-number]           one card per pillar, numbered 1 to 4
//       button.pillar-toggle[aria-controls]   its panel's id
//
// pillarHref() builds the archive links the same way R does at build time.

// A pillar's archive link (base "/publications/" or "/talks/"): the
// archives' query keys (js/filter-core.js), with foundational work included,
// so that the archive lists every record with the pillar as primary or
// secondary. R/pillar_cards.R (pillar_archive_href) writes the same links.
export function pillarHref(base, pillar) {
  return `${base}?pillar=${encodeURIComponent(pillar)}&foundational=include`;
}

// The pillar open after `number` is selected: it, or none if it was open.
export function nextSelection(selected, number) {
  return selected === number ? null : number;
}

function enhance(component) {
  const pillars = Array.from(component.querySelectorAll("[data-pillar-number]"), (card) => {
    const button = card.querySelector("button.pillar-toggle");
    const panel = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
    return { card, button, panel, number: card.dataset.pillarNumber };
  });
  // Leave the static, fully expanded component alone if it is incomplete.
  if (pillars.length === 0 || pillars.some(({ button, panel }) => !button || !panel)) return;

  let selected = null;
  const render = () => {
    for (const { card, button, panel, number } of pillars) {
      const open = number === selected;
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      card.classList.toggle("is-selected", open);
    }
  };
  for (const { button, number } of pillars) {
    button.addEventListener("click", () => {
      selected = nextSelection(selected, number);
      render();
    });
  }
  render();

  // Transitions only for readers who have not asked for reduced motion.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyMotion = () => component.classList.toggle("pillars-motion", !reduceMotion.matches);
  applyMotion();
  reduceMotion.addEventListener("change", applyMotion);

  component.classList.add("js-enhanced");
}

// Importable without a DOM (the unit tests import pillarHref).
if (typeof document !== "undefined") {
  for (const component of document.querySelectorAll("[data-pillar-component]")) enhance(component);
}
