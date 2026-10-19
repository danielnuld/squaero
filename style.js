// Style switcher. Loaded in <head> so a saved style applies before the first
// paint; then it wires the swatches in [data-style-picker]. Without JavaScript
// the page follows the system: B when light, A when dark (see site.css).
(function () {
  var KEY = "squaero-style";
  var STYLES = ["b", "a", "c", "rosa"];
  var root = document.documentElement;
  var dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  try {
    var saved = localStorage.getItem(KEY);
    if (STYLES.indexOf(saved) >= 0) root.setAttribute("data-style", saved);
  } catch (e) { /* storage blocked: follow the system */ }

  document.addEventListener("DOMContentLoaded", function () {
    var picker = document.querySelector("[data-style-picker]");
    if (!picker) return;
    var buttons = picker.querySelectorAll("button[data-pick]");
    var current = function () {
      return root.getAttribute("data-style") || (dark && dark.matches ? "a" : "b");
    };
    var sync = function () {
      var c = current();
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-pick") === c));
      }
    };
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function () {
        var v = this.getAttribute("data-pick");
        root.setAttribute("data-style", v);
        try { localStorage.setItem(KEY, v); } catch (e) { /* not remembered, still applied */ }
        sync();
      });
    }
    if (dark && dark.addEventListener) dark.addEventListener("change", sync);
    picker.hidden = false;
    sync();
  });
})();
