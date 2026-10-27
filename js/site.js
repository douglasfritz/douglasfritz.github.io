// Site-wide fixes to the markup and widgets Quarto generates, on every page
// (loaded by includes/site-script.html). Each is an enhancement: the page
// works without it.
//
// - The skip link's target, Quarto's <main id="quarto-document-content">,
//   becomes focusable (tabindex="-1"), so that following the link moves
//   keyboard and screen-reader focus to the main content, not only the
//   scroll position. (Without JavaScript, browsers still start the next Tab
//   from the target.)
// - Quarto gives the navbar's collapse toggler role="menu", which a button may
//   not have; it is a disclosure button (aria-expanded, aria-controls), so the
//   role is removed and the button keeps its native role.
// - Quarto's search dialog (Algolia Autocomplete in "detached" mode,
//   site_libs/quarto-search) covers the page but is not modal: Tab could move
//   focus to the page beneath it, out of sight, and closing it left focus on
//   <body>. While it is open, Tab and Shift+Tab wrap within it; when it
//   closes, focus returns to the search button. If a Quarto update changes
//   the widget's class names, these handlers find nothing and do nothing.
const main = document.getElementById("quarto-document-content");
if (main && !main.hasAttribute("tabindex")) main.tabIndex = -1;

for (const toggler of document.querySelectorAll('.navbar-toggler[role="menu"]')) toggler.removeAttribute("role");

const searchDialog = () => document.querySelector(".aa-DetachedOverlay");
const searchButton = () => document.querySelector("#quarto-search .aa-DetachedSearchButton");
const isTabbable = (element) => element.tabIndex >= 0 && !element.disabled && (element.checkVisibility?.() ?? true);

document.addEventListener("keydown", (event) => {
  const dialog = event.key === "Tab" ? searchDialog() : null;
  if (!dialog) return;
  const tabbables = Array.from(dialog.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")).filter(isTabbable);
  if (tabbables.length === 0) return;
  const [first, last] = [tabbables[0], tabbables[tabbables.length - 1]];
  const current = document.activeElement;
  const outside = !dialog.contains(current);
  if (event.shiftKey && (outside || current === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (outside || current === last)) {
    event.preventDefault();
    first.focus();
  }
});

let dialogOpen = false;
new MutationObserver(() => {
  const open = Boolean(searchDialog());
  if (dialogOpen && !open && (document.activeElement === document.body || document.activeElement === null)) searchButton()?.focus();
  dialogOpen = open;
}).observe(document.body, { childList: true });
