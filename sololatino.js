/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 *
 * Supone http.get(url, headers), http.post(url, body, headers) y http.status(),
 * igual que el script de Omega/CuevanaPro. Si http.post tiene otra firma, ajusta apiCall().
 */

var BASE = (CONFIG.base || "https://sololatino.net").replace(/\/+$/, "");
var warmed = false;
var MAX_RESOLVE = 12;

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function absOn(origin, u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return origin + (u.charAt(0) === "/" ? "" : "/") + u;
}

function originOf(u) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(str(u));
  return m ? m[1] : "";
}

// ───────────── HTTP ─────────────
// Igual que Omega: SIN User-Agent ni sec-ch-* / Sec-Fetch-*. El cliente http ya manda su propia
// huella de navegador; pisarla con una distinta es lo que suele provocar el 403.
function getHtml(url, referer) {
  var h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1"
  };
  if (referer) h["Referer"] = referer;
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return body;
}

function warmUp() {
  if (warmed) return;
  try { getHtml(BASE + "/"); } catch (e) {}
  warmed = true;
}

// ───────────── Tarjetas (lista y buscador) ─────────────
function parseCards(html) {
  var out = [], seen = {};
  var chunks = String(html).split('<div class="card">');
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i], m;
    m = /<a href="([^"]+)"/.exec(c);
    if (!m) continue;
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    var img = (/<img[^>]+src="([^"]+)"/.exec(c) || [])[1] || "";
    var title = (/class="card__title">([^<]+)<\/span>/.exec(c) || /alt="([^"]+)"/.exec(c) || [])[1] || "";
    var rating = (/card__rating">★\s*([0-9.]+)/.exec(c) || [])[1] || "";
    var year = (/card__year">\s*([^<\s]+)\s*</.exec(c) || [])[1] || "";

    out.push({
      title: clean(title),
      url: url,
      image: abs(img),
      rating: rating,
      year: year,
      type: url.indexOf("/serie/") !== -1 ? "serie" : "movie"
    });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  warmUp();
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url, BASE + "/"));
}

// ───────────── Búsqueda ─────────────
// Prueba la ruta conocida y alguna alternativa. Cada intento deja en el log el HTTP status
// y el inicio del cuerpo, para ver si el 403 es de Cloudflare o de otra cosa.
function search(query, page) {
  page = page || 1;
  warmUp();
  var q = encodeURIComponent(query);
  var pg = page > 1 ? "&page=" + page : "";
  var urls = [
    BASE + "/buscar?q=" + q + pg,
    BASE + "/search?q=" + q + pg,
    BASE + "/?s=" + q + pg
  ];
  for (var i = 0; i < urls.length; i++) {
    try {
      var html = http.get(urls[i], {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Referer": BASE + "/"
      });
      if (!html) { log("SoloLatino search " + urls[i] + " → HTTP " + http.status()); continue; }
      var cards = parseCards(html);
      if (cards.length) return cards;
      log("SoloLatino search " + urls[i] + " → HTTP " + http.status() + ", 0 tarjetas, inicio: " + String(html).substring(0, 150).replace(/\s+/g, " "));
    } catch (e) {
      log("SoloLatino search " + urls[i] + " error: " + e);
    }
  }
  return [];
}

// ───────────── Detalle ─────────────
function detail(url) {
  warmUp();
  var html = getHtml(url, BASE + "/"), m;
  var isSeries = url.indexOf("/serie/") !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, ""));

  m = /<img src="(https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^"]+)"[\s\S]*?class="w-44 md:w-52 rounded-2xl shadow-2xl"/.exec(html);
  if (m) d.poster = m[1];
  m = /background-image:url\('(https:\/\/image\.tmdb\.org\/t\/p\/w1280\/[^']+)'\)/.exec(html);
  if (m) d.banner = m[1];
  if (!d.poster && d.banner) d.poster = d.banner;

  m = /<p class="text-sm leading-relaxed mb-6 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (!m) m = /<p class="text-sm leading-relaxed mb-5 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));

  m = /<span>(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];

  m = /rating-badge__val">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = m[1];

  var genres = [];
  var genreRe = /<a href="https:\/\/sololatino\.net\/genero\/[^"]+"[\s\S]*?>\s*([^<]+?)\s*<\/a>/g;
  while ((m = genreRe.exec(html)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  if (isSeries) {
    var epRe = /<a href="([^"]+\/temporada-\d+\/episodio-\d+)"[\s\S]*?class="ep-thumb"[\s\S]*?<p class="ep-num">([^<]+)<\/p>[\s\S]*?<p class="text-sm font-semibold text-white leading-tight">\s*([\s\S]*?)<\/p>/g;
    while ((m = epRe.exec(html)) !== null) {
      d.episodes.push({ title: clean(m[2]) + " - " + clean(m[3]), url: abs(m[1]), image: "" });
    }
  }

  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Player: flujo /s.php ─────────────
