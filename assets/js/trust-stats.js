// The trust / social-proof band, shared by index.html and about.html.
//
// Both pages previously ended with the same section: a lowercase
// "trusted by athletes & coaches" line above a Swiper of six 60x65px PNGs —
// brand1.png ... brand6.png, the generic filler marks the Odor vape theme
// ships — presented as the logos of organisations that trust this platform.
// They are not real, so both are gone rather than restyled.
//
// Every number rendered here is COUNTED from live data on each page load.
// Nothing is stored, authored or rounded. A stat only appears when its count
// is at least 2, so the section can never read "1 Coach" and pass that off as
// proof, and if nothing clears that bar the whole section removes itself —
// no social proof beats thin social proof, and inventing a number is not an
// option.
//
// Two entry points, because the homepage already fetches this exact data for
// its other strips and must not fetch it twice:
//   render(products, taxonomies)  — called by home-dynamic.js with its data
//   [data-trust-autoload]         — the section fetches for itself (about.html)
window.TrustStats = (function () {
  function render(products, taxonomies) {
    var statsEl = document.getElementById("trustStats");
    var sectionEl = document.getElementById("trustArea");
    if (!statsEl) return;

    products = products || [];
    taxonomies = taxonomies || [];

    var coaches = {};
    products.forEach(function (p) {
      if (p.creator) coaches[p.creator] = true;
    });
    var coachCount = Object.keys(coaches).length;

    var sports = 0;
    var athletes = taxonomies.filter(function (t) { return t.key === "athletes"; })[0];
    if (athletes) sports = athletes.nodes.length;

    var candidates = [
      { value: products.length, label: products.length === 1 ? "Plan published" : "Plans published" },
      { value: coachCount, label: coachCount === 1 ? "Coach" : "Coaches & creators" },
      { value: sports, label: sports === 1 ? "Sport covered" : "Sports covered" },
    ].filter(function (s) { return s.value >= 2; });

    if (!candidates.length) {
      if (sectionEl) sectionEl.remove();
      return;
    }

    statsEl.innerHTML = "";
    candidates.forEach(function (stat) {
      var item = document.createElement("div");
      item.className = "trust__stat";

      var dd = document.createElement("dd");
      dd.className = "trust__stat-value";
      dd.textContent = String(stat.value);

      var dt = document.createElement("dt");
      dt.className = "trust__stat-label";
      dt.textContent = stat.label;

      // <dd> before <dt> visually (the number is the loud element) while the
      // list stays a valid definition list for assistive tech.
      item.appendChild(dd);
      item.appendChild(dt);
      statsEl.appendChild(item);
    });
  }

  function removeSection() {
    var sectionEl = document.getElementById("trustArea");
    if (sectionEl) sectionEl.remove();
  }

  // Self-fetch, for a page with no other reason to load the catalog. The
  // homepage deliberately does NOT carry the autoload attribute — its
  // home-dynamic.js already has this data and calls render() directly, so
  // marking the section would cost a second identical pair of requests.
  document.addEventListener("DOMContentLoaded", function () {
    var sectionEl = document.getElementById("trustArea");
    if (!sectionEl || !sectionEl.hasAttribute("data-trust-autoload")) return;
    if (!window.ProFitAPI) return removeSection();

    Promise.all([
      window.ProFitAPI.listProducts(),
      window.ProFitAPI.getTaxonomy(),
    ]).then(function (results) {
      render(results[0].products || [], results[1].taxonomies || []);
    }).catch(removeSection);
  });

  return { render: render };
})();
