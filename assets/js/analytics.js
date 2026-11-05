// PostHog bootstrap. Injected after the shared header by inlineHeader
// (server/src/routes/pages.js) only when POSTHOG_KEY is set, right after the
// self-hosted posthog-js. Every caller goes through window.faTrack and guards
// on it, so a blocked or unconfigured PostHog never breaks a page.
(function () {
  var el = document.currentScript;
  var key = el && el.getAttribute("data-key");
  var ph = window.posthog;
  if (!key || !ph || typeof ph.init !== "function") return;

  ph.init(key, {
    api_host: el.getAttribute("data-host"),
    person_profiles: "identified_only",
    // Nothing loads from PostHog's CDN: CSP allows only 'self' scripts.
    disable_external_dependency_loading: true,
    disable_session_recording: true,
    disable_surveys: true,
  });

  window.faTrack = {
    capture: function (event, props) { ph.capture(event, props); },
    // Distinct id is the internal user id, never the email.
    identify: function (id, props) {
      if (ph.get_distinct_id() !== String(id)) ph.identify(String(id), props);
    },
    reset: function () { ph.reset(); },
  };
})();
