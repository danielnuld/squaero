// Manual contents: on narrow screens it starts folded and folds again after a
// jump; everywhere it marks the section being read. Without JavaScript it is
// simply an open list. Loaded right after the contents block, not deferred, so
// folding it does not shift the page.
(function () {
  var toc = document.querySelector("details.toc");
  if (!toc) return;
  var narrow = window.matchMedia("(max-width: 960px)");
  if (narrow.matches) toc.open = false;
  narrow.addEventListener("change", function () { toc.open = !narrow.matches; });

  var links = {};
  toc.querySelectorAll("a[href^='#']").forEach(function (a) {
    links[a.getAttribute("href").slice(1)] = a;
    a.addEventListener("click", function () { if (narrow.matches) toc.open = false; });
  });
  if (!("IntersectionObserver" in window)) return;
  document.addEventListener("DOMContentLoaded", function () {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || !links[e.target.id]) return;
        for (var id in links) links[id].removeAttribute("aria-current");
        links[e.target.id].setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    document.querySelectorAll(".prose section[id]").forEach(function (s) { io.observe(s); });
  });
})();
