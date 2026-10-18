/*
 * Trace — doramasyt.com (Doramas)        idx 5
 * list · search · detail (incluye episodios vía AJAX) · servers
 * 100% HTTP. Usa la cookie de sesión + token CSRF de la página (el host guarda las cookies durante la llamada).
 */
var BASE = (CONFIG.base || "https://www.doramasyt.com").replace(/\/+$/, "");
var XHR = { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" };

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}
function firstNonEmpty(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = o[keys[i]];
    if (v !== undefined && v !== null && String(v) !== "" && String(v) !== "null") return String(v);
  }
  return null;
}
function safeInt(s) { var m = /(\d+)/.exec(String(s || "")); return m ? parseInt(m[1], 10) : 0; }
function lastSegment(u) {
  u = String(u).split("?")[0].replace(/\/+$/, "");
  return u.substring(u.lastIndexOf("/") + 1);
}

function parseCards(html, re) {
  var out = [], m;
  while ((m = re.exec(html)) !== null) {
    out.push({ url: abs(m[1]), image: abs(m[2]), title: clean(m[3]), year: clean(m[4]), kind: "serie" });
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = page === 1 ? BASE + "/doramas" : BASE + "/doramas?p=" + page;
  var html = get(url);
  return parseCards(html, /<li class="col mb-5 ficha_efecto">\s*<a href="([^"]*\/dorama\/[^"]+)">\s*<div class="tarjeta position-relative">\s*<img[^>]+data-src="([^"]+)"[^>]+alt="[^"]*">[\s\S]*?<h3[^>]*>([^<]+)<\/h3>\s*<span[^>]*>([^<]+)<\/span>/g);
}

function search(query, page) {
  page = page || 1;
  var url = BASE + "/buscar?q=" + encodeURIComponent(query);
  if (page > 1) url += "&p=" + page;
  var html = get(url);
  return parseCards(html, /<li class="col mb-3 ficha_efecto">\s*<article>\s*<a href="([^"]*\/dorama\/[^"]+)">[\s\S]*?<img[^>]+data-src="([^"]+)"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi);
}

