/*
 * CapibaraTraductor — Lector y Home (Usando WebView)
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
    "x-site": "es",
    "Referer": BASE + "/",
    "Origin": API_ROOT
  };
  if (org) h["x-organization"] = org;
  var body = http.get(API_ROOT + path, h);
  if (!body) throw new Error("Sin respuesta de " + path);
  var j = JSON.parse(body);
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
    if (RED && it.isNSFW !== true) continue;
    if (!RED && it.isNSFW === true) continue;

    var slug = slugOf(it), org = orgOf(it);
    if (!slug || !org) continue;
    var url = workUrl(org, slug);
    if (seen[url]) continue;
    seen[url] = true;

    var rawImg = it.imageUrl || (it.manga && it.manga.imageUrl) || "";
    
    // TRUCO HOME: Si en Red la imagen viene oculta, la sacamos del Detail
    if (!rawImg && RED) {
        try {
            var detailData = apiGet("/api/manga-custom/" + encodeURIComponent(slug), org).data || {};
            rawImg = detailData.imageUrl || (detailData.manga && detailData.manga.imageUrl) || "";
        } catch (e) {}
    }

    if (!rawImg) rawImg = "https://placehold.co/300x450/27272a/a1a1aa?text=+18";

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
  if (!arr) return out;
  for (var i = 0; i < arr.length; i++) {
    var n = typeof arr[i] === "string" ? arr[i] : str(arr[i] && (arr[i].name || arr[i].title));
    if (n && out.indexOf(n) === -1) out.push(n);
  }
  return out;
}

function detail(url) {
  var mSlug = /\/([^\/]+)\/manga\/([^\/?#]+)/.exec(str(url));
  var mId   = /\/manga-custom\/(\d+)/.exec(str(url));
  if (!mSlug && !mId) throw new Error("URL inválida");

  var apiPath, org;
  if (mSlug) { org = mSlug[1]; apiPath = "/api/manga-custom/" + encodeURIComponent(mSlug[2]); }
  else       { apiPath = "/api/manga-custom/" + mId[1]; }

  var d = (apiGet(apiPath, org).data) || {};
  var man = d.manga || {};

  var realOrg  = str((d.organization && d.organization.slug) || org);
  var realSlug = str(man.slug || d.slug || (mSlug && mSlug[2]));
  var workBase = BASE + "/" + realOrg + "/manga/" + realSlug;

  var rawPoster = d.imageUrl || man.imageUrl || "";
  var rawBanner = d.bannerUrl || man.bannerUrl || d.imageUrl || "";

  var res = {
    title: clean(d.title || man.title),
    synopsis: clean(d.description || man.description),
    genres: "",
    poster: rawPoster,
    banner: rawBanner || rawPoster,
    year: "", rating: "", director: "",
    isSeries: true,
    episodes: []
  };

  var chs = d.chapters || [], eps = [], seen = {}, now = Date.now();
  for (var i = 0; i < chs.length; i++) {
    var c = chs[i];
    if (!c || c.isUnreleased || c.deletedAt) continue;
    var rel = c.releasedAt ? new Date(c.releasedAt).getTime() : 0;
    if (rel && rel > now) continue;

    var num = str(c.number).replace(/\.0+$/, "");
    if (!num) continue;
    var curl = workBase + "/chapters/" + num;
    if (seen[curl]) continue;
    seen[curl] = true;

    var title = clean(c.title);
    var name = title && /cap[ií]tulo/i.test(title) ? title : ("Capítulo " + num);

    eps.push({ title: name, url: curl, image: "", _n: Number(c.number) });
  }
  eps.sort(function (a, b) { return a._n - b._n; });
  for (var e = 0; e < eps.length; e++) delete eps[e]._n;
  res.episodes = eps;
  return res;
}

// ───────────── Lector con WebView (React Bypass) ─────────────
var _pagesCache = {};

function chapterPages(chapterUrl) {
  if (_pagesCache[chapterUrl]) return _pagesCache[chapterUrl];

  // El JS exacto que Capibara usa en Tachiyomi para extraer las imágenes de React
  var js = "(function() {"
    + "function isPages(list) {"
    + "  return Array.isArray(list) && list.length > 0 && list.every(function(page) {"
    + "    return page && typeof page.imageUrl === 'string' && /^https?:/.test(page.imageUrl) && typeof page.number === 'number' && typeof page.chapterId === 'number';"
    + "  });"
    + "}"
    + "var pages = null;"
    + "function walk(fiber) {"
    + "  for (; fiber; fiber = fiber.sibling) {"
    + "    for (var hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook && 'queue' in hook; hook = hook.next) {"
    + "      if (isPages(hook.memoizedState) && (!pages || hook.memoizedState.length > pages.length)) pages = hook.memoizedState;"
    + "    }"
    + "    if (fiber.child) walk(fiber.child);"
    + "  }"
    + "}"
    + "document.querySelectorAll('*').forEach(function(element) {"
    + "  Object.keys(element).forEach(function(key) {"
    + "    if (key.indexOf('__reactContainer$') === 0) {"
    + "      var fiber = element[key];"
    + "      walk(fiber.stateNode && fiber.stateNode.current || fiber);"
    + "    }"
    + "  });"
    + "});"
    + "if (!pages) return null;"
    + "var urls = pages.map(function(page) { return page.imageUrl; });"
    + "return urls.length > 1 && new Set(urls).size === 1 ? null : urls;"
    + "})();";

  // Usamos el objeto web que provee RemoteServers.java
  // Le pasamos la URL del capítulo y el JS. El timeout es de 25s (por defecto usa 20s)
  var opts = {
      "timeout": 25000,
      "waitFor": "window.React !== undefined", // Espera a que React cargue
      "images": false
  };

  var rawResult = web.eval(chapterUrl, js, opts);
  
  if (!rawResult || rawResult === "null" || rawResult === "") {
      throw new Error("WebView no pudo extraer las imágenes (posible Cloudflare o carga lenta).");
  }

  var urls = JSON.parse(rawResult);
  if (!urls || urls.length === 0) {
      throw new Error("El WebView no encontró las imágenes en el estado de React.");
  }

  _pagesCache[chapterUrl] = urls;
  return urls;
}

function images(chapterUrl, referer) {
  return chapterPages(chapterUrl);
    }
