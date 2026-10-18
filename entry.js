/*
 * Entry — ManhwaWeb (manhwaweb.com) · lector de manhwas por API JSON
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl) · images(chapterUrl, referer)
 * index.json: "manga": true  → la app abre el lector de capítulos y le pide las páginas a images().
 *             CONFIG.base = sitio · CONFIG.api = backend JSON (si cambia el backend, edita "api" en index.json).
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://manhwaweb.com").replace(/\/+$/, "");
var API  = (CONFIG.api  || "https://api.manhwaweb.com").replace(/\/+$/, "");

function str(v) { return (v === undefined || v === null) ? "" : String(v); }

// GET JSON; si el backend no responde lanza un mensaje claro (llega en el aviso al administrador)
function getJson(url, referer) {
  var h = http.get(url, {
    "Accept": "application/json, text/plain, */*",
    "Origin": BASE,
    "Referer": referer || (BASE + "/library")
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  try { return JSON.parse(h); }
  catch (e) { throw new Error("La respuesta no es JSON: " + url); }
}

function epNum(title) {
  var m, last = -1, re = /(\d+(?:\.\d+)?)/g;
  while ((m = re.exec(str(title))) !== null) last = parseFloat(m[1]);
  return last;
}

// ordena por clave numérica de forma estable (empates conservan su orden)
function sortBy(arr, keyFn, desc) {
  var tmp = [], i;
  for (i = 0; i < arr.length; i++) tmp.push({ v: arr[i], k: keyFn(arr[i]), i: i });
  tmp.sort(function (a, b) {
    if (a.k !== b.k) return desc ? b.k - a.k : a.k - b.k;
    return a.i - b.i;
  });
  var out = [];
  for (i = 0; i < tmp.length; i++) out.push(tmp[i].v);
  return out;
}

// ───────────── Lista (home = "Últimos capítulos", sin paginación en el backend) ─────────────
function list(page) {
  if (page && page > 1) return [];
  var root = getJson(API + "/latest/new-manhwa", BASE + "/latest-chapters");
  var manhwas = root && root.manhwas;
  if (!manhwas) return [];

  var items = [], keys = ["_manhwas", "manhwas_esp"], k, j;   // "manhwas_raw" (sin traducir) se excluye
  for (k = 0; k < keys.length; k++) {
    var arr = manhwas[keys[k]];
    if (!arr || !arr.length) continue;
    for (j = 0; j < arr.length; j++) items.push(arr[j]);
  }
  items = sortBy(items, function (o) { return Number(o.create) || 0; }, true);

  var out = [];
  for (j = 0; j < items.length; j++) {
    var o = items[j];
    var id = str(o.id_manhwa) || str(o.id_rel);
    if (!id) continue;
    var chap = (o.chapter === undefined || o.chapter === null || isNaN(Number(o.chapter))) ? -1 : Number(o.chapter);
    out.push({
      id: id,
      title: str(o.name_manhwa),
      url: BASE + "/manhwa/" + id,
      image: str(o.img),
      chapter: chap < 0 ? "" : String(chap),
      group: str(o.gru_name)
    });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  var apiPage = Math.max(0, (page || 1) - 1);
  var url = API + "/manhwa/library?buscar=" + encodeURIComponent(query)
          + "&erotico=&demografia=&order_item=alfabetico&order_dir=desc&page=" + apiPage + "&generes=";
  var root = getJson(url, BASE + "/library");
  var arr = root && root.data;
  if (!arr && root && root.manhwas) arr = root.manhwas._manhwas;
  var out = [];
  if (!arr) return out;
  for (var i = 0; i < arr.length; i++) {
    var o = arr[i];
    var id = str(o._id) || str(o.id_manhwa) || str(o.id_rel);
    if (!id) continue;
    out.push({
      id: id,
      title: str(o.name_esp) || str(o.name_manhwa) || str(o.the_real_name),
      url: BASE + "/manhwa/" + id,
      image: str(o._imagen) || str(o.img)
    });
  }
  return out;
}

// ───────────── Detalle + capítulos ─────────────
function detail(url) {
  var m = /\/manhwa\/([^\/?#]+)/.exec(url);
  var id = m ? m[1] : str(url);

  var data = getJson(API + "/manhwa/see/" + id, url);
  if (data && data.data && typeof data.data === "object") data = data.data;

  var img = str(data._imagen);
  var d = {
    title: str(data.name_esp) || str(data.the_real_name) || "Sin título",
    synopsis: str(data._sinopsis),
    poster: img,
    banner: img,
    type: str(data._tipo),
    status: str(data._status),
    demo: str(data._demografi)
  };

  // Géneros: _categoris = [{ "<id>": "Acción" }, ...]
  var cats = data._categoris, genres = [], i, k;
  if (cats && cats.length) {
    for (i = 0; i < cats.length; i++) {
      var cat = cats[i];
      if (!cat || typeof cat !== "object") continue;
      for (k in cat) {
        if (Object.prototype.hasOwnProperty.call(cat, k)) {
          var g = str(cat[k]);
          if (g) genres.push(g);
          break;
        }
      }
    }
  }
  if (genres.length) d.genres = genres.join(", ");

  var chapters = [], seen = {}, arr = data.chapters;
  if (arr && arr.length) {
    for (i = 0; i < arr.length; i++) {
      var c = arr[i];
      var num = Number(c.chapter) || 0;
      var link = str(c.link);
      if (!link && c.versions && c.versions.length) link = str(c.versions[0].link);
      var numStr = String(num);
      if (!link) link = BASE + "/leer/" + id + "-" + numStr + "_01";
      if (seen[link]) continue;
      seen[link] = true;
      chapters.push({
        number: numStr,
        title: "Capítulo " + numStr,
        url: link,
        manga_url: url,     // referer para el lector
        image: img          // miniatura = póster
      });
    }
  }
  d.episodes = sortBy(chapters, function (ch) { return epNum(ch.title); }, false);
  d.isSeries = chapters.length > 0;
  return d;
}

// ManhwaWeb es un lector: no hay reproductores, se devuelve la propia URL del capítulo
function servers(episodeUrl) {
  return [episodeUrl];
}

// Páginas del capítulo (las pide el lector). Endpoint: /chapters/see/{_id}-{n}_{versión}
function images(chapterUrl, referer) {
  var m = /\/leer\/([^?#]+)/.exec(chapterUrl);
  var slug = m ? m[1].replace(/\/+$/, "") : str(chapterUrl);
  var root = getJson(API + "/chapters/see/" + slug, referer || chapterUrl);
  var chapter = (root && root.chapter) || root || {};
  var arr = chapter.img, out = [];
  if (arr && arr.length) {
    for (var i = 0; i < arr.length; i++) {
      var u = str(arr[i]);
      if (u) out.push(u);
    }
  }
  return out;
}
