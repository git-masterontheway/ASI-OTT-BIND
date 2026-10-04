const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;
const PROD_DOMAIN = process.env.APP_DOMAIN || 'https://asiott.xo.je';

// Trust proxy for secure cookies, client IP, and HTTPS reverse proxy (Vercel / Cloudflare / Nginx)
app.enable('trust proxy');

// Production CORS Configuration
const allowedOrigins = [
  'https://asiott.xo.je',
  'https://www.asiott.xo.je',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive fallback for seamless client aggregation
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Path to independent IP view counter database
// On Vercel (read-only filesystem except /tmp), use /tmp if in Vercel environment
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'asi_data') : path.join(__dirname, 'data');
const VIEWS_FILE = path.join(DATA_DIR, 'views.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not create data dir:', e.message);
  }
}

function getViewsDb() {
  try {
    if (!fs.existsSync(VIEWS_FILE)) {
      fs.writeFileSync(VIEWS_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    const raw = fs.readFileSync(VIEWS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('Error reading views DB:', err.message);
    return {};
  }
}

function saveViewsDb(data) {
  try {
    fs.writeFileSync(VIEWS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving views DB:', err.message);
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

/**
 * Map file, video, and stream URLs to their authoritative referer domain to satisfy CDN hotlinking checks
 */
function getRefererForUrl(targetUrl) {
  if (!targetUrl) return 'https://hdwall.xyz/';
  try {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase();
    if (host.includes('acek-cdn') || host.includes('m4uplay') || host.includes('morenci') || host.includes('morencl')) {
      return 'https://m4uplay.quest/';
    }
    if (host.includes('movies4u') || host.includes('m4ulinks')) {
      return 'https://new1.movies4u.garden/';
    }
    if (host.includes('filesdl') || host.includes('awssspp') || host.includes('a4udia')) {
      return 'https://new1.filesdl.in/';
    }
    if (host.includes('hubcdn.io') || host.includes('hdwall.xyz')) {
      return 'https://hdwall.xyz/';
    }
    if (host.includes('gamerxyt')) {
      return 'https://hubcloud.ist/';
    }
    if (host.includes('hubcloud') || host.includes('gpdl') || host.includes('rohitkiskk') || host.includes('hbplay')) {
      return 'https://gamerxyt.com/';
    }
    if (host.includes('r2.cloudflarestorage') || host.includes('pixeldrain') || host.includes('fuckingfast')) {
      return 'https://hubcloud.ist/';
    }
    if (host.includes('microtv') || host.includes('xdl.my.id') || host.includes('playmate') || host.includes('r2.dev')) {
      return 'https://new.microtv.st/';
    }
    return `${u.protocol}//${u.host}/`;
  } catch (e) {
    return 'https://hdwall.xyz/';
  }
}

/**
 * Fetch a URL navigating through redirects (301, 302, 307, 308) while setting the correct authoritative Referer at each hop
 */
async function fetchWithRefererRedirect(url, baseHeaders = {}, maxRedirects = 5) {
  let curUrl = url;
  let hops = 0;
  while (hops < maxRedirects) {
    const referer = getRefererForUrl(curUrl);
    let origin;
    try {
      origin = new URL(referer).origin;
    } catch (e) {
      origin = 'https://hdwall.xyz';
    }

    const headers = {
      ...baseHeaders,
      'User-Agent': COMMON_HEADERS['User-Agent'],
      'Referer': referer,
      'Origin': origin
    };

    const res = await fetch(curUrl, {
      headers,
      redirect: 'manual'
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (loc) {
        curUrl = loc.startsWith('http') ? loc : new URL(loc, curUrl).href;
        hops++;
        continue;
      }
    }
    return { response: res, finalUrl: curUrl };
  }
  return { response: await fetch(curUrl, { headers: { ...baseHeaders, 'User-Agent': COMMON_HEADERS['User-Agent'] } }), finalUrl: curUrl };
}

// ---------------------------------------------------------------------------
// Link Resolver Helpers & In-Memory Cache (HubCloud & HubCDN Multi-Cloud Resolution)
// ---------------------------------------------------------------------------
const RESOLVER_CACHE = new Map();
const RESOLVER_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolves a HubCloud link (e.g., https://hubcloud.ist/drive/...)
 * Returns { cloudDirect, directDownload, hdCloud, streamUrl }
 */
async function resolveHubCloudLink(hubCloudUrl) {
  if (!hubCloudUrl) return null;
  const cached = RESOLVER_CACHE.get(hubCloudUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const res = await fetch(hubCloudUrl, {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const genMatch = html.match(/<a[^>]+href=["'](https?:\/\/gamerxyt\.com\/hubcloud\.php[^"']+)["']/i);
    if (!genMatch) return null;

    const gamerUrl = genMatch[1];
    const gRes = await fetch(gamerUrl, {
      headers: { ...COMMON_HEADERS, 'Referer': hubCloudUrl }
    });
    if (!gRes.ok) return null;
    const gHtml = await gRes.text();

    const r2Match = gHtml.match(/href=["'](https?:\/\/[^"'\s<>]*\.r2\.cloudflarestorage\.com\/hub\/[^"']+)["']/i);
    const server10GbpsMatch = gHtml.match(/href=["'](https?:\/\/[^"'\s<>]*hubcloud\.ist\/\?[^"']+)["']/i) ||
      gHtml.match(/href=["'](https?:\/\/pixeldrain\.dev\/u\/[^"']+)["']/i);
    const watchMatch = gHtml.match(/href=["'](https?:\/\/hbplay\.pages\.dev\/\?u=([^"'\s&]+)[^"']*)["']/i);

    let streamUrl = null;
    if (watchMatch && watchMatch[2]) {
      try {
        streamUrl = Buffer.from(watchMatch[2], 'base64').toString('utf8');
      } catch (e) { }
    }

    const cloudDirect = r2Match ? r2Match[1].replace(/&amp;/g, '&') : null;
    const directDownload = server10GbpsMatch ? server10GbpsMatch[1] : cloudDirect;

    const result = {
      cloudDirect: cloudDirect || hubCloudUrl,
      directDownload: directDownload || hubCloudUrl,
      hdCloud: hubCloudUrl,
      streamUrl: streamUrl || cloudDirect
    };

    RESOLVER_CACHE.set(hubCloudUrl, { data: result, expiresAt: Date.now() + RESOLVER_TTL_MS });
    return result;
  } catch (e) {
    console.warn('Error in resolveHubCloudLink:', e.message);
    return null;
  }
}

/**
 * Resolves a HubCDN link (e.g. from HDWall https://hubcdn.io/cloud/...)
 * Returns { filesDlUrl, cloudDirect, directDownload, hdCloud, streamUrl }
 */
async function resolveHubCdnTier(hubCdnUrl) {
  if (!hubCdnUrl) return null;
  const cached = RESOLVER_CACHE.get(hubCdnUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const r1 = await fetch(hubCdnUrl, {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' }
    });
    if (!r1.ok) return null;
    const h1 = await r1.text();

    const targetMatch = h1.match(/var\s+targetUrl\s*=\s*["']([^"']+)["']/i) ||
      h1.match(/<textarea[^>]+id=["']downloadLinkBox["'][^>]*>([\s\S]*?)<\/textarea>/i);
    if (!targetMatch) return null;
    const filesDlUrl = targetMatch[1].trim();

    const r2 = await fetch(filesDlUrl, {
      headers: { ...COMMON_HEADERS, 'Referer': hubCdnUrl }
    });
    if (!r2.ok) return null;
    const h2 = await r2.text();

    const links = [...h2.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    let cloudDirect = null;
    let directDownload = null;
    let hubCloud = null;

    for (const l of links) {
      const href = l[1];
      const text = l[2].replace(/<[^>]+>/g, '').trim();

      if (text.includes('Cloud Direct') || href.includes('store/a4udia') || href.includes('r2.cloudflarestorage')) {
        cloudDirect = href;
      } else if (text.includes('Direct Download') || href.includes('zdownload.php') || href.includes('googleusercontent')) {
        directDownload = href;
      } else if (text.includes('HubCloud') || href.includes('hubcloud.ist')) {
        hubCloud = href;
      }
    }

    let extra = null;
    if (hubCloud) {
      extra = await resolveHubCloudLink(hubCloud);
    }

    const result = {
      filesDlUrl,
      cloudDirect: extra?.cloudDirect || cloudDirect || filesDlUrl,
      directDownload: directDownload || extra?.directDownload || filesDlUrl,
      hdCloud: hubCloud || hubCdnUrl,
      streamUrl: extra?.streamUrl || extra?.cloudDirect || cloudDirect
    };

    RESOLVER_CACHE.set(hubCdnUrl, { data: result, expiresAt: Date.now() + RESOLVER_TTL_MS });
    return result;
  } catch (err) {
    console.warn('Error in resolveHubCdnTier:', err.message);
    return null;
  }
}

/**
 * Extracts Movies4u Player Information (Designated embed and direct HLS stream)
 */
function extractM4uPlayer(m4uHtml, fileId) {
  let embedUrl = `https://morencius.com/embed/${fileId}`;
  let directStreamUrl = null;

  try {
    const evalMatch = m4uHtml.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
    if (evalMatch) {
      const unpacker = evalMatch[0].replace(/^eval/, '');
      const unpacked = eval(unpacker);

      const hls2Match = unpacked.match(/"hls2"\s*:\s*"([^"]+)"/i);
      const hls4Match = unpacked.match(/"hls4"\s*:\s*"([^"]+)"/i);
      if (hls2Match && hls2Match[1].startsWith('http')) {
        directStreamUrl = hls2Match[1].replace(/\\/g, '');
      } else if (hls4Match && hls4Match[1].startsWith('http')) {
        directStreamUrl = hls4Match[1].replace(/\\/g, '');
      }

      const embedDomainMatch = unpacked.match(/(?:https%3A%2F%2F|https:\/\/)(morencl[a-z0-9.]+|morenci[a-z0-9.]+)\/embed/i);
      if (embedDomainMatch) {
        embedUrl = `https://${embedDomainMatch[1]}/embed/${fileId}`;
      }
    }
  } catch (e) {
    console.warn('Error unpacking Movies4u player:', e.message);
  }

  return { embedUrl, directStreamUrl };
}

// Helper: Determine category from title and source
function detectCategory(title, source) {
  if (source === 'MicroTV') return 'Mini Drama';
  const clean = (title || '').toLowerCase();
  if (clean.includes('season') || clean.includes('s0') || clean.includes('s1') || clean.includes('s2') ||
    clean.includes('complete series') || clean.includes('completed web') || clean.includes('web series') ||
    clean.includes('episode')) {
    return 'Web Series';
  }
  return 'Movies';
}

// Clean HTML titles
function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&#[a-zA-Z0-9]+;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clean View Count Formatter (Eliminates emojis and formats cleanly: e.g. "3.2K views")
function formatViewCount(rawViews) {
  if (!rawViews) return '1.5K views';
  const clean = String(rawViews).replace(/👁️/g, '').replace(/views/gi, '').trim();
  const numMatch = clean.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!numMatch) return '1.5K views';
  const num = parseFloat(numMatch[1]);
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M views`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K views`;
  return `${num} views`;
}

// ---------------------------------------------------------------------------
// 1. SOURCE: new.microtv.st (Mini Drama / Reels)
// ---------------------------------------------------------------------------
function parseMicroTvCards(html) {
  const cards = [];
  const cardRegex = /<div\s+class=["']post-card["']>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const cardHtml = match[1];
    const linkMatch = cardHtml.match(/<a\s+[^>]*href=["']https?:\/\/new\.microtv\.st\/post\/([a-zA-Z0-9_-]+)["']/i) ||
      cardHtml.match(/<a\s+[^>]*href=["']\/post\/([a-zA-Z0-9_-]+)["']/i);
    const slug = linkMatch ? linkMatch[1] : null;

    const imgMatch = cardHtml.match(/<img[^>]+?\bsrc=["']([^"']+)["']/i);
    const thumbnail = imgMatch ? imgMatch[1] : '';

    const h3Match = cardHtml.match(/<h3>([\s\S]*?)<\/h3>/i);
    const altMatch = cardHtml.match(/alt=["']([^"']+)["']/i);
    let title = h3Match ? h3Match[1].trim() : (altMatch ? altMatch[1].trim() : '');
    title = cleanTitle(title);

    const viewsMatch = cardHtml.match(/<div\s+class=["']views["']>([\s\S]*?)<\/div>/i) ||
      cardHtml.match(/<span\s+class=["']views["']>([\s\S]*?)<\/span>/i) ||
      cardHtml.match(/👁️\s*([0-9,]+)\s*views/i);
    const rawViews = viewsMatch ? viewsMatch[1].replace(/<[^>]+>/g, '').trim() : '1800';
    const views = formatViewCount(rawViews);

    if (slug) {
      cards.push({
        id: `microtv_${slug}`,
        slug,
        title: title || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        thumbnail,
        views,
        source: 'MicroTV',
        category: 'Mini Drama',
        quality: 'HD Stream'
      });
    }
  }

  return cards;
}

function parsePagination(html, requestedPage) {
  const pageMatch = html.match(/<div class=["']pagination["']>([\s\S]*?)<\/div>/i);
  const curPage = parseInt(requestedPage, 10) || 1;

  if (!pageMatch) {
    return {
      currentPage: curPage,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      pages: [1]
    };
  }

  const pagHtml = pageMatch[1];
  const pageNumbers = new Set();
  const numMatches = [...pagHtml.matchAll(/href=["'][^"']*[?&]page=([0-9]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  numMatches.forEach(m => {
    const num = parseInt(m[1], 10);
    if (!isNaN(num)) pageNumbers.add(num);
  });

  const activeMatch = pagHtml.match(/<a[^>]+class=["'][^"']*active[^"']*["'][^>]*>([0-9]+)<\/a>/i);
  const activePage = activeMatch ? parseInt(activeMatch[1], 10) : curPage;
  pageNumbers.add(activePage);

  const sortedPages = Array.from(pageNumbers).sort((a, b) => a - b);
  const totalPages = sortedPages.length > 0 ? Math.max(...sortedPages) : activePage;

  return {
    currentPage: activePage,
    totalPages,
    hasNext: activePage < totalPages || pagHtml.includes('Next »'),
    hasPrev: activePage > 1 || pagHtml.includes('« Previous'),
    pages: sortedPages
  };
}

// ---------------------------------------------------------------------------
// 2. SOURCE: new1.movies4u.garden (Movies & Series)
// ---------------------------------------------------------------------------
async function fetchMovies4uSearch(query) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://new1.movies4u.garden/lookup.php?q=${encodeURIComponent(query)}`, {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://new1.movies4u.garden/' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.hits)) return [];

    return data.hits.map(hit => {
      // Extract clean slug from permalink (handles both absolute and relative URLs)
      let slug = '';
      if (hit.permalink) {
        slug = hit.permalink.replace(/^https?:\/\/[^\/]+/i, '').replace(/^\/+|\/+$/g, '');
      }
      if (!slug && hit.id) {
        slug = String(hit.id);
      }

      const title = cleanTitle(hit.post_title);
      const cat = detectCategory(title, 'Movies4u');
      return {
        id: `m4u_${slug || hit.id}`,
        slug: slug || String(hit.id),
        permalink: hit.permalink,
        title,
        thumbnail: hit.post_thumbnail || '',
        views: '2.5k views',
        source: 'Movies4u',
        category: cat,
        quality: hit.movie_quality || '1080p | 720p | 480p'
      };
    });
  } catch (err) {
    console.warn('Movies4u search warning:', err.message);
    return [];
  }
}

async function fetchMovies4uHome() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://new1.movies4u.garden/', {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://new1.movies4u.garden/' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();
    const articles = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)];
    const items = [];

    articles.forEach((art, idx) => {
      const artHtml = art[1];
      const linkMatch = artHtml.match(/<a\s+[^>]*href=["'](https?:\/\/new1\.movies4u\.garden\/[^"']+)["']/i);
      if (!linkMatch) return;

      const permalink = linkMatch[1];
      let slug = '';
      try {
        const u = new URL(permalink);
        slug = u.pathname.replace(/^\/|\/$/g, '');
      } catch (e) {
        slug = permalink.replace(/^https?:\/\/[^\/]+\/|\/$/g, '');
      }

      // Title & Quality from aria-label or h2
      const ariaMatch = artHtml.match(/aria-label=["']([^"']+)["']/i);
      const h2Match = artHtml.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/i);
      let title = ariaMatch ? ariaMatch[1] : (h2Match ? h2Match[1] : slug);
      title = cleanTitle(title);

      // Quality
      let quality = '1080p | 720p | 480p';
      const qMatch = title.match(/(480p\s*\|\s*720p\s*\|\s*1080p|1080p|720p|480p|HDRip|PreDvD|HQ-HDTC)/i);
      if (qMatch) {
        quality = qMatch[1];
      }

      // Image
      const imgMatch = artHtml.match(/src=["']([^"']+)["']/i);
      let thumbnail = imgMatch ? imgMatch[1] : '';

      const cat = detectCategory(title, 'Movies4u');
      items.push({
        id: `m4u_${slug || idx}`,
        slug,
        permalink,
        title,
        thumbnail,
        views: `${(Math.floor(Math.random() * 20) + 10) / 10}k views`,
        source: 'Movies4u',
        category: cat,
        quality
      });
    });

    return items;
  } catch (err) {
    console.warn('Movies4u home warning:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. SOURCE: hdwall.xyz (HDHub4u Mirror)
// ---------------------------------------------------------------------------
async function fetchHdwallSearch(query) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const searchUrl = `https://hdwall.xyz/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();
    return parseHdwallHtml(html);
  } catch (err) {
    console.warn('HDWall search warning:', err.message);
    return [];
  }
}

async function fetchHdwallHome() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://hdwall.xyz/', {
      headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();
    return parseHdwallHtml(html);
  } catch (err) {
    console.warn('HDWall home warning:', err.message);
    return [];
  }
}

function parseHdwallHtml(html) {
  const items = [];
  const thumbs = [...html.matchAll(/<li\s+class=["'][^"']*thumb[^"']*["']>([\s\S]*?)<\/li>/gi)];

  thumbs.forEach((t, idx) => {
    const tHtml = t[1];
    const linkMatch = tHtml.match(/<a\s+[^>]*href=["'](https?:\/\/hdwall\.xyz\/[^"']+\.html)["']/i);
    if (!linkMatch) return;

    const permalink = linkMatch[1];
    let slug = '';
    try {
      const u = new URL(permalink);
      slug = u.pathname.replace(/^\/|\/$/g, '');
    } catch (e) {
      slug = permalink.replace(/^https?:\/\/[^\/]+\/|\/$/g, '');
    }

    const imgMatch = tHtml.match(/src=["']([^"']+)["']/i);
    let thumbnail = imgMatch ? imgMatch[1] : '';
    if (thumbnail.startsWith('/')) {
      thumbnail = `https://hdwall.xyz${thumbnail}`;
    }

    const figMatch = tHtml.match(/<figcaption>[\s\S]*?<p>([\s\S]*?)<\/p>[\s\S]*?<\/figcaption>/i) ||
      tHtml.match(/alt=["']([^"']+)["']/i) ||
      tHtml.match(/title=["']([^"']+)["']/i);
    let title = figMatch ? figMatch[1] : slug;
    title = cleanTitle(title);

    let quality = '1080p | 720p | 480p';
    const qMatch = title.match(/(480p|720p|1080p|2160p|4k|PreDvD|HEVC|HDRip|BluRay)/i);
    if (qMatch) {
      quality = qMatch[1];
    }

    const cat = detectCategory(title, 'HDWall');
    items.push({
      id: `hdwall_${slug.replace(/\.html$/, '')}`,
      slug,
      permalink,
      title,
      thumbnail,
      views: `${(Math.floor(Math.random() * 30) + 15) / 10}k views`,
      source: 'HDWall',
      category: cat,
      quality
    });
  });

  return items;
}

// ---------------------------------------------------------------------------
// 4. API: Unified Content Aggregation Endpoint (Homepage)
// ---------------------------------------------------------------------------
app.get('/api/content', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const categoryFilter = (req.query.category || 'all').toLowerCase();

  try {
    let allItems = [];
    let pagination = {
      currentPage: page,
      totalPages: 10,
      hasNext: true,
      hasPrev: page > 1,
      pages: [1, 2, 3, 4, 5]
    };

    // Parallel fetch from MicroTV, Movies4u, and HDWall
    const microTvUrl = page > 1 ? `https://new.microtv.st/?page=${page}` : 'https://new.microtv.st/';
    const [microRes, m4uItems, hdwallItems] = await Promise.allSettled([
      fetch(microTvUrl, { headers: { ...COMMON_HEADERS, 'Referer': 'https://new.microtv.st/' } }),
      page === 1 ? fetchMovies4uHome() : Promise.resolve([]),
      page === 1 ? fetchHdwallHome() : Promise.resolve([])
    ]);

    let microItems = [];
    if (microRes.status === 'fulfilled' && microRes.value.ok) {
      const html = await microRes.value.text();
      microItems = parseMicroTvCards(html);
      pagination = parsePagination(html, page);
    }

    const m4uList = m4uItems.status === 'fulfilled' ? m4uItems.value : [];
    const hdList = hdwallItems.status === 'fulfilled' ? hdwallItems.value : [];

    // Interleave releases across all three sources for rich variety on homepage
    if (page === 1) {
      const maxLen = Math.max(microItems.length, m4uList.length, hdList.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < microItems.length) allItems.push(microItems[i]);
        if (i < m4uList.length) allItems.push(m4uList[i]);
        if (i < hdList.length) allItems.push(hdList[i]);
      }
    } else {
      allItems = microItems;
    }

    // Apply category filtering if specified
    if (categoryFilter === 'mini_drama' || categoryFilter === 'mini drama' || categoryFilter === 'dramas') {
      allItems = allItems.filter(i => i.category === 'Mini Drama');
    } else if (categoryFilter === 'movies') {
      allItems = allItems.filter(i => i.category === 'Movies');
    } else if (categoryFilter === 'web_series' || categoryFilter === 'web series') {
      allItems = allItems.filter(i => i.category === 'Web Series');
    }

    res.json({
      success: true,
      page,
      count: allItems.length,
      category: categoryFilter,
      pagination,
      items: allItems
    });
  } catch (err) {
    console.error('Error fetching aggregated content:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch content from sources',
      message: err.message
    });
  }
});

// ---------------------------------------------------------------------------
// 5. API: Multi-Source Search Endpoint (Parallel query across all 3 domains)
// ---------------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  const categoryFilter = (req.query.category || 'all').toLowerCase();
  const page = parseInt(req.query.page, 10) || 1;

  if (!query) {
    return res.json({
      success: true,
      items: [],
      pagination: { currentPage: 1, totalPages: 1, pages: [1], hasNext: false, hasPrev: false }
    });
  }

  try {
    // 1. Query MicroTV search
    const microTvPromise = (async () => {
      const searchUrl = page > 1
        ? `https://new.microtv.st/?search=${encodeURIComponent(query)}&page=${page}`
        : `https://new.microtv.st/?search=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, { headers: { ...COMMON_HEADERS, 'Referer': 'https://new.microtv.st/' } });
      if (!response.ok) return [];
      const html = await response.text();
      return parseMicroTvCards(html);
    })();

    // 2. Query Movies4u internal JSON lookup
    const m4uPromise = fetchMovies4uSearch(query);

    // 3. Query HDWall search
    const hdwallPromise = fetchHdwallSearch(query);

    // Run all 3 queries concurrently
    const [microRes, m4uRes, hdwallRes] = await Promise.allSettled([
      microTvPromise,
      m4uPromise,
      hdwallPromise
    ]);

    const microResults = microRes.status === 'fulfilled' ? microRes.value : [];
    const m4uResults = m4uRes.status === 'fulfilled' ? m4uRes.value : [];
    const hdwallResults = hdwallRes.status === 'fulfilled' ? hdwallRes.value : [];

    console.log(`Search "${query}" counts: MicroTV=${microResults.length}, Movies4u=${m4uResults.length}, HDWall=${hdwallResults.length}`);

    // Aggregate results from all 3 sources
    let combined = [];
    const maxLen = Math.max(microResults.length, m4uResults.length, hdwallResults.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < microResults.length) combined.push(microResults[i]);
      if (i < m4uResults.length) combined.push(m4uResults[i]);
      if (i < hdwallResults.length) combined.push(hdwallResults[i]);
    }

    // Apply category filtering if requested
    if (categoryFilter === 'mini_drama' || categoryFilter === 'mini drama' || categoryFilter === 'dramas') {
      combined = combined.filter(i => i.category === 'Mini Drama');
    } else if (categoryFilter === 'movies') {
      combined = combined.filter(i => i.category === 'Movies');
    } else if (categoryFilter === 'web_series' || categoryFilter === 'web series') {
      combined = combined.filter(i => i.category === 'Web Series');
    }

    res.json({
      success: true,
      query,
      count: combined.length,
      category: categoryFilter,
      sources: {
        microtv: microResults.length,
        movies4u: m4uResults.length,
        hdwall: hdwallResults.length
      },
      pagination: {
        currentPage: page,
        totalPages: 1,
        pages: [1],
        hasNext: false,
        hasPrev: false
      },
      items: combined
    });
  } catch (err) {
    console.error('Error performing multi-source search:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to query search from source servers',
      message: err.message
    });
  }
});

// ---------------------------------------------------------------------------
// 6. API: Post Detail Endpoint (Universal for MicroTV, Movies4u, and HDWall)
// ---------------------------------------------------------------------------
app.get('/api/post', async (req, res) => {
  let slug = (req.query.slug || req.query.id || '').trim();
  let source = (req.query.source || '').trim();

  // If slug has source prefix (e.g. microtv_..., m4u_..., hdwall_...)
  if (slug.startsWith('microtv_')) {
    source = 'MicroTV';
    slug = slug.replace(/^microtv_/, '');
  } else if (slug.startsWith('m4u_')) {
    source = 'Movies4u';
    slug = slug.replace(/^m4u_/, '');
  } else if (slug.startsWith('hdwall_')) {
    source = 'HDWall';
    slug = slug.replace(/^hdwall_/, '');
  }

  if (!source) {
    // Detect by slug format or default to MicroTV
    if (slug.endsWith('.html')) source = 'HDWall';
    else if (slug.includes('drishyam') || slug.includes('movie') || slug.includes('series')) source = 'Movies4u';
    else source = 'MicroTV';
  }

  try {
    if (source === 'HDWall') {
      // ---------------- HDWall Detail Handler ----------------
      const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
      const postSlug = cleanSlug.endsWith('.html') ? cleanSlug : `${cleanSlug}.html`;
      let postUrl = `https://hdwall.xyz/${postSlug}`;
      let response = await fetch(postUrl, {
        headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' }
      });

      // If 404, attempt fallback search on HDWall
      if (!response.ok) {
        try {
          const searchStory = cleanSlug.replace(/\.html$/, '').replace(/[-_]/g, ' ');
          const searchUrl = `https://hdwall.xyz/index.php?do=search&subaction=search&story=${encodeURIComponent(searchStory)}`;
          const searchRes = await fetch(searchUrl, {
            headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' }
          });
          if (searchRes.ok) {
            const searchHtml = await searchRes.text();
            const items = parseHdwallHtml(searchHtml);
            if (items.length > 0) {
              const matched = items[0];
              const altSlug = matched.slug.endsWith('.html') ? matched.slug : `${matched.slug}.html`;
              const altRes = await fetch(`https://hdwall.xyz/${altSlug}`, {
                headers: { ...COMMON_HEADERS, 'Referer': 'https://hdwall.xyz/' }
              });
              if (altRes.ok) {
                response = altRes;
              }
            }
          }
        } catch (hdErr) {
          console.warn('HDWall 404 fallback search warning:', hdErr.message);
        }
      }

      if (!response.ok) {
        return res.status(404).json({ success: false, error: `HDWall item not found (HTTP ${response.status})` });
      }

      const html = await response.text();

      // Title
      const hTitleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = cleanTitle(hTitleMatch ? hTitleMatch[1] : slug);

      // Primary Poster
      const posterMatch = html.match(/<figure[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i) ||
        html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
      let poster = posterMatch ? posterMatch[1] : '';
      if (poster.startsWith('/')) poster = `https://hdwall.xyz${poster}`;

      // Extract quality downloads mapped to file sizes
      const links = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/hubcdn\.io\/cloud\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const qualities = [];
      let directStreamUrl = null;

      // Fast resolve first quality link to enable native on-site video playback if available
      if (links.length > 0) {
        try {
          const firstHubUrl = links[0][1];
          const resolvedFirst = await resolveHubCdnTier(firstHubUrl);
          if (resolvedFirst?.streamUrl) {
            directStreamUrl = resolvedFirst.streamUrl;
          }
        } catch (e) {
          console.warn('Pre-resolve HDWall stream warning:', e.message);
        }
      }

      for (const l of links) {
        const hubUrl = l[1];
        const text = cleanTitle(l[2]);
        const qMatch = text.match(/(480p|720p|1080p|2160p|4k)/i);
        const sMatch = text.match(/([0-9.]+\s*(?:MB|GB|Mb|Gb))/i);
        const q = qMatch ? qMatch[1].toLowerCase() : (qualities.length === 0 ? '480p' : (qualities.length === 1 ? '720p' : '1080p'));
        const s = sMatch ? sMatch[1].toUpperCase() : (q === '480p' ? '450MB' : (q === '720p' ? '1.2GB' : '2.9GB'));

        qualities.push({
          quality: q,
          size: s,
          hubUrl,
          cloudDirectUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=cloud_direct`,
          directDownloadUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=direct`,
          hdCloudUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=hd_cloud`
        });
      }

      // If no hubcdn links parsed, populate structured tiers
      if (qualities.length === 0) {
        const defaultTiers = [
          { quality: '480p', size: '450MB' },
          { quality: '720p', size: '1.2GB' },
          { quality: '1080p', size: '2.9GB' }
        ];
        defaultTiers.forEach(t => {
          qualities.push({
            quality: t.quality,
            size: t.size,
            hubUrl: postUrl,
            cloudDirectUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=cloud_direct`,
            directDownloadUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=direct`,
            hdCloudUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=hd_cloud`
          });
        });
      }

      // Standard Video Player Container setup across all aggregated items (no unplayable warning UI)
      return res.json({
        success: true,
        slug: postSlug,
        source: 'HDWall',
        category: detectCategory(title, 'HDWall'),
        title,
        poster,
        embedUrl: null,
        directStreamUrl,
        isPlayable: true,
        unplayableMessage: null,
        aspectRatio: 'theater',
        qualities,
        originalViews: '4.8K views',
        publishDate: 'Recent'
      });

    } else if (source === 'Movies4u') {
      // ---------------- Movies4u Detail Handler ----------------
      const postSlug = slug.replace(/^\/+|\/+$/g, '');
      let postUrl = /^\d+$/.test(postSlug)
        ? `https://new1.movies4u.garden/?p=${postSlug}`
        : `https://new1.movies4u.garden/${postSlug}/`;

      let response = await fetch(postUrl, {
        headers: { ...COMMON_HEADERS, 'Referer': 'https://new1.movies4u.garden/' },
        redirect: 'follow'
      });

      // Fallback: If 404, attempt lookup search via lookup.php to resolve the true permalink
      if (!response.ok) {
        try {
          const searchQuery = postSlug.replace(/[-_]/g, ' ');
          const lookupRes = await fetch(`https://new1.movies4u.garden/lookup.php?q=${encodeURIComponent(searchQuery)}`, {
            headers: { ...COMMON_HEADERS, 'Referer': 'https://new1.movies4u.garden/' }
          });
          if (lookupRes.ok) {
            const lookupData = await lookupRes.json();
            if (lookupData.ok && Array.isArray(lookupData.hits) && lookupData.hits.length > 0) {
              const hit = lookupData.hits[0];
              const hitSlug = (hit.permalink || '').replace(/^https?:\/\/[^\/]+/i, '').replace(/^\/+|\/+$/g, '');
              const altUrl = hitSlug ? `https://new1.movies4u.garden/${hitSlug}/` : `https://new1.movies4u.garden/?p=${hit.id}`;
              const altRes = await fetch(altUrl, {
                headers: { ...COMMON_HEADERS, 'Referer': 'https://new1.movies4u.garden/' },
                redirect: 'follow'
              });
              if (altRes.ok) {
                response = altRes;
              }
            }
          }
        } catch (fbErr) {
          console.warn('Movies4u 404 fallback lookup warning:', fbErr.message);
        }
      }

      if (!response.ok) {
        return res.status(404).json({ success: false, error: `Movies4u post not found (HTTP ${response.status})` });
      }

      const html = await response.text();

      // Title
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = cleanTitle(titleMatch ? titleMatch[1] : slug);

      // Primary Poster
      const posterMatch = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i) ||
        html.match(/<div class=["']post-thumbnail["'][\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
      const poster = posterMatch ? posterMatch[1] : '';

      // Watch Online link / embed / direct stream
      const watchMatch = html.match(/<a[^>]+href=["'](https?:\/\/m4uplay\.quest\/file\/([a-zA-Z0-9_-]+))["'][^>]*>[\s\S]*?Watch Online[\s\S]*?<\/a>/i);
      let embedUrl = null;
      let directStreamUrl = null;

      if (watchMatch) {
        const m4uPlayUrl = watchMatch[1];
        const fileId = watchMatch[2];
        try {
          const m4uRes = await fetch(m4uPlayUrl, { headers: { ...COMMON_HEADERS, 'Referer': postUrl } });
          const m4uText = await m4uRes.text();
          const playerInfo = extractM4uPlayer(m4uText, fileId);
          embedUrl = playerInfo.embedUrl;
          directStreamUrl = playerInfo.directStreamUrl;
        } catch (e) {
          console.warn('Movies4u embed resolve warning:', e.message);
          embedUrl = `https://morencius.com/embed/${fileId}`;
        }
      }

      // Download tiers: check for m4ulinks.site on post
      const qualities = [];
      const m4uLinksMatch = html.match(/https?:\/\/m4ulinks\.site\/number\/([0-9]+)/i);

      if (m4uLinksMatch) {
        try {
          const m4uLinksUrl = m4uLinksMatch[0];
          const mLinksRes = await fetch(m4uLinksUrl, { headers: { ...COMMON_HEADERS, 'Referer': postUrl } });
          if (mLinksRes.ok) {
            const mLinksHtml = await mLinksRes.text();
            // Parse download blocks: <h4>QUALITY [SIZE]</h4> ... <a href="https://hubcloud.ist/drive/...">
            const linkDivRegex = /<h4>([\s\S]*?)<\/h4>[\s\S]*?<a[^>]+href=["'](https?:\/\/hubcloud\.ist\/drive\/[^"']+)["']/gi;
            const seenTiers = new Set();
            let divMatch;
            while ((divMatch = linkDivRegex.exec(mLinksHtml)) !== null) {
              const rawHeading = cleanTitle(divMatch[1]);
              const hubUrl = divMatch[2];

              const qMatch = rawHeading.match(/(480p|720p|1080p|2160p|4k)/i);
              const sMatch = rawHeading.match(/([0-9.]+\s*(?:MB|GB|Mb|Gb))/i);
              const q = qMatch ? qMatch[1].toLowerCase() : (qualities.length === 0 ? '480p' : (qualities.length === 1 ? '720p' : '1080p'));
              const s = sMatch ? sMatch[1].toUpperCase() : (q === '480p' ? '450MB' : (q === '720p' ? '1.2GB' : '2.9GB'));

              const isHevc = /hevc/i.test(rawHeading);
              const label = isHevc ? `${q.toUpperCase()} (HEVC)` : q;

              if (!seenTiers.has(label) && qualities.length < 4) {
                seenTiers.add(label);
                qualities.push({
                  quality: label,
                  size: s,
                  hubUrl,
                  cloudDirectUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=cloud_direct`,
                  directDownloadUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=direct`,
                  hdCloudUrl: `/api/cloud-direct-download?hubUrl=${encodeURIComponent(hubUrl)}&title=${encodeURIComponent(title)}&quality=${q}&type=hd_cloud`
                });
              }
            }
          }
        } catch (mErr) {
          console.warn('Error parsing m4ulinks:', mErr.message);
        }
      }

      // If no m4ulinks parsed, populate structured tiers
      if (qualities.length === 0) {
        const defaultTiers = [
          { quality: '480p', size: '450MB' },
          { quality: '720p', size: '1.2GB' },
          { quality: '1080p', size: '2.9GB' }
        ];
        defaultTiers.forEach(t => {
          qualities.push({
            quality: t.quality,
            size: t.size,
            hubUrl: postUrl,
            cloudDirectUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=cloud_direct`,
            directDownloadUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=direct`,
            hdCloudUrl: `/api/cloud-direct-download?title=${encodeURIComponent(title)}&quality=${t.quality}&type=hd_cloud`
          });
        });
      }

      return res.json({
        success: true,
        slug: postSlug,
        source: 'Movies4u',
        category: detectCategory(title, 'Movies4u'),
        title,
        poster,
        embedUrl,
        directStreamUrl,
        isPlayable: true,
        unplayableMessage: null,
        aspectRatio: 'theater',
        qualities,
        originalViews: '3.9K views',
        publishDate: 'Recent'
      });

    } else {
      // ---------------- MicroTV Detail Handler ----------------
      const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
      const postUrl = `https://new.microtv.st/post/${encodeURIComponent(cleanSlug)}`;
      let response = await fetch(postUrl, {
        headers: { ...COMMON_HEADERS, 'Referer': 'https://new.microtv.st/' }
      });

      if (!response.ok) {
        try {
          const searchRes = await fetch(`https://new.microtv.st/search?q=${encodeURIComponent(cleanSlug.replace(/[-_]/g, ' '))}`, {
            headers: { ...COMMON_HEADERS, 'Referer': 'https://new.microtv.st/' }
          });
          if (searchRes.ok) {
            const searchHtml = await searchRes.text();
            const postMatch = searchHtml.match(/<a\s+[^>]*href=["'](?:https?:\/\/new\.microtv\.st)?\/post\/([^"']+)["']/i);
            if (postMatch) {
              const altRes = await fetch(`https://new.microtv.st/post/${encodeURIComponent(postMatch[1])}`, {
                headers: { ...COMMON_HEADERS, 'Referer': 'https://new.microtv.st/' }
              });
              if (altRes.ok) {
                response = altRes;
              }
            }
          }
        } catch (mErr) {
          console.warn('MicroTV 404 fallback search warning:', mErr.message);
        }
      }

      if (!response.ok) {
        return res.status(404).json({ success: false, error: `Series not found (HTTP ${response.status})` });
      }

      const html = await response.text();

      // Title
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const title = cleanTitle(titleMatch ? titleMatch[1] : slug);

      // Featured Poster
      const posterMatch = html.match(/<img[^>]+?\bsrc=["']([^"']+)["'][^>]*class=["'][^"']*featured-poster/i) ||
        html.match(/<img[^>]+class=["'][^"']*featured-poster[^"']*["'][^>]+?\bsrc=["']([^"']+)["']/i);
      const poster = posterMatch ? posterMatch[1] : '';

      // Video Embed Player iframe src
      const iframeMatch = html.match(/<div class=["']embed-player["'][\s\S]*?<iframe\s+[^>]*src=["']([^"']+)["']/i) ||
        html.match(/<iframe\s+[^>]*src=["']([^"']+)["']/i);
      const embedUrl = iframeMatch ? iframeMatch[1] : '';

      // Download PHP handler link
      const downloadMatch = html.match(/<a\s+[^>]*href=["'](https?:\/\/[^"']*download\.php[^"']*)["']/i);
      const downloadPhpUrl = downloadMatch ? downloadMatch[1] : '';

      // Pre-resolve direct stream & media file URL via Fast Cloud (FSL R2)
      let directStreamUrl = null;
      let actualMediaFileName = `${title}.mkv`;
      let mediaFileSize = null;

      if (downloadPhpUrl) {
        try {
          const body = new URLSearchParams();
          body.append('fast_cloud_r2_download', '1');
          const fslRes = await fetch(downloadPhpUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': COMMON_HEADERS['User-Agent'],
              'Referer': downloadPhpUrl
            },
            body: body.toString(),
            redirect: 'manual'
          });

          if (fslRes.status === 302 || fslRes.status === 301) {
            directStreamUrl = fslRes.headers.get('location');

            if (directStreamUrl) {
              try {
                const headRes = await fetch(directStreamUrl, { method: 'HEAD' });
                if (headRes.ok) {
                  const len = headRes.headers.get('content-length');
                  if (len) mediaFileSize = parseInt(len, 10);
                }
              } catch (e) { }
            }
          }
        } catch (e) { }
      }

      // Structure 3 Quality tiers mapped to sizes
      const qualities = [
        {
          quality: '480p',
          size: '450MB',
          cloudDirectUrl: directStreamUrl ? `/api/stream-download?url=${encodeURIComponent(directStreamUrl)}&filename=${encodeURIComponent(`${title}_480p.mkv`)}` : `/api/cloud-direct-download?downloadPhpUrl=${encodeURIComponent(downloadPhpUrl)}&title=${encodeURIComponent(title)}&quality=480p`,
          directDownloadUrl: directStreamUrl || downloadPhpUrl,
          hdCloudUrl: downloadPhpUrl
        },
        {
          quality: '720p',
          size: '1.2GB',
          cloudDirectUrl: directStreamUrl ? `/api/stream-download?url=${encodeURIComponent(directStreamUrl)}&filename=${encodeURIComponent(`${title}_720p.mkv`)}` : `/api/cloud-direct-download?downloadPhpUrl=${encodeURIComponent(downloadPhpUrl)}&title=${encodeURIComponent(title)}&quality=720p`,
          directDownloadUrl: directStreamUrl || downloadPhpUrl,
          hdCloudUrl: downloadPhpUrl
        },
        {
          quality: '1080p',
          size: '2.9GB',
          cloudDirectUrl: directStreamUrl ? `/api/stream-download?url=${encodeURIComponent(directStreamUrl)}&filename=${encodeURIComponent(`${title}_1080p.mkv`)}` : `/api/cloud-direct-download?downloadPhpUrl=${encodeURIComponent(downloadPhpUrl)}&title=${encodeURIComponent(title)}&quality=1080p`,
          directDownloadUrl: directStreamUrl || downloadPhpUrl,
          hdCloudUrl: downloadPhpUrl
        }
      ];

      res.json({
        success: true,
        slug,
        source: 'MicroTV',
        category: 'Mini Drama',
        title,
        poster,
        embedUrl,
        downloadPhpUrl,
        directStreamUrl,
        isPlayable: Boolean(directStreamUrl || embedUrl),
        aspectRatio: 'vertical', // 9:16 for MicroTV Reels
        actualMediaFileName,
        mediaFileSize,
        qualities,
        originalViews: '2.8K views',
        publishDate: 'Recent'
      });
    }
  } catch (err) {
    console.error('Error fetching post details:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch post details from source server',
      message: err.message
    });
  }
});

// ---------------------------------------------------------------------------
// 7. API: Cloud Direct Resolver (Initiates instant file download without ad popups or redirects)
// ---------------------------------------------------------------------------
app.get('/api/cloud-direct-download', async (req, res) => {
  const { hubUrl, downloadPhpUrl, quality = '1080p', type = 'cloud_direct' } = req.query;
  let title = req.query.title || 'ASI_OTT_Release';
  let filename = `${title.replace(/[/\\?%*:|"<>]/g, '_')}_${quality}.mkv`;

  try {
    let resolvedData = null;

    if (hubUrl) {
      if (hubUrl.includes('hubcdn.io')) {
        resolvedData = await resolveHubCdnTier(hubUrl);
      } else if (hubUrl.includes('hubcloud.ist')) {
        resolvedData = await resolveHubCloudLink(hubUrl);
      }
    }

    if (resolvedData) {
      if (type === 'direct') {
        // Button 2: Direct Download (High Speed 10Gbps)
        let directUrl = resolvedData.directDownload;
        if (directUrl && directUrl.includes('zdownload.php')) {
          try {
            const zRes = await fetch(directUrl, {
              headers: { ...COMMON_HEADERS, 'Referer': resolvedData.filesDlUrl || 'https://new1.filesdl.in/' },
              redirect: 'manual'
            });
            if (zRes.status === 302 || zRes.status === 301) {
              const googleCdn = zRes.headers.get('location');
              if (googleCdn) {
                return res.redirect(googleCdn);
              }
            }
          } catch (ze) {
            console.warn('zdownload redirect error:', ze.message);
          }
        }
        if (directUrl && directUrl.startsWith('http')) {
          return res.redirect(directUrl);
        }
      } else if (type === 'hd_cloud') {
        // Button 3: HD Cloud / HubCloud Mirror
        let hdUrl = resolvedData.hdCloud || hubUrl;
        if (hdUrl && hdUrl.startsWith('http')) {
          return res.redirect(hdUrl);
        }
      } else {
        // Button 1: Cloud Direct (Fast Cloudflare R2 / Server)
        let cloudUrl = resolvedData.cloudDirect || resolvedData.streamUrl;
        if (cloudUrl && cloudUrl.startsWith('http')) {
          return res.redirect(cloudUrl);
        }
      }
    }

    // MicroTV Fast Cloud R2 resolution
    if (downloadPhpUrl) {
      const body = new URLSearchParams();
      body.append('fast_cloud_r2_download', '1');
      const fslRes = await fetch(downloadPhpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': COMMON_HEADERS['User-Agent'],
          'Referer': downloadPhpUrl
        },
        body: body.toString(),
        redirect: 'manual'
      });

      if (fslRes.status === 302 || fslRes.status === 301) {
        const directFileUrl = fslRes.headers.get('location');
        if (directFileUrl) {
          return res.redirect(directFileUrl);
        }
      }
    }

    // Fallback direct file delivery
    res.redirect(`/api/stream-download?filename=${encodeURIComponent(filename)}`);
  } catch (err) {
    console.error('Error resolving Cloud Direct download:', err.message);
    res.redirect(`/api/stream-download?filename=${encodeURIComponent(filename)}`);
  }
});

// ---------------------------------------------------------------------------
// 8. API: Direct Stream Download (Clean stream with attachment header & referer injection)
// ---------------------------------------------------------------------------
app.get('/api/stream-download', async (req, res) => {
  const fileUrl = req.query.url;
  let filename = req.query.filename || 'ASI_OTT_Video.mkv';

  if (!fileUrl) {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'video/x-matroska');
    return res.send(`ASI OTT Stream: ${filename}`);
  }

  try {
    const { response: fileRes } = await fetchWithRefererRedirect(fileUrl);

    if (!fileRes.ok) {
      return res.status(fileRes.status).send(`Failed to stream download: HTTP ${fileRes.status}`);
    }

    const remoteDisp = fileRes.headers.get('content-disposition');
    if (remoteDisp) {
      const fnMatch = remoteDisp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
      if (fnMatch) {
        try {
          filename = decodeURIComponent(fnMatch[1]);
        } catch (e) {
          filename = fnMatch[1];
        }
      }
    }

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
    const contentLength = fileRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const nodeStream = Readable.fromWeb(fileRes.body);
    nodeStream.pipe(res);
  } catch (err) {
    console.error('Error streaming download:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Error streaming download: ' + err.message);
    }
  }
});

// ---------------------------------------------------------------------------
// 9. API: Video Streaming Proxy (Range Requests, Referer Injection & HLS Rewriter)
// ---------------------------------------------------------------------------
app.get('/api/stream-video', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send('Missing video URL');
  }

  try {
    const baseHeaders = {};
    if (req.headers.range) {
      baseHeaders['Range'] = req.headers.range;
    }

    const { response: videoRes, finalUrl } = await fetchWithRefererRedirect(videoUrl, baseHeaders);

    // If it's an HLS manifest (.m3u8), rewrite relative and absolute segment URLs so they proxy through /api/stream-video
    const contentType = videoRes.headers.get('content-type') || '';
    if (
      finalUrl.includes('.m3u8') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('audio/x-mpegurl')
    ) {
      const manifestText = await videoRes.text();
      const u = new URL(finalUrl);
      const basePath = u.origin + u.pathname.substring(0, u.pathname.lastIndexOf('/'));

      const rewritten = manifestText.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // If line is a directive with URI="...", rewrite the URI attribute
        if (trimmed.startsWith('#')) {
          return line.replace(/URI=["']([^"']+)["']/gi, (match, uriVal) => {
            const absUri = uriVal.startsWith('http')
              ? uriVal
              : (uriVal.startsWith('/') ? (u.origin + uriVal) : (basePath + '/' + uriVal));
            return `URI="/api/stream-video?url=${encodeURIComponent(absUri)}"`;
          });
        }

        // Line is a media playlist or segment URL
        const absUrl = trimmed.startsWith('http')
          ? trimmed
          : (trimmed.startsWith('/') ? (u.origin + trimmed) : (basePath + '/' + trimmed));
        return `/api/stream-video?url=${encodeURIComponent(absUrl)}`;
      }).join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(rewritten);
    }

    res.status(videoRes.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    for (const [key, value] of videoRes.headers.entries()) {
      if (['content-range', 'content-length', 'content-type', 'accept-ranges', 'content-disposition'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    const nodeStream = Readable.fromWeb(videoRes.body);
    nodeStream.pipe(res);
  } catch (err) {
    console.error('Error proxying video stream:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Error proxying video stream: ' + err.message);
    }
  }
});

// ---------------------------------------------------------------------------
// 10. API: Custom Analytics (Strict IP-Based View Counter)
// ---------------------------------------------------------------------------
app.post('/api/views/track', (req, res) => {
  const contentId = (req.body.id || '').trim();
  if (!contentId) {
    return res.status(400).json({ success: false, error: 'Content ID is required' });
  }

  const clientIp = getClientIp(req);
  const db = getViewsDb();

  if (!db[contentId]) {
    db[contentId] = { views: 0, ips: {} };
  }

  let isNewView = false;
  if (!db[contentId].ips[clientIp]) {
    db[contentId].ips[clientIp] = new Date().toISOString();
    db[contentId].views = (db[contentId].views || 0) + 1;
    isNewView = true;
    saveViewsDb(db);
  }

  res.json({
    success: true,
    contentId,
    views: db[contentId].views,
    clientIp,
    isNewView
  });
});

app.get('/api/views/get', (req, res) => {
  const contentId = (req.query.id || '').trim();
  if (!contentId) {
    return res.status(400).json({ success: false, error: 'Content ID is required' });
  }

  const db = getViewsDb();
  const views = db[contentId] ? db[contentId].views : 0;
  res.json({ success: true, contentId, views });
});

// Watch Page Route Handler
app.get('/watch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// Server listen on available port (only in standalone Node environment, not on Vercel)
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`===============================================`);
    console.log(`ASI OTT Server running at: http://localhost:${port}`);
    console.log(`Production Domain:         ${PROD_DOMAIN}`);
    console.log(`Home / Search:             http://localhost:${port}`);
    console.log(`Watch Page:                http://localhost:${port}/watch`);
    console.log(`===============================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

// If running directly via `node server.js`
if (require.main === module && !process.env.VERCEL) {
  startServer(DEFAULT_PORT);
}

module.exports = app;
