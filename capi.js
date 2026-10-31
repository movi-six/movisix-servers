/*
 * CapibaraTraductor — Mangas / Manhwas / Manhuas
 * Funciones: list(page) · search(query, page) · detail(url) · images(chapterUrl, referer)
 */

if (typeof Math.imul !== "function") {
  Math.imul = function(a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) | 0);
  };
}

var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("CONFIG.base no definido en index.json");

var RED = String(CONFIG.mode || "blue").toLowerCase() === "red";
var API_ROOT = /\/red$/i.test(BASE) ? BASE.replace(/\/red$/i, "") : BASE;
var LIMIT = 48;
var MAGIC = [60, 110, 243, 114];

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) {
  return util.htmlDecode(str(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}

// ───────────── HTTP / API ─────────────
function apiGet(path, org) {
  var h = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "x-site": "es",
    "Referer": BASE + "/",
    "Origin": API_ROOT
  };
  if (org) h["x-organization"] = org;
  var body = http.get(API_ROOT + path, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + path);
  var j;
  try { j = JSON.parse(body); }
  catch (e) { throw new Error("Respuesta no JSON de " + path); }
  if (j && j.status === false) throw new Error("API: " + str(j.message));
  return j;
}

function orgOf(it) {
  var o = it.organization || (it.manga && it.manga.organization) || {};
  return str(o.slug || it.organizationSlug || it.scanSlug || it.organization_slug);
}
function slugOf(it) { return str((it.manga && it.manga.slug) || it.slug); }
function workUrl(org, slug) { return BASE + "/" + org + "/manga/" + slug; }

// ───────────── Lista / Búsqueda ─────────────
function cardsFrom(json) {
  var data  = (json && json.data) || {};
  var items = data.items || (Object.prototype.toString.call(data) === "[object Array]" ? data : []);
  var out = [], seen = {};
  
  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    // Filtro Blue / Red
    if (RED) {
      if (it.isNSFW !== true) continue;
    } else {
      if (it.isNSFW === true) continue;
    }

    var slug = slugOf(it), org = orgOf(it);
    if (!slug || !org) continue;
    
    var url = workUrl(org, slug);
    if (seen[url]) continue;
    seen[url] = true;

    // Buscamos la imagen en la raíz o en el objeto manga
    var rawImg = it.imageUrl || (it.manga && it.manga.imageUrl) || "";
    
    // ¡EL TRUCO! Si es Red y no hay imagen, la pedimos al Detail
    if (!rawImg && RED) {
        try {
            // Hacemos la petición al detalle de esta obra específica
            var detailData = apiGet("/api/manga-custom/" + encodeURIComponent(slug), org).data || {};
            rawImg = detailData.imageUrl || (detailData.manga && detailData.manga.imageUrl) || "";
        } catch (e) {
            // Si falla, seguimos sin imagen para no romper la lista
        }
    }

    // Si después de la consulta al Detail sigue vacío, usamos una por defecto
    if (!rawImg) {
        rawImg = "https://placehold.co/300x450/27272a/a1a1aa?text=+18"; 
    }

    out.push({
      title: clean(it.title || (it.manga && it.manga.title)),
      url: url,
      image: rawImg,
      year: "", rating: "", kind: "serie"
    });
  }
  return out;
}

function listPath(page, search) {
  return "/api/manga-custom?page=" + (page || 1) + "&limit=" + LIMIT +
         "&order=latest&nsfw=" + (RED ? "true" : "false") +
         "&incluir=todos" + (search ? "&search=" + encodeURIComponent(search) : "");
}

function list(page) { return cardsFrom(apiGet(listPath(page, ""), "")); }
function search(query, page) { return cardsFrom(apiGet(listPath(page, query), "")); }

// ───────────── Detalle ─────────────
function names(arr) {
  var out = [];
  if (!arr || Object.prototype.toString.call(arr) !== "[object Array]") return out;
  for (var i = 0; i < arr.length; i++) {
    var n = typeof arr[i] === "string" ? arr[i] : str(arr[i] && (arr[i].name || arr[i].title));
    if (n && out.indexOf(n) === -1) out.push(n);
  }
  return out;
}

function numText(n) { return str(n).replace(/\.0+$/, ""); }

