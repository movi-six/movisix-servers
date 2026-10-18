/*
 * Omega — CuevanaPro (cuevanapro.org) · películas y series (HTTP puro, sin WebView)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Los enlaces vienen cifrados (prueba de trabajo + AES): usa util.pow / util.sha256Hex / util.aesDecrypt.
 * ES5.
 */

var BASE = (CONFIG.base || "https://cuevanapro.org").replace(/\/+$/, "");
var HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Upgrade-Insecure-Requests": "1"
};

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function get(url) {
  var h = http.get(url, HEADERS);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/[\r\n]+/g, "");
}

function parseCardList(html) {
  var out = [];
  if (!html) return out;
  var m, cre = /<div[^>]*class="[^"]*movie-card[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*movie-card|$)/g;
  while ((m = cre.exec(html)) !== null) {
    var block = m[1];
    var um = /href="((?:https?:\/\/[^"\/]+)?\/(?:pelicula|serie)\/[^"]+)"/.exec(block);
    if (!um) continue;
    var url = abs(um[1]);
    var im = /<img[^>]*(?:src|data-src)="(https:\/\/[^"]+)"[^>]*>/.exec(block);
    var rm = /absolute top-2 right-2[^"]*"[^>]*>([^<]+)</.exec(block);
    var tm = /<h3[^>]*>([^<]+)<\/h3>/.exec(block);
    var isSerie = url.indexOf("/serie/") >= 0;
    out.push({
      url: url,
      image: im ? im[1] : "",
      title: tm ? clean(tm[1]) : "Sin título",
      rating: rm ? clean(rm[1]) : "",
      type: isSerie ? "Serie" : "Película",
      kind: isSerie ? "serie" : "movie"
    });
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseCardList(get(page <= 1 ? BASE + "/peliculas" : BASE + "/peliculas?page=" + page));
}

function search(query, page) {
  page = page || 1;
  return parseCardList(get(BASE + "/search?s=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "")));
}

function detail(pageUrl) {
  var html = get(pageUrl), m;
  var isSerie = pageUrl.indexOf("/serie/") >= 0;
  var d = { isSeries: isSerie };

  m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<img[^>]*src="(https:\/\/[^"]+)"[^>]*class="[^"]*(?:w-64|h-96)[^"]*"/.exec(html);
  if (!m) m = /<img[^>]*src="(https:\/\/image\.tmdb\.org\/[^"]+)"/.exec(html);
  if (m) d.poster = m[1];

  m = /href="\/year\/(\d{4})"/.exec(html);
  if (m) d.year = m[1];
  m = /fas fa-star[^<]*<\/i>\s*([0-9.]+)\/10/.exec(html);
  if (m) d.rating = m[1];

  var end = html.indexOf("Películas Similares");
  if (end === -1) end = html.indexOf("Series Similares");
  if (end === -1) end = html.length;
  var section = html.substring(0, end), seen = {}, genres = [], g;
  var gre = /href="\/generos\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((g = gre.exec(section)) !== null) {
    var name = g[1].replace(/^\s+|\s+$/g, "");
    if (!seen[name]) { seen[name] = true; genres.push(name); }
  }
  if (genres.length) d.genres = genres.join(", ");

  m = /<h2[^>]*class="[^"]*text-gray[^"]*"[^>]*>([^<]+)<\/h2>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  var episodes = [];
  if (isSerie) {
    var re = /<a href="(\/serie\/[^"]+\/temporada\/(\d+)\/capitulo\/(\d+))"[^>]*>[\s\S]*?<span[^>]*class="[^"]*text-blue-100[^"]*"[^>]*>([^<]+)<\/span>/g;
    while ((m = re.exec(html)) !== null) {
      episodes.push({ url: BASE + m[1], season: m[2], episode: m[3], title: clean(m[4]), image: "" });
    }
  } else {
    episodes.push({ url: pageUrl, title: "Película Completa", season: "1", episode: "1", image: d.poster || "" });
  }
  d.episodes = episodes;
  return d;
}

function jsVar(html, name) {
  var m = new RegExp("const\\s+" + name + "\\s*=\\s*['\"]([^'\"]+)['\"]").exec(html);
  if (m) return m[1];
  m = new RegExp("const\\s+" + name + "\\s*=\\s*(\\d+)").exec(html);
  return m ? m[1] : null;
}

function dataLink(html) {
  var m = /let\s+dataLink\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (m) return m[1];
  m = /dataLink\s*=\s*(\[\{[\s\S]*?\}\])/.exec(html);
  return m ? m[1] : null;
}

function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.substring(1) : s; }

function servers(episodeUrl) {
  var out = [];
  var page = get(episodeUrl);
  var vm = /<iframe[^>]*src="(\/vidurl\/[^"]+)"[^>]*>/.exec(page);
  if (!vm) return out;

  var vid = http.get(BASE + vm[1], {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": episodeUrl,
    "Origin": BASE,
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1"
  });
  if (!vid) throw new Error("Sin respuesta (HTTP " + http.status() + ") del reproductor");

  var challenge = jsVar(vid, "POW_CHALLENGE");
  var salt = jsVar(vid, "POW_SALT");
  if (challenge === null || salt === null) return out;
  var diffStr = jsVar(vid, "POW_DIFFICULTY");
  var difficulty = diffStr ? parseInt(diffStr, 10) : 3;

  var nonce = util.pow(challenge, difficulty);
  var keyHex = util.sha256Hex(challenge + nonce + salt);

  var raw = dataLink(vid);
  if (!raw) return out;
  var links = JSON.parse(raw);
  for (var i = 0; i < links.length; i++) {
    var lang = links[i].video_language || "LAT";
    var embeds = links[i].sortedEmbeds;
    if (!embeds) continue;
    for (var j = 0; j < embeds.length; j++) {
      var enc = embeds[j].link || "";
      if (!enc) continue;
      var url = util.aesDecrypt(enc, keyHex);
      if (!url) continue;
      url = url.replace(/`/g, "").replace(/^\s+|\s+$/g, "");
      if (/bysedikamoum\.com/i.test(url)) url = url.replace(/bysedikamoum\.com/ig, "filemoon.sx");
      out.push({ url: url, name: cap(embeds[j].servername || ""), audio: lang, referer: episodeUrl });
    }
  }
  return out;
}
