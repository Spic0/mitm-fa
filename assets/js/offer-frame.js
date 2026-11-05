// Inside /partnership/offer (the setup wizard framed by /partnership): tell
// the parent page how tall the wizard is, and when an enquiry has been sent.
// Same origin only.
(function () {
  if (window.parent === window) return;
  var origin = window.location.origin;
  function post(msg) { window.parent.postMessage(msg, origin); }
  // The content's own height: the document's scrollHeight never drops below
  // the frame's current height, so the frame could grow but never shrink.
  var main = document.querySelector("main");
  function size() { post({ type: "fa-offer-height", height: main.getBoundingClientRect().height }); }
  if ("ResizeObserver" in window) new ResizeObserver(size).observe(main);
  window.addEventListener("load", size);
  size();
  document.addEventListener("pres:contact-sent", function (e) {
    post({ type: "fa-offer-sent", intent: e.detail && e.detail.intent });
  });
})();
