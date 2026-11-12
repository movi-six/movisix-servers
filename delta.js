var BASE = (CONFIG.base || "").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers || {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/[\r\n]+/g, "");
}

function dec(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, "%20")); } catch (e) { return String(s); }
}

function img500(s) { return dec(s).replace("/original/", "/w500/"); }

function parseCards(html) {
  var out = [], m;
  var re = /<li class="TPostMv">[\s\S]*?<a href="(\/ver-(?:pelicula|serie)\/[^"]+)">[\s\S]*?<span class="Year">(\d{4})<\/span>[\s\S]*?alt="([^"]+)"[\s\S]*?srcSet="[^"]*url=([^&]+)&/g;
  while ((m = re.exec(html)) !== null) {
    var isSerie = m[1].indexOf("/ver-serie/") >= 0;
    out.push({
      url:   BASE + m[1],
      year:  m[2],
      title: clean(m[3]),
      image: img500(m[4]),
      type:  isSerie ? "serie" : "pelicula",
      kind:  isSerie ? "serie" : "movie"
    });
  }
  if (!out.length) {
    var re2 = /<(?:li|article)[^>]+class="[^"]*TPost[^"]*"[^>]*>[\s\S]*?<a href="(\/ver-(?:pelicula|serie)\/[^"]+)">[\s\S]*?alt="([^"]+)"[\s\S]*?srcSet="[^"]*url=([^&]+)&/g;
    while ((m = re2.exec(html)) !== null) {
      var isS = m[1].indexOf("/ver-serie/") >= 0;
      out.push({
        url:   BASE + m[1],
        year:  "",
        title: clean(m[2]),
        image: img500(m[3]),
        type:  isS ? "serie" : "pelicula",
        kind:  isS ? "serie" : "movie"
      });
    }
  }
  return out;
}

function home(page) {
  page = page || 1;
  var url = page === 1 ? BASE + "/peliculas" : BASE + "/peliculas/page/" + page;
  var cards = parseCards(get(url));
  // Respaldo: si /peliculas llega sin cards (cambió el HTML), prueba la portada
  if (!cards.length && page === 1) cards = parseCards(get(BASE + "/"));
  return cards;
}

function genres() {
  var html = get(BASE + "/peliculas");
  var out = [], m, seen = {};
  var re = /<a href="\/genero\/([^"\/]+)">([^<]+)<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug]) continue;
    seen[slug] = true;
    out.push({
      slug: slug,
      name: clean(m[2]),
      url:  BASE + "/genero/" + slug
    });
  }
  return out;
}

function list(page, genre) {
  // La app pide el HOME con list(page) SIN género (no llama a home()). Antes aquí se lanzaba un error
  // y el Home mostraba «El servidor no está disponible» aunque la búsqueda funcionara.
  if (!genre) return home(page);
  page = page || 1;
  genre = String(genre).replace(/^\/+|\/+$/g, "");
  var url = page === 1
    ? BASE + "/genero/" + genre
    : BASE + "/genero/" + genre + "/page/" + page;
  return parseCards(get(url));
}

function search(query, page) {
  if (page && page > 1) return [];
  var html = get(BASE + "/search?q=" + encodeURIComponent(query));
  var sec = /<section class="home-movies">([\s\S]*?)<\/section>/.exec(html);
  if (!sec) return [];
  return parseCards(sec[1]);
}

