/*
 * FrikiSeries — FrikiSeries (Cartoons y Anime)
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

// ───────────── Lista (Series) ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/series" + (page > 1 ? "?page=" + page : "");
  var html = getHtml(url);
  var data = extractData(html);
  var out = [];
  
  if (!data || !data["data-info"]) return out;
  
  for (var i = 0; i < data["data-info"].length; i++) {
    var it = data["data-info"][i];
    if (it.tipo !== "serie") continue;
    
    out.push({
      title: clean(it.titulo),
      url: BASE + "/ver-serie/" + it.slug,
      image: str(it.imagen),
      year: str(it.fecha) === "999" ? "" : str(it.fecha),
      type: "serie"
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
    if (it.tipo !== "serie") continue;
    out.push({
      title: clean(it.titulo),
      url: BASE + "/ver-serie/" + it.slug,
      image: str(it.imagen),
      year: str(it.fecha) === "999" ? "" : str(it.fecha),
      type: "serie"
    });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url);
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: true, episodes: [] };

  var data = extractData(html);
  if (data && data["data-info"] && data["data-info"].length > 0) {
    // Buscamos el objeto de información que corresponde a esta URL
    var info = null;
    for (var i = 0; i < data["data-info"].length; i++) {
      if (url.indexOf(data["data-info"][i].slug) !== -1) {
        info = data["data-info"][i];
        break;
      }
    }
    // Si no lo encontramos por slug, usamos el primero (fallback)
    if (!info) info = data["data-info"][0];

    d.title = clean(info.titulo);
    d.synopsis = clean(info.descripcion);
    d.poster = str(info.imagen);
    d.banner = str(info.imagen); // Usamos la misma para banner
    d.year = str(info.fecha) === "999" ? "" : str(info.fecha);
    d.isSeries = info.tipo === "serie";

    var totalEpisodes = parseInt(info.totalCapitulos, 10) || 1;
    var slug = info.slug;

    if (d.isSeries) {
      for (var i = 1; i <= totalEpisodes; i++) {
        d.episodes.push({
          title: "Capítulo " + i,
          url: BASE + "/ver-serie/" + slug + "/capitulo/" + i,
          image: d.poster
        });
      }
    } else {
      // Es una película
      d.episodes.push({
        title: d.title,
        url: url,
        image: d.poster
      });
    }
  } else {
    d.title = "Título no encontrado";
    d.episodes.push({ title: "Error", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores ─────────────
// La URL del episodio ya contiene el JSON con la URL del video.
// No es necesario hacer una petición HTTP adicional.
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var data = extractData(html);
  var out = [];
  
  if (data && data["data-info"] && data["data-info"].length > 0) {
    // Buscamos el objeto correcto (por slug)
    var info = null;
    for (var i = 0; i < data["data-info"].length; i++) {
      if (episodeUrl.indexOf(data["data-info"][i].slug) !== -1) {
        info = data["data-info"][i];
        break;
      }
    }
    if (!info) info = data["data-info"][0];

    var videoUrl = info.video;
    if (videoUrl && videoUrl !== "xxxx" && videoUrl.indexOf("http") === 0) {
      out.push(videoUrl);
    }
  }
  
  // Fallback: si no se encontró en el JSON, buscamos en iframes del HTML
  if (out.length === 0) {
    var re = /<iframe[^>]+src="([^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var u = m[1];
      if (u.indexOf("ok.ru") !== -1 || u.indexOf("youtube") !== -1 || u.indexOf("facebook") !== -1) {
        out.push(u);
      }
    }
  }
  
  return out;
        }
