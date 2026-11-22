var ADDON = (CONFIG.base || "")
  .replace(/\/manifest\.json\/?$/i, "")
  .replace(/\/+$/, "");
if (!ADDON) throw new Error("CONFIG.base no está definido en el index.json");

var CINEMETA = "https://v3-cinemeta.strem.io";
var MANIFEST = null;
var CAT = null;
var PAGE_SIZE = 30;

var HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0"
};

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s)).replace(/^\s+|\s+$/g, ""); }
function stripManifest(u) {
  return str(u).replace(/\/manifest\.json\/?$/i, "").replace(/\/+$/, "");
}

function getJson(url) {
  var text;
  try { text = http.get(url, HEADERS); }
  catch (e) { log("Stremio GET error " + url + ": " + e); return null; }
  if (!text) { log("Sin respuesta (HTTP " + http.status() + ") " + url); return null; }
  text = String(text).trim();
  if (text.charAt(0) === "<") { log("Stremio HTML en " + url); return null; }
  try { return JSON.parse(text); }
  catch (e) { log("Stremio JSON inválido " + url + ": " + e); return null; }
}

function getManifest() {
  if (MANIFEST) return MANIFEST;
  MANIFEST = getJson(ADDON + "/manifest.json");
  if (!MANIFEST) log("Stremio: no se pudo cargar manifest.json de " + ADDON);
  return MANIFEST;
}

function hasBrowsableCatalogs(m) {
  if (!m || !m.catalogs || !m.catalogs.length) return false;
  for (var i = 0; i < m.catalogs.length; i++) {
    var c = m.catalogs[i];
    if (c && c.id && !catRequiresSearch(c)) return true;
  }
  return false;
}

function getCatalogSource() {
  if (CAT) return CAT;

  var override = stripManifest(CONFIG.catalogBase || "");
  var base = "", man = null;

  if (override) {
    base = override;
    man = (base === ADDON) ? getManifest() : getJson(base + "/manifest.json");
  } else {
    var own = getManifest();
    if (hasBrowsableCatalogs(own)) {
      base = ADDON;
      man = own;
    } else {
      log("Stremio: " + ADDON + " no tiene catálogos, se usa Cinemeta");
      base = CINEMETA;
      man = getJson(base + "/manifest.json");
    }
  }

  CAT = { base: base, manifest: man, pageSize: (base === CINEMETA ? 100 : PAGE_SIZE) };
  return CAT;
}

function findExtra(cat, name) {
  if (!cat || !cat.extra) return null;
  for (var i = 0; i < cat.extra.length; i++) {
    if (cat.extra[i] && cat.extra[i].name === name) return cat.extra[i];
  }
  return null;
}

function catRequiresSearch(cat) {
  var e = findExtra(cat, "search");
  return !!(e && e.isRequired);
}

function catSupportsSearch(cat) {
  return !!findExtra(cat, "search");
}

function catGenres(cat) {
  var e = findExtra(cat, "genre");
  return (e && e.options) ? e.options : [];
}

function defaultType(m) {
  var order = ["series", "anime", "movie", "other"];
  var types = (m && m.types) || [];
  for (var i = 0; i < order.length; i++) {
    for (var j = 0; j < types.length; j++) {
      if (types[j] === order[i]) return order[i];
    }
  }
  return types.length ? types[0] : "movie";
}

function splitUrl(u) {
  u = str(u);
  var i = u.indexOf("|");
  if (i > 0) return { type: u.substring(0, i), id: u.substring(i + 1) };
  var t;
  if (/^tt\d+$/.test(u)) t = "movie";
  else if (/^tt\d+:\d+:\d+$/.test(u)) t = "series";
  else t = defaultType(getCatalogSource().manifest || getManifest());
  return { type: t, id: u };
}

