/*
 * Gamma — LatAnime (latanime.org)
 * Funciones que la app llama:  list(page, filtros) · filters() · search(query, page) · detail(url) · servers(episodeUrl)
 * Disponibles: http.get(url, headers) · http.post(url, body, headers) · http.status()
 *              util.b64decode(s) · util.htmlDecode(s) · log(msg) · CONFIG (la entrada de este server en index.json)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 *
 * FILTROS (nuevo): filters() define Tipo / Año / Género / Letra y la app dibuja el sheet.
 * list(page, f) recibe solo lo que el usuario tocó: { categoria:"pelicula", fecha:"2024", genero:"accion", letra:"A" }.
 * La web los entiende así: /animes?categoria=pelicula&genero=accion&fecha=2024&letra=A&p=2 (false = sin filtro).
 */

var BASE = (CONFIG.base || "https://latanime.org").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

// GET que falla con un mensaje claro si el sitio no responde (así el admin ve el motivo)
function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

// Convierte rutas relativas en absolutas con el dominio actual (CONFIG.base)
function abs(u) {
  u = String(u || "");
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? u : "/" + u);
}

var HOST = "(?:https?:\\/\\/[^\"\\/]+)?";   // dominio opcional delante de una ruta

function epNum(title) {
  var m, last = -1, re = /(\d+)/g;
  while ((m = re.exec(String(title || ""))) !== null) last = parseInt(m[1], 10);
  return last;
}

// ───────────── Filtros ─────────────
// Respaldo por si no se puede leer la lista de géneros de la web.
var GENRES_FALLBACK = [
  ["accion", "Acción"], ["aventura", "Aventura"], ["comedia", "Comedia"], ["drama", "Drama"],
  ["ecchi", "Ecchi"], ["fantasia", "Fantasía"], ["ciencia-ficcion", "Ciencia ficción"],
  ["romance", "Romance"], ["shounen", "Shounen"], ["seinen", "Seinen"], ["slice-of-life", "Slice of life"],
  ["sobrenatural", "Sobrenatural"], ["misterio", "Misterio"], ["terror", "Terror"], ["mecha", "Mecha"],
  ["deportes", "Deportes"], ["escolares", "Escolares"], ["magia", "Magia"], ["harem", "Harem"], ["isekai", "Isekai"]
];

