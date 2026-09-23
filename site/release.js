// Fills the download section from the latest GitHub release: the version, and
// each button pointing straight at its file. Without JavaScript, or if GitHub
// does not answer, the buttons keep linking to the releases page.
// The hero's main button follows the visitor's system (Windows, Mac or Linux).
(function () {
  var me = document.currentScript;
  var fill = function (tpl, v) { return tpl.replace("{v}", v); };

  var os = /Mac/.test(navigator.platform || navigator.userAgent) ? "mac"
    : /Linux/.test(navigator.platform || "") && !/Android/.test(navigator.userAgent) ? "linux"
    : "win";
  var primary = document.querySelector("[data-primary-dl]");
  var other = document.querySelector("[data-other-dl]");
  if (os !== "win" && primary && other) {
    primary.textContent = me.getAttribute("data-" + os + "-first");
    other.textContent = me.getAttribute("data-" + os + "-other");
  }
  var suffix = { win: "-x64.msi", mac: "-arm64.dmg", linux: "_amd64.deb" }[os];

  fetch("https://api.github.com/repos/danielnuld/squaero/releases/latest")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (rel) {
      var v = String(rel.tag_name || "").replace(/^v/, "");
      var assets = rel.assets || [];
      var find = function (end) {
        for (var i = 0; i < assets.length; i++) {
          if (assets[i].name.slice(-end.length) === end) return assets[i];
        }
        return null;
      };
      document.querySelectorAll("[data-asset]").forEach(function (a) {
        var hit = find(a.getAttribute("data-asset"));
        if (hit) a.href = hit.browser_download_url;
      });
      document.querySelectorAll("[data-file]").forEach(function (el) {
        var hit = find(el.getAttribute("data-file"));
        if (hit) el.textContent = hit.name;
      });
      var hit = find(suffix);
      if (primary && hit) primary.href = hit.browser_download_url;
      if (v) {
        var line = document.querySelector("[data-version-line]");
        if (line) line.textContent = fill(me.getAttribute("data-version-label"), v) + ". " + line.textContent;
        var title = document.querySelector("[data-dl-title]");
        if (title) title.textContent = fill(me.getAttribute("data-title"), v);
      }
    })
    .catch(function () { /* keep the releases-page links */ });
})();
