/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
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

// ───────────── Tarjetas (ESTRICTA - Para el Inicio) ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var re = /<div class="card">[\s\S]*?<a href="([^"]+)">[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"[\s\S]*?<span class="badge card__badge badge-([^"]+)">[^<]+<\/span>[\s\S]*?(?:<span class="card__rating">★\s*([0-9.]+)<\/span>)?[\s\S]*?<span class="card__year">([^<]+)<\/span>/g;

  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    var kind = (url.indexOf("/serie/") !== -1) ? "serie" : "movie";
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

// ───────────── Tarjetas (FLEXIBLE - Para el Buscador) ─────────────
function parseSearchCards(html) {
  var out = [], seen = {}, m;
  // Busca cualquier enlace que vaya a /pelicula/ o /serie/ y que tenga una imagen
  var re = /<a[^>]+href="([^"]*(?:\/pelicula\/|\/serie\/)[^"]*)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/g;

  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    // El año suele estar unas líneas más abajo. Buscamos en el bloque actual.
    var block = html.substring(m.index, m.index + 2000);
    var ym = /(\d{4})/.exec(block);
    var year = ym ? ym[1] : "";

    var kind = (url.indexOf("/serie/") !== -1) ? "serie" : "movie";

    out.push({
      title: clean(m[3]),
      url: url,
      image: abs(m[2]),
      rating: "",
      year: year,
      type: kind
    });
  }
  return out;
}

// ───────────── Lista (Inicio) ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url));
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  
  try {
    var html = getHtml(url);
    // Usamos la función flexible para la búsqueda
    return parseSearchCards(html);
  } catch (e) {
    log("SoloLatino search: error 403");
    return [];
  }
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url), m;
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

// ───────────── Servidores (UnLimPlay) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var isSeries = episodeUrl.indexOf("/serie/") !== -1;

  var tmdbId = "";
  var m = /themoviedb\.org\/(?:movie|tv)\/(\d+)/.exec(html);
  if (m) tmdbId = m[1];

  if (!tmdbId) return [];

  var season = "1";
  var episode = "1";
  if (isSeries) {
    var sm = /temporada-(\d+)/.exec(episodeUrl);
    if (sm) season = sm[1];
    var em = /episodio-(\d+)/.exec(episodeUrl);
    if (em) episode = em[1];
  }

  var unlimUrl;
  if (isSeries) {
    unlimUrl = "https://unlimplay.com/play/embed/tv/" + tmdbId + "/" + season + "/" + episode;
  } else {
    unlimUrl = "https://unlimplay.com/play/embed/movie/" + tmdbId;
  }

  return [unlimUrl];
}
