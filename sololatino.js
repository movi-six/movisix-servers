/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
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

// ───────────── Tarjetas ─────────────
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

function list(page) {
  page = page || 1;
  warmUp();
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url, BASE + "/"));
}

function parseSearchCards(html) {
  var h = String(html);
  var m = /(\d+)(?:<[^>]*>|\s)*resultado\(s\)/i.exec(h);
  if (!m) return null;
  var n = parseInt(m[1], 10);
  if (!n) return [];
  return parseCards(h.substring(m.index)).slice(0, n);
}

function search(query, page) {
  page = page || 1;
  warmUp();
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var html = http.get(url, {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Referer": BASE + "/"
      });
      if (!html) { log("SoloLatino search intento " + (attempt + 1) + " → HTTP " + http.status()); continue; }
      var cards = parseSearchCards(html);
      if (cards) return cards;
      log("SoloLatino search intento " + (attempt + 1) + ": sin 'N resultado(s)'");
    } catch (e) {
      log("SoloLatino search intento " + (attempt + 1) + " error: " + e);
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

// ───────────── Player (embed69) ─────────────
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
  apiCall(origin, embed, vars, { a: "click", v: srvUrl, ts: "1" }, true);
  var d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  if (d && d.type === "error" && d.msg === "no_click") {
    doClick(origin, embed, vars);
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  } else if (d && (d.error === "retry_once" || d.error === "busy")) {
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  }
  log("SoloLatino resolve " + srvUrl + " → " + JSON.stringify(d));
  if (!d) return "";
  if (d.type === "iframe" && d.url) return d.url;
  if (d.type === "mp4" && d.u) return absOn(origin, d.u);
  if (d.u) return origin + "/p.php?url=" + encodeURIComponent(d.u) + "&sig=" + encodeURIComponent(d.sig || "");
  log("SoloLatino: servidor sin URL → " + JSON.stringify(d));
  return "";
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
  if (!raw) {
    log("SoloLatino: dataLink no encontrado en HTML de embed69.");
    return out;
  }
  var links;
  try { links = JSON.parse(raw); } catch (e) { 
    log("SoloLatino: dataLink no es JSON válido: " + e.message);
    return out; 
  }

  var keyHex = "";
  var challenge = jsVar(html, "POW_CHALLENGE");
  var salt = jsVar(html, "POW_SALT");
  if (challenge && salt && typeof util.pow === "function" && typeof util.sha256Hex === "function") {
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

// ───────────── Resolución de Token (POST JSON) ─────────────
function extractPlayerToken(html) {
  var m = /data-player-token="([^"]+)"/.exec(html);
  return m ? m[1] : "";
}

function resolvePlayerToken(token, referer) {
  if (!token) return "";
  
  var body = JSON.stringify({ t: token });
  
  var res;
  try {
    res = http.post(BASE + "/api/player-url", body, {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer
    });
  } catch (e) {
    log("SoloLatino /api/player-url error: " + e);
    return "";
  }
  
  if (!res) { log("SoloLatino /api/player-url sin respuesta (HTTP " + http.status() + ")"); return ""; }
  
  try {
    var j = JSON.parse(res);
    if (j && j.url) {
      log("SoloLatino: token resuelto → " + j.url);
      return absOn(BASE, j.url);
    }
    log("SoloLatino /api/player-url sin url: " + String(res).substring(0, 200));
  } catch (e2) {
    log("SoloLatino /api/player-url no es JSON (HTTP " + http.status() + "): " + String(res).substring(0, 200));
  }
  return "";
}

