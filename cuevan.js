var BASE = (CONFIG.base || "").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }
function fixImg(u) { return String(u || "").indexOf("//") === 0 ? "https:" + u : u; }

function get(url) {
  var h = http.get(url, {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function parseCards(html) {
  var out = [], cm, re = /<a\s+href="(\/(?:peliculas|series)\/[^"]+\/)"\s+class="group block relative[\s\S]*?<\/a>/g;
  while ((cm = re.exec(html)) !== null) {
    var href = cm[1], block = cm[0], m;
    var isSeries = href.indexOf("/series/") === 0;
    var item = { url: BASE + href, isSeries: isSeries ? "true" : "false", kind: isSeries ? "serie" : "movie" };
    var alt = "";
    m = /<img\s+src="([^"]+)"[\s\S]*?alt="([^"]*)"/.exec(block);
    if (m) { item.image = fixImg(m[1]); alt = clean(m[2]); }
    m = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(block);
    item.title = m ? clean(m[1]) : alt;
    m = /text-yellow-400[^>]*>\s*<span class="animate-pulse">✭<\/span>\s*([0-9.]+)/.exec(block);
    if (m) item.rating = m[1];
    m = /<span>(Pel[íi]cula|Temporada\s*\d+)<\/span>/.exec(block);
    if (m) item.type = trim(m[1]);
    m = /<span class="text-white\/20">([^<]*)<\/span>/.exec(block);
    if (m) item.year = trim(m[1]);
    out.push(item);
  }
  return out;
}

function genres() {
  var html = get(BASE + "/generos");
  var out = [], m, seen = {};
  var re = /<a\s+href="https?:\/\/[^"\/]+\/generos\/([^"\/]+)"[^>]*class="[^"]*group[^"]*"[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g;
  while ((m = re.exec(html)) !== null) {
    var slug = trim(m[1]);
    if (seen[slug]) continue;
    seen[slug] = true;
    out.push({ slug: slug, name: clean(m[2]), url: BASE + "/generos/" + slug });
  }
  return out;
}

function filters() {
  var gs = genres();
  if (!gs.length) throw new Error("La web no devolvió géneros (¿cambió el HTML?)");

  var genreOpts = [{ value: "", name: "Todos" }];
  for (var i = 0; i < gs.length; i++) genreOpts.push({ value: gs[i].slug, name: gs[i].name });

  return [
    {
      type: "select", key: "categoria", label: "Tipo",
      options: [
        { value: "",         name: "Todos" },
        { value: "pelicula", name: "Películas" },
        { value: "serie",    name: "Series" }
      ]
    },
    { type: "select", key: "genero", label: "Género", options: genreOpts }
  ];
}

function home(page) {
  page = page || 1;
  var url = page === 1 ? BASE + "/peliculas" : BASE + "/peliculas?page=" + page;
  var cards = parseCards(get(url));
  if (!cards.length && page === 1) cards = parseCards(get(BASE + "/"));
  return cards;
}

function list(page, f) {
  page = page || 1;
  var o = (typeof f === "string") ? { genero: f } : (f || {});
  var genero    = String(o.genero    || "").replace(/^\/+|\/+$/g, "");
  var categoria = String(o.categoria || "").toLowerCase();

  var url, filterType = "";

  if (genero) {
    url = page === 1
      ? BASE + "/generos/" + genero
      : BASE + "/generos/" + genero + "?page=" + page;
    if (categoria === "serie" || categoria === "pelicula") filterType = categoria;
  } else if (categoria === "serie") {
    url = page === 1 ? BASE + "/series" : BASE + "/series?page=" + page;
  } else if (categoria === "pelicula") {
    url = page === 1 ? BASE + "/peliculas" : BASE + "/peliculas?page=" + page;
  } else {
    return home(page);
  }

  var cards = parseCards(get(url));

  if (filterType) {
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].isSeries === (filterType === "serie" ? "true" : "false")) out.push(cards[i]);
    }
    return out;
  }
  return cards;
}

