/*
 * Turbet — hentaijk.com (H-Animes, adulto)        idx 13
 * list · search · detail (incluye episodios vía AJAX paginado) · servers
 * 100% HTTP. Cookie de sesión + token CSRF (el host guarda las cookies durante la llamada).
 */
var BASE = (CONFIG.base || "https://hentaijk.com").replace(/\/+$/, "");
var EPS_PER_PAGE = 12;

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}
function lastSegment(u) {
  u = String(u).split("?")[0].replace(/\/+$/, "");
  return u.substring(u.lastIndexOf("/") + 1);
}
function epNum(s) {
  var m, last = -1, re = /(\d+)/g;
  while ((m = re.exec(String(s || ""))) !== null) last = parseInt(m[1], 10);
  return last;
}

var CARD = /<div class="col-lg-2 col-md-6 col-sm-6"[^>]*>\s*<div class="anime__item">\s*<a\s+href="([^"]+\/)"[^>]*>[\s\S]*?data-setbg="([^"]+)"[\s\S]*?<li>([^<]+)<\/li>[\s\S]*?<h5><a[^>]+>([^<]+)<\/a><\/h5>/g;

function parseCards(html) {
  var out = [], m, re = new RegExp(CARD.source, "g");
  while ((m = re.exec(html)) !== null) out.push({ url: m[1], image: m[2], status: clean(m[3]), title: clean(m[4]), kind: "serie" });
  return out;
}

function list(page) {
  page = page || 1;
  var html = get(page === 1 ? BASE + "/directorio" : BASE + "/directorio?p=" + page);
  var sm = /var\s+animes\s*=\s*(\{[\s\S]*?\});/.exec(html);
  if (sm) {
    try {
      var root = JSON.parse(sm[1].replace(/\\\//g, "/")), data = root.data || [], out = [];
      for (var i = 0; i < data.length; i++) {
        var it = data[i];
        out.push({ title: String(it.title || ""), url: String(it.url || ""), image: String(it.image || ""), status: String(it.estado || ""), kind: "serie" });
      }
      if (out.length) return out;
    } catch (e) { log("animes JSON: " + e); }
  }
  return parseCards(html);
}

function search(query, page) {
  if (page && page > 1) return [];
  return parseCards(get(BASE + "/buscar/" + encodeURIComponent(query) + "/"));
}

function extractAnimeId(html) {
  var m = /data-anime="(\d+)"/.exec(html) || /\/ajax\/votado\/(\d+)/.exec(html) || /\/ajax\/episodes\/(\d+)\//.exec(html);
  return m ? m[1] : null;
}
function extractCsrf(html) {
  var m = /<meta\s+name="csrf-token"\s+content="([^"]+)"/.exec(html) || /var\s+token\s*=\s*['"]([^'"]+)['"]/.exec(html);
  return m ? m[1] : "";
}
function buildCdnThumb(html) {
  var m = /src="(https:\/\/[^"]+\/animes\/image\/[^"?]+\.(?:jpg|png|webp)[^"]*)"/.exec(html);
  if (!m) return "";
  var raw = m[1], q = raw.indexOf("?");
  if (q > 0) raw = raw.substring(0, q);
  var t = raw.replace("/animes/image/", "/animes/video/image_thumb/"), ls = t.lastIndexOf("/");
  return ls > 0 ? t.substring(0, ls + 1) : "";
}

function fetchEpisodesPage(animeId, page, csrf, animeUrl) {
  var res = http.post(BASE + "/ajax/episodes/" + animeId + "/" + page, "_token=" + encodeURIComponent(csrf || ""), {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Origin": BASE,
    "Referer": animeUrl || (BASE + "/"),
    "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"
  });
  res = String(res || "").replace(/^\s+|\s+$/g, "");
  if (!res || res === "null") return null;
  return JSON.parse(res);
}

function parseEpisodePage(data, slug, animeImage, cdnThumb, out) {
  for (var i = 0; i < data.length; i++) {
    var it = data[i], number = parseInt(it.number, 10) || 0, image = String(it.image || ""), finalImage;
    if (image.length > 10 && cdnThumb) finalImage = cdnThumb + image;
    else finalImage = animeImage || "";
    out.push({ number: String(number), title: "Episodio " + number, url: BASE + "/" + slug + "/" + number + "/", image: finalImage, id: String(it.id || "") });
  }
}

function detail(animeUrl) {
  var html = get(animeUrl), m;
  var d = { isSeries: true, episodes: [] };

  m = /<div class="anime_info">[\s\S]*?<h3>([^<]+)<\/h3>/.exec(html);   if (m) d.title = clean(m[1]);
  m = /<span>([^<]+)<\/span>\s*<p class="scroll">/.exec(html);          if (m) d.altTitle = clean(m[1]);
  m = /<p class="scroll">([^<]+)<\/p>/.exec(html);                      if (m) d.synopsis = clean(m[1]);
  m = /<span>Generos:<\/span>\s*([\s\S]+?)<\/li>/.exec(html);
  if (m) {
    var gs = [], g, gre = />([^<]+)<\/a>/g;
    while ((g = gre.exec(m[1])) !== null) gs.push(g[1]);
    if (gs.length) d.genres = gs.join(", ");
  }
  var og = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (og) d.poster = og[1];

  var animeId = extractAnimeId(html), csrf = extractCsrf(html);
  if (!animeId) throw new Error("No se encontró animeId en " + animeUrl);
  var cdnThumb = buildCdnThumb(html);
  var normUrl = /\/$/.test(animeUrl) ? animeUrl : animeUrl + "/";
  var slug = animeUrl.replace(BASE + "/", "").replace(/\/+$/, "");
  var animeImage = d.poster || "";

  var first = fetchEpisodesPage(animeId, 1, csrf, normUrl);
  if (!first) throw new Error("AJAX de episodios falló (id=" + animeId + ")");
  var all = [];
  if (first.data) parseEpisodePage(first.data, slug, animeImage, cdnThumb, all);
  var total = parseInt(first.total, 10) || 0, pages = Math.ceil(total / EPS_PER_PAGE);
  for (var p = 2; p <= pages; p++) {
    try {
      var pg = fetchEpisodesPage(animeId, p, csrf, normUrl);
      if (pg && pg.data) parseEpisodePage(pg.data, slug, animeImage, cdnThumb, all);
    } catch (e) { log("página " + p + ": " + e); }
  }
  if (all.length > 1) {
    var a = epNum(all[0].number), b = epNum(all[all.length - 1].number);
    if (a > b && a !== -1) all.reverse();
  }
  d.episodes = all;
  return d;
}

function sanitize(url) {
  if (!url) return null;
  url = String(url).replace(/^\s+|\s+$/g, "");
  if (!url) return null;
  if (/doodstream\.com/i.test(url)) url = url.replace(/doodstream\.com/gi, "d-s.io");
  if (/bysekoze\.com/i.test(url)) url = url.replace(/bysekoze\.com/gi, "filemoon.sx");
  if (/sendvid\.com/i.test(url)) {
    var s1 = lastSegment(url);
    if (s1) url = "https://sendvid.com/embed/" + s1;
  }
  if (/filemoon\.sx/i.test(url)) {
    var s2 = lastSegment(url);
    if (s2) url = "https://filemoon.sx/bkg/" + s2;
  }
  var low = url.toLowerCase();
  if (low.indexOf("mxdrop") >= 0 || low.indexOf("listeamed") >= 0 || low.indexOf("mixdrop") >= 0 ||
      low.indexOf("mojon") >= 0 || low.indexOf("fembed") >= 0 || low.indexOf("videobin") >= 0 ||
      low.indexOf("embedv") >= 0 || low.indexOf("mediafire") >= 0 || low.indexOf("javascript:") >= 0) return null;
  return url;
}

function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;
  var sm = /var servers\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (sm) {
    var re = /"remote":"([^"]+)"/g;
    while ((m = re.exec(sm[1])) !== null) {
      try {
        var u = sanitize(util.b64decode(m[1]));
        if (u) out.push(u);
      } catch (e) {}
    }
  }
  if (!out.length) {
    var ire = /<iframe[^>]+src=['"]([^'"]+)['"]/g;
    while ((m = ire.exec(html)) !== null) {
      var s = sanitize(m[1]);
      if (s) out.push(s);
    }
  }
  return out;
}
