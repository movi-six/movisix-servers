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

function extractData(html) {
  var m = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function extractSlug(url) {
  var m = /\/ver-serie\/([^\/\?]+)/.exec(url);
  return m ? m[1] : null;
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCapitulosArray(rawJson) {
  if (Array.isArray(rawJson)) return rawJson;
  if (rawJson && Array.isArray(rawJson.capitulos)) return rawJson.capitulos;
  if (rawJson && Array.isArray(rawJson.data)) return rawJson.data;
  if (rawJson && typeof rawJson === 'object') {
    for (var key in rawJson) {
      if (Array.isArray(rawJson[key])) return rawJson[key];
    }
  }
  return [];
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

// ───────────── Detalle (Película) ─────────────
function detail(url) {
  var html = getHtml(url);
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: false, episodes: [] };

  var data = extractData(html);
  var slug = extractSlug(url);
  
  if (data && data["data-info"] && data["data-info"].length > 0) {
    var info = null;
    for (var i = 0; i < data["data-info"].length; i++) {
      if (data["data-info"][i].slug === slug) {
        info = data["data-info"][i];
        break;
      }
    }
    if (!info) info = data["data-info"][0];

    d.title = clean(info.titulo);
    d.synopsis = clean(info.descripcion);
    d.year = str(info.fecha) === "999" ? "" : str(info.fecha);
    d.poster = "";
    d.banner = "";
    d.isSeries = false;

    d.episodes.push({
      title: d.title,
      url: url,
      image: ""
    });
  } else {
    d.title = "Título no encontrado";
    d.episodes.push({ title: "Error", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores ─────────────
function servers(episodeUrl) {
  var slug = extractSlug(episodeUrl);
  
  // 1. Intentar extraer del ng-state
  var html = getHtml(episodeUrl);
  var data = extractData(html);
  
  if (data && data["data-info"] && slug) {
    for (var i = 0; i < data["data-info"].length; i++) {
      var info = data["data-info"][i];
      if (info.slug === slug) {
        var v = info.video;
        if (v && v !== "xxxx" && v.indexOf("http") === 0) {
          return [v];
        }
        break;
      }
    }
  }

  // 2. Fallback: buscar en capitulos.json
  if (slug) {
    try {
      var jsonHtml = getHtml(BASE + "/assets/data/capitulos.json");
      var raw = JSON.parse(jsonHtml);
      var lista = getCapitulosArray(raw);
      
      var normSlug = normalize(slug);
      for (var j = 0; j < lista.length; j++) {
        var ep = lista[j];
        if (normalize(ep.serie).indexOf(normSlug) !== -1 && ep.capitulo === 1) {
          if (ep.video && ep.video !== "xxxx" && ep.video.indexOf("http") === 0) {
            return [ep.video];
          }
        }
      }
    } catch (e) {
      // Falló
    }
  }

  // 3. Fallback final: iframe en HTML
  var out = [];
  var re = /<iframe[^>]+src="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var u = m[1];
    if (u.indexOf("ok.ru") !== -1 || u.indexOf("youtube") !== -1 || u.indexOf("facebook") !== -1) {
      out.push(u);
    }
  }
  
  return out;
}