function detail(url) {
  var html = get(url), m;
  var d = { isSeries: true, episodes: [] };

  m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);                       if (m) d.title = clean(m[1]);
  m = /<div class="mt-3">\s*<p[^>]*>([^<]+)<\/p>/.exec(html);    if (m) d.synopsis = clean(m[1]);
  m = /<dt>Tipo:<\/dt>\s*<dd>([^<]+)<\/dd>/.exec(html);          if (m) d.type = clean(m[1]);
  m = /<dt>Fecha de emisi[óo]n:<\/dt>\s*<dd>([^<]+)<\/dd>/.exec(html);
  if (m) {
    d.year = clean(m[1]);
    var y = /(\d{4})/.exec(d.year);
    if (y) d.yearOnly = y[1];
  }
  m = /<meta property="og:image" content="([^"]+)"/.exec(html);  if (m) d.poster = m[1];

  var genres = [], g, gre = /href="[^"]*genero\/[^"]+"><span[^>]*>([^<]+)<\/span>/g;
  while ((g = gre.exec(html)) !== null) genres.push(clean(g[1]));
  if (genres.length) d.genres = genres.join(", ");

  var csrf = null, doramaId = null, baseEp = null;
  m = /<meta name="csrf-token" content="([^"]+)"/.exec(html);                          if (m) csrf = m[1];
  m = /data-ajax="[^"]*\/ajax\/ajax_pagination\/(\d+)"/.exec(html);                    if (m) doramaId = m[1];
  m = /href="[^"]*\/ver\/([^"]+)-episodio-\d+"/.exec(html);                            if (m) baseEp = BASE + "/ver/" + m[1];
  log("csrf=" + (csrf ? "OK" : "NULL") + " doramaId=" + doramaId + " baseEp=" + baseEp);

  var eps = [];
  if (doramaId) eps = fetchEpisodesAjax(doramaId, csrf, baseEp, d.poster || "", url);
  if (!eps.length && baseEp) eps.push({ url: baseEp + "-episodio-1", number: "1", title: "Episodio 1", image: d.poster || "" });
  d.episodes = eps;
  return d;
}

function fetchEpisodesAjax(doramaId, csrf, baseEp, fallbackImage, pageUrl) {
  var endpoint = BASE + "/ajax/ajax_pagination/" + doramaId;
  var hdrPost = { "X-Requested-With": XHR["X-Requested-With"], "Accept": XHR["Accept"], "Referer": pageUrl };
  if (csrf) hdrPost["X-CSRF-TOKEN"] = csrf;
  var result = [], body;

  try {                                                          // intento 1: POST con token
    body = http.post(endpoint, "_token=" + encodeURIComponent(csrf || ""), hdrPost);
    result = parseEpisodes(body, baseEp, fallbackImage);
    if (result.length) {
      var pu = /"paginate_url"\s*:\s*"([^"]+)"/.exec(body || "");
      if (pu) {
        var imgs = fetchEpisodeImages(pu[1].replace(/\\\//g, "/"), csrf, hdrPost);
        for (var i = 0; i < result.length; i++) {
          var real = imgs[result[i].number];
          if (real) result[i].image = real;
        }
      }
    }
  } catch (e) { log("intento1: " + e); }

  if (!result.length) {                                          // intento 2: GET
    try { result = parseEpisodes(http.get(endpoint, { "X-Requested-With": XHR["X-Requested-With"], "Accept": XHR["Accept"] }), baseEp, fallbackImage); }
    catch (e2) { log("intento2: " + e2); }
  }
  if (!result.length) {                                          // intento 3: GET ?page=1
    try { result = parseEpisodes(http.get(endpoint + "?page=1", { "X-Requested-With": XHR["X-Requested-With"], "Accept": XHR["Accept"] }), baseEp, fallbackImage); }
    catch (e3) { log("intento3: " + e3); }
  }
  result.sort(function (a, b) { return safeInt(a.number) - safeInt(b.number); });
  return result;
}

function parseEpisodes(body, baseEp, fallbackImage) {
  var out = [];
  if (!body) return out;
  var t = String(body).replace(/^\s+|\s+$/g, "");
  if (!t) return out;
  var seen = {}, m;

  if (t.charAt(0) === "{" || t.charAt(0) === "[") {
    try {
      var root = JSON.parse(t), arr;
      if (root instanceof Array) arr = root;
      else arr = root.eps || root.data || root.episodes;
      if (arr && arr.length) {
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (!it || typeof it !== "object") continue;
          var number = firstNonEmpty(it, ["num", "number", "numero", "episode", "cap", "capitulo", "id"]);
          if (number === null) number = String(out.length + 1);
          if (seen[number]) continue;
          seen[number] = true;
          var direct = firstNonEmpty(it, ["url", "link", "slug"]), epUrl;
          if (direct && /^http/i.test(direct)) epUrl = direct;
          else if (baseEp) epUrl = baseEp + "-episodio-" + number;
          else if (direct) epUrl = BASE + "/ver/" + direct;
          else continue;
          var img = firstNonEmpty(it, ["image", "imagen", "thumb"]);
          out.push({ url: epUrl, number: number, title: "Episodio " + number, image: img || fallbackImage });
        }
      }
      if (out.length) return out;
    } catch (e) { log("JSON episodios: " + e); }
  }

  seen = {};
  var re = /href="(?:https?:\/\/[^"\/]+)?(\/ver\/[^"#?]+-episodio-(\d+))"/gi;
  while ((m = re.exec(body)) !== null) {
    if (seen[m[2]]) continue;
    seen[m[2]] = true;
    out.push({ url: BASE + m[1], number: m[2], title: "Episodio " + m[2], image: fallbackImage });
  }
  return out;
}

function looksUseful(b) {
  if (!b) return false;
  var t = String(b).replace(/^\s+|\s+$/g, "").toLowerCase();
  return t.length > 20 && t.indexOf("page expired") < 0 && t.indexOf("<title>419") < 0;
}

function fetchEpisodeImages(paginateUrl, csrf, hdrPost) {
  var res = {}, body = null;
  try { body = http.get(paginateUrl, { "X-Requested-With": XHR["X-Requested-With"], "Accept": XHR["Accept"] }); } catch (e) {}
  if (!looksUseful(body)) {
    try { body = http.post(paginateUrl, "_token=" + encodeURIComponent(csrf || ""), hdrPost); } catch (e2) {}
  }
  if (!body) return res;
  var t = String(body).replace(/^\s+|\s+$/g, "");
  if (t.charAt(0) === "{" || t.charAt(0) === "[") {
    try {
      var root = JSON.parse(t), arr = (root instanceof Array) ? root : (root.eps || root.data);
      if (arr) {
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (!it) continue;
          var n = firstNonEmpty(it, ["num", "number", "numero"]);
          var im = firstNonEmpty(it, ["img", "image", "imagen", "thumb", "poster"]);
          if (n !== null && im) res[n] = im;
        }
        for (var k in res) return res;
      }
    } catch (e3) {}
  }
  var card = /<a[^>]+href="(?:https?:\/\/[^"\/]+)?\/ver\/[^"#?]+-episodio-(\d+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi, c;
  while ((c = card.exec(body)) !== null) {
    var a = /data-src="([^"]+)"/.exec(c[2]) || /\ssrc="([^"]+)"/.exec(c[2]);
    if (a) res[c[1]] = a[1];
  }
  return res;
}

function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;
  var players = [], re = /data-player="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) players.push(m[1]);

  for (var i = 0; i < players.length; i++) {
    try {
      var p = get(BASE + "/reproductor?video=" + players[i]);
      var f = /<iframe[^>]+src="([^"]+)"/i.exec(p);
      if (!f) continue;
      var u = f[1];
      if (/bysekoze\.com/i.test(u)) u = u.replace(/bysekoze\.com/gi, "filemoon.sx");
      if (/\/d\//i.test(u)) u = u.replace(/\/d\//i, "/e/");
      if (/sendvid\.com/i.test(u)) {
        var seg = lastSegment(u);
        if (seg) u = "https://sendvid.com/embed/" + seg;
      }
      var low = u.toLowerCase();
      if (low.indexOf("listeamed") < 0 && low.indexOf("mojon") < 0 && low.indexOf("fembed") < 0 &&
          low.indexOf("videobin") < 0 && low.indexOf("embedv") < 0 && low.indexOf("mediafire") < 0) out.push(u);
    } catch (e) { log("player: " + e); }
  }
  return out;
}
