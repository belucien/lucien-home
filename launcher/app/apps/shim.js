/* Lucien Home: the app's own screens run here, and google.script.run saves through the launcher
   to the same Google Sheet the phone apps use. */
(function () {
  "use strict";
  const bridge = window.lhApp;
  const run = (ok, fail) => new Proxy({}, {
    get(_, fn) {
      if (fn === "withSuccessHandler") return h => run(h, fail);
      if (fn === "withFailureHandler") return h => run(ok, h);
      if (fn === "withUserObject") return () => run(ok, fail);
      if (typeof fn !== "string") return undefined;
      return (...args) => {
        bridge.rpc(fn, args).then(r => {
          if (r && r.error) { if (fail) fail(new Error(r.error)); }
          else if (ok) ok(r ? r.value : null);
        }).catch(e => { if (fail) fail(e instanceof Error ? e : new Error(String(e))); });
      };
    }
  });
  window.google = { script: {
    run: run(null, null),
    url: { getLocation: cb => { bridge.location().then(l => cb(l)).catch(() => cb({ parameter: {}, parameters: {}, hash: "" })); } },
    host: { close() {}, setHeight() {}, setWidth() {}, editor: { focus() {} }, origin: location.origin }
  } };
  document.documentElement.classList.add("in-lucien-home");
})();
