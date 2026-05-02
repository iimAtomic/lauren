(function () {
  const btn = document.querySelector(".btn-hero-collection");
  const overlay = document.getElementById("page-transition");
  if (!btn || !overlay) return;

  const BOUTIQUE_URL = "/boutique.html";
  const EXIT_MS = 400;

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      window.location.href = BOUTIQUE_URL;
      return;
    }
    overlay.classList.add("is-active");
    document.body.classList.add("is-page-leaving");
    window.setTimeout(function () {
      window.location.href = BOUTIQUE_URL;
    }, EXIT_MS);
  });
})();
