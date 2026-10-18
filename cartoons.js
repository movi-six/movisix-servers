/*
 * Cartoons — LACartoons (lacartoons.com) · series animadas clásicas, con temporadas
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://www.lacartoons.com").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:/i.test(u)) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

// ───────────── Lista principal ─────────────
function list(page) {
  page = page || 1;
  var html = get(page <= 1 ? BASE + "/" : BASE + "/?page=" + page);
  var out = [], m;

  // <a href="/serie/5"> <img/> <p class="nombre-serie">…</p> … año … valoración
  var re = /<a href="(\/serie\/\d+)">\s*<div class="serie[^"]*">\s*<img src="([^"]+)"\s*\/>\s*<div class="informacion-serie">[\s\S]*?<p class="nombre-serie">([^<]+)<\/p>[\s\S]*?(?:<span class="marcador marcador-(?:cartoon|nickelodeon|hanna|disney|warner|marvel|foxKids|otros)[^"]*">\s*([^<]+?)\s*<\/span>)?[\s\S]*?<span class="marcador marcador-ano">(\d{4})<\/span>[\s\S]*?<span class="valoracion">(\d+)<span/g;
  while ((m = re.exec(html)) !== null) {
    out.push({
      url: BASE + m[1],
      image: abs(m[2]),
      title: clean(m[3]),
      type: m[4] ? clean(m[4]) : "Cartoon Network",
      year: m[5],
      rating: m[6]
    });
  }

  // Respaldo: solo lo esencial si el patrón completo no encaja
  if (!out.length) {
    var fb = /<a href="(\/serie\/\d+)">\s*<div class="serie[^"]*">\s*<img src="([^"]+)"\s*\/>[\s\S]*?<p class="nombre-serie">([^<]+)<\/p>[\s\S]*?<span class="marcador marcador-ano">(\d{4})<\/span>/g;
    while ((m = fb.exec(html)) !== null)
      out.push({ url: BASE + m[1], image: abs(m[2]), title: clean(m[3]), year: m[4] });
  }
  return out;
}

// ───────────── Búsqueda (LACartoons no pagina) ─────────────
function search(query, page) {
  if (page && page > 1) return [];
  var html = get(BASE + "/?Titulo=" + encodeURIComponent(query));
  var out = [], m;
  var re = /<a href="(\/serie\/\d+)">\s*<div class="serie[^"]*">\s*<img src="([^"]+)"\s*\/>[\s\S]*?<p class="nombre-serie">([^<]+)<\/p>[\s\S]*?<span class="marcador marcador-ano">(\d{4})<\/span>/g;
  while ((m = re.exec(html)) !== null)
    out.push({ url: BASE + m[1], image: abs(m[2]), title: clean(m[3]), year: m[4] });
  return out;
}

// ───────────── Detalle: temporadas y episodios ─────────────
function detail(url) {
  var html = get(url), m;
  var d = {};

  m = /<h2 class="text-center subtitulo-serie-seccion[^"]*">([^<]+)/.exec(html);
  if (m) d.title = clean(m[1]);
  m = /<div class="imagen-serie">\s*<img src="([^"]+)"/.exec(html);
  if (m) d.poster = abs(m[1]);
  m = /<img class="fondo-serie-seccion" src="([^"]+)"/.exec(html);
  if (m) d.banner = abs(m[1]);
  m = /<p>Año:<span[^>]*>(\d{4})<\/span><\/p>/.exec(html);
  if (m) d.year = m[1];
  m = /<p>Reseña:<br><span>([^<]+)<\/span><\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  var poster = d.poster || "";
  function parseEps(block) {
    var eps = [], em;
    var epRe = /<a class="[^"]*" href="(\/serie\/capitulo\/\d+\?t=\d+)">\s*<span>([^<]+)<\/span>\s*([^<]*)<\/a>/g;
    while ((em = epRe.exec(block)) !== null)
      eps.push({ title: clean(em[2]) + " " + clean(em[3]), url: BASE + em[1], image: poster });
    return eps;
  }

  var seasons = [], sm;
  var seasonRe = /<h4 class="accordion[^"]*" data-temporada-id="(\d+)">[\s\S]*?<\/h4>\s*<div class="episodio-panel">\s*<ul class="listas-de-episodion">([\s\S]*?)<\/ul>/g;
  while ((sm = seasonRe.exec(html)) !== null) {
    var eps = parseEps(sm[2]);
    if (eps.length) seasons.push({ id: sm[1], title: "Temporada " + sm[1], episodes: eps });
  }

  if (seasons.length) {
    d.seasons = seasons;
    d.isSeries = true;
  } else {
    d.isSeries = false;
    d.episodes = parseEps(html);
  }

  // Sin episodios: un solo "Ver" con la propia URL
  if (!seasons.length && !d.episodes.length)
    d.episodes.push({ title: d.title || "Ver", url: url, image: poster });
  return d;
}

// ───────────── Reproductores (iframes) ─────────────
function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;
  var re = /<iframe\s+src="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    var src = m[1];
    if (!src) continue;
    if (src.indexOf("//") === 0) src = "https:" + src;
    // ok.ru: autoplay
    if (src.toLowerCase().indexOf("ok.ru/videoembed/") !== -1) {
      if (src.indexOf("?") === -1) src += "?autoplay=1";
      else if (src.indexOf("autoplay=") === -1) src += "&autoplay=1";
    }
    out.push(src);
  }
  return out;
}
