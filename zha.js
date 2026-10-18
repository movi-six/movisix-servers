/*
 * Zha — PelisPlusHD (pelisplushd20.lat) · películas y series, enriquecido con TMDB
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * index.json: "tmdbKey": clave v3 de TMDB (opcional; sin ella funciona solo con lo que trae el sitio).
 * ES5. servers() devuelve objetos {name, url, audio, quality, serverNum}.
 */

var BASE = (CONFIG.base || "https://pelisplushd20.lat").replace(/\/+$/, "");
var TMDB_KEY = CONFIG.tmdbKey || "";
var TMDB_BASE = "https://api.themoviedb.org/3";
var IMG_POSTER = "https://image.tmdb.org/t/p/w500";
var IMG_BACKDROP = "https://image.tmdb.org/t/p/original";
var IMG_STILL = "https://image.tmdb.org/t/p/w300";
var TMDB_LANG = "es-ES";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }
function urlDecode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return String(s); } }

function get(url) {
  var h = http.get(url, {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9",
    "Referer": BASE + "/"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

// ───────────── Listas y búsqueda ─────────────
function list(page) {
  page = page || 1;
  return parseCards(get(page <= 1 ? BASE + "/peliculas" : BASE + "/peliculas/page/" + page));
}

function search(query, page) {
  var url = BASE + "/busqueda/" + encodeURIComponent(query);
  if (page > 1) url += "/page/" + page;
  return parseCards(get(url));
}

// Mismo HTML para listas y búsqueda. Cada tarjeta se enriquece con TMDB (poster + rating).
function parseCards(html) {
  var out = [], m;
  var re = /<div class="movie-item">\s*<a href="([^"]+)">\s*<div class="item-picture">\s*<figure>\s*<img[^>]+src="([^"]+)"[^>]*\/?>\s*<span class="year text-center">([^<]*)<\/span>[\s\S]*?<div class="item-detail"><p>([^<]+)<\/p><\/div>/g;
  while ((m = re.exec(html)) !== null) {
    var href = trim(m[1]), image = trim(m[2]), year = trim(m[3]), title = trim(m[4]);
    var itemUrl = href.indexOf("http") === 0 ? href : BASE + href;
    if (image.indexOf("//") === 0) image = "https:" + image;
    var isSerie = itemUrl.indexOf("/serie/") !== -1;
    var cleanTitle = clean(title);

    var item = {
      url: itemUrl,
      image: image,
      title: cleanTitle,
      year: year,
      type: isSerie ? "Serie" : "Película",
      rating: "",
      kind: isSerie ? "serie" : "movie"
    };
    try {
      var t = searchTmdb(cleanTitle, year, isSerie);
      if (t) {
        if (t.poster_path) item.image = IMG_POSTER + t.poster_path;
        if (t.vote_average !== undefined && t.vote_average !== null && Number(t.vote_average) >= 0) item.rating = fmtRating(t.vote_average);
        if (t.id > 0) item.tmdbId = String(t.id);
      }
    } catch (e) { log("TMDB card: " + e); }
    out.push(item);
  }
  return out;
}

function fmtRating(v) {
  var n = Number(v);
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

// ───────────── Detalle ─────────────
function detail(pageUrl) {
  var html = get(pageUrl), d = {}, m;
  var isSerie = pageUrl.indexOf("/serie/") !== -1;
  d.isSeries = isSerie;

  m = /<span\s+itemprop="name">\s*([^<]+)\s*<\/span>/.exec(html);
  if (m) d.title = clean(trim(m[1]).replace(/^Ver\s+(Pel[ií]cula|Serie)\s+/i, ""));

  m = /<img\s+itemprop="image"\s+src="([^"]+)"/.exec(html);
  if (m) {
    var poster = m[1];
    if (poster.indexOf("//") === 0) poster = "https:" + poster;
    d.poster = poster;
    d.banner = poster;
  }
  m = /<span\s+itemprop="datePublished">\s*(\d{4})\s*<\/span>/.exec(html);
  if (m) { d.year = m[1]; d.date = m[1]; }
  m = /<span\s+itemprop="duration">\s*([^<]+)\s*<\/span>/.exec(html);
  if (m) d.duration = trim(m[1]);

  m = /<strong>G[eé]neros:<\/strong>([\s\S]*?)<\/li>/i.exec(html);
  if (m) {
    var genres = [], g, gre = /<span\s+itemprop="genre">([^<]+)<\/span>/g;
    while ((g = gre.exec(m[1])) !== null) genres.push(trim(g[1].replace(/,\s*$/, "")));
    if (genres.length) d.genres = genres.join(", ");
  }
  m = /<div[^>]+itemprop="description"[^>]*>[\s\S]*?<p>\s*([\s\S]+?)\s*<\/p>/.exec(html);
  if (m) d.synopsis = clean(trim(m[1].replace(/<[^>]+>/g, "")));

  // TMDB: pisa poster/banner/sinopsis/rating y guarda el id para las imágenes de episodio
  var tmdbId = -1;
  try {
    if (d.title) {
      var t = searchTmdb(d.title, d.year, isSerie);
      if (t) {
        tmdbId = t.id > 0 ? t.id : -1;
        d.tmdbId = String(tmdbId);
        if (t.poster_path) d.poster = IMG_POSTER + t.poster_path;
        if (t.backdrop_path) d.banner = IMG_BACKDROP + t.backdrop_path;
        if (t.vote_average !== undefined && t.vote_average !== null && Number(t.vote_average) >= 0) d.rating = fmtRating(t.vote_average);
        if (t.overview) d.synopsis = t.overview;
      }
    }
  } catch (e) { log("TMDB detail: " + e); }

  var all = [];
  if (isSerie) {
    var entries = [], sm, sre = /<a href="(https?:\/\/[^"]+\/temporada\/[^"]+)"[^>]*>[\s\S]*?<span\s+itemprop="name">Temporada\s+(\d+)<\/span>/g;
    while ((sm = sre.exec(html)) !== null) entries.push([sm[1], sm[2]]);
    for (var i = 0; i < entries.length; i++) {
      try { all = all.concat(seasonEpisodes(entries[i][0], entries[i][1], tmdbId)); }
      catch (e2) { log("temporada " + entries[i][1] + ": " + e2); }
    }
  } else {
    all.push({ url: pageUrl, title: "Película Completa", season: "1", episode: "1", image: d.poster || "" });
  }
  d.episodes = all;
  return d;
}

function seasonEpisodes(seasonUrl, seasonNum, tmdbId) {
  var eps = [];
  var html = get(seasonUrl);
  var tmdbEps = {};
  var sn = parseInt(seasonNum, 10);
  if (tmdbId > 0 && sn >= 0) tmdbEps = tmdbSeason(tmdbId, sn);

  var m, re = /<a href="(https?:\/\/[^"]+\/episodio\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*\/?>\s*<span\s+itemprop="name">([^<]+)<\/span>\s*<span>(\d+x\d+)<\/span>/g;
  var counter = 1;
  while ((m = re.exec(html)) !== null) {
    var image = m[2], code = m[4];
    if (image.indexOf("//") === 0) image = "https:" + image;
    var epNum = code.indexOf("x") !== -1 ? code.split("x")[1] : String(counter);
    var title = clean(trim(m[3]));
    var synopsis = "";
    var te = tmdbEps[parseInt(epNum, 10)];
    if (te) {
      if (te.still_path) image = IMG_STILL + te.still_path;
      if (te.name) title = te.name;
      synopsis = te.overview || "";
    }
    var ep = {
      url: m[1],
      title: "T" + seasonNum + "E" + epNum + " - " + title,
      season: String(seasonNum),
      episode: epNum,
      code: code,
      image: image
    };
    if (synopsis) ep.synopsis = synopsis;
    eps.push(ep);
    counter++;
  }
  return eps;
}

// ───────────── TMDB ─────────────
function tmdbJson(url) {
  var h = http.get(url, { "Accept": "application/json" });
  if (!h) return null;
  try { return JSON.parse(h); } catch (e) { return null; }
}

function searchTmdb(title, year, isSerie) {
  if (!TMDB_KEY) return null;
  var url = TMDB_BASE + (isSerie ? "/search/tv" : "/search/movie")
          + "?api_key=" + TMDB_KEY + "&language=" + TMDB_LANG + "&query=" + encodeURIComponent(title);
  if (year) url += "&" + (isSerie ? "first_air_date_year" : "year") + "=" + year;
  var root = tmdbJson(url);
  if (!root) return null;
  var results = root.results;
  if (!results || !results.length) {
    if (year) return searchTmdb(title, null, isSerie);   // el año del sitio puede no coincidir: reintenta sin año
    return null;
  }
  return results[0];
}

function tmdbSeason(tvId, seasonNum) {
  var map = {};
  if (!TMDB_KEY || tvId <= 0) return map;
  var root = tmdbJson(TMDB_BASE + "/tv/" + tvId + "/season/" + seasonNum + "?api_key=" + TMDB_KEY + "&language=" + TMDB_LANG);
  var eps = root && root.episodes;
  if (!eps) return map;
  for (var i = 0; i < eps.length; i++) map[eps[i].episode_number] = eps[i];
  return map;
}

// ───────────── Reproductores ─────────────
function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;

  var block = html;
  var pm = /<ul class="tabs-video">([\s\S]*?)<\/ul>\s*<style>/.exec(html);
  if (pm) block = pm[1];

  var n = 1;
  var tabRe = /<li class="tab-video-item">([\s\S]*?)(?=<li class="tab-video-item"|$)/g, tm;
  while ((tm = tabRe.exec(block)) !== null) {
    var tab = tm[1];
    var audio = "Latino";
    m = /<div class="tab-item-name">\s*([^<\r\n]+)/.exec(tab);
    if (m) audio = trim(m[1]);
    var quality = "HD";
    m = /Calidad\s*[·•]\s*([A-Za-z0-9]+)/i.exec(tab);
    if (m) quality = trim(m[1]);

    var om, optRe = /<li[^>]+data-server="([^"]+)"[^>]*>\s*<span>\s*([^<]+)<\/span>/g;
    while ((om = optRe.exec(tab)) !== null) {
      var real = decodeUrl(om[1]);
      if (!real) continue;
      out.push({ name: "Server " + n, url: real, audio: audio, quality: quality, serverNum: String(n) });
      n++;
    }
  }

  if (!out.length) {   // respaldo si cambia el markup de las pestañas
    var fm, fre = /<li[^>]+data-server="([^"]+)"[^>]*>[\s\S]*?<span>\s*([^<]+)<\/span>/g;
    while ((fm = fre.exec(html)) !== null) {
      if (trim(fm[2]).toLowerCase() === "reproducir") continue;
      var real2 = decodeUrl(fm[1]);
      if (!real2) continue;
      out.push({ url: real2, serverNum: String(n) });
      n++;
    }
  }
  return out;
}

function decodeUrl(encoded) {
  if (!encoded) return null;
  try {
    var url = util.b64decode(encoded);
    if (url.indexOf("nupload.top/iframe/") !== -1) {
      var q = /[?&]url=([^&#]*)/.exec(url);
      var voe = q ? urlDecode(q[1]) : null;
      if (voe && voe.indexOf("voe.sx") !== -1) return urlDecode(voe);
    }
    return url;
  } catch (e) {
    log("Base64 inválido: " + e);
    return null;
  }
}