// El HTML del embed no trae los servidores. El player hace:
//   POST /s.php a=1                  -> {s:[[label,url],...], langs_s:{LANG:[[label,url],...]}}
//   POST /s.php a=click              -> habilita la sesión
//   POST /s.php a=2 v=<url servidor> -> {type:"iframe",url} | {type:"mp4",u} | {u:<m3u8>,sig}
// Cada petición lleva tok (del HTML), rt (_qv) y, tras el click, tk.

// FNV-1a de 32 bits, igual que _qh() del player (sin Math.imul).
function fnv(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(16);
}

function pageVars(html) {
  var t = /const _t\s*=\s*'([^']+)'/.exec(html);
  var qc = /var _qc\s*=\s*"([^"]+)"/.exec(html);
  var qk = /var _qk\s*=\s*\[([^\]]*)\]/.exec(html);
  if (!t || !qc || !qk) return null;
  var parts = [], re = /"([^"]*)"/g, m;
  while ((m = re.exec(qk[1])) !== null) parts.push(m[1]);
  if (parts.length < 4) return null;
  var qv = parts[1] + parts[3] + parts[0] + parts[2];
  return { tok: t[1], qv: qv, tk: fnv(qv + "|clk|" + qc[1]) };
}

function apiCall(origin, embed, vars, params, withTk) {
  var p = {};
  for (var k in params) p[k] = params[k];
  p.tok = vars.tok;
  p.rt = vars.qv;
  p.tk = withTk ? vars.tk : "";
  var body = [];
  for (var key in p) body.push(encodeURIComponent(key) + "=" + encodeURIComponent(p[key]));
  var res;
  try {
    res = http.post(origin + "/s.php", body.join("&"), {
      "Accept": "*/*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Origin": origin,
      "Referer": embed
    });
  } catch (e) {
    log("SoloLatino /s.php error: " + e);
    return null;
  }
  if (!res) { log("SoloLatino /s.php sin respuesta (HTTP " + http.status() + ")"); return null; }
  try { return JSON.parse(res); } catch (e2) {
    log("SoloLatino /s.php no es JSON (HTTP " + http.status() + "): " + String(res).substring(0, 200));
    return null;
  }
}

function doClick(origin, embed, vars) {
  var j = apiCall(origin, embed, vars, { a: "click", ts: "1" }, true);
  return !!(j && j.ok);
}

function resolveServer(origin, embed, vars, srvUrl) {
  var d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  if (d && d.type === "error" && d.msg === "no_click") {
    doClick(origin, embed, vars);
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  } else if (d && (d.error === "retry_once" || d.error === "busy")) {
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  }
  if (!d) return "";
  if (d.type === "iframe" && d.url) return d.url;
  if (d.type === "mp4" && d.u) return absOn(origin, d.u);
  if (d.u) return origin + "/p.php?url=" + encodeURIComponent(d.u) + "&sig=" + encodeURIComponent(d.sig || "");
  log("SoloLatino: servidor sin URL → " + JSON.stringify(d));
  return "";
}

