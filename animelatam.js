var ADDON = CONFIG.base.replace(/\/+$/, "");

var HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0"
};

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s)).replace(/^\s+|\s+$/g, ""); }

function getJson(url) {
  var text;
  try { text = http.get(url, HEADERS); }
  catch (e) { log("AnimeLatam GET error " + url + ": " + e); return null; }
  if (!text) { log("Sin respuesta (HTTP " + http.status() + ") " + url); return null; }
  text = String(text).trim();
  if (text.charAt(0) === "<") return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

var CATS = {
  "animeav1|onair":  { name: "AnimeAV1 · En emisión", id: "animeav1|onair" },
  "henaojara|onair": { name: "Henaojara · En emisión", id: "henaojara|onair" },
  "latanime|onair":  { name: "Latanime · En emisión", id: "latanime|onair" },
  "animeav1":        { name: "AnimeAV1 · Buscar", id: "animeav1", search: true },
  "henaojara":       { name: "Henaojara · Buscar", id: "henaojara", search: true },
  "latanime":        { name: "Latanime · Buscar", id: "latanime", search: true }
};

function filters() {
  var cats = [];
  for (var k in CATS) cats.push({ value: k, name: CATS[k].name });
  return [
    { type: "select", key: "cat", label: "Catálogo", options: cats }
  ];
}

function card(it) {
  if (!it || !it.id) return null;
  return {
    title: clean(it.name || it.title),
    url: it.id,
    image: str(it.poster || it.background || ""),
    year: str(it.releaseInfo || ""),
    kind: "serie"
  };
}

function cards(metas) {
  var out = [];
  for (var i = 0; i < (metas || []).length; i++) {
    var c = card(metas[i]);
    if (c) out.push(c);
  }
  return out;
}

function list(page, f) {
  page = page || 1;
  var o = f || {};
  var cat = CATS[o.cat || ""] || CATS["animeav1|onair"];
  var skip = (page - 1) * 30;
  var url = ADDON + "/catalog/anime/" + encodeURIComponent(cat.id) + "/skip=" + skip + ".json";
  if (cat.search && !o.query) {
    log("AnimeLatam: el catálogo " + cat.id + " requiere búsqueda. Usa search().");
    return [];
  }
  var j = getJson(url);
  return j ? cards(j.metas) : [];
}

function search(query, page) {
  if (!query) return [];
  page = page || 1;
  var skip = (page - 1) * 30;
  var url = ADDON + "/catalog/anime/animeav1/search=" + encodeURIComponent(query) + "&skip=" + skip + ".json";
  var j = getJson(url);
  return j ? cards(j.metas) : [];
}

function detail(url) {
  var id = str(url);
  if (!id) return null;
  var j = getJson(ADDON + "/meta/anime/" + encodeURIComponent(id) + ".json");
  if (!j || !j.meta) return null;
  var m = j.meta;

  var episodes = [];
  var vids = m.videos || [];
  for (var i = 0; i < vids.length; i++) {
    var v = vids[i];
    episodes.push({
      title: clean(v.title || v.name) || ("Episodio " + (v.number || (i + 1))),
      url: v.id,
      image: str(v.thumbnail || ""),
      season: v.season,
      episode: v.episode || v.number
    });
  }

  var trailer = "";
  if (m.trailers && m.trailers.length) {
    trailer = "https://www.youtube.com/embed/" + m.trailers[0].source;
  }

  return {
    title: clean(m.name),
    poster: str(m.poster || ""),
    banner: str(m.background || m.poster || ""),
    synopsis: str(m.description || ""),
    year: str(m.releaseInfo || (m.released ? String(m.released).substring(0, 4) : "")),
    rating: "",
    genres: (m.genres || []).join(", "),
    trailer: trailer,
    isSeries: true,
    episodes: episodes
  };
}

function servers(episodeUrl) {
  var id = str(episodeUrl);
  if (!id) return [];
  var j = getJson(ADDON + "/stream/anime/" + encodeURIComponent(id) + ".json");
  if (!j || !j.streams || !j.streams.length) {
    log("AnimeLatam: sin streams para " + id);
    return [];
  }

  var out = [];
  for (var i = 0; i < j.streams.length; i++) {
    var s = j.streams[i];
    if (!s) continue;

    var url = str(s.url || "");
    var hash = str(s.infoHash || "");
    if (!url && !hash) continue;

    var name = str(s.name || "").replace(/\n+/g, " ").replace(/^\s+|\s+$/g, "");
    var desc = str(s.description || "").replace(/\n+/g, " ").replace(/^\s+|\s+$/g, "");
    var full = (name + " " + desc).toLowerCase();

    var audio = "SUB";
    if (/lat|dub|🇲🇽/.test(full)) audio = "LAT";
    else if (/cast|español|spa/.test(full)) audio = "CAS";

    var ref = "";
    var ua = "";
    if (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request) {
      ref = str(s.behaviorHints.proxyHeaders.request.Referer || "");
      ua = str(s.behaviorHints.proxyHeaders.request["User-Agent"] || "");
    }

    if (url) {
      out.push({
        url: url,
        name: name || ("Servidor " + (i + 1)),
        audio: audio,
        referer: ref,
        userAgent: ua
      });
    } else if (hash) {
      var mag = "magnet:?xt=urn:btih:" + hash + "&dn=" + encodeURIComponent(desc || name);
      out.push({ url: mag, name: name || "Torrent", audio: audio });
    }
  }

  return out;
}