function search(query, page) {
  if (page && page > 1) return [];
  return parseCards(get(BASE + "/search?q=" + encodeURIComponent(query)));
}

function detail(url) {
  var html = get(url), d = {}, m;
  var isSeries = url.indexOf("/series/") !== -1;
  d.isSeries = isSeries;

  m = /<h1 class="text-3xl md:text-5xl font-black tracking-tighter leading-\[0\.9\] text-white italic drop-shadow-2xl">\s*([^<]+?)\s*<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  m = /class="text-sm font-semibold text-white\/40 italic">\s*([^<]+?)\s*<\/span>/.exec(html);
  if (m) d.altTitle = clean(m[1]);
  m = /OT<\/span>\s*([^<]+?)\s*<\/span>/.exec(html);
  if (m) d.originalTitle = clean(m[1]);
  m = /<span class="px-3 py-1 bg-white\/10 backdrop-blur-xl border border-white\/20 rounded-lg text-xs font-black uppercase tracking-wider">(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];
  m = /<span class="px-3 py-1 bg-white\/10 backdrop-blur-xl border border-white\/20 rounded-lg text-xs font-black uppercase tracking-wider">(\d+)m<\/span>/.exec(html);
  if (m) d.runtime = m[1] + " min";
  m = /<p class="text-xl leading-\[1\.8\] text-white\/70 font-medium">\s*([\s\S]*?)\s*<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  var genres = [], g, gre = /<a href="https:\/\/[^"\/]+\/generos\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((g = gre.exec(html)) !== null) genres.push(trim(g[1]));
  if (genres.length) d.genres = genres.join(", ");

  m = /<img src="([^"]+)" srcset="[^"]*" sizes="[^"]*" class="w-full aspect-\[2\/3\][^"]*"/.exec(html);
  if (m) d.poster = fixImg(m[1]);
  m = /<img src="([^"]+)" class="w-full h-full object-cover animate-\[zoomOut/.exec(html);
  if (m) d.banner = fixImg(m[1]);
  else if (d.poster) d.banner = d.poster;

  var cast = [], cm, cre = /<a href="(https:\/\/[^"\/]+\/personas\/[^"]+)"[^>]*>\s*<img src="([^"]+)"[\s\S]*?alt="([^"]*)"[\s\S]*?<\/a>\s*<h3[^>]*>([^<]+)<\/h3>\s*<p[^>]*>([^<]*)<\/p>/g;
  while ((cm = cre.exec(html)) !== null) {
    cast.push({ url: cm[1], photo: fixImg(cm[2]), name: clean(cm[4]), character: clean(cm[5]) });
  }
  if (cast.length) d.castList = cast;

  if (isSeries) {
    var seasons = parseSeasons(html);
    var out = [];
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i];
      try { s.episodes = parseEpisodes(get(s.url)); }
      catch (e) { log("temporada " + s.url + ": " + e); s.episodes = []; }
      if (s.episodes.length) out.push(s);
    }
    d.seasons = out;
  } else {
    d.episodes = [{ url: url, number: "1", title: "Película" }];
  }
  return d;
}

function parseSeasons(html) {
  var seasons = [], sm, re = /<a href="([^"]*temporada-\d+\/?)"\s+class="flex bg-white\/\[0\.03\][\s\S]*?<\/a>/g;
  while ((sm = re.exec(html)) !== null) {
    var sUrl = sm[1];
    if (sUrl.indexOf("http") !== 0) sUrl = BASE + sUrl;
    var block = sm[0], m;
    var title = "Temporada";
    m = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(block);
    if (m) title = clean(m[1]);
    var image = "";
    m = /<img src="([^"]+)"[^>]*alt="([^"]*)"/.exec(block);
    if (m) image = fixImg(m[1]);
    var count = 0;
    m = /(\d+)\s*Episodios/.exec(block);
    if (m) count = parseInt(m[1], 10) || 0;
    seasons.push({ title: title, url: sUrl, image: image, episodeCount: count });
  }
  if (!seasons.length) {
    var fm, fre = /<a href="([^"]*temporada[^"]*)"[^>]*>[\s\S]*?Temporada\s*(\d+)/g;
    while ((fm = fre.exec(html)) !== null) {
      var u = fm[1];
      if (u.indexOf("http") !== 0) u = BASE + u;
      seasons.push({ title: "Temporada " + fm[2], url: u });
    }
  }
  return seasons;
}

