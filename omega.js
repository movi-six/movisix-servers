/*
 * Omega — CuevanaPro (cuevanapro.org) · películas y series (HTTP puro, sin WebView)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Los enlaces vienen cifrados (prueba de trabajo + AES): usa util.pow / util.sha256Hex / util.aesDecrypt.
 * ES5.
 *
 * v2: la ficha cambió. Los episodios ya no son /serie/<slug>/temporada/N/capitulo/M sino
 *     /serie/<slug>#sN-eM (el hash lo resuelve el JS del sitio con /api/bootstrap/<tipo>/<slug>).
 */

// El dominio viene del index.json (campo "base"); no hay valor por defecto en el script.
var BASE = String(CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("Omega: falta \"base\" en el index.json");
// Cabeceras como las manda el navegador dentro del propio sitio (misma web: Referer/Origin/Sec-Fetch-*).
// NO se pone User-Agent ni sec-ch-*: el cliente http de la app ya manda su huella y pisarla provoca 403.
function navHeaders(referer) {            // navegar de una página del sitio a otra
  return {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": referer || (BASE + "/"),
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1"
  };
}
function xhrHeaders(referer) {            // fetch()/XHR que haría el JS del sitio
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": referer || (BASE + "/"),
    "Origin": BASE,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  };
}
function frameHeaders(referer) {          // el <iframe> del reproductor
  var h = navHeaders(referer);
  h["Origin"] = BASE;
  h["Sec-Fetch-Dest"] = "iframe";
  return h;
}

function clean(s) { return util.htmlDecode(String(s || "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function get(url, referer) {
  var h = http.get(url, navHeaders(referer));
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
  var base = String(pageUrl).split("#")[0];
  var html = get(base), m;
  var isSerie = base.indexOf("/serie/") >= 0;
  var d = { isSeries: isSerie };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<img[^>]*src="(https:\/\/[^"]+)"[^>]*class="[^"]*(?:w-64|h-96)[^"]*"/.exec(html);
  if (!m) m = /<img[^>]*src="(https:\/\/image\.tmdb\.org\/[^"]+)"/.exec(html);
  if (m) d.poster = m[1];

  m = /href="\/year\/(\d{4})"/.exec(html);
  if (m) d.year = m[1];
  m = /⭐\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/.exec(html) || /fas fa-star[^<]*<\/i>\s*([0-9.]+)\/10/.exec(html);
  if (m) d.rating = m[1];

  // Géneros: solo los de la cabecera (entre "Géneros" y el bloque de reparto), no los del pie
  var g0 = html.indexOf("Géneros");
  var g1 = g0 === -1 ? -1 : html.indexOf("detail-meta", g0);
  if (g0 !== -1) {
    var section = html.substring(g0, g1 === -1 ? g0 + 3000 : g1), seen = {}, genres = [], g;
    var gre = /href="\/generos\/[^"]+"[^>]*>([\s\S]*?)<\/a>/g;
    while ((g = gre.exec(section)) !== null) {
      var name = clean(g[1]);
      if (name && !seen[name]) { seen[name] = true; genres.push(name); }
    }
    if (genres.length) d.genres = genres.join(", ");
  }

  m = /<div class="sinopsis-text"[^>]*>([\s\S]*?)<\/div>/.exec(html) || /<h2[^>]*class="[^"]*text-gray[^"]*"[^>]*>([^<]+)<\/h2>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  // Reparto / guionistas → "director" (la app lo muestra como crédito)
  m = /Guionistas:<\/span>\s*<span class="detail-meta__value">([^<]+)</.exec(html);
  if (m) d.director = clean(m[1]);

  var episodes = [];
  if (isSerie) {
    // <a href="/serie/<slug>#s1-e1" data-episode-link ...> ... E1 ... <span class="text-blue-100 ...">Título</span>
    var re = /<a href="(\/serie\/[^"#]+)#s(\d+)-e(\d+)"[^>]*data-episode-link[^>]*>[\s\S]*?<span[^>]*class="[^"]*text-blue-100[^"]*"[^>]*>([^<]*)<\/span>/g;
    var seenEp = {};
    while ((m = re.exec(html)) !== null) {
      var key = m[2] + "x" + m[3];
      if (seenEp[key]) continue;
      seenEp[key] = true;
      episodes.push({ url: BASE + m[1] + "#s" + m[2] + "-e" + m[3], season: m[2], episode: m[3], title: clean(m[4]) || ("Episodio " + m[3]), image: "" });
    }
    // Plan B: enlaces antiguos /serie/<slug>/temporada/N/capitulo/M
    if (!episodes.length) {
      var re2 = /<a href="(\/serie\/[^"]+\/temporada\/(\d+)\/capitulo\/(\d+))"[^>]*>[\s\S]*?<span[^>]*class="[^"]*text-blue-100[^"]*"[^>]*>([^<]+)<\/span>/g;
      while ((m = re2.exec(html)) !== null) {
        episodes.push({ url: BASE + m[1], season: m[2], episode: m[3], title: clean(m[4]), image: "" });
      }
    }
  } else {
    episodes.push({ url: base, title: "Película Completa", season: "1", episode: "1", image: d.poster || "" });
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

// Abre el reproductor (/vidurl/...) y descifra los enlaces (prueba de trabajo + AES).
function resolvePlayer(vidPath, referer) {
  var out = [];
  var vid = http.get(abs(vidPath), frameHeaders(referer));
  if (!vid) throw new Error("Sin respuesta (HTTP " + http.status() + ") del reproductor");

  var challenge = jsVar(vid, "POW_CHALLENGE");
  var salt = jsVar(vid, "POW_SALT");
  if (challenge === null || salt === null) { log("Omega: el reproductor no trae POW_CHALLENGE/POW_SALT"); return out; }
  var diffStr = jsVar(vid, "POW_DIFFICULTY");
  var difficulty = diffStr ? parseInt(diffStr, 10) : 3;

  var nonce = util.pow(challenge, difficulty);
  var keyHex = util.sha256Hex(challenge + nonce + salt);

  var raw = dataLink(vid);
  if (!raw) { log("Omega: el reproductor no trae dataLink"); return out; }
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
      out.push({ url: url, name: cap(embeds[j].servername || ""), audio: lang, referer: referer });
    }
  }
  return out;
}

