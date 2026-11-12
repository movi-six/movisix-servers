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
// Los filtros salen de los <select> reales de /animes (categoria, fecha, genero, letra): si la web agrega un género
// o una categoría, aparece solo. Sin listas de respaldo: si la web no responde, la app muestra el error con «Reintentar».
// El valor "false" de la web significa «sin filtro» → la app lo muestra como «Todos» y no lo envía.

function readSelect(html, name, label) {
  var sel = new RegExp("<select[^>]*name=\"" + name + "\"[^>]*>([\\s\\S]*?)<\\/select>", "i").exec(html);
  if (!sel) throw new Error("La web no trae el filtro «" + name + "» en /animes (¿cambió el HTML?)");
  var opts = [{ value: "", name: "Todos" }], seen = {}, m;
  var re = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  while ((m = re.exec(sel[1])) !== null) {
    var v = clean(m[1]);
    if (!v || v === "false" || seen[v]) continue;
    seen[v] = true;
    opts.push({ value: v, name: clean(m[2]) || v });
  }
  if (opts.length < 2) throw new Error("El filtro «" + name + "» llegó sin opciones");
  return { type: "select", key: name, label: label, options: opts };
}

function filters() {
  var html = get(BASE + "/animes");
  return [
    { type: "note", label: "La búsqueda por texto ignora el filtro" },
    readSelect(html, "categoria", "Tipo"),
    readSelect(html, "fecha",     "Año"),
    readSelect(html, "genero",    "Géneros"),
    readSelect(html, "letra",     "Letra")
  ];
}

// ───────────── Lista principal ─────────────
// f = { categoria, fecha, genero, letra } con lo que el usuario eligió (lo demás no llega).
// Misma URL que usa la web: /animes?fecha=…&genero=…&letra=…&categoria=…&p=N  ("false" = sin filtro).
function list(page, f) {
  page = page || 1;
  var o = (typeof f === "string") ? { genero: f } : (f || {});
  var filtered = !!(o.categoria || o.fecha || o.genero || o.letra);

  var url;
  if (filtered) {
    url = BASE + "/animes?fecha=" + encodeURIComponent(o.fecha || "false") +
          "&genero="    + encodeURIComponent(o.genero    || "false") +
          "&letra="     + encodeURIComponent(o.letra     || "false") +
          "&categoria=" + encodeURIComponent(o.categoria || "false") +
          (page > 1 ? "&p=" + page : "");
  } else {
    url = (page <= 1) ? BASE + "/animes" : BASE + "/animes?p=" + page;
  }
  return parseCards(get(url));
}

// Tarjetas de lista / filtro / búsqueda. La imagen real va en data-src (src es un placeholder por carga diferida).
function parseCards(html) {
  var out = [], parts = html.split("col-md-4 col-lg-3 col-xl-2 col-6 my-3\"");
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i].replace(/<!--[\s\S]*?-->/g, "");
    var a = new RegExp("<a href=\"(" + HOST + "\\/anime\\/[^\"]+)\"").exec(c);
    if (!a) continue;
    var img = /<img[^>]+data-src="([^"]+)"/.exec(c) || /<img[^>]+src="([^"]+)"/.exec(c);
    var t = /<h3[^>]*>([^<]+)<\/h3>/.exec(c);
    var y = /(\d{4})\s*<\/span>/.exec(c);
    out.push({
      url: abs(a[1]),
      image: img ? abs(img[1]) : "",
      title: t ? clean(t[1].replace(/\s+Latino\s*$/i, "")) : "",
      year: y ? y[1] : ""
    });
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
