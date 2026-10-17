/*
 * Gamma — LatAnime (latanime.org)
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Disponibles: http.get(url, headers) · http.post(url, body, headers) · http.status()
 *              util.b64decode(s) · util.htmlDecode(s) · log(msg) · CONFIG (la entrada de este server en index.json)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
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

// ───────────── Lista principal ─────────────
function list(page) {
  var url = (page <= 1) ? BASE + "/animes" : BASE + "/animes?p=" + page;
  var html = get(url);
  var out = [], m;

  var re1 = new RegExp(
    "<a href=\"(" + HOST + "\\/anime\\/[^\"]+)\">[\\s\\S]*?" +
    "<img[^>]+src=\"([^\"]+)\"[^>]+alt=\"([^\"]+)\"[\\s\\S]*?" +
    "<span style=\"color: #ffc119;\">[\\s\\S]*?(\\d{4})<\\/span>", "g");
  while ((m = re1.exec(html)) !== null) {
    out.push({ url: abs(m[1]), image: m[2], title: clean(m[3].replace(" Latino", "")), year: m[4] });
  }
  if (out.length) return out;

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
