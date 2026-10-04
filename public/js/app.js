/**
 * ASI OTT - Multi-Source Content Aggregation Frontend
 * Backend API Base Configuration:
 * Directly connects to Vercel backend when hosted on custom domain (asiott.xo.je).
 */
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''
  : 'https://asiott.vercel.app';

// State
let allItems = [];
let currentPage = 1;
let currentPagination = null;
let currentSearchQuery = '';
let currentCategory = 'all';
let searchDebounceTimer = null;

// DOM Elements
const seriesGrid = document.getElementById('series-grid');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const searchSubmitBtn = document.getElementById('search-submit-btn');
const searchForm = document.getElementById('search-form');
const itemsCounter = document.getElementById('items-counter');
const sectionHeading = document.getElementById('section-heading');
const heroSpotlight = document.getElementById('hero-spotlight');
const heroBackdrop = document.getElementById('hero-backdrop');
const heroTitle = document.getElementById('hero-title');
const heroViews = document.getElementById('hero-views');
const heroSource = document.getElementById('hero-source');
const heroCategory = document.getElementById('hero-category');
const heroWatchBtn = document.getElementById('hero-watch-btn');
const heroQuickBtn = document.getElementById('hero-quick-btn');
const filterChips = document.querySelectorAll('.filter-chips .chip');
const categoryTabs = document.querySelectorAll('.category-tabs-wrapper .cat-tab');
const paginationWrapper = document.getElementById('pagination-wrapper');

/**
 * Toast Notification Helper
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Fetch Aggregated Content by Page & Category
 */