function parseEpisodes(html) {
  var eps = [], m, re = /<a href="([^"]*\/\d+x\d+\/?)"\s+class="group flex items-center gap-6[\s\S]*?<\/a>/g;
  while ((m = re.exec(html)) !== null) {
    var epUrl = m[1];
    if (epUrl.indexOf("http") !== 0) epUrl = BASE + epUrl;
    var block = m[0], x;
    x = /text-sm font-black opacity-20[^>]*>\s*(\d+)\s*<\/span>/.exec(block);
    var number = x ? String(parseInt(x[1], 10)) : "";
    x = /<h3[^>]*>\s*([^<]+?)\s*<\/h3>/.exec(block);
    var title = x ? clean(x[1]) : "";
    var image = "";
    x = /<img src="([^"]+)"[^>]*alt="([^"]*)"/.exec(block);
    if (x) image = fixImg(x[1]);
    x = /text-\[9px\][^>]*italic">([^<]*)<\/span>/.exec(block);
    var date = x ? trim(x[1]) : "";
    if (!number && !title) continue;
    var ep = { url: epUrl, number: number, title: title || ("Episodio " + number), image: image };
    if (date) ep.date = date;
    eps.push(ep);
  }
  if (!eps.length) {
    var fm, fre = /<a href="([^"]*\/\d+x(\d+)\/?)"[^>]*>[\s\S]*?<h3[^>]*>\s*([^<]+?)\s*<\/h3>/g;
    while ((fm = fre.exec(html)) !== null) {
      var u = fm[1];
      if (u.indexOf("http") !== 0) u = BASE + u;
      eps.push({ url: u, number: fm[2], title: clean(fm[3]) });
    }
  }
  for (var i = 0; i < eps.length; i++) eps[i]._i = i;
  eps.sort(function (a, b) {
    var na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
    if (isNaN(na) || isNaN(nb)) return a._i - b._i;
    return (na - nb) || (a._i - b._i);
  });
  for (var j = 0; j < eps.length; j++) delete eps[j]._i;
  return eps;
}

function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;
  var embedUrls = [];

  var re = /<button type="button"\s*\n?\s*class="video-server-tab[^"]*"\s*\n?\s*data-url="([^"]+)">([\s\S]*?)<\/button>/g;
  while ((m = re.exec(html)) !== null) {
    var u = m[1].replace(/&amp;/g, "&");
    if (u) embedUrls.push(u);
  }

  if (!embedUrls.length) {
    var re2 = /<iframe[^>]+src="([^"]+)"[^>]*>/g;
    while ((m = re2.exec(html)) !== null) {
      if (m[1] && m[1].indexOf("http") === 0) embedUrls.push(m[1]);
    }
  }

  for (var i = 0; i < embedUrls.length; i++) {
    var embedUrl = embedUrls[i];
    var realVideoUrl = embedUrl;
    try {
      var embedHtml = get(embedUrl);
      var iframeMatch = /<iframe[^>]*src="([^"]+)"[^>]*>/i.exec(embedHtml);
      if (iframeMatch && iframeMatch[1] && iframeMatch[1].indexOf("http") === 0) {
        realVideoUrl = iframeMatch[1];
      }
    } catch (e) {
      log("Cuevana: error resolviendo embed " + embedUrl + ": " + e);
    }
    if (realVideoUrl) out.push({ url: realVideoUrl, name: "Servidor " + (i + 1) });
  }
  return out;
}