// Lee los géneros de la propia web (<option value="slug"> o enlaces /genero/slug); si falla, usa el respaldo.
function readGenres() {
  var out = [{ value: "", name: "Todos" }], seen = {}, m;
  try {
    var html = get(BASE + "/animes");
    var sel = /<select[^>]*(?:name|id)="genero"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
    var re = /<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
    var scope = sel ? sel[1] : "";
    while ((m = re.exec(scope)) !== null) {
      if (m[1] === "false" || seen[m[1]]) continue;
      seen[m[1]] = true;
      out.push({ value: m[1], name: clean(m[2]) });
    }
    if (out.length < 2) {
      var re2 = /href="[^"]*\/genero\/([^"\/?]+)"[^>]*>(?:<div class="btn">)?([^<]+)</g;
      while ((m = re2.exec(html)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = true;
        out.push({ value: m[1], name: clean(m[2]) });
      }
    }
  } catch (e) { log("filters(): " + e); }
  if (out.length < 2) {
    for (var i = 0; i < GENRES_FALLBACK.length; i++) out.push({ value: GENRES_FALLBACK[i][0], name: GENRES_FALLBACK[i][1] });
  }
  return out;
}

function filters() {
  var years = [{ value: "", name: "Todos" }];
  for (var y = new Date().getFullYear(); y >= 1990; y--) years.push({ value: String(y), name: String(y) });

  var letters = [{ value: "", name: "Todas" }];
  for (var c = 65; c <= 90; c++) letters.push({ value: String.fromCharCode(c), name: String.fromCharCode(c) });

  return [
    { type: "note",   label: "La búsqueda por texto ignora el filtro" },
    { type: "select", key: "categoria", label: "Tipo", options: [
        { value: "",           name: "Animes" },
        { value: "pelicula",   name: "Películas" },
        { value: "ova",        name: "OVAs" } ] },
    { type: "select", key: "fecha",  label: "Año",     options: years },
    { type: "select", key: "genero", label: "Géneros", options: readGenres() },
    { type: "select", key: "letra",  label: "Letra",   options: letters }
  ];
}

// ───────────── Lista principal ─────────────
// f = objeto de filtros (ver arriba) · o, por compatibilidad, un slug de género suelto.
function list(page, f) {
  page = page || 1;
  var o = (typeof f === "string") ? { genero: f } : (f || {});
  var filtered = !!(o.categoria || o.fecha || o.genero || o.letra);

  var url;
  if (filtered) {
    url = BASE + "/animes?categoria=" + encodeURIComponent(o.categoria || "false") +
          "&genero="  + encodeURIComponent(o.genero || "false") +
          "&fecha="   + encodeURIComponent(o.fecha  || "false") +
          "&letra="   + encodeURIComponent(o.letra  || "false") +
          (page > 1 ? "&p=" + page : "");
  } else {
    url = (page <= 1) ? BASE + "/animes" : BASE + "/animes?p=" + page;
  }
  var html = get(url);
  var out = [], m;

  if (!filtered) {
    var re1 = new RegExp(
      "<a href=\"(" + HOST + "\\/anime\\/[^\"]+)\">[\\s\\S]*?" +
      "<img[^>]+src=\"([^\"]+)\"[^>]+alt=\"([^\"]+)\"[\\s\\S]*?" +
      "<span style=\"color: #ffc119;\">[\\s\\S]*?(\\d{4})<\\/span>", "g");
    while ((m = re1.exec(html)) !== null) {
      out.push({ url: abs(m[1]), image: m[2], title: clean(m[3].replace(" Latino", "")), year: m[4] });
    }
    if (out.length) return out;
  }

  return parseCards(html);
}

// Tarjetas de lista/búsqueda
function parseCards(html) {
  var out = [], m;
  var re = new RegExp(
    "<div class=\"col-md-4 col-lg-3 col-xl-2 col-6 my-3\">\\s*" +
    "<a href=\"(" + HOST + "\\/anime\\/[^\"]+)\">\\s*" +
    "<div class=\"series\">\\s*" +
    "<div class=\"serieimg shadown\">\\s*" +
    "<img src=\"([^\"]+)\"[^>]+alt=\"[^\"]*\">[\\s\\S]*?" +
    "<h3[^>]*>([^<]+)<\\/h3>[\\s\\S]*?" +
    "<span style=\"color: [^\"]+\">[\\s\\S]*?(\\d{4})<\\/span>", "g");
  while ((m = re.exec(html)) !== null) {
    out.push({ url: abs(m[1]), image: m[2], title: clean(m[3]), year: m[4] });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&p=" + page : "");
  return parseCards(get(url));
}

// ───────────── Detalle + episodios ─────────────
function detail(animeUrl) {
  var html = get(animeUrl);
  var d = {}, m;

  m = /<h2>([^<]+)<\/h2>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<h3 class="fs-6 text-light opacity-75">([^<]+)<\/h3>/.exec(html);
  if (m) d.altTitle = clean(m[1]);

  var g = [], gre = /<a href="[^"]*\/genero\/[^"]+"><div class="btn">([^<]+)<\/div><\/a>/g;
  while ((m = gre.exec(html)) !== null) g.push(m[1]);
  if (g.length) d.genres = g.join(", ");

  m = /<p class="my-2 opacity-75">([^<]+)<\/p>/.exec(html);
  if (m) d.synopsis = m[1];

  var eps = [];
  var ere = new RegExp(
    "<a href=\"(" + HOST + "\\/ver\\/[^\"]+)\">\\s*" +
    "<div class=\"p-2 cap-layout[^>]*>\\s*" +
    "<img[^>]+src=\"([^\"]+)\"[^>]*>\\s*" +
    "([^<]+)<\\/div>", "g");
  while ((m = ere.exec(html)) !== null) {
    eps.push({ url: abs(m[1]), image: m[2], title: clean(m[3]) });
  }
  // Orden ascendente por número de episodio
  if (eps.length > 1) {
    var first = epNum(eps[0].title), last = epNum(eps[eps.length - 1].title);
    if (first > last && first !== -1) eps.reverse();
  }
  d.episodes = eps;
  return d;
}

// ───────────── Servidores de video ─────────────
function sanitize(u) {
  if (!u) return null;
  u = String(u).replace(/^\s+|\s+$/g, "");
  if (!u) return null;
  u = u.replace(/bysekoze\.com/ig, "filemoon.sx");
  if (/ok\.ru\/videoembed\//i.test(u)) {
    if (u.indexOf("?") < 0) u += "?autoplay=1";
    else if (u.indexOf("autoplay=") < 0) u += "&autoplay=1";
  }
  if (/sendvid\.com/i.test(u)) {
    var seg = u.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (seg) u = "https://sendvid.com/embed/" + seg;
  }
  if (/mxdrop|listeamed|mojon|fembed|videobin|embedv/i.test(u)) return null;
  return u;
}

function servers(episodeUrl) {
  var html = get(episodeUrl);
  var out = [], m, re = /data-player="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    try {
      var s = sanitize(util.b64decode(m[1]));
      if (s) out.push(s);
    } catch (e) { log("b64 falló: " + e); }
  }
  return out;
}
