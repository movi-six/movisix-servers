// Catálogo: TMDB  |  Streams: Torrentio (addon de Stremio)
//
// En el index.json (CONFIG) puedes definir:
//   tmdbKey   -> (OBLIGATORIO) API key v3 de TMDB (https://www.themoviedb.org/settings/api)
//   torrentio -> (opcional) base de Torrentio con tu configuración, sin /manifest.json
//                por defecto: https://torrentio.strem.fun/language=latino,spanish
//   lang      -> (opcional) idioma de TMDB, por defecto es-MX

var TMDB = "https://api.themoviedb.org/3";
var IMG = "https://image.tmdb.org/t/p/";
var KEY = CONFIG.tmdbKey || "";
if (!KEY) throw new Error("CONFIG.tmdbKey no está definido en el index.json");

var TORRENTIO = (CONFIG.torrentio || "https://torrentio.strem.fun/language=latino,spanish")
  .replace(/\/manifest\.json$/i, "").replace(/\/+$/, "");
var LANG = CONFIG.lang || "es-MX";

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Accept": "application/json"
};

var EXTRA_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce"
];

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getJson(url) {
  var text;
  try { text = http.get(url, HEADERS); }
  catch (e) { log("TMDB/Torrentio GET error " + url.replace(KEY, "***") + ": " + e); return null; }
  if (!text) { log("Sin respuesta (HTTP " + http.status() + ") " + url.replace(KEY, "***")); return null; }
  text = String(text).trim();
  if (text.charAt(0) === "<") return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function tmdb(path, params) {
  var url = TMDB + path + "?api_key=" + encodeURIComponent(KEY) + "&language=" + encodeURIComponent(LANG);
  if (params) for (var k in params) url += "&" + k + "=" + encodeURIComponent(params[k]);
  return getJson(url);
}

function img(path, size) { return path ? IMG + (size || "w500") + str(path) : ""; }

// ───────────── Filtros ─────────────
// Categorías especiales (se traducen a filtros de /discover)
var CATS = {
  "":       { name: "Todas" },
  "anime":  { name: "Anime", genres: "16", lang: "ja" },
  "kdrama": { name: "Doramas · Corea del Sur", country: "KR", noGenres: "16" },
  "cdrama": { name: "Doramas · China", country: "CN", noGenres: "16" },
  "jdrama": { name: "Doramas · Japón", country: "JP", noGenres: "16" },
  "thai":   { name: "Doramas · Tailandia", country: "TH", noGenres: "16" },
  "twdrama":{ name: "Doramas · Taiwán", country: "TW", noGenres: "16" },
  "animacion": { name: "Animación (no anime)", genres: "16", noLang: "ja" }
};

// Géneros (IDs de películas; para series se convierten con genreFor)
var GENRE_OPTS = [
  ["28", "Acción"], ["12", "Aventura"], ["16", "Animación"], ["35", "Comedia"],
  ["80", "Crimen"], ["99", "Documental"], ["18", "Drama"], ["10751", "Familia"],
  ["14", "Fantasía"], ["36", "Historia"], ["27", "Terror"], ["10402", "Música"],
  ["9648", "Misterio"], ["10749", "Romance"], ["878", "Ciencia ficción"],
  ["53", "Suspenso"], ["10752", "Bélica"], ["37", "Western"],
  ["10764", "Reality (series)"], ["10766", "Telenovela (series)"],
  ["10767", "Talk show (series)"], ["10762", "Infantil (series)"]
];

// En TMDB algunos géneros de series tienen otro ID
function genreFor(type, id) {
  if (type !== "tv") return id;
  var map = { "28": "10759", "12": "10759", "878": "10765", "14": "10765", "10752": "10768" };
  return map[id] || id;
}

function filters() {
  var cats = [];
  for (var k in CATS) cats.push({ value: k, name: CATS[k].name });

  var gens = [{ value: "", name: "Todos" }];
  for (var g = 0; g < GENRE_OPTS.length; g++) gens.push({ value: GENRE_OPTS[g][0], name: GENRE_OPTS[g][1] });

  var years = [{ value: "", name: "Todos" }];
  var thisYear = new Date().getFullYear();
  for (var y = thisYear + 1; y >= 1950; y--) years.push({ value: String(y), name: String(y) });

  return [
    { type: "select", key: "tipo", label: "Tipo",
      options: [{ value: "movie", name: "Películas" }, { value: "tv", name: "Series" }] },
    { type: "select", key: "cat", label: "Categoría", options: cats },
    { type: "select", key: "genero", label: "Género", options: gens },
    { type: "select", key: "anio", label: "Año", options: years },
    { type: "select", key: "orden", label: "Orden",
      options: [
        { value: "popularity.desc", name: "Populares" },
        { value: "vote_average.desc", name: "Mejor valoradas" },
        { value: "date.desc", name: "Más recientes" },
        { value: "date.asc", name: "Más antiguos" }
      ] },
    { type: "select", key: "adulto", label: "Contenido adulto",
      options: [{ value: "no", name: "Ocultar" }, { value: "si", name: "Incluir (+18)" }] }
  ];
}

// ───────────── Tarjetas ─────────────
// La URL de la tarjeta es "tmdb:movie:123" o "tmdb:tv:456"
function card(it, forcedType) {
  var type = forcedType || it.media_type;
  if (type !== "movie" && type !== "tv") return null;
  var title = it.title || it.name;
  if (!title || !it.id) return null;
  var date = it.release_date || it.first_air_date || "";
  return {
    title: clean(title),
    url: "tmdb:" + type + ":" + it.id,
    image: img(it.poster_path),
    year: date ? String(date).split("-")[0] : "",
    type: type === "tv" ? "serie" : "movie",
    kind: type === "tv" ? "serie" : "movie",
    rating: it.vote_average ? String(Math.round(it.vote_average * 10) / 10) : ""
  };
}

function cards(results, forcedType) {
  var out = [];
  for (var i = 0; i < (results || []).length; i++) {
    var c = card(results[i], forcedType);
    if (c) out.push(c);
  }
  return out;
}

// ───────────── Lista ─────────────
function today() {
  try { return new Date().toISOString().substring(0, 10); } catch (e) { return ""; }
}

function list(page, f) {
  page = page || 1;
  var o = f || {};
  var tipo = o.tipo === "tv" ? "tv" : "movie";
  var cat = CATS[o.cat || ""] || CATS[""];
  var dateField = tipo === "tv" ? "first_air_date" : "primary_release_date";

  var p = { page: page, include_adult: o.adulto === "si" ? "true" : "false" };

  // Orden
  var orden = o.orden || "popularity.desc";
  if (orden === "date.desc" || orden === "date.asc") {
    p.sort_by = dateField + (orden === "date.desc" ? ".desc" : ".asc");
    if (orden === "date.desc" && today()) p[dateField + ".lte"] = today(); // sin estrenos futuros
    p["vote_count.gte"] = "5";
  } else if (orden === "vote_average.desc") {
    p.sort_by = "vote_average.desc";
    p["vote_count.gte"] = "300"; // evita títulos con 1-2 votos y nota 10
  } else {
    p.sort_by = "popularity.desc";
  }

  // Género (+ el de la categoría, p. ej. anime = Animación)
  var gens = [];
  if (cat.genres) gens.push(cat.genres);
  if (o.genero) gens.push(genreFor(tipo, o.genero));
  if (gens.length) p.with_genres = gens.join(",");
  if (cat.noGenres) p.without_genres = cat.noGenres;

  // Origen / idioma
  if (cat.country) p.with_origin_country = cat.country;
  if (cat.lang) p.with_original_language = cat.lang;
  if (cat.noLang) p.without_original_language = cat.noLang; // (ignorado por TMDB si no aplica)

  // Año
  if (o.anio) {
    if (tipo === "tv") p.first_air_date_year = o.anio;
    else p.primary_release_year = o.anio;
  }

  var j = tmdb("/discover/" + tipo, p);
  return j ? cards(j.results, tipo) : [];
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if (!query) return [];
  page = page || 1;
  // Para incluir contenido adulto en la búsqueda, pon "adult": true en el CONFIG
  var j = tmdb("/search/multi", { query: query, page: page, include_adult: CONFIG.adult ? "true" : "false" });
  return j ? cards(j.results, null) : [];
}

// ───────────── Detalle ─────────────
// Episodios: url = "tt1234567" (película) o "tt1234567:1:3" (serie T1 E3), lo que Torrentio espera
function parseCardUrl(url) {
  var m = /tmdb:(movie|tv):(\d+)/.exec(str(url));
  if (m) return { type: m[1], id: m[2] };
  m = /themoviedb\.org\/(movie|tv)\/(\d+)/.exec(str(url));
  if (m) return { type: m[1], id: m[2] };
  return null;
}

function detail(url) {
  var p = parseCardUrl(url);
  if (!p) return null;

  var j = tmdb("/" + p.type + "/" + p.id, { append_to_response: "external_ids,videos" });
  if (!j) return null;

  var imdb = (j.external_ids && j.external_ids.imdb_id) || j.imdb_id || "";
  var isSeries = p.type === "tv";
  var date = j.release_date || j.first_air_date || "";

  var genres = [];
  for (var g = 0; g < (j.genres || []).length; g++) genres.push(j.genres[g].name);

  var d = {
    title: clean(j.title || j.name),
    poster: img(j.poster_path, "w500"),
    banner: img(j.backdrop_path, "w1280") || img(j.poster_path, "w500"),
    synopsis: str(j.overview),
    year: date ? String(date).split("-")[0] : "",
    rating: j.vote_average ? String(Math.round(j.vote_average * 10) / 10) + "/10" : "",
    genres: genres.join(", "),
    isSeries: isSeries,
    episodes: []
  };

  // Tráiler de YouTube
  var vids = (j.videos && j.videos.results) || [];
  for (var v = 0; v < vids.length; v++) {
    if (vids[v].site === "YouTube" && vids[v].type === "Trailer") {
      d.trailer = "https://www.youtube.com/embed/" + vids[v].key;
      break;
    }
  }

  if (!imdb) {
    log("Sin IMDb ID en TMDB para " + p.type + ":" + p.id + "; Torrentio no podrá buscar streams");
    return d;
  }

  if (!isSeries) {
    d.episodes.push({ title: "Ver película", url: imdb, image: d.poster });
    return d;
  }

  // Series: una petición por temporada (saltamos la 0 = especiales)
  var seasons = j.seasons || [];
  for (var s = 0; s < seasons.length; s++) {
    var sn = seasons[s].season_number;
    if (!sn || sn < 1) continue;
    var sj = tmdb("/tv/" + p.id + "/season/" + sn);
    var eps = (sj && sj.episodes) || [];
    for (var e = 0; e < eps.length; e++) {
      var ep = eps[e];
      d.episodes.push({
        title: clean(ep.name) || ("Episodio " + ep.episode_number),
        url: imdb + ":" + sn + ":" + ep.episode_number,
        image: img(ep.still_path, "w500"),
        season: sn,
        episode: ep.episode_number
      });
    }
  }
  return d;
}

// ───────────── Servidores (Torrentio) ─────────────
function magnetFrom(s) {
  var hash = str(s.infoHash);
  if (!hash) return "";

  var dn = (s.behaviorHints && s.behaviorHints.filename) || str(s.title).split("\n")[0];
  var m = "magnet:?xt=urn:btih:" + hash + "&dn=" + encodeURIComponent(dn);

  var trackers = [], seen = {};
  function addTr(t) { if (t && !seen[t]) { seen[t] = true; trackers.push(t); } }

  var src = s.sources || [];
  for (var i = 0; i < src.length; i++) {
    var x = str(src[i]);
    if (x.indexOf("tracker:") === 0) addTr(x.substring(8));
  }
  for (var k = 0; k < EXTRA_TRACKERS.length; k++) addTr(EXTRA_TRACKERS[k]);

  for (var t = 0; t < trackers.length; t++) m += "&tr=" + encodeURIComponent(trackers[t]);

  // Archivo concreto dentro del torrent (útil en packs de temporada)
  if (s.fileIdx !== undefined && s.fileIdx !== null) m += "&so=" + s.fileIdx;
  return m;
}

function servers(epUrl) {
  var id = str(epUrl);
  var m = /^(tt\d+)(?::(\d+):(\d+))?$/.exec(id);
  if (!m) return [];

  var path = m[2] ? "/stream/series/" + m[1] + ":" + m[2] + ":" + m[3] + ".json"
                  : "/stream/movie/" + m[1] + ".json";

  var j = getJson(TORRENTIO + path);
  var list = (j && j.streams) || [];

  var out = [], seen = {};
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var mag = magnetFrom(s);
    if (!mag || seen[s.infoHash + ":" + s.fileIdx]) continue;
    seen[s.infoHash + ":" + s.fileIdx] = true;

    // name = "Torrentio\n1080p" ; title = "Nombre.del.archivo\n👤 12 💾 1.7 GB ⚙️ Fuente"
    var q = clean(str(s.name).replace(/^Torrentio\s*/i, "").replace(/\n+/g, " "));
    var lines = str(s.title).split("\n");
    var info = clean(lines.slice(1).join(" "));
    var label = "Torrent" + (q ? " · " + q : "") + (info ? " · " + info : "");
    out.push({ url: mag, name: label });
  }
  return out;
}
