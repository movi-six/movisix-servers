/*
 * Epsilon — JKAnime
 * Funciones que la app llama:  list(page) · search(query) · detail(url) · episodes(url, image) · servers(episodeUrl)
 * Disponibles: http.get(url, headers) · http.post(url, body, headers) · http.status()
 *              util.b64decode(s) · util.htmlDecode(s) · log(msg) · CONFIG (la entrada de este server en index.json)
 * Escribe en ES5 (var / function) y usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://jkanime.net").replace(/\/+$/, "");
var EPS_PER_PAGE = 16;

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

// ───────────── Lista principal ─────────────
function list(page) {
  var url = (page <= 1) ? BASE + "/directorio" : BASE + "/directorio?p=" + page;
  var html = http.get(url);
  var out = [];

  // Intento 1: var animes = {...}
  var m = /var\s+animes\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (m) {
    try {
      var root = JSON.parse(m[1].replace(/\\\//g, "/"));
      var data = root.data || [];
      for (var i = 0; i < data.length; i++) {
        out.push({ title: data[i].title || "", url: data[i].url || "",
                   image: data[i].image || "", status: data[i].estado || "" });
      }
      if (out.length) return out;
    } catch (e) { log("JSON animes falló: " + e); }
  }

  // Intento 2: cards HTML
  var re = /<div[^>]+class="[^"]*anime__item[^"]*"[^>]*>[\s\S]*?<a\s+href="(https?:\/\/[^"]+\/)"[^>]*>[\s\S]*?data-setbg="([^"]+)"[\s\S]*?<h5[^>]*><a[^>]+>([^<]+)<\/a><\/h5>[\s\S]*?<li>([^<]*)<\/li>/g;
  var c;
  while ((c = re.exec(html)) !== null) {
    out.push({ url: c[1], image: c[2], title: clean(c[3]), status: clean(c[4]) });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query) {
  var html = http.get(BASE + "/buscar/" + encodeURIComponent(query) + "/");
  var re = /<div class="col-lg-2 col-md-6 col-sm-6"[^>]*>\s*<div class="anime__item">\s*<a\s+href="(https?:\/\/[^"]+\/)"[^>]*>[\s\S]*?data-setbg="([^"]+)"[\s\S]*?<li>([^<]+)<\/li>[\s\S]*?<h5><a[^>]+>([^<]+)<\/a><\/h5>/g;
  var out = [], c;
  while ((c = re.exec(html)) !== null) {
    out.push({ url: c[1], image: c[2], status: clean(c[3]), title: clean(c[4]) });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(animeUrl) {
  var html = http.get(animeUrl);
  var d = {}, m;

  m = /<div class="anime_info">[\s\S]*?<h3>([^<]+)<\/h3>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<span>([^<]+)<\/span>\s*<p class="scroll">/.exec(html);
  if (m) d.altTitle = m[1];

  m = /<p class="scroll">([^<]+)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /<span>Generos:<\/span>\s*([\s\S]+?)<\/li>/.exec(html);
  if (m) {
    var g = [], lm, lre = />([^<]+)<\/a>/g;
    while ((lm = lre.exec(m[1])) !== null) g.push(lm[1]);
    d.genres = g.join(", ");
  }
  return d;
}

// ───────────── Episodios (AJAX) ─────────────
function extractAnimeId(html) {
  var m = /data-anime="(\d+)"/.exec(html);
  if (m) return m[1];
  m = /\/ajax\/votado\/(\d+)/.exec(html);
  if (m) return m[1];
  m = /\/ajax\/episodes\/(\d+)\//.exec(html);
  if (m) return m[1];
  return null;
}

function extractCsrf(html) {
  var m = /<meta\s+name="csrf-token"\s+content="([^"]+)"/.exec(html);
  if (m) return m[1];
  m = /var\s+token\s*=\s*['"]([^'"]+)['"]/.exec(html);
  return m ? m[1] : "";
}

function buildCdnThumb(html) {
  var m = /src="(https?:\/\/[^"]+\/animes\/image\/[^"]+\.(?:jpg|png|webp))"/.exec(html);
  if (!m) return "";
  var t = m[1].replace("/animes/image/", "/animes/video/image_thumb/");
  var i = t.lastIndexOf("/");
  return i > 0 ? t.substring(0, i + 1) : "";
}

function fetchEpisodesPage(animeId, page, csrf, referer) {
  var body = http.post(BASE + "/ajax/episodes/" + animeId + "/" + page,
                       "_token=" + encodeURIComponent(csrf || ""), {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Origin": BASE,
    "Referer": referer,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty"
  });
  body = String(body || "").replace(/^\s+|\s+$/g, "");
  if (!body || body === "null") return null;
  return JSON.parse(body);
}

function episodes(animeUrl, animeImage) {
  var html = http.get(animeUrl);
  var animeId = extractAnimeId(html);
  if (!animeId) throw new Error("No se encontró animeId en " + animeUrl);
  var csrf = extractCsrf(html);
  var cdn = buildCdnThumb(html);
  var normalized = /\/$/.test(animeUrl) ? animeUrl : animeUrl + "/";
  var slug = animeUrl.replace(BASE + "/", "").replace(/\/+$/, "");

  var first = fetchEpisodesPage(animeId, 1, csrf, normalized);
  if (!first) throw new Error("AJAX falló id=" + animeId);

  var all = [];
  function add(data) {
    for (var i = 0; i < (data || []).length; i++) {
      var it = data[i], n = parseInt(it.number, 10) || 0, img = String(it.image || "");
      var finalImg = (img.length > 10 && cdn) ? cdn + img : (animeImage || "");
      all.push({ number: String(n), title: "Capítulo " + n,
                 url: BASE + "/" + slug + "/" + n + "/", image: finalImg, id: String(it.id || "") });
    }
  }
  add(first.data);

  var totalPages = Math.ceil((first.total || 0) / EPS_PER_PAGE);
  for (var p = 2; p <= totalPages; p++) {
    var pg = fetchEpisodesPage(animeId, p, csrf, normalized);
    if (pg) add(pg.data);
  }
  return all;
}

// ───────────── Servidores de video ─────────────
function sanitize(u) {
  if (!u) return null;
  u = String(u).replace(/^\s+|\s+$/g, "");
  if (!u) return null;
  if (/d-s\.io/i.test(u)) u = u.replace(/d-s\.io/ig, "doodstream.com");
  if (/bysekoze\.com/i.test(u)) u = u.replace(/bysekoze\.com/ig, "filemoon.sx");
  if (/sendvid\.com/i.test(u)) {
    var seg = u.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (seg) u = "https://sendvid.com/embed/" + seg;
  }
  if (/mxdrop|listeamed|mojon|fembed|videobin|embedv|javascript:/i.test(u)) return null;
  return u;
}

function servers(episodeUrl) {
  var html = http.get(episodeUrl);
  var out = [], m;

  m = /var servers\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (m) {
    var re = /"remote":"([^"]+)"/g, r;
    while ((r = re.exec(m[1])) !== null) {
      try {
        var s = sanitize(util.b64decode(r[1]));
        if (s) out.push(s);
      } catch (e) { log("b64 falló: " + e); }
    }
  }
  if (!out.length) {
    var ire = /<iframe[^>]+src=['"]([^'"]+)['"]/g, i;
    while ((i = ire.exec(html)) !== null) {
      var s2 = sanitize(i[1]);
      if (s2) out.push(s2);
    }
  }
  return out;
}
