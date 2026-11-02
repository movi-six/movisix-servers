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

// ───────────── Lógica de Embed69 (POW + AES) ─────────────
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
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Origin": origin,
      "Referer": embed
    });
  } catch (e) { return null; }
  if (!res) return null;
  try { return JSON.parse(res); } catch (e2) { return null; }
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
  if (!d) return "";
  if (d.type === "iframe" && d.url) return d.url;
  if (d.type === "mp4" && d.u) return absOn(origin, d.u);
  if (d.u) return origin + "/p.php?url=" + encodeURIComponent(d.u) + "&sig=" + encodeURIComponent(d.sig || "");
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
  if (!raw) return out;
  
  var links;
  try { links = JSON.parse(raw); } catch (e) { return out; }

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

// ───────────── Resolución de Token para Películas ─────────────
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
  } catch (e) { return ""; }
  
  if (!res) return "";
  try {
    var j = JSON.parse(res);
    if (j && j.url) return absOn(BASE, j.url);
  } catch (e2) {}
  return "";
}

// ───────────── Servers (Punto de entrada Híbrido) ─────────────
function servers(episodeUrl) {
  warmUp();
  var isSeries = episodeUrl.indexOf("/serie/") !== -1;
  
  // ==========================================
  // 1. LÓGICA PARA SERIES (Usa WebView)
  // ==========================================
  if (isSeries) {
    log("SoloLatino: Es una serie. Usando WebView para esquivar el bloqueo...");
    
    var embedUrl = "";
    
    // Usamos el WebView para hacer clic en el botón de Embed69
    var jsFindEmbed = "(function(){" +
        "var b = document.querySelectorAll('button, a, div');" +
        "for(var i=0; i<b.length; i++) {" +
        "  if ((b[i].innerText||'').toLowerCase().indexOf('embed') !== -1) { b[i].click(); break; }" +
        "}" +
        "return new Promise(function(r) {" +
        "  setTimeout(function(){" +
        "    var iframe = document.querySelector('iframe');" +
        "    if(iframe && iframe.src && iframe.src.indexOf('embed69') !== -1) { r(iframe.src); return; }" +
        "    var m = document.documentElement.innerHTML.match(/https?:\\/\\/(?:www\\.)?embed69\\.org\\/f\\/[A-Za-z0-9_-]+/i);" +
        "    r(m ? m[0] : '');" +
        "  }, 4000);" + 
        "});" +
        "})();";

    try {
      var resEmbed = web.eval(episodeUrl, jsFindEmbed, { "timeout": 15000, "images": false });
      if (resEmbed && resEmbed !== "null" && resEmbed.trim() !== "") {
          embedUrl = resEmbed.replace(/^"|"$/g, "").trim();
      }
    } catch(e) {
      log("SoloLatino: Falló WebView -> " + e.message);
    }

    // Fallback: Si el WebView falla, buscar en el HTML normal
    if (!embedUrl || embedUrl.indexOf("embed69") === -1) {
        try {
          var html = getHtml(episodeUrl, BASE + "/");
          var m = /https?:\/\/(?:www\.)?embed69\.org\/f\/[A-Za-z0-9_-]+/i.exec(html);
          if (m) embedUrl = m[0];
        } catch (e) {}
    }

    if (!embedUrl) {
        return [{ url: episodeUrl, name: "Abrir en Web", audio: "LAT", referer: BASE + "/" }];
    }

    // Procesamos el Embed69 usando el método de Películas (POW + AES)
    var eh;
    try {
      eh = getHtml(embedUrl, BASE + "/");
    } catch (e) {
      try { eh = web.html(embedUrl, { "timeout": 15000 }); } catch (e2) { eh = ""; }
    }

    if (eh) {
      var viaPow = serversPow(eh, embedUrl);
      if (viaPow.length > 0) return viaPow;
    }

    // Si no pudimos sacar los videos del Embed69, mandamos la URL de Embed69 directo al player
    return [{ url: embedUrl, name: "Embed69", audio: "LAT", referer: BASE + "/" }];
  }

  // ==========================================
  // 2. LÓGICA PARA PELÍCULAS (Usa http.get)
  // ==========================================
  log("SoloLatino: Es una película. Usando método HTTP (Token)...");
  
  var html = getHtml(episodeUrl, BASE + "/");
  var embed = "";

  // Intentamos sacar el Token de la película
  var token = extractPlayerToken(html);
  if (token) {
    embed = resolvePlayerToken(token, episodeUrl);
  }

  // Si el token falla, buscamos el embed en el HTML
  if (!embed) {
    var m = /https?:\/\/(?:www\.)?embed69\.org\/f\/[A-Za-z0-9_-]+/i.exec(html);
    if (m) embed = m[0];
  }

  if (!embed) {
    return [{ url: episodeUrl, name: "Abrir en Web", audio: "LAT", referer: BASE + "/" }];
  }

  var origin = originOf(embed);
  var eh;
  try {
    eh = getHtml(embed, BASE + "/");
  } catch (e) {
    return [{ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl }];
  }

  var viaPow = serversPow(eh, embed);
  if (viaPow.length > 0) {
    return viaPow;
  }

  return [{ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl }];
    }
