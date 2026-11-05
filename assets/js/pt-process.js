// /partnership "What you get": the partnership cycle. The steps are a real
// <ol> in the page (server/src/routes/pages.js); this draws the connectors
// into its SVG from where the badges actually are (so any layout or font
// works), then walks a light pulse along them, lighting each step in turn:
// ~1.1s a step, 7 links + the 8 -> 5 return, 9.5s a loop.
//
// One clock drives everything: draw(t) is a pure function of time, with no
// CSS transitions involved, so tools/record-process-loop.js can step it
// frame by frame for the GIF/webm export. Paused while off screen. With
// prefers-reduced-motion it draws the static diagram once and never moves.
(function () {
  var root = document.querySelector("[data-process]");
  if (!root) return;
  var svg = root.querySelector(".pt-proc__svg");
  var steps = [].slice.call(root.querySelectorAll(".pt-proc__step"));
  var grow = root.querySelector(".pt-proc__grow");
  if (!svg || steps.length < 5) return;

  var NS = "http://www.w3.org/2000/svg";
  var STEP = 1100; // ms per link
  var TRAVEL = 0.72; // share of a link spent moving; the rest, the step glows
  var HOLD = 700; // after the return lands on step 5
  var SEGS = steps.length; // links 1-2 ... 7-8, then 8 -> 5
  var LOOP = SEGS * STEP + HOLD;
  var BACK = 4; // index of step 5, where the cycle returns
  var GAP = 6; // between a connector's end and its badge or card
  var RAD = 18; // corner radius
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wide = window.matchMedia("(min-width: 1024px)");
  var segs = [];
  var pulse = null;
  var arrivals = [];
  var current = 0;

  function make(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function f(n) { return Math.round(n * 10) / 10; }

  // Layout positions relative to the diagram, from offsets: the steps fade up
  // on scroll (reveal.js translateY), and a transform must not bend the lines.
  function pos(el) {
    var x = 0, y = 0;
    for (var e = el; e && e !== root; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x: x, y: y };
  }
  function geometry() {
    return steps.map(function (s) {
      var n = s.querySelector(".pt-proc__n");
      var c = s.querySelector(".pt-proc__card");
      var np = pos(n), cp = pos(c);
      return { x: np.x + n.offsetWidth / 2, y: np.y + n.offsetHeight / 2, r: n.offsetWidth / 2, bottom: cp.y + c.offsetHeight, w: root.clientWidth };
    });
  }

  // Path strings, in order: each link, then the return from the last step to step 5.
  function paths(g) {
    var out = [];
    var last = g[g.length - 1];
    var back = g[BACK];
    if (wide.matches) {
      // Snake: rows run along the badges; the row change turns outside the
      // grid on the right; the return runs under row 2.
      for (var i = 0; i < g.length - 1; i++) {
        var a = g[i], b = g[i + 1];
        if (Math.abs(a.y - b.y) < 2) {
          var d = b.x > a.x ? 1 : -1;
          out.push("M" + f(a.x + d * (a.r + GAP)) + " " + f(a.y) + "H" + f(b.x - d * (b.r + GAP)));
        } else {
          var R = a.w - 16;
          out.push("M" + f(a.x + a.r + GAP) + " " + f(a.y) + "H" + f(R - RAD) +
            "A" + RAD + " " + RAD + " 0 0 1 " + f(R) + " " + f(a.y + RAD) + "V" + f(b.y - RAD) +
            "A" + RAD + " " + RAD + " 0 0 1 " + f(R - RAD) + " " + f(b.y) + "H" + f(b.x + b.r + GAP));
        }
      }
      var low = 0;
      for (var j = BACK; j < g.length; j++) low = Math.max(low, g[j].bottom);
      var L = low + 30;
      out.push("M" + f(last.x) + " " + f(last.bottom + GAP) + "V" + f(L - RAD) +
        "A" + RAD + " " + RAD + " 0 0 0 " + f(last.x + RAD) + " " + f(L) + "H" + f(back.x - RAD) +
        "A" + RAD + " " + RAD + " 0 0 0 " + f(back.x) + " " + f(L - RAD) + "V" + f(back.bottom + GAP));
      if (grow) grow.style.top = f(L + 14) + "px";
    } else {
      // Timeline: down the badges; the return runs up to the left of them.
      for (var k = 0; k < g.length - 1; k++) {
        out.push("M" + f(g[k].x) + " " + f(g[k].y + g[k].r + GAP) + "V" + f(g[k + 1].y - g[k + 1].r - GAP));
      }
      var X = last.x - last.r - 16;
      out.push("M" + f(last.x - last.r - GAP) + " " + f(last.y) + "H" + f(X + RAD) +
        "A" + RAD + " " + RAD + " 0 0 1 " + f(X) + " " + f(last.y - RAD) + "V" + f(back.y + RAD) +
        "A" + RAD + " " + RAD + " 0 0 1 " + f(X + RAD) + " " + f(back.y) + "H" + f(back.x - back.r - GAP));
      if (grow) grow.style.top = "";
    }
    return out;
  }

  function build() {
    var g = geometry();
    if (!g[0].r) return; // not laid out (hidden)
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + root.clientWidth + " " + root.clientHeight);
    var defs = make("defs", {});
    var marker = make("marker", { id: "ptProcArrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto" });
    marker.appendChild(make("path", { d: "M0 0L10 5L0 10z", "class": "pt-proc__arrow" }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    segs = paths(g).map(function (d) {
      var base = make("path", { d: d, "class": "pt-proc__base", "marker-end": "url(#ptProcArrow)" });
      var lit = make("path", { d: d, "class": "pt-proc__lit" });
      svg.appendChild(base);
      svg.appendChild(lit);
      return { base: base, lit: lit, len: base.getTotalLength() };
    });
    pulse = make("circle", { r: "4.5", "class": "pt-proc__pulse" });
    svg.appendChild(pulse);
    // When each step is reached: step 1 at the start (and again at the loop's
    // end), each next step as its link's pulse arrives, step 5 again on the return.
    arrivals = steps.map(function () { return []; });
    arrivals[0].push(0, LOOP);
    for (var i = 0; i < SEGS; i++) arrivals[i === SEGS - 1 ? BACK : i + 1].push(i * STEP + TRAVEL * STEP);
    if (reduce) still(); else draw(current);
  }

  function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  // 0..1: up over 120ms before the pulse lands, down over 1.5s after.
  function glow(t, times) {
    var h = 0;
    for (var i = 0; i < times.length; i++) {
      var d = t - times[i];
      if (d >= -120 && d < 0) h = Math.max(h, 1 + d / 120);
      else if (d >= 0 && d < 1500) h = Math.max(h, 1 - d / 1500);
    }
    return h;
  }

  function setGlow(el, h) {
    el.style.setProperty("--h", h.toFixed(3));
    el.classList.toggle("is-on", h > 0.5);
  }

  function draw(t) {
    if (!segs.length) return;
    t = ((t % LOOP) + LOOP) % LOOP;
    current = t;
    var k = Math.min(SEGS - 1, Math.floor(t / STEP));
    var p = Math.min(1, (t - k * STEP) / (STEP * TRAVEL));
    var e = ease(p);
    segs.forEach(function (s, i) {
      s.lit.style.strokeDasharray = (i === k ? f(s.len * e) : 0) + " " + f(s.len + 2);
      // the link the pulse just finished fades as the step glows
      s.lit.style.opacity = i === k ? String(p < 1 ? 1 : Math.max(0, 1 - (t - k * STEP - STEP * TRAVEL) / 400)) : "0";
    });
    var at = segs[k].base.getPointAtLength(segs[k].len * e);
    pulse.setAttribute("cx", f(at.x));
    pulse.setAttribute("cy", f(at.y));
    pulse.style.opacity = p < 1 ? "1" : "0";
    steps.forEach(function (s, i) { setGlow(s, glow(t, arrivals[i])); });
    if (grow) setGlow(grow, t >= (SEGS - 1) * STEP ? Math.max(0, Math.min(1, (t - (SEGS - 1) * STEP) / 250, (LOOP - t) / 250)) : 0);
  }

  function still() {
    segs.forEach(function (s) { s.lit.style.opacity = "0"; });
    if (pulse) pulse.style.opacity = "0";
    steps.forEach(function (s) { setGlow(s, 0); });
    if (grow) setGlow(grow, 0);
  }

  var raf = 0;
  var running = false;
  var t0 = 0;
  var base = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    draw(base + now - t0);
  }
  function start() {
    if (running || reduce) return;
    running = true;
    base = current;
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
  }

  build();
  var pending = 0;
  function rebuild() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(build);
  }
  if ("ResizeObserver" in window) new ResizeObserver(rebuild).observe(root);
  else window.addEventListener("resize", rebuild);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild).catch(function () {});

  if (!reduce) {
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[entries.length - 1].isIntersecting) start();
        else stop();
      }, { threshold: 0.15 }).observe(root);
    } else {
      start();
    }
  }

  // For the export script: stop the clock and draw any moment of the loop.
  root.ptProcess = { draw: draw, stop: stop, start: start, build: build, loop: LOOP };
})();
