// ---------------------------------------------------------------------------
// THE HEADER NAVIGATION MODEL.
//
// One renderer for every top-level nav category, present and future. Nothing
// in here — and nothing in partials/header.html, style.css or script.js —
// knows the words "goal", "athlete" or "creator". Those three are simply the
// first three rows of the Taxonomy table.
//
// The old header was three hand-authored <li> blocks with three unrelated
// column compositions, two different data paths (one server-rendered, one
// fetched client-side from the whole product catalogue) and three fixed pixel
// widths. That is what produced the reported symptoms: a 760px panel holding
// four short sport columns is 60% empty by construction, and a layout that is
// authored per category cannot be consistent across categories or exist at
// all for a category an admin adds later.
//
// The pipeline is:
//
//   Taxonomy row  ->  layout resolution  ->  presentation model  ->  HTML
//   (CMS)             (structure + one     (columns, tiles,        (one
//                      stored hint)         optional feature)       template)
//
// Layout resolution is deliberately mostly STRUCTURAL, so a taxonomy an admin
// creates tomorrow gets a sensible panel with zero configuration:
//
//   flat list of nodes        -> "list"    a balanced index of links
//   nodes with children       -> "groups"  a column per group
//   navLayout: "people"       -> "people"  faces, ranked by real catalogue depth
//
// Only "people" is stored, because it is the one fact the tree's shape cannot
// tell you: that the leaves are humans and deserve a face rather than a
// bullet. Everything else — how many columns, how wide the panel is, whether
// there is a group rail, whether there is a featured product — is DERIVED
// from how much real content the category actually has. That is what makes
// the panel height and width content-driven instead of fixed.
// ---------------------------------------------------------------------------
const { prisma } = require("../db");
const { getAllTaxonomyTrees } = require("./taxonomy");
const { coverMedia, normalizeImageUrl } = require("./media");
const { formatProductPrice } = require("./price");

// How many people a "people" panel shows before it stops and defers to its
// View-all. Ten is two balanced columns of five: enough to feel like a real
// roster, few enough that the panel never becomes a page inside the header.
const PEOPLE_LIMIT = 10;
// A "groups" panel shows at most this many group columns for the same reason.
const GROUP_COLUMN_LIMIT = 4;
// Thumbnail box for a person tile / featured card, in CSS px. Declared here
// because it has to appear in BOTH the CSS and the <img sizes> attribute, and
// a `sizes` that disagrees with the real box is how this codebase has
// repeatedly ended up downloading a 640px file for a 36px slot.
const TILE_PX = 36;
const FEATURE_PX = 56;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Layout resolution
// ---------------------------------------------------------------------------
function resolveLayout(tree) {
  const stored = tree.navLayout || "auto";
  if (stored === "list" || stored === "groups" || stored === "people") return stored;
  // "auto", or any value written by a future admin UI this build predates.
  return tree.hasSubcategories ? "groups" : "list";
}

// Balanced columns for a flat index of `count` items. The panel's width is
// content-driven (CSS `width: max-content`), so choosing FEWER columns for a
// short list is what stops four items rendering inside a half-empty slab —
// there is no fixed box left over to fill.
//
// The ROW COUNT is returned too, and it has to be: the columns are laid out
// with `grid-auto-flow: column` over an explicit `grid-template-rows`, which
// is the only way to get a top-to-bottom-then-wrap fill (7 items as 4 + 3
// rather than a ragged 3 + 3 + 1). A fixed row count in the CSS would silently
// mis-split every count that is not a multiple of it — eleven items over seven
// rows renders 7 + 4 and leaves the third column empty — so the exact ceiling
// is computed here, where the count is actually known, and handed to the CSS
// as data-rows.
function columnsFor(count, layout) {
  // People tiles carry a thumbnail, so a column is roughly twice as wide as a
  // text column and a third would push the panel past its clamp.
  const maxCols = layout === "people" ? 2 : 3;
  if (count <= 0) return { cols: 1, rows: 1 };
  let cols;
  if (count <= 5) cols = 1;
  else if (count <= 10) cols = Math.min(2, maxCols);
  else cols = maxCols;
  return { cols, rows: Math.ceil(count / cols) };
}

