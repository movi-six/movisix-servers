/*
 * CapibaraTraductor — Mangas / Manhwas / Manhuas
 * Funciones: list(page) · search(query, page) · detail(url) · images(chapterUrl, referer)
 */

var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("CONFIG.base no definido en index.json");

var RED = String(CONFIG.mode || "blue").toLowerCase() === "red";
var API_ROOT = /\/red$/i.test(BASE) ? BASE.replace(/\/red$/i, "") : BASE;
var LIMIT = 48;

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
    
    // TRUCO: Si es Red y la API ocultó la imagen (viene null), la pedimos al Detail
    if (!rawImg && RED) {
        try {
            var detailData = apiGet("/api/manga-custom/" + encodeURIComponent(slug), org).data || {};
            rawImg = detailData.imageUrl || (detailData.manga && detailData.manga.imageUrl) || "";
        } catch (e) {}
    }

    // Si de plano no hay imagen, usamos una por defecto para que no se vea roto
    if (!rawImg) {
        rawImg = "https://placehold.co/300x450/27272a/a1a1aa?text=+18"; 
    }

    out.push({
      title: clean(it.title || (it.manga && it.manga.title)),
      url: url,
      image: rawImg, // Mandamos la URL directa (funciona en Detail, funcionará en Home)
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

// ───────────── Lector (Nuevo sistema sin encriptar) ─────────────
var _pagesCache = {};

function chapterPages(chapterUrl) {
  if (_pagesCache[chapterUrl]) return _pagesCache[chapterUrl];

  var m = /\/([^\/]+)\/manga\/([^\/?#]+)\/chapters\/([^\/?#]+)/.exec(str(chapterUrl));
  if (!m) throw new Error("URL de capítulo no reconocida: " + chapterUrl);
  
  var p = { org: m[1], slug: m[2], capId: m[3] };
  var path = "/api/manga-custom/" + encodeURIComponent(p.slug) + "/chapter/" + encodeURIComponent(p.capId) + "/pages";
  
  var j = apiGet(path, p.org);
  
  if (!j || !j.data || !j.data.length) throw new Error("Respuesta de páginas inesperada o vacía");

  var urls = [];
  for (var i = 0; i < j.data.length; i++) {
    // Ahora la URL viene directa en 'imageUrl'
    var imgUrl = str(j.data[i] && j.data[i].imageUrl);
    if (imgUrl) {
      urls.push(imgUrl);
    }
  }

  _pagesCache[chapterUrl] = urls;
  return urls;
}

// ───────────── Lector ─────────────
function images(chapterUrl, referer) {
  return chapterPages(chapterUrl);
      }
