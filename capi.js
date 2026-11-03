var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("CONFIG.base no definido en index.json");

var RED = String(CONFIG.mode || "blue").toLowerCase() === "red";
var API_ROOT = /\/red$/i.test(BASE) ? BASE.replace(/\/red$/i, "") : BASE;
var LIMIT = 48;
var ONLY = str0(CONFIG.only).toLowerCase();        // "", "manga" o "novel": filtra la lista a un solo tipo
var INCLUIR = str0(CONFIG.incluir) || "todos";     // filtro de tipo que acepta la API
var API_PATH = str0(CONFIG.apiPath) || "/api/manga-custom";   // endpoint de lista/detalle (novelas: configurable)
var ORIGIN = (/^(https?:\/\/[^\/]+)/.exec(BASE) || ["", ""])[1];
function str0(v) { return (v === undefined || v === null) ? "" : String(v); }

function str(v) { return (v === undefined || v === null) ? "" : String(v); }

// Tipo por URL: novela = /writings/<org>/novel/<slug>[/chapter/<n>]  ·  manga = /<org>/manga/<slug>/chapters/<n>
function isNovelUrl(u) { return /\/writings\/[^\/]+\/novel\/|\/novel\//i.test(str(u)); }

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
function workUrl(org, slug, novel) {
  return novel ? BASE + "/writings/" + org + "/novel/" + slug      // novelas: /writings/<org>/novel/<slug>
               : BASE + "/" + org + "/manga/" + slug;
}

// ───────────── Lista / Búsqueda ─────────────
function cardsFrom(json) {
  var data  = (json && json.data) || {};
  var items = data.items || (Object.prototype.toString.call(data) === "[object Array]" ? data : []);
  var out = [], seen = {};

  // ¿La API marca el tipo de obra? Si sí, cada obra recibe la URL de su tipo (y "only" puede filtrar).
  var anyKind = false;
  for (var k = 0; k < items.length; k++) if (kindOf(items[k])) { anyKind = true; break; }

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (RED && it.isNSFW !== true) continue;
    if (!RED && it.isNSFW === true) continue;
    var nov = (anyKind && isNovelKind(kindOf(it))) || it.isNovel === true || !!it.novel;
    if (ONLY === "novel" && anyKind && !nov) continue;
    if (ONLY === "manga" && nov) continue;

    var slug = slugOf(it), org = orgOf(it);
    if (!slug || !org) continue;
    var url = workUrl(org, slug, nov);
    if (seen[url]) continue;
    seen[url] = true;

    var rawImg = it.imageUrl || (it.manga && it.manga.imageUrl) || "";

    // TRUCO HOME: Si en Red la imagen viene oculta, la sacamos del Detail
    if (!rawImg && RED) {
        try {
            var detailData = apiGet(API_PATH + "/" + encodeURIComponent(slug), org).data || {};
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

function kindOf(it) {
  var m = it.manga || {};
  var c = [it.type, it.kind, it.format, it.contentType, it.category, it.mangaType, it.tipo, it.workType,
           m.type, m.kind, m.format, m.contentType, m.category, m.mangaType, m.tipo, m.workType];
  for (var i = 0; i < c.length; i++) {
    var v = c[i];
    if (v && typeof v === "object") v = v.slug || v.name;
    if (typeof v === "string" && v) return v.toLowerCase();
  }
  if (it.isNovel === true || m.isNovel === true) return "novel";
  return "";
}
function isNovelKind(kind) { return /novel|ln$/.test(kind); }

function listPath(page, search) {
  return API_PATH + "?page=" + (page || 1) + "&limit=" + LIMIT +
         "&order=latest&nsfw=" + (RED ? "true" : "false") +
         "&incluir=" + encodeURIComponent(INCLUIR) + (search ? "&search=" + encodeURIComponent(search) : "");
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
  var mNov  = /\/writings\/([^\/]+)\/novel\/([^\/?#]+)/.exec(str(url));   // novela
  var mSlug = mNov || /\/([^\/]+)\/manga\/([^\/?#]+)/.exec(str(url));
  var mId   = /\/manga-custom\/(\d+)/.exec(str(url));
  if (!mSlug && !mId) throw new Error("URL inválida");

  var apiPath, org;
  if (mSlug) { org = mSlug[1]; apiPath = API_PATH + "/" + encodeURIComponent(mSlug[2]); }
  else       { apiPath = API_PATH + "/" + mId[1]; }

  var d = (apiGet(apiPath, org).data) || {};
  var man = d.manga || {};
  var isNov = !!mNov || isNovelKind(kindOf(d));   // por la URL o por el tipo que marca la API

  var realOrg  = str((d.organization && d.organization.slug) || org);
  var realSlug = str(man.slug || d.slug || (mSlug && mSlug[2]));
  var workBase = isNov ? BASE + "/writings/" + realOrg + "/novel/" + realSlug
                       : BASE + "/" + realOrg + "/manga/" + realSlug;

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
    var curl = workBase + (isNov ? "/chapter/" : "/chapters/") + num;
    if (seen[curl]) continue;
    seen[curl] = true;

    var title = clean(c.title);
    var name = title && /cap[ií]tulo/i.test(title) ? title : ("Capítulo " + num);

    eps.push({ title: name, url: curl, image: "", _n: Number(c.number) });
  }
  if (isNov && eps.length === 0) eps = novelChaptersFromDom(workBase);
  eps.sort(function (a, b) { return a._n - b._n; });
  for (var e = 0; e < eps.length; e++) delete eps[e]._n;
  res.episodes = eps;
  return res;
}

// Respaldo para novelas: lee los enlaces /chapter/<n> de la página de la obra (render en cliente).
var CH_LINKS_JS = "(function(){var a=document.getElementsByTagName('a'),o=[],s={};" +
  "for(var i=0;i<a.length;i++){var h=a[i].href||'';if(h.indexOf('/chapter/')>0&&!s[h]){s[h]=1;o.push({u:h});}}" +
  "return o.length?o:null;})()";
function novelChaptersFromDom(workBase) {
  var out = [];
  try {
    var raw = web.eval(workBase, CH_LINKS_JS, { poll: true, timeout: 15000, cache: 600000, stale: 86400000 });
    if (!raw || raw === "null") return out;
    var arr = JSON.parse(raw), seen = {};
    for (var i = 0; i < arr.length; i++) {
      var m = /\/chapter\/(\d+(?:\.\d+)?)(?:[\/?#]|$)/.exec(arr[i].u);
      if (!m || seen[m[1]]) continue;
      seen[m[1]] = true;
      out.push({ title: "Capítulo " + m[1], url: workBase + "/chapter/" + m[1], image: "", _n: Number(m[1]) });
    }
  } catch (e) {}
  return out;
}

// ───────────── Lector con WebView (estado de React) ─────────────
//
// El DOM solo trae ~5 <img> con src (el resto son placeholders lazy), así que las URLs completas se leen del
// estado de React. La expresión devuelve null hasta que el estado ya tiene las páginas; con poll:true el
// WebView la evalúa cada 60 ms y responde en el primer instante en que hay datos (sin esperas fijas).
//
// OJO: antes se usaba waitFor "window.React !== undefined", que NUNCA se cumple en producción (React no es
// global) → siempre esperaba el timeout completo (25 s) antes de leer.
var PAGES_JS = [
  "(function(){",
  "function isPages(l){return Array.isArray(l)&&l.length>0&&l.every(function(p){",
  "return p&&typeof p.imageUrl==='string'&&/^https?:/.test(p.imageUrl)&&typeof p.number==='number'&&typeof p.chapterId==='number';});}",
  "var pages=null;",
  "function walk(f){for(;f;f=f.sibling){",
  "for(var h=f.memoizedState;h&&typeof h==='object'&&'next' in h&&'queue' in h;h=h.next){",
  "var s=h.memoizedState;if(isPages(s)&&(!pages||s.length>pages.length))pages=s;}",
  "if(f.child)walk(f.child);}}",
  "function scan(el){if(!el)return;var ks=Object.keys(el);",
  "for(var k=0;k<ks.length;k++){if(ks[k].indexOf('__reactContainer$')===0){",
  "var fb=el[ks[k]];walk(fb.stateNode&&fb.stateNode.current||fb);}}}",
  // Camino rápido: solo los posibles root de React (no los miles de nodos del documento).
  "var roots=[document.getElementById('root'),document.getElementById('__next'),document.getElementById('app'),document.body];",
  "var bc=document.body?document.body.children:[];for(var i=0;i<bc.length;i++)roots.push(bc[i]);",
  "for(var r=0;r<roots.length&&!pages;r++)scan(roots[r]);",
  // Respaldo (caro): recorrer todos los elementos, solo tras varios intentos fallidos.
  "window.__wfTry=(window.__wfTry||0)+1;",
  "if(!pages&&window.__wfTry>10){var all=document.querySelectorAll('*');for(var a=0;a<all.length&&!pages;a++)scan(all[a]);}",
  "if(!pages)return null;",
  "var u=pages.map(function(p){return p.imageUrl;});",
  "return u.length>1&&new Set(u).size===1?null:u;",
  "})()"
].join("");

function chapterPages(chapterUrl) {
  // Sin variable global como caché: cada llamada a este script corre en un scope nuevo de Rhino y no se conserva.
  // La caché real vive en WebFetcher (opción cache / stale).
  var opts = {
    poll: true,            // lee en el primer instante en que hay datos
    timeout: 20000,
    cache: 1800000,        // 30 min: volver a un capítulo es instantáneo
    stale: 86400000        // aunque haya vencido, se sirve ya y se refresca por detrás
  };

  var rawResult = web.eval(chapterUrl, PAGES_JS, opts);

  if (!rawResult || rawResult === "null") {
    throw new Error("WebView no pudo extraer las imágenes (posible Cloudflare o carga lenta).");
  }

  var urls = JSON.parse(rawResult);
  if (!urls || urls.length === 0) {
    throw new Error("El WebView no encontró las imágenes en el estado de React.");
  }
  return urls;
}

// Marca que images() antepone cuando el capítulo resulta ser una NOVELA: el lector Java la ve y pasa a modo texto.
var NOVEL_MARK = "@@NOVEL@@";

// Lector único: abre el capítulo UNA vez y decide por el DOM de la página (no por la API ni por el index.json):
//   · <article class="nr-article">  → {t:"text", v:[párrafos]}
//   · estado de React con páginas   → {t:"img",  v:[urls]}
function uniJs(url) {
  return "(function(){var NV=" + (isNovelUrl(url) ? "true" : "false") + ";" +
    "var a=document.querySelector('article.nr-article');" +
    "if(a){var r=" + TEXT_JS + ";return r?{t:'text',v:r}:null;}" +
    "var p=" + PAGES_JS + ";if(p)return{t:'img',v:p};" +
    "if(NV){var r2=" + TEXT_JS + ";if(r2)return{t:'text',v:r2};}" +
    "return null;})()";
}

function readChapter(chapterUrl) {
  var raw = web.eval(chapterUrl, uniJs(chapterUrl), { poll: true, timeout: 20000, cache: 1800000, stale: 86400000 });
  log("readChapter raw=" + (raw ? String(raw).length + " chars" : "vacío") + " · " + chapterUrl);
  if (!raw || raw === "null") throw new Error("No se pudo leer el capítulo (Cloudflare o carga lenta): " + chapterUrl);
  var o = JSON.parse(raw);
  if (!o || !o.v || !o.v.length) throw new Error("El capítulo no tiene contenido: " + chapterUrl);
  return o;
}

function images(chapterUrl, referer) {
  if (isNovelUrl(chapterUrl)) {                       // novela abierta en modo imágenes: respuesta rápida + marca
    var fast = paragraphsFromHttp(chapterUrl);
    if (fast) return [NOVEL_MARK].concat(fast);
  }
  var o = readChapter(chapterUrl);
  if (o.t === "text") return [NOVEL_MARK].concat(o.v);
  return o.v;
}


// ───────────── Lector de NOVELAS (texto) ─────────────
//
// paragraphs() devuelve un arreglo de strings con las convenciones del lector:
//   texto normal = párrafo · "## Título" = encabezado · "* * *" = corte de escena · "[img]URL" = ilustración.
//
// OJO: se declara con "var paragraphs = function" A PROPÓSITO. RemoteServers.defines() busca el texto
// la declaración clásica de paragraphs para decidir que un servidor es de novelas; con "var" la entrada NO pasa a modo texto
// por tenerla: el modo lo decide el lector por capítulo con "novelUrl" (ver ServerRegistry.isNovelServer).
//
// extractText() corre DENTRO del WebView. Busca el texto del capítulo, en este orden:
//   0) <article class="nr-article"> (estructura real de las novelas de Capibara)
//   1) estado de React (claves content / text / body / html / paragraphs…): HTML, texto plano, arreglo de
//      párrafos, JSON de editor (ProseMirror / TipTap) o Quill delta.
//   2) si el capítulo en realidad es de imágenes (estado con páginas) → "[img]URL" por página.
//   3) el DOM: el contenedor con más texto en <p>.
// Devuelve null hasta que el resultado se queda igual en dos lecturas seguidas (así no se entrega un
// capítulo a medio renderizar) y poll:true la reevalúa cada 60 ms.
function extractText() {
  var MIN = 60, budget = 30000;
  var KEYS = { content: 1, contents: 1, text: 1, texts: 1, body: 1, html: 1, contenido: 1, texto: 1,
               paragraphs: 1, parrafos: 1, chaptercontent: 1, blocks: 1, doc: 1, ops: 1, delta: 1 };
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|NAV|HEADER|FOOTER|ASIDE|BUTTON|FORM|SVG|IFRAME|SELECT|INPUT|TEXTAREA)$/;
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|UL|OL|LI|BLOCKQUOTE|H[1-6]|HR|IMG|PRE|FIGURE|TABLE|TBODY|TR)$/;
  var SCENE = /^([*\u2022\u00b7~#=_\-]\s*){3,}$/;

  function norm(s) {
    return String(s).replace(/\u00a0/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/^\s+|\s+$/g, '');
  }
  function para(out, t) { t = norm(t); if (t) out.push(SCENE.test(t) ? '* * *' : t); }
  function sumLen(a) { var n = 0; for (var i = 0; i < a.length; i++) n += a[i].length; return n; }
  function stable(total) {
    if (window.__wfPrev !== total) { window.__wfPrev = total; return false; }
    return true;
  }
  function textOf(el) {
    var s = '';
    (function w(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) { if (String(c.tagName).toUpperCase() === 'BR') s += '\n'; else w(c); }
      }
    })(el);
    return norm(s);
  }
  function imgSrc(i) {
    var s = i.getAttribute('src') || i.getAttribute('data-src') || '';
    if (!s) return '';
    try { return new URL(s, location.href).href; } catch (e) { return s; }   // relativas → absolutas
  }

  // ── HTML / DOM → párrafos ──
  function fromNode(root, out) {
    function visit(n) {
      if (n.nodeType !== 1) return;
      var tag = String(n.tagName).toUpperCase();
      if (SKIP.test(tag)) return;
      if (tag === 'HR') { out.push('* * *'); return; }
      if (tag === 'IMG') { var s = imgSrc(n); if (/^https?:/.test(s)) out.push('[img]' + s); return; }
      if (/^H[1-6]$/.test(tag)) { var h = textOf(n); if (h) out.push('## ' + h); return; }
      var hasBlock = false, c;
      for (c = n.firstElementChild; c; c = c.nextElementSibling) {
        if (BLOCK.test(String(c.tagName).toUpperCase())) { hasBlock = true; break; }
      }
      if (!hasBlock) {                       // hoja: un párrafo (los <br> pasan a saltos de línea)
        para(out, textOf(n));
        var imgs = n.getElementsByTagName('img');
        for (var i = 0; i < imgs.length; i++) { var u = imgSrc(imgs[i]); if (/^https?:/.test(u)) out.push('[img]' + u); }
        return;
      }
      for (var k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType === 3) { if (/\S/.test(k.nodeValue)) para(out, k.nodeValue); }
        else visit(k);
      }
    }
    visit(root);
    return out;
  }
  function fromHtml(html) {
    var d = new DOMParser().parseFromString(html, 'text/html');   // documento aparte: no carga imágenes ni ejecuta nada
    return fromNode(d.body, []);
  }
  function splitText(s) {
    var a = String(s).split(/\r?\n+/), out = [];
    for (var i = 0; i < a.length; i++) para(out, a[i]);
    return out;
  }
  function looksHtml(s) { return /<\/?(p|div|br|h[1-6]|span|em|strong|i|b|img|hr|blockquote|ul|ol|li)\b[^>]*>/i.test(s); }

  // ── ProseMirror / TipTap → párrafos ──
  function fromPM(doc) {
    var out = [];
    function inline(n) {
      if (!n) return '';
      if (n.type === 'text') return n.text || '';
      if (n.type === 'hardBreak' || n.type === 'hard_break') return '\n';
      var s = '', c = n.content || [];
      for (var i = 0; i < c.length; i++) s += inline(c[i]);
      return s;
    }
    function block(n) {
      if (!n) return;
      var t = n.type, c = n.content || [], i;
      if (t === 'paragraph') {
        para(out, inline(n));
        for (i = 0; i < c.length; i++) if (c[i] && c[i].type === 'image') block(c[i]);
      } else if (t === 'heading') {
        var h = norm(inline(n)); if (h) out.push('## ' + h);
      } else if (t === 'horizontalRule' || t === 'horizontal_rule') {
        out.push('* * *');
      } else if (t === 'image') {
        var a = n.attrs || {}, src = a.src || a.url || '';
        if (/^https?:/.test(src)) out.push('[img]' + src);
      } else {
        for (i = 0; i < c.length; i++) block(c[i]);
      }
    }
    block(doc);
    return out;
  }

  // ── Cualquier valor → párrafos ──
  function toParas(v) {
    var out = [], i, p, q;
    if (v === null || v === undefined) return out;
    if (typeof v === 'string') {
      if (/^\s*[\[{]/.test(v)) { try { return toParas(JSON.parse(v)); } catch (e) {} }
      return looksHtml(v) ? fromHtml(v) : splitText(v);
    }
    if (typeof v !== 'object' || v.nodeType) return out;
    if (Array.isArray(v)) {
      for (i = 0; i < v.length; i++) { p = toParas(v[i]); for (q = 0; q < p.length; q++) out.push(p[q]); }
      return out;
    }
    if (v.type && Array.isArray(v.content)) return fromPM(v);
    if (Array.isArray(v.ops)) {                                   // Quill delta
      var buf = '';
      for (i = 0; i < v.ops.length; i++) { var ins = v.ops[i] && v.ops[i].insert; if (typeof ins === 'string') buf += ins; }
      return splitText(buf);
    }
    var k = v.html || v.content || v.text || v.body || v.value || v.paragraph;
    return (k !== null && k !== undefined && k !== v) ? toParas(k) : out;
  }

  // ── Estado de React ──
  var best = null, bestLen = 0, pages = null;
  var seen = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function isPages(l) {
    return Array.isArray(l) && l.length > 0 && l.every(function (p) {
      return p && typeof p.imageUrl === 'string' && /^https?:/.test(p.imageUrl) && typeof p.number === 'number' && typeof p.chapterId === 'number';
    });
  }
  function consider(val) {
    var ps = toParas(val), len = sumLen(ps);
    if (len >= MIN && len > bestLen) { best = ps; bestLen = len; }
  }
  function scanVal(v, depth) {
    if (budget-- < 0 || v === null || typeof v !== 'object' || depth > 6 || v.nodeType || v === window) return;
    if (seen) { if (seen.has(v)) return; seen.add(v); }
    if (isPages(v)) { if (!pages || v.length > pages.length) pages = v; return; }
    if (Array.isArray(v)) { for (var i = 0; i < v.length && i < 200; i++) scanVal(v[i], depth + 1); return; }
    var keys;
    try { keys = Object.keys(v); } catch (e) { return; }
    for (var j = 0; j < keys.length; j++) {
      var val;
      try { val = v[keys[j]]; } catch (e2) { continue; }
      if (KEYS[keys[j].toLowerCase()] && (typeof val === 'string' || (val && typeof val === 'object'))) consider(val);
      if (val && typeof val === 'object') scanVal(val, depth + 1);
    }
  }
  function walk(f) {
    for (; f; f = f.sibling) {
      for (var h = f.memoizedState; h && typeof h === 'object' && 'next' in h && 'queue' in h; h = h.next) {
        var ms = h.memoizedState;
        if (typeof ms === 'string') { if (ms.length >= 400) consider(ms); }   // useState('<p>…</p>')
        else scanVal(ms, 0);
      }
      if (f.memoizedProps && typeof f.memoizedProps === 'object') scanVal(f.memoizedProps, 4);
      if (f.child) walk(f.child);
      if (budget < 0) return;
    }
  }
  function scanRoot(el) {
    if (!el) return;
    var ks = Object.keys(el);
    for (var k = 0; k < ks.length; k++) {
      if (ks[k].indexOf('__reactContainer$') === 0) {
        var fb = el[ks[k]];
        walk(fb.stateNode && fb.stateNode.current || fb);
      }
    }
  }

  // ── DOM: el contenedor con más texto en <p> ──
  function fromDom() {
    var list = [].slice.call(document.querySelectorAll('article, main, section, [class*="prose"], [class*="chapter"], [class*="content"], [class*="reader"], [class*="novel"], [id*="chapter"], [id*="content"], [id*="reader"]'));
    if (document.body) list.push(document.body);
    var items = [], top = 0, i, j;
    for (i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && el.closest('nav, header, footer, aside')) continue;
      var ps = el.getElementsByTagName('p'), score = 0;
      for (j = 0; j < ps.length; j++) score += (ps[j].textContent || '').length;
      if (score < MIN) continue;
      items.push({ el: el, score: score, size: el.getElementsByTagName('*').length });
      if (score > top) top = score;
    }
    var pick = null;
    for (i = 0; i < items.length; i++) {
      if (items[i].score >= top * 0.97 && (!pick || items[i].size < pick.size)) pick = items[i];   // el más específico
    }
    return pick ? fromNode(pick.el, []) : null;
  }

  // ── Flujo ──
  var tries = window.__wfTry = (window.__wfTry || 0) + 1;

  // 0) Estructura conocida de las novelas de Capibara: <article class="nr-article"><p>…</p>…</article>
  var art = document.querySelector('article.nr-article');
  if (art) {
    var ap = fromNode(art, []);
    if (ap.length && sumLen(ap) >= MIN) return stable(sumLen(ap)) ? ap : null;
  }

  var roots = [document, document.documentElement, document.getElementById('root'), document.getElementById('__next'),
               document.getElementById('app'), document.body];
  var bc = document.body ? document.body.children : [];
  for (var b = 0; b < bc.length; b++) roots.push(bc[b]);
  for (var r = 0; r < roots.length && !best && !pages; r++) scanRoot(roots[r]);
  if (!best && !pages && tries > 10) {                       // respaldo caro: todos los elementos
    var all = document.querySelectorAll('*');
    for (var a = 0; a < all.length && !best && !pages; a++) scanRoot(all[a]);
  }

  if (best) return stable(sumLen(best)) ? best : null;       // 1) texto en el estado de React

  if (pages) {                                               // 2) capítulo de imágenes
    var u = pages.map(function (p) { return '[img]' + p.imageUrl; });
    if (u.length > 1) {
      var same = true;
      for (var x = 1; x < u.length; x++) if (u[x] !== u[0]) { same = false; break; }
      if (same) return null;                                 // placeholders todavía
    }
    return u;
  }

  var dom = fromDom();                                       // 3) DOM
  if (dom) return stable(sumLen(dom)) ? dom : null;

  if (tries > 15) {                                          // último recurso: texto plano del contenedor
    var m = document.querySelector('article, main, [class*="prose"]');
    var tx = m ? (m.innerText || '') : '';
    if (tx.length > 300) { var ls = splitText(tx); return stable(sumLen(ls)) ? ls : null; }
  }
  return null;
}

// TEXT_JS escrito a mano (ES5, una sola línea, sin comentarios), igual que PAGES_JS, que sí funciona.
// Antes se generaba con extractText.toString(): Rhino "descompila" la función y ese texto puede salir distinto/roto.
var TEXT_JS = [
  "(function(){",
  "var MIN=60;",
  "function nm(s){return String(s).replace(/\\u00a0/g,' ').replace(/[ \\t\\r\\f\\v]+/g,' ').replace(/^\\s+|\\s+$/g,'');}",
  "function tx(e){var s='',c=e.firstChild;for(;c;c=c.nextSibling){if(c.nodeType===3)s+=c.nodeValue;else if(c.nodeType===1){if(c.tagName==='BR')s+='\\n';else s+=tx(c);}}return s;}",
  "function lines(root){var o=[],els=root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,hr,img');",
  "for(var i=0;i<els.length;i++){var e=els[i],t=e.tagName;",
  "if(t==='HR'){o.push('* * *');continue;}",
  "if(t==='IMG'){var u=e.src||e.getAttribute('data-src')||'';if(/^https?:/.test(u)&&!e.closest('p'))o.push('[img]'+u);continue;}",
  "var x=nm(tx(e));if(!x)continue;",
  "if(t!=='P'){o.push('## '+x);continue;}",
  "o.push(/^([*\\u2022\\u00b7~#=_-]\\s*){3,}$/.test(x)?'* * *':x);",
  "var im=e.getElementsByTagName('img');for(var k=0;k<im.length;k++){var u2=im[k].src;if(/^https?:/.test(u2))o.push('[img]'+u2);}}",
  "return o;}",
  "function len(a){var n=0;for(var i=0;i<a.length;i++)n+=a[i].length;return n;}",
  "var root=document.querySelector('article.nr-article');",
  "if(!root){var best=null,bl=0,c=document.querySelectorAll('article,main,section,div');",
  "for(var i=0;i<c.length;i++){if(c[i].closest&&c[i].closest('nav,header,footer,aside'))continue;",
  "var ps=c[i].getElementsByTagName('p'),sc=0;for(var j=0;j<ps.length;j++)sc+=(ps[j].textContent||'').length;",
  "var sz=c[i].getElementsByTagName('*').length;",
  "if(sc>=MIN&&(sc>bl*1.03||(sc>=bl*0.97&&best&&sz<best.sz))){best={e:c[i],sz:sz};bl=Math.max(sc,bl);}}",
  "if(best)root=best.e;}",
  "if(!root)return null;",
  "var out=lines(root),n=len(out);",
  "if(out.length===0||n<MIN)return null;",
  "if(window.__wfPrev!==n){window.__wfPrev=n;return null;}",
  "return out;",
  "})()"
].join("");

// ── Camino rápido: HTTP plano (sin WebView) ──
// Si el capítulo ya viene en el HTML del servidor (<article class="nr-article">), se lee con una sola petición
// (~0,2–0,5 s en vez de cargar un WebView). Si no viene (render solo en cliente) o hay Cloudflare, cae al WebView.
function absUrl(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return ORIGIN + u;
  return "";
}
function attrOf(tag, name) {
  var m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  return m ? (str(m[1]) || str(m[2])) : "";
}
function htmlToText(h) {
  var t = str(h).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  t = util.htmlDecode(t).replace(/\u00a0/g, " ");
  return t.replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/^\s+|\s+$/g, "");
}
var SCENE_RX = /^([*\u2022\u00b7~#=_\-]\s*){3,}$/;

function parseArticle(html) {
  var m = /<article\b[^>]*class="[^"]*\bnr-article\b[^"]*"[^>]*>([\s\S]*?)<\/article>/i.exec(str(html));
  if (!m) return null;
  var body = m[1], out = [], t, i;
  var re = /<p\b[^>]*>([\s\S]*?)<\/p>|<h([1-6])\b[^>]*>([\s\S]*?)<\/h\2>|<hr\b[^>]*>|<img\b[^>]*>/gi;
  while ((t = re.exec(body)) !== null) {
    var tag = t[0];
    if (/^<p\b/i.test(tag)) {
      var inner = str(t[1]), txt = htmlToText(inner);
      if (txt) out.push(SCENE_RX.test(txt) ? "* * *" : txt);
      var imgs = inner.match(/<img\b[^>]*>/gi) || [];
      for (i = 0; i < imgs.length; i++) {
        var u = absUrl(attrOf(imgs[i], "src") || attrOf(imgs[i], "data-src"));
        if (u) out.push("[img]" + u);
      }
    } else if (/^<h[1-6]/i.test(tag)) {
      var h = htmlToText(t[3]);
      if (h) out.push("## " + h);
    } else if (/^<hr/i.test(tag)) {
      out.push("* * *");
    } else {
      var u2 = absUrl(attrOf(tag, "src") || attrOf(tag, "data-src"));
      if (u2) out.push("[img]" + u2);
    }
  }
  return out;
}

function paragraphsFromHttp(url) {
  try {
    var html = http.get(url, { "Accept": "text/html,application/xhtml+xml", "Referer": BASE + "/" });
    if (!html || html.length < 200) return null;
    var ps = parseArticle(html);
    if (!ps || !ps.length) return null;
    var n = 0;
    for (var i = 0; i < ps.length; i++) n += ps[i].length;
    return n >= 80 ? ps : null;
  } catch (e) { return null; }
}

var paragraphs = function (chapterUrl, referer) {
  if (CONFIG.novelHttp !== false) {            // "novelHttp": false en el index.json lo desactiva
    var fast = paragraphsFromHttp(chapterUrl);
    if (fast) { log("paragraphs HTTP OK: " + fast.length + " parrafos · " + chapterUrl); return fast; }
    log("paragraphs HTTP sin article.nr-article (status " + http.status() + "), paso al WebView · " + chapterUrl);
  }
  var o = readChapter(chapterUrl);
  var raw = JSON.stringify(o.t === "text" ? o.v : o.v.map(function (u) { return "[img]" + u; }));
  var arr = JSON.parse(raw);
  if (Object.prototype.toString.call(arr) !== "[object Array]") {
    throw new Error("El WebView devolvió un formato inesperado.");
  }
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var t = str(arr[i]).replace(/^\s+|\s+$/g, "");
    if (t) out.push(t);
  }
  if (out.length === 0) throw new Error("El capítulo no tiene texto.");
  return out;
};
