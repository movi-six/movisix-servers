 ADDON = "";
try {
  if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.base) {
    ADDON = String(CONFIG.base).replace(/\/+$/, "");
  }
} catch (e) { ADDON = ""; }

if (!ADDON) {
  log("Stremio: CONFIG.base no está configurado. Ejemplo: CONFIG.base = \"https://ptube.ers.pw\"");
}

var MANIFEST = null;

var HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0"
};

/* ------------------------------- utilidades ------------------------------ */

function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function clean(s) {
  s = str(s);
  try {
    if (typeof util !== "undefined" && util && typeof util.htmlDecode === "function") {
      s = util.htmlDecode(s);
    }
  } catch (e) {}
  return s.replace(/^\s+|\s+$/g, "");
}

function httpStatus() {
  try { return http.status(); } catch (e) { return "?"; }
}

function getJson(url) {
  var text;
  try { text = http.get(url, HEADERS); }
  catch (e) { log("Stremio GET error " + url + ": " + e); return null; }
  if (!text) { log("Sin respuesta (HTTP " + httpStatus() + ") " + url); return null; }
  text = String(text).trim();
  if (text.charAt(0) === "<") {
    log("Respuesta HTML (no JSON) de " + url + ": " + text.substring(0, 120));
    return null;
  }
  try { return JSON.parse(text); }
  catch (e) { log("JSON inválido de " + url + ": " + text.substring(0, 120)); return null; }
}

function getManifest() {
  if (MANIFEST) return MANIFEST;
  if (!ADDON) return null;
  MANIFEST = getJson(ADDON + "/manifest.json");
  if (!MANIFEST) log("Stremio: no se pudo cargar manifest.json de " + ADDON);
  return MANIFEST;
}

/* --------------------------- helpers de catálogos ------------------------ */

function catRequiresSearch(cat) {
  if (!cat || !cat.extra) return false;
  for (var i = 0; i < cat.extra.length; i++) {
    if (cat.extra[i].name === "search" && cat.extra[i].isRequired) return true;
  }
  return false;
}

function catSupportsSearch(cat) {
  if (!cat || !cat.extra) return false;
  for (var i = 0; i < cat.extra.length; i++) {
    if (cat.extra[i].name === "search") return true;
  }
  return false;
}