async function loadContentPage(page = 1, isInitial = false) {
  currentPage = page;
  
  // Show loading indicator
  seriesGrid.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
      <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2.5rem; color: var(--accent-primary); margin-bottom: 1rem;"></i>
      <p style="color: var(--text-muted); font-size: 1.05rem;">Aggregating titles from MicroTV, Movies4u & HDWall...</p>
    </div>
  `;
  itemsCounter.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Loading sources...`;

  try {
    let endpoint = '';
    const params = new URLSearchParams();
    if (page > 1) params.set('page', page);
    if (currentCategory && currentCategory !== 'all') params.set('category', currentCategory);

    if (currentSearchQuery) {
      params.set('q', currentSearchQuery);
      endpoint = `${API_BASE}/api/search?${params.toString()}`;
    } else {
      endpoint = `${API_BASE}/api/content?${params.toString()}`;
    }

    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to reach aggregation server`);
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.items)) {
      throw new Error(data.error || 'Invalid data received from server');
    }

    allItems = data.items;
    currentPagination = data.pagination;

    // Update Hero Spotlight on initial load if page 1
    if (page === 1 && !currentSearchQuery && allItems.length > 0) {
      setupHeroSpotlight(allItems[0]);
    }

    // Render Grid & Pagination
    renderSeriesGrid(allItems);
    renderPagination(currentPagination);

    // Update Section Headings & Counter
    const catLabel = currentCategory !== 'all' ? ` in ${currentCategory.toUpperCase().replace('_', ' ')}` : '';
    if (currentSearchQuery) {
      sectionHeading.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search Results for "${currentSearchQuery}"${catLabel}`;
      const srcMeta = data.sources ? ` (MicroTV: ${data.sources.microtv}, Movies4u: ${data.sources.movies4u}, HDWall: ${data.sources.hdwall})` : '';
      itemsCounter.textContent = `Found ${allItems.length} matching titles across all sources${srcMeta}`;
    } else {
      sectionHeading.innerHTML = `<i class="fa-solid fa-bolt"></i> Aggregated Latest Releases${catLabel}`;
      itemsCounter.textContent = `Displaying ${allItems.length} releases from MicroTV, Movies4u & HDWall`;
    }

    // Update Browser Query URL
    if (!isInitial) {
      const url = new URL(window.location.href);
      if (page > 1) url.searchParams.set('page', page);
      else url.searchParams.delete('page');

      if (currentCategory !== 'all') url.searchParams.set('category', currentCategory);
      else url.searchParams.delete('category');

      if (currentSearchQuery) url.searchParams.set('q', currentSearchQuery);
      else url.searchParams.delete('q');

      window.history.pushState({ page, category: currentCategory, q: currentSearchQuery }, '', url.toString());

      // Scroll to content section smoothly
      const section = document.getElementById('series-section');
      if (section && page > 1) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  } catch (err) {
    console.error('Aggregation fetch error:', err);
    seriesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: #f43f5e; margin-bottom: 1rem;"></i>
        <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">Unable to aggregate source content</h3>
        <p style="color: var(--text-muted); margin-bottom: 1.5rem;">${err.message}</p>
        <button class="btn btn-primary" onclick="loadContentPage(${page})"><i class="fa-solid fa-rotate-right"></i> Retry Aggregation</button>
      </div>
    `;
    itemsCounter.textContent = 'Error loading content';
    paginationWrapper.innerHTML = '';
    showToast('Failed to aggregate content from sources', 'error');
  }
}

/**
 * Setup Spotlight Banner
 */
function setupHeroSpotlight(item) {
  if (!item) return;

  heroSpotlight.style.display = 'flex';
  heroBackdrop.style.backgroundImage = `url('${item.thumbnail || ''}')`;
  heroTitle.textContent = item.title;
  
  let cleanViews = String(item.views || '1.5K')
    .replace(/👁️/g, '')
    .replace(/views/gi, '')
    .trim();
  if (!cleanViews) cleanViews = '1.5K';
  heroViews.innerHTML = `<i class="fa-solid fa-eye"></i> ${cleanViews} views`;
  
  const catLabel = item.category || 'Mini Drama';
  if (heroCategory) heroCategory.textContent = catLabel;
  if (heroSource) heroSource.style.display = 'none'; // Source masked

  const watchUrl = `/watch.html?id=${encodeURIComponent(item.id || item.slug)}&source=${encodeURIComponent(item.source || 'MicroTV')}`;
  heroWatchBtn.href = watchUrl;
  heroQuickBtn.onclick = () => {
    window.location.href = watchUrl;
  };
}

/**
 * Render Unified Multi-Source Card Grid (With Source Masking & Alignment Fix)
 */
function renderSeriesGrid(items) {
  if (!items || items.length === 0) {
    seriesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
        <i class="fa-solid fa-film" style="font-size: 2.5rem; color: var(--text-dim); margin-bottom: 1rem;"></i>
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;">No matching content found</h3>
        <p style="color: var(--text-muted);">Try a different search term or change the category tab.</p>
      </div>
    `;
    return;
  }

  seriesGrid.innerHTML = items.map(item => {
    const watchUrl = `/watch.html?id=${encodeURIComponent(item.id || item.slug)}&source=${encodeURIComponent(item.source || 'MicroTV')}`;
    const safeTitle = (item.title || '').replace(/"/g, '&quot;');
    const thumbUrl = item.thumbnail || 'https://new.microtv.st/assets/images/placeholder.jpg';
    const qualityTag = item.quality || 'HD Stream';
    
    // SOURCE MASKING: Dynamically map to casual category tags without revealing original source names
    const catLabel = item.category || (item.source === 'MicroTV' ? 'Mini Drama' : 'Movies');
    const catClass = catLabel.toLowerCase().replace(/\s+/g, '-');

    // CRITICAL UI FIX: Clean view count (strip emojis/duplicates) to ensure perfect non-overlapping alignment
    let cleanViews = String(item.views || '1.2K')
      .replace(/👁️/g, '')
      .replace(/views/gi, '')
      .trim();
    if (!cleanViews) cleanViews = '1.2K';

    return `
      <div class="series-card" onclick="window.location.href='${watchUrl}'" title="${safeTitle}">
        <div class="poster-wrapper">
          <img 
            src="${thumbUrl}" 
            alt="${safeTitle}" 
            class="series-poster"
            loading="lazy"
            onerror="this.onerror=null; this.src='https://new.microtv.st/assets/images/placeholder.jpg'"
          >
          <div class="poster-gradient"></div>
          
          <!-- Casual Category Tag (Source Masked) -->
          <div class="card-badges-top">
            <span class="category-badge badge-${catClass}">${catLabel}</span>
          </div>

          <!-- Quality Caption Badge at Bottom of Poster -->
          <div class="card-caption-badge">
            <i class="fa-solid fa-closed-captioning"></i> ${qualityTag}
          </div>

          <div class="play-hover-overlay">
            <div class="play-icon-circle">
              <i class="fa-solid fa-play" style="margin-left: 3px;"></i>
            </div>
          </div>
        </div>
        <div class="series-info">
          <h3 class="series-title">${item.title}</h3>
          
          <!-- Flawlessly Aligned View Count & Watch Button Row (Zero Overlap) -->
          <div class="series-meta">
            <span class="views"><i class="fa-solid fa-eye"></i> ${cleanViews} views</span>
            <span class="watch-online-cta"><i class="fa-solid fa-play"></i> Watch</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Pagination Controls
 */
function renderPagination(pagination) {
  if (!pagination || pagination.totalPages <= 1 || currentSearchQuery) {
    paginationWrapper.innerHTML = '';
    return;
  }

  const cur = pagination.currentPage;
  const total = pagination.totalPages;
  let html = `<div class="pagination-controls">`;

  // Previous Button
  if (cur > 1) {
    html += `<button class="page-btn page-arrow" onclick="loadContentPage(${cur - 1})"><i class="fa-solid fa-chevron-left"></i> Prev</button>`;
  } else {
    html += `<button class="page-btn page-arrow disabled" disabled><i class="fa-solid fa-chevron-left"></i> Prev</button>`;
  }

  // Numbered pages
  const pagesToShow = [];
  pagesToShow.push(1);

  let start = Math.max(2, cur - 2);
  let end = Math.min(total - 1, cur + 2);

  if (start > 2) pagesToShow.push('dots1');
  for (let i = start; i <= end; i++) pagesToShow.push(i);
  if (end < total - 1) pagesToShow.push('dots2');
  if (total > 1) pagesToShow.push(total);

  pagesToShow.forEach(p => {
    if (typeof p === 'string') {
      html += `<span class="page-dots">...</span>`;
    } else if (p === cur) {
      html += `<button class="page-btn active" disabled>${p}</button>`;
    } else {
      html += `<button class="page-btn" onclick="loadContentPage(${p})">${p}</button>`;
    }
  });

  // Next Button
  if (cur < total) {
    html += `<button class="page-btn page-arrow" onclick="loadContentPage(${cur + 1})">Next <i class="fa-solid fa-chevron-right"></i></button>`;
  } else {
    html += `<button class="page-btn page-arrow disabled" disabled>Next <i class="fa-solid fa-chevron-right"></i></button>`;
  }

  html += `</div>`;
  paginationWrapper.innerHTML = html;
}

/**
 * Execute Search
 */
function triggerSearch(immediate = false) {
  const val = searchInput.value.trim();
  searchClearBtn.style.display = val.length > 0 ? 'block' : 'none';

  if (immediate) {
    clearTimeout(searchDebounceTimer);
    currentSearchQuery = val;
    loadContentPage(1);
    return;
  }

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentSearchQuery = val;
    loadContentPage(1);
  }, 350);
}

// Search Inputs & Submissions
searchInput.addEventListener('input', () => triggerSearch(false));
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  triggerSearch(true);
});
searchSubmitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  triggerSearch(true);
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  searchInput.focus();
  triggerSearch(true);
});

// Category Tab Filtering
categoryTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    categoryTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.category;
    loadContentPage(1);
  });
});

// Quick sorting chips
filterChips.forEach(chip => {
  chip.addEventListener('click', () => {
    filterChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const filter = chip.dataset.filter;

    if (filter === 'popular') {
      const sorted = [...allItems].sort((a, b) => {
        const vA = parseFloat((a.views || '0').replace(/[^0-9.]/g, '')) || 0;
        const vB = parseFloat((b.views || '0').replace(/[^0-9.]/g, '')) || 0;
        return vB - vA;
      });
      renderSeriesGrid(sorted);
      itemsCounter.textContent = `Sorted by most viewed (${sorted.length} titles)`;
    } else {
      renderSeriesGrid(allItems);
      itemsCounter.textContent = `Displaying ${allItems.length} titles`;
    }
  });
});

// Browser Popstate (Back/Forward)
window.addEventListener('popstate', (e) => {
  const urlParams = new URLSearchParams(window.location.search);
  currentPage = parseInt(urlParams.get('page'), 10) || 1;
  currentCategory = urlParams.get('category') || 'all';
  currentSearchQuery = urlParams.get('q') || '';
  if (searchInput) searchInput.value = currentSearchQuery;

  // Set active tab
  categoryTabs.forEach(t => {
    if (t.dataset.category === currentCategory) t.classList.add('active');
    else t.classList.remove('active');
  });

  loadContentPage(currentPage, true);
});

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const initialPage = parseInt(urlParams.get('page'), 10) || 1;
  currentCategory = urlParams.get('category') || 'all';
  currentSearchQuery = urlParams.get('q') || '';

  if (searchInput && currentSearchQuery) {
    searchInput.value = currentSearchQuery;
    searchClearBtn.style.display = 'block';
  }

  categoryTabs.forEach(t => {
    if (t.dataset.category === currentCategory) t.classList.add('active');
    else t.classList.remove('active');
  });

  loadContentPage(initialPage, true);
});