function servers(episodeUrl) {
  var base = String(episodeUrl).split("#")[0];
  var hm = /#s(\d+)-e(\d+)/.exec(String(episodeUrl));
  var season = hm ? hm[1] : "1", episode = hm ? hm[2] : "1";
  var tm = /\/(serie|pelicula)\/([^\/?#]+)/.exec(base);
  if (!tm) { log("Omega: URL no reconocida " + episodeUrl); return []; }

  var paths = [];
  function add(p) {
    p = String(p || "").replace(/\\\//g, "/");
    if (/^\/vidurl\//.test(p) && paths.indexOf(p) === -1) paths.push(p);
  }
  function scan(html) {
    var m, re = /data-url=\\?"([^"\\]+)\\?"/g, re2 = /<iframe[^>]*src=\\?"([^"\\]+)\\?"/g;
    while ((m = re.exec(html)) !== null) add(m[1]);
    while ((m = re2.exec(html)) !== null) add(m[1]);
  }

  // 1) API del sitio: /api/episodio/serie/<slug>/<temporada>/<episodio>  (película: sin temporada/episodio)
  var api = BASE + "/api/episodio/" + tm[1] + "/" + encodeURIComponent(tm[2]) +
            (tm[1] === "serie" ? "/" + season + "/" + episode : "");
  var body = http.get(api, xhrHeaders(base));
  if (body) {
    try {
      var j = JSON.parse(body);
      if (j && j.html) scan(j.html);
      else log("Omega: /api/episodio sin html (success=" + (j && j.success) + ")");
    } catch (e) { log("Omega: /api/episodio no es JSON: " + String(body).substring(0, 160)); }
  } else {
    log("Omega: /api/episodio sin respuesta (HTTP " + http.status() + ")");
  }

  // 2) Plan B: el iframe del reproductor viene en el HTML de la ficha (forma antigua)
  if (!paths.length) scan(get(base));

  if (!paths.length) { log("Omega: no se encontró ningún /vidurl/ para " + episodeUrl); return []; }

  var out = [], seen = {};
  for (var i = 0; i < paths.length; i++) {
    try {
      var r = resolvePlayer(paths[i], base);
      for (var k = 0; k < r.length; k++) {
        if (seen[r[k].url]) continue;
        seen[r[k].url] = true;
        out.push(r[k]);
      }
    } catch (e2) { log("Omega: falló el reproductor " + paths[i] + ": " + e2); }
  }
  return out;
}