function catGenreOptions(cat) {
  if (!cat || !cat.extra) return [];
  for (var i = 0; i < cat.extra.length; i++) {
    if (cat.extra[i].name === "genre" && cat.extra[i].options && cat.extra[i].options.length) {
      return cat.extra[i].options;
    }
  }
  return [];
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

/* Los idPrefixes del addon apuntan aquí todos al mismo type, así que basta
   con el type preferente del manifest. */
function typeForId(m, id) {
  return defaultType(m);
}

/* -------------------------------- filtros -------------------------------- */

function filters() {
  var m = getManifest();
  if (!m || !m.catalogs) return [];

  var cats = [], seen = {};
  for (var i = 0; i < m.catalogs.length; i++) {
    var c = m.catalogs[i];
    if (!c || !c.id) continue;
    if (catRequiresSearch(c)) continue;
    var key = c.type + "/" + c.id;
    if (seen[key]) continue;
    seen[key] = 1;
    cats.push({ value: key, name: c.name || c.id });
  }
  if (!cats.length) return [];

  var out = [{ type: "select", key: "cat", label: "Catálogo", options: cats }];

  /* Géneros: del primer catálogo navegable que los declare */
  var generos = [], seenG = {};
  for (var j = 0; j < m.catalogs.length && !generos.length; j++) {
    var opts = catGenreOptions(m.catalogs[j]);
    for (var k = 0; k < opts.length; k++) {
      var g = opts[k];
      if (seenG[g]) continue;
      seenG[g] = 1;
      generos.push({ value: g, name: g });
    }
  }
  if (generos.length) out.push({ type: "select", key: "genre", label: "Género", options: generos });

  /* Tipo: solo si el manifest declara más de uno */
  var tipos = [], seenT = {};
  var types = m.types || [];
  for (var n = 0; n < types.length; n++) {
    var t = types[n];
    if (seenT[t]) continue;
    seenT[t] = 1;
    tipos.push({ value: t, name: t });
  }
  if (tipos.length > 1) out.push({ type: "select", key: "tipo", label: "Tipo", options: tipos });

  return out;
}

/* --------------------------------- cards --------------------------------- */

function card(it) {
  if (!it || !it.id) return null;
  var t = str(it.type || "");
  return {
    title: clean(it.name || it.title),
    url: it.id,
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

/* ------------------------------- selección ------------------------------- */

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

/* ---------------------------------- list --------------------------------- */

function list(page, f) {
  var m = getManifest();
  if (!m) return [];
  page = page || 1;
  var o = f || {};
  var cat = pickCatalog(m, o);
  if (!cat) { log("Stremio: sin catálogo navegable en " + ADDON); return []; }

  var skip = (page - 1) * 30;
  var extras = "skip=" + skip;

  if (o.genre) {
    if (catGenreOptions(cat).length) {
      extras = "genre=" + encodeURIComponent(o.genre) + "&" + extras;
    } else {
      log("Stremio: el catálogo " + cat.id + " no soporta el género " + o.genre);
    }
  }

  var url = ADDON + "/catalog/" + encodeURIComponent(cat.type) + "/" +
            encodeURIComponent(cat.id) + "/" + extras + ".json";
  var j = getJson(url);
  return j ? cards(j.metas, {}) : [];
}

/* --------------------------------- search -------------------------------- */

function search(query, page) {
  if (!query) return [];
  var m = getManifest();
  if (!m || !m.catalogs) return [];

  page = page || 1;
  var skip = (page - 1) * 30;
  var seen = {}, out = [], any = false;

  for (var i = 0; i < m.catalogs.length; i++) {
    var cat = m.catalogs[i];
    if (!catSupportsSearch(cat)) continue;
    any = true;
    var url = ADDON + "/catalog/" + encodeURIComponent(cat.type) + "/" +
              encodeURIComponent(cat.id) + "/search=" + encodeURIComponent(query) +
              "&skip=" + skip + ".json";
    var j = getJson(url);
    if (!j || !j.metas) continue;
    var partial = cards(j.metas, seen);
    for (var k = 0; k < partial.length; k++) out.push(partial[k]);
  }

  if (!any) log("Stremio: el addon no soporta búsqueda");
  return out;
}

/* --------------------------------- detail -------------------------------- */

function detail(url) {
  var id = str(url);
  if (!id) return null;
  var m = getManifest();
  if (!m) return null;

  var type = typeForId(m, id);
  var j = getJson(ADDON + "/meta/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + ".json");
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
      title: clean(v.title || v.name) || ("Episodio " + (v.number || (i + 1))),
      url: v.id,
      image: str(v.thumbnail || ""),
      season: v.season,
      episode: v.episode || v.number
    });
  }

  var trailer = "";
  if (meta.trailers && meta.trailers.length && meta.trailers[0].source) {
    trailer = "https://www.youtube.com/embed/" + meta.trailers[0].source;
  } else if (meta.trailer) {
    trailer = str(meta.trailer);
  }

  return {
    title: clean(meta.name || meta.title),
    poster: str(meta.poster || ""),
    banner: str(meta.background || meta.poster || ""),
    synopsis: str(meta.description || ""),
    year: str(meta.releaseInfo || (meta.released ? String(meta.released).substring(0, 4) : "")),
    rating: str(meta.imdbRating || ""),
    genres: (meta.genres || []).join(", "),
    trailer: trailer,
    isSeries: episodes.length > 0,
    episodes: episodes
  };
}

/* --------------------------------- servers ------------------------------- */

function servers(episodeUrl) {
  var id = str(episodeUrl);
  if (!id) return [];
  var m = getManifest();
  if (!m) return [];

  var type = typeForId(m, id);
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
    var title = str(s.title || "").replace(/\n+/g, " ").replace(/^\s+|\s+$/g, "");
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
      out.push({ url: mag, name: label || "Torrent", audio: audio });
    }
  }
  return out;
}
