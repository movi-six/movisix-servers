/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
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
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url, BASE + "/"));
}

function search(query, page) {
  page = page || 1;
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  return parseCards(getHtml(url, BASE + "/"));
}

// ───────────── Detalle ─────────────
function detail(url) {
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

// ───────────── Resolución Embed69 (POW + AES) ─────────────
function fnv(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(16);
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

// ───────────── Servers (100% WebView) ─────────────
function servers(episodeUrl) {
  var logMsg = [];
  logMsg.push("Iniciando WebView para " + episodeUrl);

  // 1. Cargamos la página del episodio usando el WebView invisible
  // Usamos 'eval' para inyectar un JS que hace clic en el botón 2 y extrae el iframe.
  var jsClickAndExtract = "(function(){" +
    "return new Promise(function(resolve) {" +
    "  var found = false;" +
    "  var btns = document.querySelectorAll('button, a, .server-item, li');" +
    "  for(var i=0; i<btns.length; i++) {" +
    "    var txt = (btns[i].innerText || '').toLowerCase();" +
    "    if(txt.indexOf('embed') !== -1 || txt.indexOf('opción 2') !== -1 || txt.indexOf('opcion 2') !== -1) {" +
    "      btns[i].click();" +
    "      found = true;" +
    "      break;" +
    "    }" +
    "  }" +
    "  if (!found) {" +
    "     var iframes = document.querySelectorAll('iframe');" +
    "     for(var k=0; k<iframes.length; k++) {" +
    "       if (iframes[k].src && iframes[k].src.indexOf('embed69') !== -1) {" +
    "          resolve(iframes[k].src); return;" +
    "       }" +
    "     }" +
    "  }" +
    "  setTimeout(function() {" +
    "    var iframes = document.querySelectorAll('iframe');" +
    "    for(var k=0; k<iframes.length; k++) {" +
    "      if (iframes[k].src && iframes[k].src.indexOf('embed69') !== -1) {" +
    "        resolve(iframes[k].src); return;" +
    "      }" +
    "    }" +
    "    var html = document.documentElement.innerHTML;" +
    "    var m = html.match(/https?:\\/\\/(?:www\\.)?embed69\\.org\\/f\\/[A-Za-z0-9_-]+/i);" +
    "    if (m) resolve(m[0]); else resolve('');" +
    "  }, 3000);" +
    "});" +
    "})();";

  var embed = "";
  try {
    // web.eval espera una promesa, y nuestro JS devuelve una, así que esperará los 3 segundos.
    var res = web.eval(episodeUrl, jsClickAndExtract, { "timeout": 20000 });
    if (res && res !== "null" && res !== "") {
      // El string puede venir con comillas dobles si Rhino lo serializa, lo limpiamos
      embed = res.replace(/^"|"$/g, "").trim();
      logMsg.push("Embed encontrado: " + embed);
    }
  } catch(e) {
    logMsg.push("Error en WebView: " + e);
  }

  // Si el WebView falló, hacemos un fallback silencioso a la API por si acaso.
  if (!embed || embed.indexOf("embed69") === -1) {
    logMsg.push("WebView falló, probando API (fallback)...");
    try {
      var html = getHtml(episodeUrl, BASE + "/");
      var tokenM = /data-player-token="([^"]+)"/.exec(html);
      if (tokenM) {
        var resApi = http.post(BASE + "/api/player-url", JSON.stringify({ t: tokenM[1] }), {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json",
          "Referer": episodeUrl
        });
        if (resApi) {
          var jApi = JSON.parse(resApi);
          if (jApi && jApi.url) embed = absOn(BASE, jApi.url);
        }
      }
    } catch(e2) {
      logMsg.push("Fallback API falló: " + e2);
    }
  }

  log(logMsg.join(" | "));

  if (!embed) {
     return [{ url: episodeUrl, name: "Abrir en navegador", audio: "LAT", referer: BASE + "/" }];
  }

  var origin = originOf(embed);
  
  // 2. Ahora que tenemos la URL de Embed69, extraemos los servidores usando http.get (esto SÍ funciona)
  var eh;
  try {
    eh = http.get(embed, {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Referer": BASE + "/"
    });
    if (!eh) throw new Error("HTTP " + http.status());
  } catch (e) {
    log("SoloLatino: no se pudo abrir el embed con http.get, usando WebView...");
    try {
       eh = web.html(embed, { "timeout": 15000 });
       if (!eh) throw new Error("Vacío");
    } catch (e2) {
       return [{ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl }];
    }
  }

  // 3. Aplicamos el método de Películas (POW + AES)
  var viaPow = serversPow(eh, embed);
  if (viaPow.length > 0) {
    log("SoloLatino: Servidores extraídos de Embed69 -> " + viaPow.length);
    return viaPow;
  }

  // 4. Si no hay servidores, devolvemos el embed como último recurso
  return [{ url: embed, name: "Embed", audio: "LAT", referer: episodeUrl }];
           }