// ---------------------------------------------------------------------------
// Catalogue facts the menu needs
// ---------------------------------------------------------------------------
// PUBLISHED product count per taxonomy node, and one representative product
// per node.
//
// TaxonomyNode._count.products (what getAllTaxonomyTrees carries) counts every
// ProductTaxonomy row regardless of the product's status, so it happily
// reports "1 plan" for a node whose only plan is a draft. That number is right
// for the admin CMS — an operator wants to see what is tagged — and wrong for
// a storefront menu, where it is a promise to the customer. So the nav
// computes its own from published products only.
//
// The representative product is where a person tile's picture comes from. It
// is a real CMS relation (this athlete is tagged on this plan), not a name
// match against Product.creator — those two strings disagree in the live
// catalogue, so matching on them would put the wrong face on the wrong person.
async function loadCatalogueFacts() {
  const rows = await prisma.productTaxonomy.findMany({
    where: { product: { status: "published" } },
    select: {
      taxonomyNodeId: true,
      product: {
        select: { slug: true, name: true, imageUrl: true, priceCents: true, featured: true, creator: true },
      },
    },
  });

  const byNode = new Map();
  for (const row of rows) {
    let entry = byNode.get(row.taxonomyNodeId);
    if (!entry) {
      entry = { count: 0, product: null };
      byNode.set(row.taxonomyNodeId, entry);
    }
    entry.count += 1;
    // Prefer a featured product as the face of a node; otherwise the first.
    if (!entry.product || (row.product.featured && !entry.product.featured)) {
      entry.product = row.product;
    }
  }
  return byNode;
}

// ---------------------------------------------------------------------------
// Model builders — one per layout, all producing the same shape
// ---------------------------------------------------------------------------
function itemHref(tree, node) {
  return `/${encodeURIComponent(tree.nodeRoute)}/${encodeURIComponent(node.slug)}`;
}

function groupHref(tree, node) {
  return tree.groupRoute ? `/${encodeURIComponent(tree.groupRoute)}/${encodeURIComponent(node.slug)}` : null;
}

function toItem(tree, node, facts, opts) {
  const fact = facts.get(node.id);
  const count = fact ? fact.count : 0;
  const item = {
    name: node.name,
    href: opts && opts.asGroup ? groupHref(tree, node) : itemHref(tree, node),
    count,
  };
  if (opts && opts.withImage) {
    item.initials = initials(node.name);
    const product = fact && fact.product;
    item.cover = product && product.imageUrl ? coverMedia(product.imageUrl) : null;
    item.src = product && product.imageUrl ? normalizeImageUrl(product.imageUrl) : null;
  }
  return item;
}

// Flattens a tree to its LEAVES. A people taxonomy is Sport -> Athlete today,
// but nothing stops an admin nesting deeper, and the person is always the
// leaf.
function leavesOf(nodes, out) {
  for (const n of nodes) {
    if (n.children && n.children.length) leavesOf(n.children, out);
    else out.push(n);
  }
  return out;
}

function buildPanel(tree, facts, featured) {
  const layout = resolveLayout(tree);
  const panel = {
    key: tree.key,
    label: tree.label,
    href: tree.route,
    panelId: `navPanel-${tree.key}`,
    layout,
    rail: [],
    columns: [],
    items: [],
    grid: { cols: 1, rows: 1 },
    featured: null,
    empty: false,
  };

  if (layout === "groups") {
    // A column per group, each holding its own children. The group's own name
    // is the column heading — a real piece of the customer's mental model
    // ("Football"), never a decorative label invented by the design.
    panel.columns = tree.nodes.slice(0, GROUP_COLUMN_LIMIT).map((group) => ({
      name: group.name,
      href: groupHref(tree, group),
      items: (group.children || []).map((child) => toItem(tree, child, facts)),
    }));
    panel.empty = !panel.columns.some((c) => c.items.length) && !panel.columns.length;
    return panel;
  }

  if (layout === "people") {
    const leaves = leavesOf(tree.nodes, []);
    // Ranked by how much of the catalogue actually sits behind them, so the
    // ten faces a customer sees are the ten with something to sell. Name
    // ordering breaks ties so the list is stable between requests.
    leaves.sort((a, b) => {
      const ca = facts.get(a.id) ? facts.get(a.id).count : 0;
      const cb = facts.get(b.id) ? facts.get(b.id).count : 0;
      return cb - ca || a.name.localeCompare(b.name);
    });
    panel.items = leaves.slice(0, PEOPLE_LIMIT).map((n) => toItem(tree, n, facts, { withImage: true }));
    panel.grid = columnsFor(panel.items.length, "people");
    // The group rail exists only when the groups are themselves reachable
    // pages. Athletes' sports are (/sport/football); Creators' categories are
    // not, and inventing a dead link for them would be worse than omitting
    // the rail — which is why this is read from the data, not the key.
    if (tree.groupRoute) {
      panel.rail = tree.nodes.map((n) => toItem(tree, n, facts, { asGroup: true }));
    }
    panel.empty = panel.items.length === 0;
    return panel;
  }

  // "list": a flat index, balanced into as many columns as it actually needs.
  panel.items = tree.nodes.map((n) => toItem(tree, n, facts));
  panel.grid = columnsFor(panel.items.length, "list");
  panel.empty = panel.items.length === 0;
  // The one product preview in the whole header, and only on a text index —
  // a people panel's tiles are already the product discovery, and repeating a
  // card in every panel is how a menu starts to feel like a page.
  panel.featured = featured;
  return panel;
}