function detail(pageUrl) {
  var html = get(pageUrl), m;
  var d = {};
  var isSeries = pageUrl.indexOf("/ver-serie/") >= 0;

  m = /<h1 class="Title">([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  m = /<span class="SubTitle">\s*<!--\s*-->([^<]+)<!--/.exec(html);
  if (m) d.altTitle = clean(m[1]);
  m = /<p class="meta"><span>([^<]+)<\/span><span>(\d{4})<\/span>/.exec(html);
  if (m) { d.duration = m[1]; d.year = m[2]; }

  var genresList = [], g, gre = /<a href="\/genero\/[^"]+">([^<]+)<\/a>/g;
  while ((g = gre.exec(html)) !== null) genresList.push(g[1]);
  if (genresList.length) d.genres = genresList.join(", ");

  m = /<strong>Actores:<\/strong>\s*<!--\s*-->([^<]+)/.exec(html);
  if (m) d.actors = m[1].replace(/^\s+|\s+$/g, "");
  m = /<div class="Description"><p>([^<]+)<\/p>/.exec(html);
  if (m) d.synopsis = m[1];
  m = /data-percent="(\d+)"/.exec(html);
  if (m) d.rating = m[1] + "/100";

  var mainPoster = "";
  m = /srcset="[^"]*url=([^&]+)&/.exec(html);
  if (m) { mainPoster = img500(m[1]); d.poster = mainPoster; }
  m = /<\/article>\s*<div class="Image">[\s\S]*?srcset="[^"]*url=([^&]+)&/.exec(html);
  d.banner = m ? dec(m[1]) : mainPoster;

  if (isSeries) {
    var slug = "";
    m = /\/ver-serie\/([^\/?]+)/.exec(pageUrl);
    if (m) slug = m[1];
    var order = [], bySeason = {};
    var re = /\{"title":"([^"]+)","TMDbId":"[^"]*","number":(\d+),"releaseDate":"[^"]*","image":"([^"]*)","url":\{"slug":"series\/[^\/]+\/[^\/]+\/seasons\/(\d+)\/episodes\/\d+"\}/g;
    while ((m = re.exec(html)) !== null) {
      var image = m[3].replace(/\\\//g, "/");
      if (!image || image === "null") image = mainPoster;
      else if (image.indexOf("http") !== 0) image = "https://image.tmdb.org/t/p/w300" + image;
      var key = "Temporada " + m[4];
      if (!bySeason[key]) { bySeason[key] = []; order.push(key); }
      bySeason[key].push({
        url: BASE + "/episodio/" + slug + "-temporada-" + m[4] + "-episodio-" + m[2],
        title: clean(m[1]), image: image, season: m[4], episode: m[2]
      });
    }
    var seasons = [];
    for (var i = 0; i < order.length; i++) seasons.push({ title: order[i], episodes: bySeason[order[i]] });
    d.seasons = seasons;
    d.isSeries = true;
  } else {
    d.isSeries = false;
    d.episodes = [{ url: pageUrl, title: "Ver película", image: mainPoster }];
  }
  return d;
}

function playerUrls(ulContent) {
  var urls = [], m, re = /<li[^>]+data-tr="([^"]+)"/g;
  while ((m = re.exec(ulContent)) !== null) urls.push(m[1]);
  return urls;
}

var BLOCKED = ["mxdrop", "listeamed", "mixdrop", "mojon", "fembed", "videobin", "embedv"];

function parsePlayerUrl(playerUrl) {
  var out = [];
  try {
    var html = http.get(playerUrl, { "User-Agent": "Mozilla/5.0" }) || "";
    var m = /url\s*=\s*'([^']+)'/.exec(html);
    if (!m) return out;
    var s = m[1];
    if (/bysejikuar\.com/i.test(s)) s = s.replace(/bysejikuar\.com/ig, "filemoon.sx");
    if (/sendvid\.com/i.test(s)) {
      var seg = s.split("#")[0].split("?")[0].replace(/\/+$/, "").split("/").pop();
      if (seg) s = "https://sendvid.com/embed/" + seg;
    }
    var low = s.toLowerCase();
    for (var i = 0; i < BLOCKED.length; i++) if (low.indexOf(BLOCKED[i]) >= 0) return out;
    out.push(s);
  } catch (e) { log("playerUrl " + e); }
  return out;
}

function extractPlayers(ul) {
  var urls = playerUrls(ul), out = [];
  var limit = Math.min(6, urls.length);
  for (var i = 0; i < limit; i++) out = out.concat(parsePlayerUrl(urls[i]));
  return out;
}

function servers(episodeUrl) {
  var html = get(episodeUrl), m, blocks = [];
  var re = /<div class="_1R6bW_0"><span>([\s\S]*?)<\/span><\/div>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/g;
  while ((m = re.exec(html)) !== null) blocks.push({ lang: m[1].replace(/^\s+|\s+$/g, "").toLowerCase(), ul: m[2] });

  var out = [], i, l;
  for (i = 0; i < blocks.length; i++) {
    l = blocks[i].lang;
    if (l.indexOf("español") >= 0 || l.indexOf("latino") >= 0 || l.indexOf("castellano") >= 0 || l.indexOf("spanish") >= 0) {
      out = extractPlayers(blocks[i].ul);
      return out;
    }
  }
  for (i = 0; i < blocks.length; i++) {
    l = blocks[i].lang;
    if (l.indexOf("subtitulado") >= 0 || l.indexOf("sub") >= 0) { out = extractPlayers(blocks[i].ul); break; }
  }
  if (!out.length && blocks.length) out = extractPlayers(blocks[0].ul);
  return out;
}
