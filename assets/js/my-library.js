// MY LIBRARY — /my-library
//
// Two requests, both fired at once: /auth/me (which the header wiring is
// calling anyway, and which the API layer dedupes into one round trip) and
// /library. The greeting paints from the first, the programs from the second,
// so the page is readable before the library payload lands.
//
// It renders COVERS ONLY — never a program's media library. A customer with
// eight programs downloads eight thumbnails at the size they are displayed
// at, not eight galleries. That is what the `sizes` argument on every cover
// call below is for.
(function () {
  "use strict";
  var A = window.AccountUI;
  var api = window.ProFitAPI;

  var PANELS = ["libLoading", "libSignedOut", "libContent"];

  function greet(user) {
    var name = (user && user.greetingName) || "";
    return (
      A.avatar(user) +
      '<div class="ac-greet__body">' +
      '<h1 class="ac-greet__title">' + (name ? "Welcome back, " + A.esc(name) + "." : "Welcome back.") + "</h1>" +
      '<p class="ac-greet__sub">Your programs, all in one place.</p>' +
      "</div>"
    );
  }

  // The dominant card. Its cover is the only eager image on the page and the
  // only one allowed to be large — everything below it is a thumbnail.
  function continueCard(entry) {
    var p = entry.product;
    var prog = entry.progress || {};
    var href = "/my-library/" + encodeURIComponent(p.slug);
    var meta = [p.creator, p.difficulty, p.durationWeeks ? p.durationWeeks + " weeks" : null]
      .filter(Boolean).join(" · ");

    // Resuming vs starting is a real distinction and the copy should not
    // guess: `started` is set from a stored lastOpenedAt, not inferred.
    var resuming = !!prog.started;

    // The section above the card is already headed "Continue", so this
    // eyebrow carries recency instead of repeating the word — which is also
    // the one thing a percentage cannot say: when they were last here.
    var eyebrow = prog.lastOpenedAt
      ? "Last opened " + A.relativeDate(prog.lastOpenedAt)
      : "Ready when you are";

    return (
      '<a class="ac-continue" href="' + href + '">' +
      '<span class="ac-continue__media">' +
      // 100vw below 768 (full-bleed card), then the left column of the split.
      (p.imageUrl
        ? '<img src="' + A.esc(p.imageUrl) + '" alt="" sizes="(min-width: 768px) 560px, 100vw" fetchpriority="high" decoding="async">'
        : "") +
      "</span>" +
      '<span class="ac-continue__scrim" aria-hidden="true"></span>' +
      '<span class="ac-continue__body">' +
      '<span class="ac-eyebrow">' + A.esc(eyebrow) + "</span>" +
      '<span class="ac-continue__title">' + A.esc(p.name) + "</span>" +
      (meta ? '<span class="ac-continue__meta">' + A.esc(meta) + "</span>" : "") +
      A.progress(prog, { withOpened: true }) +
      '<span class="ac-btn ac-btn--primary"><span>' +
      (resuming ? "Continue program" : "Open program") +
      '</span><i class="fa-regular fa-arrow-right" aria-hidden="true"></i></span>' +
      "</span></a>"
    );
  }

  function programCard(entry) {
    var p = entry.product;
    var prog = entry.progress || {};
    var href = "/my-library/" + encodeURIComponent(p.slug);
    // 84px thumbnail on a phone, ~320px card from 600px up. Without this the
    // browser reaches for the widest candidate in the srcset for an 84px box.
    var sizes = "(min-width: 1024px) 320px, (min-width: 600px) 45vw, 84px";

    return (
      '<a class="ac-prog" href="' + href + '">' +
      A.cover(p.imageUrl, "", sizes, false) +
      '<span class="ac-prog__body">' +
      '<span class="ac-prog__title">' + A.esc(p.name) + "</span>" +
      (p.creator ? '<span class="ac-prog__by">' + A.esc(p.creator) + "</span>" : "") +
      A.progress(prog, { withOpened: false }) +
      '<span class="ac-prog__foot">' +
      '<span class="ac-prog__cta">' + (prog.started ? "Continue" : "Open program") +
      '<i class="fa-regular fa-arrow-right" aria-hidden="true"></i></span>' +
      "</span></span></a>"
    );
  }

  function renderLibrary(library) {
    var empty = !library.length;
    A.show(A.$("libEmpty"), empty);
    A.show(A.$("libContinueWrap"), !empty);
    A.show(A.$("libProgramsWrap"), !empty);
    if (empty) return;

    // library[0] is the most recently opened — ordered server-side from real
    // timestamps, so "continue" means what it says.
    A.$("libContinue").innerHTML = continueCard(library[0]);

    var rest = library.slice(1);
    var grid = A.$("libGrid");
    if (rest.length) {
      grid.innerHTML = rest.map(programCard).join("");
      A.$("libProgramsCount").textContent =
        library.length + (library.length === 1 ? " program" : " programs");
    } else {
      // One program only: the Continue card already is the library, and an
      // empty "My programs" heading under it reads as a loading failure.
      A.show(A.$("libProgramsWrap"), false);
    }

    A.paintProgress(A.$("libContent"));
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Session first, library second — deliberately serial.
    //
    // /api/library is session-scoped, so with no session it can only 401,
    // and asking anyway puts a red error in the console of every signed-out
    // visitor for an answer we already had. It costs nothing: api.me() is
    // already in flight from the header's own auth check and get() shares
    // one promise per path, so this adds no round trip.
    api.me().then(function (me) {
      if (!me || !me.user) {
        A.panel(PANELS, "libSignedOut");
        return null;
      }
      A.$("libGreet").innerHTML = greet(me.user);
      A.panel(PANELS, "libContent");
      // A failed library read is not a signed-out state: the customer is
      // authenticated, something else went wrong, and showing them "sign in"
      // would send them round a loop that cannot fix it.
      return api.getLibrary().then(function (lib) {
        renderLibrary((lib && lib.library) || []);
        A.reveal(A.$("libContent"));
      }).catch(function () {
        // Authenticated, but the library read failed. Deliberately NOT the
        // empty state: "your library is waiting" would tell a customer who
        // owns eight programs that they own none. The greeting stays, and
        // the sections simply do not appear.
        A.show(A.$("libContinueWrap"), false);
        A.show(A.$("libProgramsWrap"), false);
        A.show(A.$("libLoadError"), true);
        A.reveal(A.$("libContent"));
      });
    }).catch(function () {
      A.panel(PANELS, "libSignedOut");
    });
  });
})();