// One featured product for the text-index panel: published, ideally flagged
// featured, and actually tagged under this taxonomy so the card belongs to
// the category it sits in.
function pickFeatured(tree, facts) {
  const nodeIds = [];
  (function walk(nodes) {
    for (const n of nodes) {
      nodeIds.push(n.id);
      if (n.children) walk(n.children);
    }
  })(tree.nodes);

  let best = null;
  for (const id of nodeIds) {
    const fact = facts.get(id);
    if (!fact || !fact.product) continue;
    if (!best || (fact.product.featured && !best.product.featured)) {
      best = { product: fact.product, nodeId: id };
    }
  }
  if (!best) return null;
  const p = best.product;
  return {
    name: p.name,
    creator: p.creator || "",
    price: formatProductPrice(p.priceCents),
    href: `/program/${encodeURIComponent(p.slug)}`,
    cover: p.imageUrl ? coverMedia(p.imageUrl) : null,
    src: p.imageUrl ? normalizeImageUrl(p.imageUrl) : null,
  };
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
// A thumbnail that is never the original upload, and never fetched on a page
// where nobody opens the menu.
//
// TWO separate failures are being avoided here, and this codebase has shipped
// both before.
//
// 1. THE ORIGINAL. Seven surfaces have put a stored upload straight into a
//    small box — megabytes to fill a 44px thumbnail, every request a 200, so
//    nothing ever flagged it. Fixed the same way each time: <picture> with the
//    derivative srcsets, `sizes` declared as the REAL CSS box (36px here, not
//    a guess), and never an original as a placeholder to be upgraded later,
//    because that fires the original's download regardless.
//
// 2. FETCHING IT AT ALL. `loading="lazy"` was assumed to cover this: the
//    panels are closed, so surely nothing loads. Measured, it does not. A
//    closed desktop panel is `visibility: hidden` with a real box 47px below
//    the top of the viewport — squarely inside the lazy-loading threshold —
//    so Chrome fetched every menu thumbnail on every page of the site. (This
//    is NOT the same as the display:none case, where a lazy image never
//    intersects anything and therefore never loads at all.)
//
//    So NOTHING in the <picture> ships with a live URL. `data-src` on the img
//    and `data-srcset` on each <source> carry them, and script.js promotes the
//    lot the first time a visitor touches the nav — hovering it, tabbing into
//    it, or opening the drawer — which is early enough that the images are
//    there before a panel finishes its 200ms fade, and never happens at all on
//    the majority of page views where nobody goes near the menu.
//
//    Deferring the img's `src` alone is NOT enough, and measuring is the only
//    way to find that out: inside a <picture>, the img's src is merely one
//    more candidate, so a live `<source srcset>` selects and fetches on its
//    own with the img still src-less. Three of five thumbnails still loaded.
function thumbHtml(entry, px, className) {
  const alt = ""; // Decorative: the name is right next to it in real text.
  // width/height are still declared, so the box is reserved before the image
  // exists and promoting it cannot shift the panel's layout.
  const common = `class="${className}" alt="${alt}" width="${px}" height="${px}" decoding="async" sizes="${px}px" data-nav-thumb`;
  if (entry.cover && entry.cover.sources && entry.cover.sources.length) {
    const sources = entry.cover.sources
      .map((s) => `<source type="${escapeHtml(s.type)}" data-srcset="${escapeHtml(s.srcset)}" sizes="${px}px">`)
      .join("");
    return `<picture class="nav-panel__thumb-box">${sources}<img ${common} data-src="${escapeHtml(entry.cover.src)}"></picture>`;
  }
  if (entry.src) {
    // No manifest (SVG, GIF, or an image already smaller than the narrowest
    // derivative tier). Degrading to the stored file is correct — there is
    // nothing smaller to serve.
    return `<picture class="nav-panel__thumb-box"><img ${common} data-src="${escapeHtml(entry.src)}"></picture>`;
  }
  return "";
}

function personTileHtml(item) {
  const media = item.cover || item.src
    ? thumbHtml(item, TILE_PX, "nav-panel__thumb")
    : `<span class="nav-panel__thumb-box nav-panel__initials" aria-hidden="true">${escapeHtml(item.initials)}</span>`;
  // No "ATHLETE"/"CREATOR" tag: the panel this tile sits in is already headed
  // "Browse Athletes". The only secondary text is a fact the name does not
  // carry — how many plans are actually behind this person — and it is
  // omitted entirely when the answer is none, rather than printing a zero.
  const meta = item.count
    ? `<span class="nav-panel__tile-meta">${item.count} plan${item.count === 1 ? "" : "s"}</span>`
    : "";
  return (
    `<li class="nav-panel__tile-item"><a class="nav-panel__tile" href="${escapeHtml(item.href)}">` +
    media +
    `<span class="nav-panel__tile-body"><span class="nav-panel__tile-name">${escapeHtml(item.name)}</span>${meta}</span>` +
    "</a></li>"
  );
}

function linkItemHtml(item) {
  return (
    `<li><a class="nav-panel__link" href="${escapeHtml(item.href)}">` +
    `<span class="nav-panel__link-name">${escapeHtml(item.name)}</span>` +
    "</a></li>"
  );
}

function featuredHtml(featured) {
  if (!featured) return "";
  const media = featured.cover || featured.src ? thumbHtml(featured, FEATURE_PX, "nav-panel__feature-thumb") : "";
  const sub = [featured.creator, featured.price].filter(Boolean).join(" · ");
  return (
    `<a class="nav-panel__feature" href="${escapeHtml(featured.href)}">` +
    media +
    `<span class="nav-panel__feature-body">` +
    `<span class="nav-panel__feature-name">${escapeHtml(featured.name)}</span>` +
    (sub ? `<span class="nav-panel__feature-meta">${escapeHtml(sub)}</span>` : "") +
    "</span></a>"
  );
}

function railHtml(rail) {
  if (!rail.length) return "";
  const links = rail
    .filter((r) => r.href)
    .map((r) => `<li><a class="nav-panel__rail-link" href="${escapeHtml(r.href)}">${escapeHtml(r.name)}</a></li>`)
    .join("");
  if (!links) return "";
  return `<ul class="nav-panel__rail">${links}</ul>`;
}

// The single action row. "View all" and nothing else in visible text: the
// panel is already titled, and repeating the category name after every group
// is exactly what made the old menu read as a directory. The accessible name
// still says which "all" — a screen-reader user tabbing straight to this link
// has none of the surrounding context a sighted one does — and it is phrased
// to stay grammatical whatever an admin names the category, rather than
// concatenating "View all" onto a label that may already start with a verb.
function actionHtml(panel) {
  return (
    `<a class="nav-panel__action" href="${escapeHtml(panel.href)}" aria-label="View everything in ${escapeHtml(panel.label)}">` +
    `View all <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>`
  );
}

function panelBodyHtml(panel) {
  if (panel.empty && !panel.columns.length) {
    return `<p class="nav-panel__empty">Nothing here yet.</p>`;
  }

  if (panel.layout === "groups") {
    return (
      `<div class="nav-panel__groups">` +
      panel.columns
        .map((col) => {
          const heading = col.href
            ? `<a class="nav-panel__group-title" href="${escapeHtml(col.href)}">${escapeHtml(col.name)}</a>`
            : `<span class="nav-panel__group-title">${escapeHtml(col.name)}</span>`;
          const items = col.items.map(linkItemHtml).join("");
          return `<div class="nav-panel__group">${heading}<ul class="nav-panel__list">${items}</ul></div>`;
        })
        .join("") +
      "</div>"
    );
  }

  if (panel.layout === "people") {
    return (
      railHtml(panel.rail) +
      `<ul class="nav-panel__tiles" data-cols="${panel.grid.cols}" data-rows="${panel.grid.rows}">` +
      panel.items.map(personTileHtml).join("") +
      "</ul>"
    );
  }

  return (
    `<ul class="nav-panel__list nav-panel__list--index" data-cols="${panel.grid.cols}" data-rows="${panel.grid.rows}">` +
    panel.items.map(linkItemHtml).join("") +
    "</ul>"
  );
}

function menuHtml(panel) {
  const feature = featuredHtml(panel.featured);
  return (
    `<li class="nav-mega" data-nav-item="${escapeHtml(panel.key)}">` +
    `<a href="${escapeHtml(panel.href)}" class="nav-top-link" aria-haspopup="true" aria-expanded="false" aria-controls="${escapeHtml(panel.panelId)}">` +
    `${escapeHtml(panel.label)} <i class="fa-regular fa-angle-down nav-top-link__chevron" aria-hidden="true"></i>` +
    "</a>" +
    // .mega-menu is kept as the panel's outer class on purpose: it is the
    // contract the mobile drawer's accordion (assets/js/script.js and the
    // <=991px rules in style.css) and two browser test harnesses already key
    // off. Everything INSIDE it is the new system.
    `<div class="mega-menu nav-panel nav-panel--${escapeHtml(panel.layout)}" id="${escapeHtml(panel.panelId)}" data-menu-panel>` +
    `<div class="mega-menu__panel-inner nav-panel__inner">` +
    `<div class="nav-panel__body">${panelBodyHtml(panel)}</div>` +
    (feature ? `<div class="nav-panel__aside">${feature}</div>` : "") +
    `<div class="nav-panel__foot">${actionHtml(panel)}</div>` +
    "</div></div></li>"
  );
}

// ---------------------------------------------------------------------------
// Build + cache
// ---------------------------------------------------------------------------
// The header is identical on every page of the site, so rendering it per
// request means re-running the same handful of queries for every visitor on
// every navigation. It is cached as finished HTML and invalidated explicitly
// whenever the CMS writes something the menu shows (see
// invalidateNavigation()'s call sites in routes/admin/*).
//
// The TTL is the belt to that braces: if a future admin route mutates
// taxonomy or products without calling the invalidator, the menu is stale for
// at most a minute rather than until the next deploy.
const TTL_MS = 60 * 1000;
let cache = { html: null, expires: 0 };

function invalidateNavigation() {
  cache = { html: null, expires: 0 };
}

async function buildNavigationHtml() {
  const trees = await getAllTaxonomyTrees();
  const visible = trees
    .filter((t) => t && t.showInNav !== false)
    .sort((a, b) => a.order - b.order);
  if (!visible.length) return "";

  const facts = await loadCatalogueFacts();
  return visible
    .map((tree) => {
      const layout = resolveLayout(tree);
      const featured = layout === "list" ? pickFeatured(tree, facts) : null;
      return menuHtml(buildPanel(tree, facts, featured));
    })
    .join("");
}

// The storefront shell must render even when taxonomy data cannot be loaded —
// a DB outage should degrade to a header with no category menus, not take
// every page on the site down with it. Same contract the old
// safeGetAllTaxonomyTrees had.
async function getNavigationHtml() {
  const now = Date.now();
  if (cache.html !== null && cache.expires > now) return cache.html;
  try {
    const html = await buildNavigationHtml();
    cache = { html, expires: now + TTL_MS };
    return html;
  } catch (err) {
    console.error("Failed to build header navigation; rendering header with no category menus.", err);
    return "";
  }
}

module.exports = {
  getNavigationHtml,
  invalidateNavigation,
  // The two pure decisions, exported so they can be reasoned about (and
  // tested) without standing up a database or a browser.
  resolveLayout,
  columnsFor,
};
