/*
 * Cuevana — Cuevana3 (cuevana3.sc) · películas y series por API JSON (wp-json/cuevana/v1)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://cuevana3.sc").replace(/\/+$/, "");
var API = BASE + "/wp-json/cuevana/v1";
var IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

// JSON de la API; null si no responde o devuelve una página HTML (p. ej. un bloqueo)
function getJson(url) {
  var h = http.get(url, {
    "Accept": "application/json, text/plain, */*",
    "Referer": BASE + "/",
    "Origin": BASE,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
  });
  if (!h || /^\s*</.test(h)) return null;
  try { return JSON.parse(h); } catch (e) { return null; }
}

function getHtml(url) {
  return http.get(url, {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/",
    "Origin": BASE
  }) || "";
}

function resolveImage(path) {
  path = str(path);
  if (!path) return "";
  if (path.indexOf("http") === 0) return path;
  if (path.charAt(0) === "/") return IMAGE_BASE + path;
  return IMAGE_BASE + "/" + path;
}

function absLink(link) { return link.charAt(0) === "/" ? BASE + link : link; }
function kindOf(url) { return url.indexOf("/series-online/") !== -1 ? "serie" : "movie"; }

// ───────────── Lista (películas) ─────────────
function list(page) {
  var root = getJson(API + "/chome?paged=" + (page || 1) + "&limit=20&lang=any&type=movies");
  var data = root && root.data;
  var out = [];
  if (!data || !data.length) return out;
  for (var i = 0; i < data.length; i++) {
    var it = data[i];
    var id = str(it.id), slug = str(it.slug);
    var type = str(it.type) || "movies";
    var url;
    if (id && slug) url = BASE + (type === "series" ? "/series-online/" : "/peliculas-online/") + id + "/" + slug + "/";
    else url = absLink(str(it.link));
    var year = str(it.year);
    if (!year) { var rel = str(it.release); if (rel.length >= 4) year = rel.substring(0, 4); }
    var item = {
      id: id,
      title: clean(it.title !== undefined ? it.title : "Sin título"),
      url: url,
      image: resolveImage(str(it.image) || str(it.poster)),
      year: year,
      type: type,
      kind: kindOf(url)
    };
    if (str(it.synopsis)) item.synopsis = clean(it.synopsis);
    out.push(item);
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if (page && page > 1) return [];
  var root = getJson(API + "/search?q=" + encodeURIComponent(query));
  var data = root && root.data;
  var out = [];
  if (!data || !data.length) return out;
  for (var i = 0; i < data.length; i++) out.push(fromSearchItem(data[i]));
  return out;
}

function fromSearchItem(it) {
  var link = str(it.link);
  var url = link ? absLink(link) : "";
  var m = { title: clean(it.title !== undefined ? it.title : "Sin título"), url: url };
  var info = it.info;
  var type = link.indexOf("/series-online/") !== -1 ? "series" : "movies";
  if (info) {
    m.id = (info._id !== undefined && info._id !== null) ? String(info._id) : "";
    m.image = resolveImage(info.cover);
    var rel = str(info.release);
    if (rel.length >= 4) m.year = rel.substring(0, 4);
    var desc = str(info.desc);
    if (desc && desc !== "null") m.synopsis = clean(desc);
    m.rating = str(info.ratingValue);
    m.runtime = str(info.runtime);
    var it2 = str(info.type);
    if (it2.toLowerCase() === "movie") type = "movies";
    else if (it2) type = "series";
    var g = joinArray(info.genres); if (g) m.genres = g;
    var dr = joinArray(info.director); if (dr) m.director = dr;
    var ca = joinArray(info.cast); if (ca) m.cast = ca;
  } else {
    m.id = "";
    m.image = "";
  }
  m.type = type;
  m.kind = kindOf(url);
  return m;
}

// [ "Acción", "Drama" ]  o  [ ["Acción", 1], ["Drama", 2] ]
function joinArray(arr) {
  if (!arr || !arr.length) return "";
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i], s = "";
    if (v && typeof v === "object" && v.length !== undefined) { if (v.length > 0) s = str(v[0]); }
    else s = str(v);
    if (s) out.push(s);
  }
  return out.join(", ");
}

// ───────────── Detalle ─────────────
function postId(url) {
  var m = /\/(\d+)\/[^\/]+\/?$/.exec(url);
  if (m) return m[1];
  m = /\/(?:peliculas-online|series-online|ver-el-episodio)\/(\d+)\//.exec(url);
  return m ? m[1] : null;
}

