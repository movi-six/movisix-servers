var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("CONFIG.base no está definido en el index.json");

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Accept": "*/*",
  "Referer": BASE + "/"
};

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url) {
  var h;
  try { h = http.get(url, HEADERS); }
  catch (e) { log("Hackstore GET error " + url + ": " + e); return ""; }
  if (!h) { log("Hackstore sin respuesta (HTTP " + http.status() + ") " + url); return ""; }
  return h;
}

function getJson(url) {
  var text = getHtml(url);
  if (!text) return null;
  text = String(text).trim();
  if (text.charAt(0) === "<") { log("Hackstore HTML en " + url); return null; }
  try { return JSON.parse(text); }
  catch (e) { log("Hackstore JSON inválido " + url + ": " + e); return null; }
}

function toArray(data) {
  if (!data) return [];
  if (Object.prototype.toString.call(data) === "[object Array]") return data;
  if (typeof data === "object") return [data];
  return [];
}

// ───────────── Datos de filtros (leídos del HTML, tipo Gamma) ─────────────
var FILTERS_CACHE = null;

function parseHackstoreObject(html, key) {
  var re = new RegExp(key + "\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*,\\s*(?:years|genres|\\}|\\n)", "m");
  var m = re.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function loadFiltersData() {
  if (FILTERS_CACHE) return FILTERS_CACHE;
  var html = getHtml(BASE + "/peliculas");
  if (!html) throw new Error("No se pudo leer " + BASE + "/peliculas para los filtros");
  var genres = parseHackstoreObject(html, "genres") || {};
  var years  = parseHackstoreObject(html, "years")  || {};
  FILTERS_CACHE = { genres: genres, years: years };
  return FILTERS_CACHE;
}

function filters() {
  var data = loadFiltersData();

  var tipoOpts = [
    { value: "movies",  name: "Películas" },
    { value: "tvshows", name: "Series" },
    { value: "animes",  name: "Animes" }
  ];

  var genreOpts = [{ value: "", name: "Todos" }];
  var genreIds = [], id;
  for (id in data.genres) genreIds.push(parseInt(id, 10));
  genreIds.sort(function(a, b) {
    return String(data.genres[a].name).localeCompare(String(data.genres[b].name), "es");
  });
  for (var gi = 0; gi < genreIds.length; gi++) {
    var g = data.genres[genreIds[gi]];
    genreOpts.push({ value: String(genreIds[gi]), name: clean(g.name) });
  }

  var yearOpts = [{ value: "", name: "Todos" }];
  var yearIds = [];
  for (id in data.years) yearIds.push(parseInt(id, 10));
  yearIds.sort(function(a, b) { return b - a; });
  for (var yi = 0; yi < yearIds.length; yi++) {
    var y = data.years[yearIds[yi]];
    yearOpts.push({ value: String(yearIds[yi]), name: clean(y.name) });
  }

  return [
    { type: "note", label: "Los filtros de Género y Año se aplican sobre los resultados del Tipo (la API no los soporta nativamente)." },
    { type: "select", key: "tipo",   label: "Categoría", options: tipoOpts },
    { type: "select", key: "genero", label: "Género",    options: genreOpts },
    { type: "select", key: "anio",   label: "Año",       options: yearOpts }
  ];
}

// ───────────── Tarjetas ─────────────
function posterUrl(path) {
  if (!path) return "";
  path = str(path);
  if (/^https?:\/\//i.test(path)) return path;
  return BASE + "/wp-content/uploads" + (path.charAt(0) === "/" ? "" : "/") + path;
}

function stillUrl(path) {
  if (!path) return "";
  path = str(path);
  if (/^https?:\/\//i.test(path)) return path;
  return "https://image.tmdb.org/t/p/w500" + (path.charAt(0) === "/" ? "" : "/") + path;
}

function typeKind(t) {
  if (t === "tvshows") return "serie";
  if (t === "animes") return "anime";
  return "movie";
}

function itemToCard(item) {
  if (!item || !item.title || !item.slug) return null;
  var type = item.type || "movies";
  return {
    title: clean(item.title),
    url: BASE + "/api/rest/single?post_name=" + encodeURIComponent(item.slug) + "&post_type=" + encodeURIComponent(type),
    image: posterUrl(item.images && item.images.poster),
    year: item.release_date ? String(item.release_date).split("-")[0] : "",
    type: typeKind(type),
    kind: typeKind(type),
    rating: item.rating ? String(item.rating) : "",
    genres: item.genres || []
  };
}

// ───────────── Lista con filtros ─────────────
var PAGE_SIZE = 20;
var MAX_SAFETY = 60;

function fetchPage(tipo, apiPage) {
  var j = getJson(BASE + "/api/rest/listing?post_type=" + tipo + "&page=" + apiPage);
  if (!j || !j.data || !j.data.posts) return { cards: [], hasMore: false, lastPage: 0 };
  var out = [];
  for (var i = 0; i < j.data.posts.length; i++) {
    var c = itemToCard(j.data.posts[i]);
    if (c) out.push(c);
  }
  var pag = j.pagination || {};
  var lastPage = pag.last_page || apiPage;
  var hasMore  = apiPage < lastPage;
  return { cards: out, hasMore: hasMore, lastPage: lastPage };
}

function matchesFilters(card, genreId, yearSlug) {
  if (genreId) {
    var found = false;
    for (var g = 0; g < card.genres.length; g++) {
      if (card.genres[g] === genreId) { found = true; break; }
    }
    if (!found) return false;
  }
  if (yearSlug) {
    if (card.year !== yearSlug) return false;
  }
  return true;
}

function list(page, f) {
  page = page || 1;
  var o = (typeof f === "string") ? { tipo: f } : (f || {});
  var tipo = o.tipo || "movies";
  if (tipo !== "movies" && tipo !== "tvshows" && tipo !== "animes") tipo = "movies";

  var genreId = o.genero ? parseInt(String(o.genero), 10) : 0;
  if (isNaN(genreId)) genreId = 0;

  var yearSlug = "";
  if (o.anio) {
    try {
      var data = loadFiltersData();
      if (data.years[String(o.anio)]) yearSlug = data.years[String(o.anio)].name;
    } catch (e) { log("Hackstore años: " + e); }
  }

  if (!genreId && !yearSlug) {
    return fetchPage(tipo, page).cards;
  }

  var wanted  = (page - 1) * PAGE_SIZE;
  var apiPage = 1;
  var taken   = 0;
  var out     = [];
  var safety  = 0;

  while (out.length < PAGE_SIZE && safety < MAX_SAFETY) {
    safety++;
    var res = fetchPage(tipo, apiPage);
    if (!res.cards.length) break;

    for (var i = 0; i < res.cards.length; i++) {
      var c = res.cards[i];
      if (!matchesFilters(c, genreId, yearSlug)) continue;
      if (taken < wanted) { taken++; continue; }
      if (out.length >= PAGE_SIZE) break;
      out.push(c);
      taken++;
    }

    if (!res.hasMore) break;
    apiPage++;
  }

  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if (!query) return [];
  page = page || 1;
  var types = ["movies", "tvshows", "animes"];
  var out = [], seen = {};
  for (var i = 0; i < types.length; i++) {
    var j = getJson(BASE + "/api/rest/search?post_type=" + types[i] + "&query=" + encodeURIComponent(query) + "&page=" + page);
    if (!j || !j.data || !j.data.posts) continue;
    for (var k = 0; k < j.data.posts.length; k++) {
      var item = j.data.posts[k];
      if (!item || !item.slug) continue;
      var key = item.slug + "|" + (item.type || "");
      if (seen[key]) continue;
      seen[key] = true;
      var c = itemToCard(item);
      if (c) out.push(c);
    }
  }
  return out;
}

// ───────────── Detalle ─────────────
function normalizeDetailUrl(url) {
  url = str(url);
  if (url.indexOf("/api/rest/single") !== -1) return url;
  var slug = url.replace(/\/+$/, "").split("/").pop();
  var type = "movies";
  if (url.indexOf("/series") !== -1) type = "tvshows";
  else if (url.indexOf("/animes") !== -1) type = "animes";
  return BASE + "/api/rest/single?post_name=" + encodeURIComponent(slug) + "&post_type=" + encodeURIComponent(type);
}

function genreNameById(id) {
  try {
    var data = loadFiltersData();
    var g = data.genres[String(id)];
    return g ? clean(g.name) : "";
  } catch (e) { return ""; }
}

function detail(url) {
  var j = getJson(normalizeDetailUrl(url));
  if (!j || !j.data) return null;
  var item = j.data;
  if (!item.title) return null;

  var type = item.type || "movies";
  var isSeries = (type === "tvshows" || type === "animes");

  var tags = [];
  if (item.genres) {
    for (var gi = 0; gi < item.genres.length; gi++) {
      var gn = genreNameById(item.genres[gi]);
      if (gn) tags.push(gn);
    }
  }

  var d = {
    title: clean(item.title),
    poster: posterUrl(item.images && item.images.poster),
    banner: posterUrl(item.images && item.images.backdrop),
    synopsis: str(item.overview),
    year: item.release_date ? String(item.release_date).split("-")[0] : "",
    rating: item.rating ? String(item.rating) + "/10" : "",
    genres: tags.join(", "),
    isSeries: isSeries,
    episodes: []
  };
  if (!d.banner) d.banner = d.poster;

  if (item.trailer && String(item.trailer).trim() && item.trailer !== "no") {
    d.trailer = "https://www.youtube.com/embed/" + item.trailer;
  }

  if (!isSeries) {
    if (item._id !== undefined && item._id !== null) {
      d.episodes.push({
        title: "Ver película",
        url: BASE + "/api/rest/player?post_id=" + encodeURIComponent(item._id),
        image: d.poster
      });
    }
    return d;
  }

  if (item._id === undefined || item._id === null) return d;

  var epsResp = getJson(BASE + "/api/rest/episodes?post_id=" + encodeURIComponent(item._id));
  if (!epsResp || !epsResp.data) return d;

  var epList = toArray(epsResp.data);
  for (var ei = 0; ei < epList.length; ei++) {
    var ep = epList[ei];
    if (!ep || ep._id === undefined || ep._id === null) continue;

    var epTitle = clean(ep.title);
    if (!epTitle) {
      var s = ep.season_number || 1, n = ep.episode_number || (ei + 1);
      epTitle = "T" + s + " Ep " + n;
    }

    var epObj = {
      title: epTitle,
      url: BASE + "/api/rest/player?post_id=" + encodeURIComponent(ep._id),
      image: stillUrl(ep.still_path)
    };
    if (ep.season_number !== undefined && ep.season_number !== null) epObj.season = ep.season_number;
    if (ep.episode_number !== undefined && ep.episode_number !== null) epObj.episode = ep.episode_number;
    d.episodes.push(epObj);
  }
  return d;
}

// ───────────── Servidores ─────────────
function resolvePostId(data) {
  var m = /[?&]post_id=([^&#]+)/.exec(str(data));
  if (m) return decodeURIComponent(m[1]);
  return str(data).replace(/\/+$/, "");
}

function servers(episodeUrl) {
  var postId = resolvePostId(episodeUrl);
  if (!postId) return [];

  var out = [], seen = {};
  function push(u, name) {
    if (!u || seen[u]) return;
    seen[u] = true;
    out.push({ url: u, name: name || "" });
  }

  var players = getJson(BASE + "/api/rest/player?post_id=" + encodeURIComponent(postId));
  var pList = players && players.data ? toArray(players.data) : [];
  for (var i = 0; i < pList.length; i++) {
    var pl = pList[i];
    if (!pl || !pl.url) continue;
    if (!/^https?:\/\//i.test(pl.url)) continue;
    var label = clean(str(pl.lang) + (pl.quality ? " · " + pl.quality : ""));
    push(pl.url, label || ("Player " + (i + 1)));
  }

  var downloads = getJson(BASE + "/api/rest/downloads?post_id=" + encodeURIComponent(postId));
  var dList = downloads && downloads.data ? toArray(downloads.data) : [];
  for (var k = 0; k < dList.length; k++) {
    var dl = dList[k];
    if (!dl || !dl.url) continue;
    var nm = clean(str(dl.server) + (dl.quality ? " " + dl.quality : ""));
    push(dl.url, nm || ("Descarga " + (k + 1)));
  }

  return out;
                      }
