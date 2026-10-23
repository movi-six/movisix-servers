/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 *
 * Servidores reales: hace POST /api/player-url con CSRF para obtener el embed
 * (embed69.org / player.pelisserieshoy.com), luego GET a ese embed para extraer
 * los iframes/sources reales de los servidores.
 *
 * Requiere RemoteServers.java con http.getCookie() y util.md5/sha1/uuid/now.
 */

var BASE = (CONFIG.base || "https://sololatino.net").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

// ───────────── GET con headers de navegador (evita 403) ─────────────
function getHtml(url) {
  return http.get(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": BASE + "/",
    "Origin": BASE,
    "Sec-Ch-Ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": "\"Windows\"",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0"
  });
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ───────────── Tarjetas ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var re = /<div[^>]*class="[^"]*card[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]*)"[\s\S]*?(?:<span[^>]*class="[^"]*card__year[^"]*"[^>]*>([^<]+)<\/span>)?/g;

  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (url.indexOf("/pelicula/") === -1 && url.indexOf("/serie/") === -1) continue;
    if (seen[url]) continue;
    seen[url] = true;

    var kind = (url.indexOf("/serie/") !== -1) ? "serie" : "movie";
    var badgeMatch = /badge-(movie|series|dorama|anime)/.exec(html.substring(m.index, m.index + 600));
    if (badgeMatch) kind = (badgeMatch[1] === "movie") ? "movie" : "serie";

    out.push({
      title: clean(m[3]),
      url: url,
      image: abs(m[2]),
      year: m[4] ? clean(m[4]) : "",
      type: kind
    });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url));
}

// ───────────── Búsqueda (visita home primero para cookie) ─────────────
function search(query, page) {
  page = page || 1;

  // 1. Visita la home → el servidor asigna cookie laravel_session
  try {
    http.get(BASE + "/", {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    });
  } catch (e) { /* seguimos igual */ }

  // 2. Buscar (la cookie ya viaja en el jar de JsHost)
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  var html = getHtml(url);

  if (!html || html.length < 500) {
    log("SoloLatino search: respuesta vacía o corta (" + (html ? html.length : 0) + " bytes)");
    return [];
  }

  var result = parseCards(html);
  if (result.length === 0) {
    log("SoloLatino search: HTML recibido pero sin tarjetas. Inicio: " + html.substring(0, 200));
  }
  return result;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url), m;
  var isSeries = url.indexOf("/serie/") !== -1;
  var d = {
    title: "", synopsis: "", genres: "", poster: "", banner: "",
    year: "", rating: "", director: "", isSeries: isSeries, episodes: []
  };

  // Título
  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, ""));

  // Póster y banner
  m = /<img src="(https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^"]+)"[\s\S]*?class="w-44 md:w-52 rounded-2xl shadow-2xl"/.exec(html);
  if (m) d.poster = m[1];
  m = /background-image:url\('(https:\/\/image\.tmdb\.org\/t\/p\/w1280\/[^']+)'\)/.exec(html);
  if (m) d.banner = m[1];
  if (!d.poster && d.banner) d.poster = d.banner;

  // Sinopsis
  m = /<p class="text-sm leading-relaxed mb-6 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (!m) m = /<p class="text-sm leading-relaxed mb-5 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));

  // Año
  m = /<span>(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];

  // Rating
  m = /rating-badge__val">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = m[1];

  // Géneros
  var genres = [];
  var genreRe = /<a href="https:\/\/sololatino\.net\/genero\/[^"]+"[\s\S]*?>\s*([^<]+?)\s*<\/a>/g;
  while ((m = genreRe.exec(html)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  // Episodios (solo series)
  if (isSeries) {
    var epRe = /<a href="([^"]+\/temporada-\d+\/episodio-\d+)"[\s\S]*?class="ep-thumb"[\s\S]*?<p class="ep-num">([^<]+)<\/p>[\s\S]*?<p class="text-sm font-semibold text-white leading-tight">\s*([\s\S]*?)<\/p>/g;
    while ((m = epRe.exec(html)) !== null) {
      d.episodes.push({
        title: clean(m[2]) + " - " + clean(m[3]),
        url: abs(m[1]),
        image: ""
      });
    }
  }

  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (2 peticiones) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];

  // 1. Extraer tokens de los botones de SoloLatino
  var tokens = [];
  var re = /data-player-token="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) tokens.push(m[1]);
  if (tokens.length === 0) return out;

  // 2. Obtener CSRF
  try {
    http.get(BASE + "/sanctum/csrf-cookie", {
      "Accept": "application/json",
      "Referer": episodeUrl
    });
  } catch (e) { /* seguimos */ }

  var xsrf = "";
  try { xsrf = http.getCookie("XSRF-TOKEN"); } catch (e) { xsrf = ""; }

  if (!xsrf) {
    log("SoloLatino: no se pudo leer XSRF-TOKEN");
    return out;
  }

  // 3. Resolver cada token → obtiene el embed base
  var embeds = [];
  for (var i = 0; i < tokens.length; i++) {
    try {
      var res = http.post(BASE + "/api/player-url", JSON.stringify({ t: tokens[i] }), {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-XSRF-TOKEN": xsrf,
        "Referer": episodeUrl,
        "Origin": BASE
      });
      if (res && res.charAt(0) === '{') {
        var parsed = JSON.parse(res);
        if (parsed && parsed.url) embeds.push(parsed.url);
      }
    } catch (e) {
      log("SoloLatino: token " + i + " falló: " + e);
    }
  }

  // 4. Para cada embed base, GET y extraer iframes/sources reales
  for (var j = 0; j < embeds.length; j++) {
    var embedUrl = embeds[j];
    try {
      var embedHtml = http.get(embedUrl, {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Referer": BASE + "/",
        "Origin": BASE
      });

      var realUrls = extractRealServers(embedHtml, embedUrl);
      for (var k = 0; k < realUrls.length; k++) out.push(realUrls[k]);

      // Fallback: si no hay iframes, al menos devolver el embed base
      if (realUrls.length === 0 && embedUrl) out.push(embedUrl);
    } catch (e) {
      log("SoloLatino: no se pudo abrir embed " + embedUrl + ": " + e);
      if (embedUrl) out.push(embedUrl);
    }
  }

  return out;
}