function findEmbed(html, episodeUrl, isSeries) {
  var h = String(html).replace(/\\\//g, "/");
  var season = (/temporada-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
  var episode = (/episodio-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
  season = String(parseInt(season, 10) || 1);
  episode = String(parseInt(episode, 10) || 1);
  var m = /https?:\/\/(?:www\.)?embed69\.org\/f\/[A-Za-z0-9_-]+/i.exec(h);
  if (m) return m[0];
  m = /<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(h);
  if (m && !/youtube|google|facebook|twitter/i.test(m[1])) return abs(m[1]);
  var imdb = /imdb\.com\/title\/(tt\d+)/.exec(h);
  if (imdb) return "https://embed69.org/f/" + imdb[1] + (isSeries ? "-" + season + "x" + episode : "");
  m = /themoviedb\.org\/(?:movie|tv)\/(\d+)/.exec(h);
  if (m) return "https://embed69.org/f/" + m[1] + (isSeries ? "-" + season + "x" + episode : "");
  return "";
}

// ───────────── Servers (Punto de entrada con WebView Fallback) ─────────────
function servers(episodeUrl) {
  warmUp();
  var html = getHtml(episodeUrl, BASE + "/");
  var isSeries = episodeUrl.indexOf("/serie/") !== -1;
  var embed = "";

  // 1) Método normal: Token y POST JSON
  var token = extractPlayerToken(html);
  if (token) {
    log("SoloLatino: token de player detectado, consultando /api/player-url…");
    embed = resolvePlayerToken(token, episodeUrl);
  }

  // 2) Fallback normal
  if (!embed) embed = findEmbed(html, episodeUrl, isSeries);

  // 3) Si la API bloqueó la petición (común en series), usamos WebView invisible
  if (!embed || embed.indexOf("embed69") === -1) {
    log("SoloLatino: API bloqueó el embed (común en series). Usando WebView invisible…");
    
    var jsCode = "(function(){" +
                 "var e = document.querySelector('iframe');" +
                 "if (e && e.src && e.src.indexOf('embed69') !== -1) return e.src;" +
                 "var m = document.documentElement.innerHTML.match(/https?:\\/\\/(?:www\\.)?embed69\\.org\\/f\\/[A-Za-z0-9_-]+/i);" +
                 "return m ? m[0] : '';" +
                 "})();";

    try {
      // web.eval está disponible en RemoteServers.java
      var embedFromWeb = web.eval(episodeUrl, jsCode, { "timeout": 15000 });
      if (embedFromWeb && embedFromWeb.trim() !== "" && embedFromWeb.trim() !== "null") {
        embed = embedFromWeb.trim();
        log("SoloLatino: WebView encontró embed → " + embed);
      }
    } catch (err) {
      log("SoloLatino: error en WebView -> " + err.message);
    }
  }

  if (!embed) { log("SoloLatino: no se encontró embed en " + episodeUrl); return []; }

  var origin = originOf(embed);
  log("SoloLatino: embed host=" + origin + " · url=" + embed);

  // 4) Descargar embed69 y extraer servidores
  var eh;
  try {
    eh = http.get(embed, {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Referer": BASE + "/",
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site"
    });
    if (!eh) throw new Error("HTTP " + http.status());
  } catch (e) {
    log("SoloLatino: no se pudo abrir el embed directo, intentando WebView para embed69...");
    try {
       eh = web.html(embed, { "timeout": 15000 });
       if (!eh) throw new Error("Vacío");
    } catch (e2) {
       log("SoloLatino: WebView tampoco pudo abrir el embed -> " + e2.message);
       return [];
    }
  }

  // 5) Método POW + AES (el mismo que funciona en películas)
  var viaPow = serversPow(eh, embed);
  if (viaPow.length) {
    log("SoloLatino: método POW/AES → " + viaPow.length + " servidores");
    return viaPow;
  }

  // 6) /s.php (fallback)
  log("SoloLatino: POW/AES sin resultados; probando /s.php");
  var vars = pageVars(eh);
  if (!vars) return [];

  var scan = apiCall(origin, embed, vars, { a: "1" }, false);
  if (!scan || !scan.s || !scan.s.length) return [];

  doClick(origin, embed, vars);

  var items = [], k, i, ls = scan.langs_s, hasLangs = false;
  if (ls) {
    for (k in ls) {
      hasLangs = true;
      for (i = 0; i < ls[k].length; i++) items.push({ lang: (k === "ENG" ? "SUB" : k), label: ls[k][i][0], url: ls[k][i][1] });
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
    out.push({ url: real, name: str(items[i].label).replace(/^[^A-Za-z0-9]+\s*/, ""), audio: items[i].lang, referer: embed });
  }

  if (out.length === 0) out.push({ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl });
  return out;
    }
