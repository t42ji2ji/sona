document.querySelectorAll("[data-set-lang]").forEach(function (b) {
  b.addEventListener("click", function () {
    var lang = b.getAttribute("data-set-lang");
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-Hant-TW" : "en";
    try { localStorage.setItem("sona-lang", lang); } catch (e) {}
    render();
  });
});

var D = window.SONA_DEMO, audio = new Audio(), current = null, voice = D && D.voices[0];
function lang() { return document.documentElement.getAttribute("data-lang"); }
function pick(o) { return o == null ? "" : typeof o === "string" ? o : o[lang()] || o.en || ""; }
function wave(el, peaks) {
  el.innerHTML = "";
  (peaks || []).forEach(function (p) { var i = document.createElement("i"); i.style.height = Math.max(6, p * 100) + "%"; el.appendChild(i); });
}
function stop() {
  audio.pause();
  if (current) { current.classList.remove("playing"); current.querySelector(".play").classList.remove("on"); paint(current, 0); }
  current = null;
}
function paint(row, f) {
  var bars = row.querySelectorAll(".wave i"), n = Math.round(f * bars.length);
  bars.forEach(function (b, k) { b.classList.toggle("done", k < n); });
}
function hook(row, src) {
  row.querySelector(".play").onclick = function () {
    if (current === row) { stop(); return; }
    stop();
    current = row; row.classList.add("playing"); row.querySelector(".play").classList.add("on");
    audio.src = src; audio.play();
  };
}
audio.ontimeupdate = function () { if (current && audio.duration) paint(current, audio.currentTime / audio.duration); };
audio.onended = stop;

function render() {
  if (!D) return;
  stop();
  var demo = document.getElementById("demo");
  demo.hidden = false;
  var tabs = demo.querySelector(".voices");
  tabs.innerHTML = "";
  D.voices.forEach(function (v) {
    var b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab"); b.textContent = pick(v.name);
    b.setAttribute("aria-selected", v === voice ? "true" : "false");
    b.onclick = function () { voice = v; render(); };
    tabs.appendChild(b);
  });
  var ref = demo.querySelector(".ref");
  ref.querySelector(".ref-sec").textContent = Math.round(voice.seconds) + (lang() === "zh" ? " 秒" : " s");
  wave(ref.querySelector(".wave"), voice.peaks);
  hook(ref, "assets/demo/" + voice.id + "-ref.mp3");
  var says = demo.querySelector(".says");
  says.innerHTML = "";
  D.lines.forEach(function (l) {
    var s = voice.says[l.id]; if (!s) return;
    var row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<button class="play" type="button" aria-label="Play"></button><div class="row-body"><p class="line-text"></p><div class="wave"></div></div>';
    row.querySelector(".line-text").textContent = l.text;
    if (l.label) { var t = document.createElement("span"); t.className = "line-tag"; t.textContent = pick(l.label); row.querySelector(".line-text").appendChild(t); }
    wave(row.querySelector(".wave"), s.peaks);
    hook(row, "assets/demo/" + voice.id + "-" + l.id + ".mp3");
    says.appendChild(row);
  });
  if (D.tone) {
    var tone = document.getElementById("tone");
    tone.hidden = false;
    ["before", "after"].forEach(function (k) {
      var row = tone.querySelector("." + k);
      row.querySelector(".tone-text").textContent = D.tone[k];
      wave(row.querySelector(".wave"), D.tone[k + "_peaks"]);
      hook(row, "assets/demo/tone-" + k + ".mp3");
    });
  }
  document.querySelector(".credit").textContent = pick(D.credit);
}
render();