// ───────────── Extrae URLs reales del embed ─────────────
function extractRealServers(html, embedUrl) {
  var out = [], seen = {}, m;

  // a) iframes directos
  var reIframe = /<iframe[^>]+src="([^"]+)"/g;
  while ((m = reIframe.exec(html)) !== null) {
    var u = decodeHtml(m[1]);
    if (u && u.indexOf("http") === 0 && !seen[u] && u.indexOf("about:") !== 0) {
      seen[u] = true;
      out.push(u);
    }
  }

  // b) <source src="...">
  var reSource = /<source[^>]+src="([^"]+)"/g;
  while ((m = reSource.exec(html)) !== null) {
    var u2 = decodeHtml(m[1]);
    if (u2 && u2.indexOf("http") === 0 && !seen[u2]) {
      seen[u2] = true;
      out.push(u2);
    }
  }

  // c) URLs dentro de JSON / JS: "file": "...", "src": "...", etc.
  var reJson = /"(?:file|src|url|source|hls|mp4)"\s*:\s*"([^"]+)"/g;
  while ((m = reJson.exec(html)) !== null) {
    var u3 = m[1].replace(/\\\//g, "/");
    if (u3 && u3.indexOf("http") === 0 && !seen[u3]) {
      seen[u3] = true;
      out.push(u3);
    }
  }

  // d) Fallback: dominios típicos de embed
  if (out.length === 0) {
    var reDomain = /(https?:\/\/(?:embed69|pelisserieshoy|xupalace|streamwish|filemoon|voe|doodstream|mixdrop|streamtape|mp4upload|uqload|ok\.ru|hlswish|wishembed|streamhide|vidsrc)\.[^\s"'<>]+)/g;
    while ((m = reDomain.exec(html)) !== null) {
      var u4 = m[1];
      if (!seen[u4]) {
        seen[u4] = true;
        out.push(u4);
      }
    }
  }

  return out;
}
