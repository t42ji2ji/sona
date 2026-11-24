document.querySelectorAll("[data-set-lang]").forEach(function (b) {
  b.addEventListener("click", function () {
    var lang = b.getAttribute("data-set-lang");
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-Hant-TW" : "en";
    try { localStorage.setItem("sona-lang", lang); } catch (e) {}
  });
});