function detail(detailUrl) {
  var pid = postId(detailUrl);
  var isSeries = detailUrl.indexOf("/series-online/") !== -1;
  if (!pid) throw new Error("No se pudo sacar el id de " + detailUrl);

  var root = getJson(API + "/single/?pid=" + pid + "&type=" + (isSeries ? "series" : "movies"));
  var data = root && root.data;
  if (!data) throw new Error("Cuevana no devolvió datos para " + pid);

  var title = str(data.title) || "Sin título";
  var info = data.info;
  var d = { title: clean(title), isSeries: isSeries, id: str(data.id) || pid };

  if (info) {
    d.poster = resolveImage(info.cover);
    d.backdrop = resolveImage(info.backdrop);
    if (d.backdrop) d.banner = d.backdrop;
    var rel = str(info.release);
    var year = rel.length >= 4 ? rel.substring(0, 4) : "";
    if (year) d.year = year;
    var rating = str(info.ratingValue);
    d.rating = rating;
    d.duration = str(info.runtime);

    var desc = str(info.desc);
    if (desc && desc !== "null") {
      d.synopsis = clean(desc);
    } else {
      var orig = str(info.original_title) || title;
      var s = orig + " es una " + (isSeries ? "Serie" : "Película");
      if (year) s += " estrenada en " + year;
      if (rating && rating !== "0" && rating !== "0.0") s += " con una calificación de " + rating + " en TMDB.";
      else s += ".";
      s += " Si estuviste buscando este título, no te preocupes que aquí la tenemos. Disfrútala gratis solo en Cuevana3";
      d.synopsis = s;
    }
    d.genres = joinArray(info.genres) || (isSeries ? "Serie" : "Película");
    d.director = joinArray(info.director) || "Desconocido";
    d.cast = joinArray(info.cast) || "No especificado";
  } else {
    d.poster = "";
    d.synopsis = "Sin información disponible. Disfruta de este título en Cuevana3.";
    d.genres = isSeries ? "Serie" : "Película";
    d.director = "Desconocido";
    d.cast = "No especificado";
    d.year = "";
    d.rating = "";
    d.duration = "";
  }

  if (isSeries) d.episodes = fetchEpisodes(pid);
  else d.episodes = [{ title: "Ver Película", url: detailUrl, image: d.poster || "", id: pid }];
  return d;
}

function fetchEpisodes(pid) {
  var root = getJson(API + "/Episodes/" + pid);
  var seasons = root && root.data;
  var eps = [];
  if (!seasons || !seasons.length) return eps;
  for (var s = 0; s < seasons.length; s++) {
    var arr = seasons[s];
    if (!arr || !arr.length) continue;
    for (var e = 0; e < arr.length; e++) {
      var ep = arr[e];
      var sn = (ep.snum !== undefined && ep.snum !== null) ? parseInt(ep.snum, 10) : s + 1;
      var en = (ep.enum !== undefined && ep.enum !== null) ? parseInt(ep.enum, 10) : e + 1;
      var name = str(ep.name) || ("Episodio " + (e + 1));
      var slug = str(ep.slug);
      eps.push({
        title: name,
        season: String(sn),
        episode: String(en),
        overview: str(ep.overview),
        image: resolveImage(ep.still_path),
        url: slug ? BASE + slug : BASE + "/ver-el-episodio/" + pid + "/temporada-" + sn + "/episodio-" + en + "/",
        id: pid
      });
    }
  }
  return eps;
}

// ───────────── Reproductores ─────────────
function servers(episodeUrl) {
  var pid = postId(episodeUrl);
  if (!pid) return [];
  var json;
  if (episodeUrl.indexOf("/ver-el-episodio/") !== -1) {
    var season = "1", episode = "1", m;
    m = /temporada[-\s]*(\d+)/i.exec(episodeUrl); if (m) season = m[1];
    m = /episodio[-\s]*(\d+)/i.exec(episodeUrl); if (m) episode = m[1];
    json = getJson(API + "/episode/" + pid + "/" + season + "/" + episode);
  } else {
    json = getJson(API + "/player/" + pid);
  }
  var embeds = json && json.data && json.data.embeds;
  var out = [];
  if (!embeds || !embeds.length) return out;
  for (var i = 0; i < embeds.length; i++) {
    var url = str(embeds[i].url);
    if (!url) continue;
    var real = resolveFake(url);
    out.push(real || url);
  }
  return out;
}

// Los enlaces "fakeplayer" son una página intermedia: se saca el reproductor real de su HTML
function resolveFake(fakeUrl) {
  if (fakeUrl.indexOf("fakeplayer") === -1 && fakeUrl.indexOf("doo.lat") === -1 && fakeUrl.indexOf("goo.lat") === -1)
    return fakeUrl;
  try {
    var html = getHtml(fakeUrl);
    if (!html) return fakeUrl;
    var m = /var\s+url\s*=\s*['"]([^'"]+)['"]/.exec(html);
    if (m) return m[1];
    m = /(https?:\/\/(?:streamwish|doodstream|filemoon|embedwish|waaw|sbface|voe)\.[^\s'"]+)/.exec(html);
    if (m) return m[1];
    var re = /(https?:\/\/[^\s'"]+\.(?:to|com|net|tv|sx|io|xyz)\/[^\s'"]+)/g, f;
    var bad = ["fakeplayer", "histats", "yandex", "cloudflare", "google", "analytics", "doubleclick", "ads", "googlesyndication"];
    while ((f = re.exec(html)) !== null) {
      var ok = true;
      for (var i = 0; i < bad.length; i++) if (f[1].indexOf(bad[i]) !== -1) { ok = false; break; }
      if (ok) return f[1];
    }
  } catch (e) { log("fakeplayer: " + e); }
  return fakeUrl;
}
