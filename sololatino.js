/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://sololatino.net").replace(/\/+$/, "");
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
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
  };
  if (referer) h["Referer"] = referer;
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return body;
}

// ───────────── Tarjetas ─────────────
function parseCards(html) {
  var out = [], chunks = String(html).split('<div class="card">');
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i], m = /<a href="([^"]+)"/.exec(c);
    if (!m) continue;
    var url = abs(m[1]);
    var title = (/class="card__title">([^<]+)<\/span>/.exec(c) || [])[1] || "";
    var img = (/<img[^>]+src="([^"]+)"/.exec(c) || [])[1] || "";
    out.push({ title: clean(title), url: url, image: abs(img), year: "", rating: "", kind: "serie" });
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseCards(getHtml(BASE + "/peliculas" + (page > 1 ? "?page=" + page : ""), BASE));
}

function search(query, page) {
  page = page || 1;
  return parseCards(getHtml(BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : ""), BASE));
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url, BASE), m;
  var isSeries = url.indexOf("/serie/") !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, ""));

  if (isSeries) {
    var epRe = /<a href="([^"]+\/temporada-\d+\/episodio-\d+)"[\s\S]*?class="ep-thumb"[\s\S]*?<p class="ep-num">([^<]+)<\/p>/g;
    while ((m = epRe.exec(html)) !== null) {
      d.episodes.push({ title: clean(m[2]), url: abs(m[1]), image: "" });
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

function resolveServer(origin, embed, vars, srvUrl) {
  apiCall(origin, embed, vars, { a: "click", v: srvUrl, ts: "1" }, true);
  var d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  if (d && d.type === "error" && d.msg === "no_click") {
    apiCall(origin, embed, vars, { a: "click", ts: "1" }, true);
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

// ───────────── Servers (100% WebView para Series y Películas) ─────────────
function servers(episodeUrl) {
  log("SoloLatino: Iniciando extracción con WebView para " + episodeUrl);
  
  var embedUrl = "";

  // JS Maestro: Busca el botón de Embed69 (usualmente el 2do botón o el que dice 'embed')
  // Le hace clic, espera 6 segundos (por si el iframe tarda en cargar) y devuelve la URL.
  var jsFindEmbed = "(function(){" +
    "return new Promise(function(resolve){" +
    "  var btns = document.querySelectorAll('button, a');" +
    "  var target = null;" +
    // 1. Buscar por texto 'embed' o 'opción 2'
    "  for(var i=0; i<btns.length; i++){" +
    "    var t = (btns[i].innerText||'').toLowerCase();" +
    "    if(t.indexOf('embed') !== -1 || t.indexOf('opcion 2') !== -1) { target = btns[i]; break; }" +
    "  }" +
    // 2. Si no, tomar el segundo botón de servidores
    "  if(!target && btns.length > 1) { target = btns[1]; }" +
    "  if(target) { target.click(); }" +
    // 3. Esperar a que el iframe aparezca en el DOM
    "  setTimeout(function(){" +
    "    var iframes = document.querySelectorAll('iframe');" +
    "    for(var j=0; j<iframes.length; j++){" +
    "      if(iframes[j].src && iframes[j].src.indexOf('embed69') !== -1){" +
    "        resolve(iframes[j].src); return;" +
    "      }" +
    "    }" +
    // 4. Si el iframe no tiene el src, buscarlo en el HTML
    "    var m = document.documentElement.innerHTML.match(/https?:\\/\\/(?:www\\.)?embed69\\.org\\/f\\/[A-Za-z0-9_-]+/i);" +
    "    resolve(m ? m[0] : '');" +
    "  }, 6000);" + // 6 segundos para estar seguros
    "});" +
    "})();";

  try {
    var resEmbed = web.eval(episodeUrl, jsFindEmbed, { "timeout": 20000, "images": false });
    if (resEmbed && resEmbed !== "null" && resEmbed.trim() !== "") {
      embedUrl = resEmbed.replace(/^"|"$/g, "").trim();
      log("SoloLatino: WebView encontró embed -> " + embedUrl);
    }
  } catch(e) {
    log("SoloLatino: Error en WebView -> " + e.message);
  }

  // Fallback: Si el WebView no lo encontró, buscar en el HTML normal
  if (!embedUrl || embedUrl.indexOf("embed69") === -1) {
    try {
      var html = getHtml(episodeUrl, BASE);
      var m = /https?:\/\/(?:www\.)?embed69\.org\/f\/[A-Za-z0-9_-]+/i.exec(html);
      if (m) embedUrl = m[0];
    } catch (e) {}
  }

  // Si después de todo no hay embed, devolvemos el episodio (no hay de otra)
  if (!embedUrl || embedUrl.indexOf("embed69") === -1) {
    log("SoloLatino: No se pudo encontrar embed.");
    return [{ url: episodeUrl, name: "Abrir Web", audio: "LAT", referer: BASE + "/" }];
  }

  // Extraer los servidores desde Embed69 usando el método que ya funciona (POW + AES)
  log("SoloLatino: Procesando Embed69 -> " + embedUrl);
  var eh;
  try {
    eh = getHtml(embedUrl, BASE);
  } catch (e) {
    try { eh = web.html(embedUrl, { "timeout": 15000 }); } catch (e2) { eh = ""; }
  }

  if (eh) {
    var viaPow = serversPow(eh, embedUrl);
    if (viaPow.length > 0) {
      log("SoloLatino: Servidores extraídos -> " + viaPow.length);
      return viaPow;
    }
  }

  // Si no se pudieron extraer los videos del Embed69, mandamos la URL del Embed69 para que la app intente reproducirla
  return [{ url: embedUrl, name: "Embed69", audio: "LAT", referer: BASE + "/" }];
  }
