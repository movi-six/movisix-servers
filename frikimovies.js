/*
 * FrikiMovies — FrikiSeries (Peliculas Retro y Anime)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://www.frikiserie.com").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url) {
  return http.get(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
}

// Extrae el estado JSON que Angular incrusta en el HTML
function extractData(html) {
  var m = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

// ───────────── Lista (Películas) ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  var html = getHtml(url);
  var data = extractData(html);
  var out = [];
  
  if (!data || !data["data-info"]) return out;
  
  for (var i = 0; i < data["data-info"].length; i++) {
    var it = data["data-info"][i];
    if (it.tipo !== "pelicula") continue; // Filtramos solo películas
    
    out.push({
      title: clean(it.titulo),
      url: BASE + "/ver-serie/" + it.slug, // La web usa /ver-serie/ para todo
      image: str(it.imagen),
      year: str(it.fecha) === "999" ? "" : str(it.fecha),
      type: "movie"
    });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if (page && page > 1) return [];
  var url = BASE + "/buscar?q=" + encodeURIComponent(query);
  var html = getHtml(url);
  var data = extractData(html);
  var out = [];
  
  if (!data || !data["data-info"]) return out;
  for (var i = 0; i < data["data-info"].length; i++) {
    var it = data["data-info"][i];
    if (it.tipo !== "pelicula") continue;
    out.push({
      title: clean(it.titulo),
      url: BASE + "/ver-serie/" + it.slug,
      image: str(it.imagen),
      year: str(it.fecha) === "999" ? "" : str(it.fecha),
      type: "movie"
    });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, ""));

  m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) { d.poster = m[1]; d.banner = m[1]; }

  // En FrikiSeries, el reproductor está en un iframe (ok.ru, etc.)
  var re = /<iframe[^>]+src="([^"]+)"/g;
  var found = false;
  while ((m = re.exec(html)) !== null) {
    if (m[1].indexOf("ok.ru") !== -1 || m[1].indexOf("youtube") !== -1 || m[1].indexOf("facebook") !== -1) {
      d.episodes.push({ title: "Ver Película", url: url, image: d.poster });
      found = true;
      break;
    }
  }
  
  if (!found) d.episodes.push({ title: "Ver Película", url: url, image: d.poster });
  return d;
}

// ───────────── Servidores ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];
  var re = /<iframe[^>]+src="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var u = m[1];
    if (u.indexOf("ok.ru") !== -1 || u.indexOf("youtube") !== -1) {
      out.push(u);
    }
  }
  return out;
}