// Localiza el embed en la página de sololatino. Orden: embed69, unlimplay, cualquier iframe,
// y por último construirlo con el IMDb id (el player usa /f/<imdb>; en series, <imdb>-<T>x<E>).
function findEmbed(html, episodeUrl, isSeries) {
  var h = String(html).replace(/\\\//g, "/");
  var season = (/temporada-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
  var episode = (/episodio-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
  var m = /https?:\/\/(?:www\.)?embed69\.org\/f\/[A-Za-z0-9_-]+/i.exec(h);
  if (m) return m[0];
  m = /https?:\/\/(?:www\.)?unlimplay\.com\/play\/embed\/[A-Za-z0-9_\/-]+/i.exec(h);
  if (m) return m[0];
  m = /<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(h);
  if (m && !/youtube|google|facebook|twitter/i.test(m[1])) return abs(m[1]);
  m = /imdb\.com\/title\/(tt\d+)/.exec(h);
  if (m) return "https://embed69.org/f/" + m[1] + (isSeries ? "-" + season + "x" + episode : "");
  m = /themoviedb\.org\/(?:movie|tv)\/(\d+)/.exec(h);
  if (m) {
    return isSeries
      ? "https://unlimplay.com/play/embed/tv/" + m[1] + "/" + season + "/" + episode
      : "https://unlimplay.com/play/embed/movie/" + m[1];
  }
  return "";
}

// ───────────── Método Omega: POW + AES sobre dataLink ─────────────
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

function b64decode(s) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
  var out = "", bits = 0, val = 0;
  for (var i = 0; i < s.length; i++) {
    val = (val << 6) | chars.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((val >> bits) & 255);
      val &= (1 << bits) - 1;
    }
  }
  return out;
}

// Variante antigua de embed69: el "link" es un JWT cuyo payload trae {"link":"https://..."}.
function jwtLink(enc) {
  var parts = String(enc).split(".");
  if (parts.length !== 3) return "";
  try {
    var o = JSON.parse(b64decode(parts[1]));
    return o && o.link ? String(o.link) : "";
  } catch (e) { return ""; }
}

function serversPow(html, embed) {
  var out = [];
  var raw = dataLink(html);
  if (!raw) return out;
  var links;
  try { links = JSON.parse(raw); } catch (e) { log("SoloLatino: dataLink no es JSON válido"); return out; }

  var keyHex = "";
  var challenge = jsVar(html, "POW_CHALLENGE");
  var salt = jsVar(html, "POW_SALT");
  if (challenge !== null && salt !== null &&
      typeof util.pow === "function" && typeof util.sha256Hex === "function") {
    var diffStr = jsVar(html, "POW_DIFFICULTY");
    var difficulty = diffStr ? parseInt(diffStr, 10) : 3;
    var nonce = util.pow(challenge, difficulty);
    keyHex = util.sha256Hex(challenge + nonce + salt);
  }

  for (var i = 0; i < links.length; i++) {
    var lang = links[i].video_language || "LAT";
    var embeds = links[i].sortedEmbeds;
    if (!embeds) continue;
    for (var j = 0; j < embeds.length; j++) {
      var enc = embeds[j].link || "";
      if (!enc) continue;
      var url = "";
      if (keyHex && typeof util.aesDecrypt === "function") {
        try { url = util.aesDecrypt(enc, keyHex); } catch (e2) { url = ""; }
      }
      if (!url) url = jwtLink(enc);
      if (!url) continue;
      url = String(url).replace(/`/g, "").replace(/^\s+|\s+$/g, "");
      if (/bysedikamoum\.com/i.test(url)) url = url.replace(/bysedikamoum\.com/ig, "filemoon.sx");
      out.push({ url: url, name: cap(embeds[j].servername || ""), audio: (lang === "ENG" ? "SUB" : lang), referer: embed });
    }
  }
  return out;
}

function servers(episodeUrl) {
  warmUp();
  var html = getHtml(episodeUrl, BASE + "/");
  var isSeries = episodeUrl.indexOf("/serie/") !== -1;

  var embed = findEmbed(html, episodeUrl, isSeries);
  if (!embed) { log("SoloLatino: no se encontró embed en " + episodeUrl); return []; }
  log("SoloLatino: embed → " + embed);
  var origin = originOf(embed);

  var eh;
  try {
    // Cabeceras de iframe, como en el reproductor de Omega.
    eh = http.get(embed, {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Referer": episodeUrl,
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site"
    });
    if (!eh) throw new Error("HTTP " + http.status());
  } catch (e) {
    log("SoloLatino: no se pudo abrir el embed: " + e);
    return [];
  }

  // Método A (Omega): POW + AES sobre dataLink
  var viaPow = serversPow(eh, embed);
  if (viaPow.length) {
    log("SoloLatino: método POW/AES → " + viaPow.length + " servidores");
    return viaPow;
  }
  log("SoloLatino: método POW/AES sin resultados (len=" + eh.length +
      ", POW_CHALLENGE=" + (eh.indexOf("POW_CHALLENGE") !== -1) +
      ", dataLink=" + (eh.indexOf("dataLink") !== -1) +
      ", s.php=" + (eh.indexOf("/s.php") !== -1) + "); se prueba /s.php");

  // Método B: flujo /s.php
  var vars = pageVars(eh);
  if (!vars) { log("SoloLatino: no hay _t/_qk/_qc en el embed. Inicio: " + String(eh).substring(0, 200).replace(/\s+/g, " ")); return []; }

  var scan = apiCall(origin, embed, vars, { a: "1" }, false);
  if (!scan || !scan.s || !scan.s.length) {
    log("SoloLatino: scan sin servidores → " + JSON.stringify(scan));
    return [];
  }

  if (!doClick(origin, embed, vars)) log("SoloLatino: click no confirmado, se intenta igual");

  // Servidores por idioma (LAT, CAS, SUB...). ENG se muestra como SUB en el player.
  var items = [], k, i, ls = scan.langs_s, hasLangs = false;
  if (ls) {
    for (k in ls) {
      hasLangs = true;
      for (i = 0; i < ls[k].length; i++) {
        items.push({ lang: (k === "ENG" ? "SUB" : k), label: ls[k][i][0], url: ls[k][i][1] });
      }
    }
  }
  if (!hasLangs) {
    for (i = 0; i < scan.s.length; i++) items.push({ lang: "LAT", label: scan.s[i][0], url: scan.s[i][1] });
  }

  var out = [], seen = {};
  for (i = 0; i < items.length && i < MAX_RESOLVE; i++) {
    var real = resolveServer(origin, embed, vars, items[i].url);
    if (!real || seen[real]) continue;
    seen[real] = true;
    out.push({
      url: real,
      name: str(items[i].label).replace(/^[^A-Za-z0-9]+\s*/, ""),
      audio: items[i].lang,
      referer: embed
    });
  }

  if (out.length === 0) out.push({ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl });
  return out;
}
