/*
 * Cuevan — Cuevana 3 (cuevan.net) · Películas y Series
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 *
 * Portado de ServerCuevan.java. Sin WebView: todo es HTTP + regex.
 * Mezcla películas y series, así que cada ítem de la lista lleva isSeries (index.json: "kind": "auto").
 *
 * Estructura del sitio:
 *   Lista películas  /peliculas  ó  /peliculas?page=N        Búsqueda  /search?q=…
 *   Detalle          /peliculas/{slug}/  ·  /series/{slug}/
 *   Temporada        /{slug}/temporada-{n}/    (⚠ NO cuelga de /series/)
 *   Episodio         /{slug}/{temporada}x{episodio}/
 */

var BASE = (CONFIG.base || "https://cuevan.net").replace(/\/+$/, "");

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
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// ───────────── Tarjetas (lista y búsqueda comparten markup) ─────────────
function parseCards(html) {
  var out = [], m;
  var re = /<a\s+href="(\/(?:peliculas|series)\/[^"]+\/)"\s+class="group block relative[\s\S]*?<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var href = m[1], block = m[0], t;
    var item = { url: BASE + href, isSeries: href.indexOf("/series/") === 0 };

    var alt = "";
    t = /<img\s+src="([^"]+)"[\s\S]*?alt="([^"]*)"/.exec(block);
    if (t) { item.image = abs(t[1]); alt = clean(t[2]); }

    t = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(block);
    item.title = t ? clean(t[1]) : alt;

    t = /text-yellow-400[^>]*>\s*<span class="animate-pulse">✭<\/span>\s*([0-9.]+)/.exec(block);
    if (t) item.rating = t[1];
    t = /<span>(Pel[íi]cula|Temporada\s*\d+)<\/span>/.exec(block);
    if (t) item.type = clean(t[1]);
    t = /<span class="text-white\/20">([^<]*)<\/span>/.exec(block);
    if (t) item.year = clean(t[1]);

    out.push(item);
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseCards(get(page <= 1 ? BASE + "/peliculas" : BASE + "/peliculas?page=" + page));
}

// El sitio muestra todos los resultados de golpe (sin páginas)
function search(query, page) {
  if (page && page > 1) return [];
  return parseCards(get(BASE + "/search?q=" + encodeURIComponent(query)));
}

// ───────────── Episodios de una temporada ─────────────
function parseEpisodes(html) {
  var eps = [], m;
  var re = /<a href="([^"]*\/\d+x\d+\/?)"\s+class="group flex items-center gap-6[\s\S]*?<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var block = m[0], t;
    var num = "", title = "", image = "";
    t = /text-sm font-black opacity-20[^>]*>\s*(\d+)\s*<\/span>/.exec(block);
    if (t) num = String(parseInt(t[1], 10));
    t = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(block);
    if (t) title = clean(t[1]);
    t = /<img src="([^"]+)"[^>]*alt="([^"]*)"/.exec(block);
    if (t) image = abs(t[1]);
    if (!num && !title) continue;
    eps.push({ url: abs(m[1]), number: num, title: title || ("Episodio " + num), image: image });
  }

  // Respaldo por si el markup cambia
  if (!eps.length) {
    var fb = /<a href="([^"]*\/\d+x(\d+)\/?)"[^>]*>[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g;
    while ((m = fb.exec(html)) !== null)
      eps.push({ url: abs(m[1]), number: m[2], title: clean(m[3]), image: "" });
  }

  eps.sort(function (a, b) { return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0); });
  return eps;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = get(url), m;
  var d = {};
  var isSeries = url.indexOf("/series/") !== -1;
  d.isSeries = isSeries;

  m = /<h1 class="text-3xl md:text-5xl font-black tracking-tighter leading-\[0\.9\] text-white italic drop-shadow-2xl">\s*([^<]+?)\s*<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  m = /<span class="px-3 py-1 bg-white\/10 backdrop-blur-xl border border-white\/20 rounded-lg text-xs font-black uppercase tracking-wider">(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];
  m = /<span class="px-3 py-1 bg-white\/10 backdrop-blur-xl border border-white\/20 rounded-lg text-xs font-black uppercase tracking-wider">(\d+)m<\/span>/.exec(html);
  if (m) d.runtime = m[1] + " min";
  m = /<p class="text-xl leading-\[1\.8\] text-white\/70 font-medium">\s*([\s\S]*?)\s*<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  var g = [], gm, gre = /<a href="https?:\/\/[^"\/]+\/generos\/[^"]+" class="hover:text-\[var\(--color-primary\)\][^"]*">([^<]+)<\/a>/g;
  while ((gm = gre.exec(html)) !== null) g.push(clean(gm[1]));
  if (g.length) d.genres = g.join(", ");

  m = /<img src="([^"]+)" srcset="[^"]*" sizes="[^"]*" class="w-full aspect-\[2\/3\][^"]*"/.exec(html);
  if (m) d.poster = abs(m[1]);
  m = /<img src="([^"]+)" class="w-full h-full object-cover animate-\[zoomOut/.exec(html);
  if (m) d.banner = abs(m[1]);
  else if (d.poster) d.banner = d.poster;

  if (!isSeries) {
    // Película: un solo "episodio" con la propia URL (los servidores están en esta misma página)
    d.episodes = [{ title: "Película", url: url, image: d.poster || "" }];
    return d;
  }

  // Serie: tarjetas de temporada → se piden aquí las páginas de cada temporada
  var cards = [], sm;
  var sre = /<a href="([^"]*temporada-\d+\/?)"\s+class="flex bg-white\/\[0\.03\][\s\S]*?<\/a>/g;
  while ((sm = sre.exec(html)) !== null) {
    var t2 = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(sm[0]);
    cards.push({ url: abs(sm[1]), title: t2 ? clean(t2[1]) : "Temporada" });
  }
  if (!cards.length) {   // respaldo: cualquier enlace a una temporada
    var fre = /<a href="([^"]*temporada[^"]*)"[^>]*>[\s\S]*?Temporada\s*(\d+)/g;
    while ((sm = fre.exec(html)) !== null) cards.push({ url: abs(sm[1]), title: "Temporada " + sm[2] });
  }

  var seasons = [];
  for (var i = 0; i < cards.length; i++) {
    try {
      var eps = parseEpisodes(get(cards[i].url));
      for (var j = 0; j < eps.length; j++) if (!eps[j].image) eps[j].image = d.poster || "";
      if (eps.length) seasons.push({ title: cards[i].title, episodes: eps });
    } catch (e) {
      log("temporada " + cards[i].url + ": " + e);   // una temporada caída no tumba las demás
    }
  }
  d.seasons = seasons;
  return d;
}

// ───────────── Reproductores ─────────────
// Botones <button class="video-server-tab" data-url="…">. (El botón copyShareLink también tiene data-url
// pero apunta a la propia página: se descarta.)
function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], seen = {}, m;
  function add(u) {
    u = String(u || "").replace(/&amp;/g, "&");
    if (u && !seen[u]) { seen[u] = true; out.push(u); }
  }

  var re = /<button type="button"\s*\n?\s*class="video-server-tab[^"]*"\s*\n?\s*data-url="([^"]+)">/g;
  while ((m = re.exec(html)) !== null) add(m[1]);

  if (!out.length) {
    var self = episodeUrl.replace(/\/$/, "");
    var re2 = /<button[^>]*id="copyShareLink"[^>]*data-url="([^"]+)"|data-url="([^"]+)"/g;
    while ((m = re2.exec(html)) !== null) {
      if (m[1] || !m[2]) continue;
      var c = m[2].replace(/&amp;/g, "&");
      if (c.replace(/\/$/, "") === self) continue;
      add(c);
    }
  }

  if (!out.length) {
    var re3 = /<iframe[^>]+src="([^"]+)"[^>]*>/g;
    while ((m = re3.exec(html)) !== null) add(m[1]);
  }
  return out;
}