function detail(url) {
  var mSlug = /\/([^\/]+)\/manga\/([^\/?#]+)/.exec(str(url));
  var mId   = /\/manga-custom\/(\d+)/.exec(str(url));
  if (!mSlug && !mId) throw new Error("URL de obra no reconocida: " + url);

  var apiPath, org;
  if (mSlug) { org = mSlug[1]; apiPath = "/api/manga-custom/" + encodeURIComponent(mSlug[2]); }
  else       { apiPath = "/api/manga-custom/" + mId[1]; }

  var d = (apiGet(apiPath, org).data) || {};
  var man = d.manga || {};

  var realOrg  = str((d.organization && d.organization.slug) || org);
  var realSlug = str(man.slug || d.slug || (mSlug && mSlug[2]));
  if (!realOrg || !realSlug) throw new Error("No se pudo resolver org/slug del manga");

  var workBase = BASE + "/" + realOrg + "/manga/" + realSlug;

  var genres = [];
  if (man.bookType && man.bookType.name)     genres.push(str(man.bookType.name));
  if (man.demography && man.demography.name) genres.push(str(man.demography.name));
  var gs = names(d.genres);
  for (var g = 0; g < gs.length; g++) if (genres.indexOf(gs[g]) === -1) genres.push(gs[g]);

  var rs = d.reviewStats || {};
  var rating = str(rs.average || rs.avg || rs.rating || rs.score);

  var rawPoster = d.imageUrl || man.imageUrl || "";
  var rawBanner = d.bannerUrl || man.bannerUrl || d.imageUrl || "";

  var res = {
    title: clean(d.title || man.title),
    synopsis: clean(d.description || d.shortDescription || man.description || man.shortDescription),
    genres: genres.join(", "),
    poster: rawPoster,
    banner: rawBanner || rawPoster,
    year: str(d.releasedAt || man.releasedAt).substring(0, 4),
    rating: rating,
    director: names(man.authors).join(", "),
    isSeries: true,
    episodes: []
  };

  var chs = d.chapters || [], eps = [], seen = {}, now = Date.now();
  for (var i = 0; i < chs.length; i++) {
    var c = chs[i];
    if (!c || c.isUnreleased || c.deletedAt) continue;
    var rel = c.releasedAt ? new Date(c.releasedAt).getTime() : 0;
    if (rel && rel > now) continue;

    var num = numText(c.number);
    if (!num) continue;
    var curl = workBase + "/chapters/" + num;
    if (seen[curl]) continue;
    seen[curl] = true;

    var shown = (c.displayNumber !== undefined && c.displayNumber !== null && c.displayNumber !== "") ? c.displayNumber : c.number;
    var title = clean(c.title);
    var name = title && /cap[ií]tulo/i.test(title) ? title : ("Capítulo " + numText(shown) + (title ? " - " + title : ""));

    eps.push({ title: name, url: curl, image: "", _n: Number(c.number) });
  }
  eps.sort(function (a, b) { return a._n - b._n; });
  for (var e = 0; e < eps.length; e++) delete eps[e]._n;
  res.episodes = eps;
  return res;
}

// ───────────── Base64 / LCG / Desencriptación ─────────────
function b64ToBytes(b64) {
  var s = str(b64).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "=") break;
    var v = chars.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xFF); }
  }
  return out;
}

function makeLCG(seed) {
  var s = seed | 0;
  return function next() {
    s = (s + 1831565813) | 0;
    var i2 = Math.imul((s >>> 15) ^ s, s | 1) | 0;
    i2 = (i2 ^ ((Math.imul((i2 >>> 7) ^ i2, i2 | 61) + i2) | 0)) | 0;
    return (i2 ^ (i2 >>> 14)) >>> 24;
  };
}

function deriveSeed(master) {
  var seed = 0;
  for (var i = 0; i < MAGIC.length; i++) {
    seed = ((seed << 8) | ((master[i * 2] & 0xFF) ^ MAGIC[i])) | 0;
  }
  return seed;
}

function decryptPage(cipherBytes, seed, index) {
  var key = (Math.imul(-1640531535, index + 1) ^ seed ^ 2135587861) | 0;
  var rng = makeLCG(key);
  var n = cipherBytes.length - 2;
  var out = new Array(n);
  var acc = 90;
  for (var i = 0; i < n; i++) {
    var b = (cipherBytes[i + 2] ^ rng()) & 0xFF;
    acc = ((b * (i + 1)) + acc) & 0xFF;
    out[i] = b;
  }
  var expect = (cipherBytes[1] ^ rng()) & 0xFF;
  if (expect !== acc) throw new Error("Checksum inválido en página " + index);

  var s = "", j = 0;
  while (j < out.length) {
    var c = out[j++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c >= 0xC0 && c < 0xE0) s += String.fromCharCode(((c & 0x1F) << 6) | (out[j++] & 0x3F));
    else if (c >= 0xE0 && c < 0xF0) s += String.fromCharCode(((c & 0x0F) << 12) | ((out[j++] & 0x3F) << 6) | (out[j++] & 0x3F));
    else {
      var cp = ((c & 0x07) << 18) | ((out[j++] & 0x3F) << 12) | ((out[j++] & 0x3F) << 6) | (out[j++] & 0x3F);
      cp -= 0x10000;
      s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return s;
}

function parseChapterUrl(u) {
  var m = /\/([^\/]+)\/manga\/([^\/?#]+)\/chapters\/([^\/?#]+)/.exec(str(u));
  if (!m) throw new Error("URL de capítulo no reconocida: " + u);
  return { org: m[1], slug: m[2], capId: m[3] };
}

var _pagesCache = {};

function chapterPages(chapterUrl) {
  if (_pagesCache[chapterUrl]) return _pagesCache[chapterUrl];

  var p = parseChapterUrl(chapterUrl);
  var path = "/api/manga-custom/" + encodeURIComponent(p.slug) + "/chapter/" + encodeURIComponent(p.capId) + "/pages";
  var j = apiGet(path, p.org);
  
  if (!j || !j.rv || !j.data || !j.data.length) throw new Error("Respuesta de páginas inesperada");

  var seed = deriveSeed(b64ToBytes(j.rv));
  var urls = [];
  for (var i = 0; i < j.data.length; i++) {
    var pg = str(j.data[i] && j.data[i].pg);
    if (!pg) throw new Error("Página " + i + " sin campo pg");
    urls.push(decryptPage(b64ToBytes(pg), seed, i));
  }

  _pagesCache[chapterUrl] = urls;
  return urls;
}

// ───────────── Lector ─────────────
function images(chapterUrl, referer) {
  return chapterPages(chapterUrl);
                   }
