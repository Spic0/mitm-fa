// Inside /partnership/offer (the setup wizard framed by /partnership): tell
// the parent page how tall the wizard is, when the step changes, and when an
// enquiry has been sent. Same origin only.
(function () {
  if (window.parent === window) return;
  var origin = window.location.origin;
  function post(msg) { window.parent.postMessage(msg, origin); }
  // The body's own layout height, not the document's scrollHeight: the
  // wizard's inactive steps are absolutely positioned and can be taller than
  // the active one, so scrollHeight counts invisible steps (that was the
  // empty, scrollable area under the buttons). offer-frame.css also turns
  // the frame's own scrolling off.
  var body = document.body;
  function size() { post({ type: "fa-offer-height", height: body.getBoundingClientRect().height }); }
  if ("ResizeObserver" in window) new ResizeObserver(size).observe(body);
  window.addEventListener("load", size);
  size();
  // A new step can be shorter than the last: the parent keeps the box top in view.
  var steps = document.querySelector(".pres-setup__steps");
  var active = steps && steps.querySelector(".pres-setup__step.is-active");
  if (steps && "MutationObserver" in window) {
    new MutationObserver(function () {
      var now = steps.querySelector(".pres-setup__step.is-active");
      if (now && now !== active) {
        active = now;
        post({ type: "fa-offer-step" });
      }
    }).observe(steps, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  document.addEventListener("pres:contact-sent", function (e) {
    post({ type: "fa-offer-sent", intent: e.detail && e.detail.intent });
  });
})();
