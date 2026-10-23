/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 *
 * Los servidores de video se resuelven vía POST /api/player-url con CSRF
 * (Laravel). Requiere RemoteServers.java con http.getCookie().
 */

var BASE = (CONFIG.base || "https://sololatino.net").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url) {
  return http.get(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  });
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// ───────────── Tarjetas del listado/búsqueda ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var re = /<div class="card">[\s\S]*?<a href="([^"]+)">[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"[\s\S]*?<span class="badge card__badge badge-([^"]+)">[^<]+<\/span>[\s\S]*?(?:<span class="card__rating">★\s*([0-9.]+)<\/span>)?[\s\S]*?<span class="card__year">([^<]+)<\/span>/g;

  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;
    var kind = (m[4] === "movie") ? "movie" : "serie";
    out.push({
      title: clean(m[3]),
      url: url,
      image: abs(m[2]),
      rating: m[5] ? m[5] : "",
      year: m[6] ? clean(m[6]) : "",
      type: kind
    });
  }
  return out;
}

// ───────────── Lista (películas por defecto) ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url));
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  return parseCards(getHtml(url));
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

  // Póster (w500) y banner (w1280)
  m = /<img src="(https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^"]+)"[\s\S]*?class="w-44 md:w-52 rounded-2xl shadow-2xl"/.exec(html);
  if (m) d.poster = m[1];
  m = /background-image:url\('(https:\/\/image\.tmdb\.org\/t\/p\/w1280\/[^']+)'\)/.exec(html);
  if (m) d.banner = m[1];
  if (!d.poster && d.banner) d.poster = d.banner;

  // Sinopsis (dos posibles clases según el tipo)
  m = /<p class="text-sm leading-relaxed mb-6 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (!m) m = /<p class="text-sm leading-relaxed mb-5 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));

  // Año
  m = /<span>(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];

  // Rating (TMDB)
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
        image: ""   // la app usa el póster como fallback
      });
    }
  }

  // Película o serie sin episodios: un único "episodio" con la URL del detalle
  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (Laravel + CSRF) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];

  // 1. Extraer los data-player-token de los botones
  var tokens = [];
  var re = /data-player-token="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) tokens.push(m[1]);
  if (tokens.length === 0) return out;

  // 2. Pedir la cookie CSRF de Laravel
  http.get(BASE + "/sanctum/csrf-cookie", {
    "Accept": "application/json",
    "Referer": episodeUrl
  });

  // 3. Leer la cookie XSRF-TOKEN (gracias al parche en JsHost)
  var xsrf = "";
  try { xsrf = http.getCookie("XSRF-TOKEN"); } catch (e) { xsrf = ""; }

  if (!xsrf) {
    log("SoloLatino: no se pudo leer XSRF-TOKEN (¿RemoteServers sin parche?)");
    return out;
  }

  // 4. Resolver cada token contra /api/player-url
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
      if (res) {
        var parsed = JSON.parse(res);
        if (parsed && parsed.url) out.push(parsed.url);
      }
    } catch (e) {
      log("SoloLatino: token " + i + " falló: " + e);
    }
  }

  return out;
  }