function filters() {
  var src = getCatalogSource();
  var m = src.manifest;
  if (!m || !m.catalogs) return [];

  var cats = [], seen = {}, genres = [];
  for (var i = 0; i < m.catalogs.length; i++) {
    var c = m.catalogs[i];
    if (!c || !c.id) continue;
    if (catRequiresSearch(c)) continue;
    var key = c.type + "/" + c.id;
    if (seen[key]) continue;
    seen[key] = 1;
    cats.push({ value: key, name: (c.name || c.id) + (c.type ? " (" + c.type + ")" : "") });
    if (!genres.length) genres = catGenres(c);
  }
  if (!cats.length) return [];

  var out = [];
  if (cats.length > 1) out.push({ type: "select", key: "cat", label: "Catálogo", options: cats });

  if (genres.length) {
    var gopts = [{ value: "", name: "Todos" }];
    for (var g = 0; g < genres.length; g++) {
      gopts.push({ value: str(genres[g]), name: str(genres[g]) });
    }
    out.push({ type: "select", key: "genero", label: "Género", options: gopts });
  }

  var tipos = [], seenT = {};
  var types = m.types || [];
  for (var j = 0; j < types.length; j++) {
    var t = types[j];
    if (seenT[t]) continue;
    seenT[t] = 1;
    tipos.push({ value: t, name: t });
  }
  if (tipos.length > 1) out.push({ type: "select", key: "tipo", label: "Tipo", options: tipos });

  return out;
}

function card(it) {
  if (!it || !it.id) return null;
  var t = str(it.type || "movie");
  return {
    title: clean(it.name || it.title),
    url: t + "|" + it.id,
    image: str(it.poster || it.background || ""),
    year: str(it.releaseInfo || ""),
    kind: (t === "series" || t === "anime") ? "serie" : "movie"
  };
}

function cards(metas, seen) {
  var out = [];
  seen = seen || {};
  for (var i = 0; i < (metas || []).length; i++) {
    var it = metas[i];
    if (!it || !it.id || seen[it.id]) continue;
    seen[it.id] = 1;
    var c = card(it);
    if (c) out.push(c);
  }
  return out;
}

function pickCatalog(m, o) {
  if (!m || !m.catalogs || !m.catalogs.length) return null;
  var key = o && o.cat;
  if (key) {
    for (var i = 0; i < m.catalogs.length; i++) {
      if ((m.catalogs[i].type + "/" + m.catalogs[i].id) === key) return m.catalogs[i];
    }
  }
  var tipo = o && o.tipo;
  for (var j = 0; j < m.catalogs.length; j++) {
    var c = m.catalogs[j];
    if (catRequiresSearch(c)) continue;
    if (tipo && c.type !== tipo) continue;
    return c;
  }
  return null;
}

function list(page, f) {
  var src = getCatalogSource();
  var m = src.manifest;
  if (!m) return [];
  page = page || 1;
  var o = f || {};
  var cat = pickCatalog(m, o);
  if (!cat) { log("Stremio: sin catálogo navegable en " + src.base); return []; }

  var skip = (page - 1) * src.pageSize;
  var extra = "";
  var genero = str(o.genero);
  if (genero) extra += "genre=" + encodeURIComponent(genero) + "&";
  extra += "skip=" + skip;

  var url = src.base + "/catalog/" + encodeURIComponent(cat.type) + "/" +
            encodeURIComponent(cat.id) + "/" + extra + ".json";
  var j = getJson(url);
  return j ? cards(j.metas, {}) : [];
}

function search(query, page) {
  if (!query) return [];
  var src = getCatalogSource();
  var m = src.manifest;
  if (!m || !m.catalogs) return [];

  page = page || 1;
  var skip = (page - 1) * src.pageSize;
  var seen = {}, out = [], any = false;

  for (var i = 0; i < m.catalogs.length; i++) {
    var cat = m.catalogs[i];
    if (!catSupportsSearch(cat)) continue;
    any = true;
    var url = src.base + "/catalog/" + encodeURIComponent(cat.type) + "/" +
              encodeURIComponent(cat.id) + "/search=" + encodeURIComponent(query) +
              "&skip=" + skip + ".json";
    var j = getJson(url);
    if (!j || !j.metas) continue;
    var partial = cards(j.metas, seen);
    for (var k = 0; k < partial.length; k++) out.push(partial[k]);
  }

  if (!any) log("Stremio: la fuente de catálogo no soporta búsqueda");
  return out;
}

function detail(url) {
  var sp = splitUrl(url);
  var id = sp.id, type = sp.type;
  if (!id) return null;
  var src = getCatalogSource();

  var j = getJson(src.base + "/meta/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + ".json");
  if (!j || !j.meta) {
    log("Stremio: sin meta para " + type + "/" + id);
    return null;
  }
  var meta = j.meta;

  var episodes = [];
  var vids = meta.videos || [];
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    if (!v || !v.id) continue;
    episodes.push({
      title: clean(v.title || v.name) || ("Episodio " + (v.number || v.episode || (i + 1))),
      url: type + "|" + v.id,
      image: str(v.thumbnail || ""),
      season: v.season,
      episode: v.episode || v.number
    });
  }

  var trailer = "";
  if (meta.trailers && meta.trailers.length && meta.trailers[0].source) {
    trailer = "https://www.youtube.com/embed/" + meta.trailers[0].source;
  }

  var poster = str(meta.poster || "");
  var isSeries = episodes.length > 0;

  if (!isSeries) {
    episodes.push({
      title: "Ver película",
      url: type + "|" + id,
      image: poster
    });
  }

  return {
    title: clean(meta.name || meta.title),
    poster: poster,
    banner: str(meta.background || meta.poster || ""),
    synopsis: str(meta.description || ""),
    year: str(meta.releaseInfo || (meta.released ? String(meta.released).substring(0, 4) : "")),
    rating: str(meta.imdbRating || ""),
    genres: (meta.genres || []).join(", "),
    trailer: trailer,
    isSeries: isSeries,
    episodes: episodes
  };
}

function servers(episodeUrl) {
  var sp = splitUrl(episodeUrl);
  var id = sp.id, type = sp.type;
  if (!id) return [];

  var j = getJson(ADDON + "/stream/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + ".json");
  if (!j || !j.streams || !j.streams.length) {
    log("Stremio: sin streams para " + type + "/" + id);
    return [];
  }

  var out = [];
  for (var i = 0; i < j.streams.length; i++) {
    var s = j.streams[i];
    if (!s) continue;

    var su = str(s.url || "");
    var hash = str(s.infoHash || "");
    if (!su && !hash) continue;

    var name = str(s.name || "").replace(/\n+/g, " ").replace(/^\s+|\s+$/g, "");
    var title = str(s.title || s.description || "").replace(/\n+/g, " ").replace(/^\s+|\s+$/g, "");
    var label = name + (title ? " · " + title : "");
    var full = (name + " " + title).toLowerCase();

    var audio = "SUB";
    if (/lat|dub|🇲🇽/.test(full)) audio = "LAT";
    else if (/cast|español|spa/.test(full)) audio = "CAS";

    var ref = "", ua = "";
    if (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) {
      ref = str(s.behaviorHints.proxyHeaders.request.Referer || "");
      ua = str(s.behaviorHints.proxyHeaders.request["User-Agent"] || "");
    }

    if (su) {
      out.push({ url: su, name: label || ("Servidor " + (i + 1)), audio: audio, referer: ref, userAgent: ua });
    } else if (hash) {
      var dn = title || name || ("Torrent " + hash);
      var mag = "magnet:?xt=urn:btih:" + hash + "&dn=" + encodeURIComponent(dn);

      var src = s.sources || [];
      for (var q = 0; q < src.length; q++) {
        var sv = str(src[q]);
        if (sv.indexOf("tracker:") === 0) mag += "&tr=" + encodeURIComponent(sv.substring(8));
      }

      if (s.fileIdx !== undefined && s.fileIdx !== null) mag += "&so=" + encodeURIComponent(String(s.fileIdx));

      out.push({ url: mag, name: label || "Torrent", audio: audio });
    }
  }
  return out;
}
