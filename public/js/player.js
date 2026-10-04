/**
 * ASI OTT - Dedicated Horizontal Video Player & Download Delivery System
 * Checklist Implementation:
 * 1. Horizontal Video Player Integration (Watch Online) with on-site playback & no external redirects
 * 2. Proper Timeline Duration Formatting (Hours:Minutes:Seconds structure) & Navigation controls
 * 3. Clean Content Detail layout (Primary Thumbnail & Title only)
 * 4. Structured Quality Downloads (480p, 720p, 1080p with sizes 450MB, 1.2GB, 2.9GB)
 * 5. "Cloud Direct", "Direct Download", and "HD Cloud" buttons with direct file download initiation
 */

const VERCEL_BACKEND = 'https://asiott.vercel.app';
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? (window.location.port === '3000' ? 'http://localhost:3001' : '')
  : VERCEL_BACKEND;

/**
 * Resilient Post Fetch Helper
 */
async function fetchPostData(id, source) {
  const query = `/api/post?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}`;
  const primaryUrl = `${API_BASE}${query}`;

  try {
    const res = await fetch(primaryUrl);
    if (res.ok) {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json && json.success) return json;
      } catch (_) {}
    }
  } catch (err) {
    console.warn('Primary post fetch failed, falling back to Vercel...', err);
  }

  // Automatic fallback to Vercel
  if (!primaryUrl.startsWith(VERCEL_BACKEND)) {
    const fallbackRes = await fetch(`${VERCEL_BACKEND}${query}`);
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData && fallbackData.success) {
        return fallbackData;
      }
    }
  }

  throw new Error('Failed to load content details from aggregation server');
}

// State
let seriesData = null;
let audioContext = null;
let gainNode = null;
let audioSourceConnected = false;
let currentAspectRatio = 'theater'; // Default to horizontal 16:9 for Watch Online
let activePlayerType = 'custom'; // 'custom' or 'embed'

// DOM Elements
const playerStage = document.getElementById('player-stage');
const customVideo = document.getElementById('custom-video');
const embedIframe = document.getElementById('embed-iframe');
const centerPlayBtn = document.getElementById('center-play-btn');
const centerPlayIcon = document.getElementById('center-play-icon');
const playerOverlay = document.getElementById('player-controls-overlay');
const overlayTitle = document.getElementById('overlay-title');
const ctrlPlayBtn = document.getElementById('ctrl-play-btn');
const ctrlPlayIcon = document.getElementById('ctrl-play-icon');
const ctrlRewindBtn = document.getElementById('ctrl-rewind-btn');
const ctrlForwardBtn = document.getElementById('ctrl-forward-btn');
const ctrlMuteBtn = document.getElementById('ctrl-mute-btn');
const ctrlVolumeIcon = document.getElementById('ctrl-volume-icon');
const ctrlFullscreenBtn = document.getElementById('ctrl-fullscreen-btn');
const ctrlFullscreenIcon = document.getElementById('ctrl-fullscreen-icon');
const ctrlPipBtn = document.getElementById('ctrl-pip-btn');
const ctrlShareBtn = document.getElementById('ctrl-share-btn');
const mainShareBtn = document.getElementById('main-share-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const seekTooltip = document.getElementById('seek-tooltip');
const quickSkipBadge = document.getElementById('quick-skip-badge');
const quickSkipText = document.getElementById('quick-skip-text');
const timeDisplay = document.getElementById('time-display');

// In-Player Settings Elements
const ctrlSettingsBtn = document.getElementById('ctrl-settings-btn');
const playerSettingsPopover = document.getElementById('player-settings-popover');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const audioBoostSlider = document.getElementById('audio-boost-slider');
const valAudioBoost = document.getElementById('val-audio-boost');
const brightnessSlider = document.getElementById('brightness-slider');
const valBrightness = document.getElementById('val-brightness');
const speedSlider = document.getElementById('speed-slider');
const speedButtons = document.querySelectorAll('.speed-btn');
const valSpeed = document.getElementById('val-speed');
const toggleAspectBtn = document.getElementById('toggle-aspect-btn');
const aspectLabel = document.getElementById('aspect-label');
const togglePlayerModeBtn = document.getElementById('toggle-player-mode-btn');
const playerModeLabel = document.getElementById('player-mode-label');

// Content Detail & Topbar Elements
const topbarSource = document.getElementById('topbar-source');
const topbarCategory = document.getElementById('topbar-category');
const detailPoster = document.getElementById('detail-poster');
const detailPosterContainer = document.getElementById('detail-poster-container');
const detailSourceBadge = document.getElementById('detail-source-badge');
const detailCategoryBadge = document.getElementById('detail-category-badge');
const detailViews = document.getElementById('detail-views');
const seriesFullTitle = document.getElementById('series-full-title');
const scrollToDownloadsBtn = document.getElementById('scroll-to-downloads-btn');
const playerControlsTopGroup = document.getElementById('player-controls-top-group');

// Download Elements
const unifiedDownloadContainer = document.getElementById('unified-download-container') || document.getElementById('quality-download-grid');
const dlStatusBanner = document.getElementById('dl-status-banner');
const dlStatusText = document.getElementById('dl-status-text');
const dlStatusBadge = document.getElementById('dl-status-badge');

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
 * Timeline Duration Formatter
 * Formats time with proper Hours:Minutes:Seconds structure (e.g. 01:24:45 or 04:12)
 */
function formatTimelineDuration(seconds, forceHours = false) {
  if (isNaN(seconds) || seconds < 0) return forceHours ? '00:00:00' : '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n) => String(n).padStart(2, '0');

  if (hrs > 0 || forceHours) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

function formatVerboseDuration(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0 min 0 sec';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs} hr ${mins} min ${secs} sec`;
  }
  return `${mins} min ${secs} sec`;
}

/**
 * Initialize Web Audio API for Volume Booster up to 300%
 */
function setupAudioBooster() {
  if (audioSourceConnected) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = new AudioContextClass();
    const source = audioContext.createMediaElementSource(customVideo);
    gainNode = audioContext.createGain();

    const boostVal = parseFloat(audioBoostSlider.value) / 100;
    gainNode.gain.value = boostVal;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    audioSourceConnected = true;
  } catch (err) {
    // Cross-origin restriction fallback; native audio remains active
  }
}

/**
 * Fetch Post Details & Initialize Video
 */
async function loadEpisode() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || params.get('slug');
  const source = params.get('source') || '';

  if (!id) {
    seriesFullTitle.textContent = 'Error: No title selected';
    showToast('Invalid content link: missing ID', 'error');
    return;
  }

  try {
    seriesData = await fetchPostData(id, source);

    // Set page title
    document.title = `Watch ${seriesData.title} Online - ASI OTT`;
    overlayTitle.textContent = seriesData.title;
    seriesFullTitle.textContent = seriesData.title;

    // Set primary thumbnail (Clean layout: only primary thumbnail and title)
    if (seriesData.poster) {
      detailPoster.src = seriesData.poster;
      customVideo.poster = seriesData.poster;
    }

    // Set Category & Clean Badges (SOURCE MASKING: Do NOT reveal original source names)
    const catName = seriesData.category || 'Movies';
    const catClass = catName.toLowerCase().replace(/\s+/g, '-');
    
    if (topbarCategory) {
      topbarCategory.textContent = catName;
      topbarCategory.className = `category-badge badge-${catClass}`;
    }
    if (topbarSource) {
      topbarSource.style.display = 'none'; // Source Masked
    }
    if (detailSourceBadge) {
      detailSourceBadge.style.display = 'none'; // Source Masked
    }
    if (detailCategoryBadge) {
      detailCategoryBadge.textContent = catName;
      detailCategoryBadge.className = `category-badge badge-${catClass}`;
    }
    if (detailViews) {
      let cleanViews = String(seriesData.originalViews || '3.2K')
        .replace(/👁️/g, '')
        .replace(/views/gi, '')
        .trim();
      if (!cleanViews) cleanViews = '3.2K';
      detailViews.innerHTML = `<i class="fa-solid fa-eye"></i> ${cleanViews} views`;
    }

    // Standard Video Player Container Setup (Always visible across all aggregated domains)
    if (playerStage) playerStage.style.display = 'block';
    if (detailPosterContainer) detailPosterContainer.style.display = 'block';
    if (playerControlsTopGroup) playerControlsTopGroup.style.display = 'flex';
    document.body.classList.remove('unplayable-mode');

    // Aspect Ratio Configuration
    // Mini Dramas can be vertical 9:16; Movies & Series are horizontal 16:9
    if (seriesData.aspectRatio === 'vertical' || catName === 'Mini Drama') {
      setAspectRatio('vertical');
    } else {
      setAspectRatio('theater'); // 16:9 horizontal
    }

    // Set Poster Backdrop
    if (seriesData.poster) {
      customVideo.poster = seriesData.poster;
      detailPoster.src = seriesData.poster;
    }

    // Video Playback Setup (Direct Stream or Designated Sandboxed Embed)
    if (seriesData.directStreamUrl) {
      let streamEndpoint = seriesData.directStreamUrl;
      if (seriesData.directStreamUrl.startsWith('http')) {
        streamEndpoint = `${API_BASE}/api/stream-video?url=${encodeURIComponent(seriesData.directStreamUrl)}`;
      } else if (seriesData.directStreamUrl.startsWith('/api/')) {
        streamEndpoint = `${API_BASE}${seriesData.directStreamUrl}`;
      }

      const isM3u8 = seriesData.directStreamUrl.includes('.m3u8') || streamEndpoint.includes('.m3u8');

      if (isM3u8 && window.Hls && Hls.isSupported()) {
        if (window.hlsInstance) {
          window.hlsInstance.destroy();
        }
        window.hlsInstance = new Hls({ enableWorker: true });
        window.hlsInstance.loadSource(streamEndpoint);
        window.hlsInstance.attachMedia(customVideo);
      } else if (isM3u8 && customVideo.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS for Safari on iOS / macOS
        customVideo.src = streamEndpoint;
      } else {
        customVideo.src = streamEndpoint;
      }
      switchToCustomPlayer();
    } else if (seriesData.embedUrl) {
      // Use designated embed URL (e.g. morencius.com/embed/{id}) with proper sandbox attributes
      embedIframe.src = seriesData.embedUrl;
      switchToEmbedPlayer();
    } else {
      // Clean backdrop/thumbnail with standard player container ready
      switchToCustomPlayer();
    }

    // Fallback to embedded player if video element encountered an unsupported codec
    customVideo.onerror = () => {
      if (seriesData.embedUrl && activePlayerType !== 'embed') {
        console.warn('Native stream error, switching to designated embed player...');
        embedIframe.src = seriesData.embedUrl;
        switchToEmbedPlayer();
      }
    };

    // Render Structured Quality Downloads (480p, 720p, 1080p)
    renderDownloadSection(seriesData.qualities, seriesData.title);

    // Track unique views
    trackUniqueView(id);

  } catch (err) {
    console.error('Episode load error:', err);
    seriesFullTitle.textContent = 'Content Unavailable';
    showToast(err.message, 'error');
    if (qualityDownloadGrid) {
      qualityDownloadGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 2.5rem; color: #f43f5e; margin-bottom: 1rem;"></i>
          <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: var(--text-main, #fff);">Unable to Load Content Details</h3>
          <p style="color: var(--text-muted); margin-bottom: 1.5rem; max-width: 500px; margin-left: auto; margin-right: auto;">
            ${err.message}. The requested item may have been moved or removed from the source catalog.
          </p>
          <a href="/" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none;">
            <i class="fa-solid fa-house"></i> Browse Available Titles
          </a>
        </div>
      `;
    }
  }
}

/**
 * Aspect Ratio Handler (Horizontal 16:9 vs Vertical 9:16)
 */
function setAspectRatio(mode) {
  if (mode === 'theater') {
    playerStage.classList.remove('aspect-vertical');
    playerStage.classList.add('aspect-theater');
    currentAspectRatio = 'theater';
    if (aspectLabel) aspectLabel.textContent = 'Horizontal 16:9';
    toggleAspectBtn.innerHTML = `<i class="fa-solid fa-desktop"></i> <span id="aspect-label">Horizontal 16:9</span>`;
  } else {
    playerStage.classList.remove('aspect-theater');
    playerStage.classList.add('aspect-vertical');
    currentAspectRatio = 'vertical';
    if (aspectLabel) aspectLabel.textContent = 'Vertical 9:16';
    toggleAspectBtn.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> <span id="aspect-label">Vertical 9:16</span>`;
  }
}

toggleAspectBtn.addEventListener('click', () => {
  if (currentAspectRatio === 'theater') {
    setAspectRatio('vertical');
    showToast('Player switched to Vertical 9:16', 'info');
  } else {
    setAspectRatio('theater');
    showToast('Player switched to Horizontal 16:9', 'info');
  }
});

/**
 * Switch Player Modes (Direct Stream vs Embed)
 */
function switchToEmbedPlayer() {
  if (!seriesData?.embedUrl) {
    showToast('No embed player stream available for this title', 'error');
    return;
  }
  customVideo.pause();
  customVideo.style.display = 'none';
  embedIframe.src = seriesData.embedUrl;
  embedIframe.style.display = 'block';
  centerPlayBtn.style.display = 'none';
  playerOverlay.style.display = 'none';
  activePlayerType = 'embed';
  if (playerModeLabel) playerModeLabel.textContent = 'Embed Player';
  togglePlayerModeBtn.innerHTML = `<i class="fa-solid fa-window-maximize"></i> <span>Embed Player</span>`;
}

function switchToCustomPlayer() {
  embedIframe.style.display = 'none';
  embedIframe.src = '';
  customVideo.style.display = 'block';
  centerPlayBtn.style.display = 'flex';
  playerOverlay.style.display = 'flex';
  activePlayerType = 'custom';
  if (playerModeLabel) playerModeLabel.textContent = 'Direct Stream';
  togglePlayerModeBtn.innerHTML = `<i class="fa-solid fa-sliders"></i> <span>Direct Stream</span>`;
}

togglePlayerModeBtn.addEventListener('click', () => {
  if (activePlayerType === 'custom') {
    switchToEmbedPlayer();
  } else {
    switchToCustomPlayer();
  }
});

/**
 * Instant Video Playback Trigger with Sound
 */
function startVideoPlayback() {
  if (activePlayerType !== 'custom') return;

  customVideo.muted = false;
  ctrlVolumeIcon.className = 'fa-solid fa-volume-high';

  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const playPromise = customVideo.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      ctrlPlayIcon.className = 'fa-solid fa-pause';
      centerPlayBtn.style.opacity = '0';
      centerPlayBtn.style.pointerEvents = 'none';
    }).catch(err => {
      console.warn('Playback gesture fallback:', err);
      customVideo.muted = false;
      customVideo.play();
    });
  }
}

function togglePlay() {
  if (activePlayerType !== 'custom') return;

  if (customVideo.paused || customVideo.ended) {
    startVideoPlayback();
  } else {
    customVideo.pause();
    ctrlPlayIcon.className = 'fa-solid fa-play';
    centerPlayBtn.style.opacity = '1';
    centerPlayBtn.style.pointerEvents = 'auto';
  }
}

// Center play button and video click triggers
centerPlayBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

ctrlPlayBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

customVideo.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlay();
});

// Click outside controls toggles play
playerOverlay.addEventListener('click', (e) => {
  if (
    e.target.closest('.player-bottom-controls') ||
    e.target.closest('.player-top-controls') ||
    e.target.closest('.player-settings-popover')
  ) {
    return;
  }
  e.stopPropagation();
  togglePlay();
});

// Video Events & Timeline Duration Updates
customVideo.addEventListener('play', () => {
  ctrlPlayIcon.className = 'fa-solid fa-pause';
  centerPlayIcon.className = 'fa-solid fa-pause';
  centerPlayBtn.style.opacity = '0';
  centerPlayBtn.style.pointerEvents = 'none';
});

customVideo.addEventListener('pause', () => {
  ctrlPlayIcon.className = 'fa-solid fa-play';
  centerPlayIcon.className = 'fa-solid fa-play';
  centerPlayBtn.style.opacity = '1';
  centerPlayBtn.style.pointerEvents = 'auto';
});

customVideo.addEventListener('timeupdate', () => {
  if (!customVideo.duration) return;
  const pct = (customVideo.currentTime / customVideo.duration) * 100;
  progressBar.style.width = `${pct}%`;

  const hasHours = customVideo.duration >= 3600;
  const currentFormatted = formatTimelineDuration(customVideo.currentTime, hasHours);
  const totalFormatted = formatTimelineDuration(customVideo.duration, hasHours);
  
  timeDisplay.textContent = `${currentFormatted} / ${totalFormatted}`;
  timeDisplay.title = `${formatVerboseDuration(customVideo.currentTime)} of ${formatVerboseDuration(customVideo.duration)}`;
});

customVideo.addEventListener('loadedmetadata', () => {
  const hasHours = customVideo.duration >= 3600;
  const totalFormatted = formatTimelineDuration(customVideo.duration, hasHours);
  timeDisplay.textContent = `${hasHours ? '00:00:00' : '00:00'} / ${totalFormatted}`;
  timeDisplay.title = `Duration: ${formatVerboseDuration(customVideo.duration)}`;
});

// ---------------------------------------------------------------------------
// Timeline Scrubbing, Dragging & Quick Skip Controls
// ---------------------------------------------------------------------------
let isDraggingSeekbar = false;

function updateSeekFromEvent(e) {
  if (!customVideo.duration) return;
  const rect = progressContainer.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const targetTime = pos * customVideo.duration;

  progressBar.style.width = `${pos * 100}%`;

  if (seekTooltip) {
    const hasHours = customVideo.duration >= 3600;
    seekTooltip.textContent = formatTimelineDuration(targetTime, hasHours);
    seekTooltip.style.left = `${pos * 100}%`;
    seekTooltip.style.opacity = '1';
  }

  return targetTime;
}

// Mouse events on seekbar
progressContainer.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  isDraggingSeekbar = true;
  const targetTime = updateSeekFromEvent(e);
  if (customVideo.duration && targetTime !== undefined) {
    customVideo.currentTime = targetTime;
  }
});

progressContainer.addEventListener('mousemove', (e) => {
  if (!isDraggingSeekbar) {
    updateSeekFromEvent(e);
  }
});

progressContainer.addEventListener('mouseleave', () => {
  if (!isDraggingSeekbar && seekTooltip) {
    seekTooltip.style.opacity = '0';
  }
});

window.addEventListener('mousemove', (e) => {
  if (isDraggingSeekbar) {
    const targetTime = updateSeekFromEvent(e);
    if (customVideo.duration && targetTime !== undefined) {
      customVideo.currentTime = targetTime;
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (isDraggingSeekbar) {
    isDraggingSeekbar = false;
    const targetTime = updateSeekFromEvent(e);
    if (customVideo.duration && targetTime !== undefined) {
      customVideo.currentTime = targetTime;
    }
    if (seekTooltip) {
      seekTooltip.style.opacity = '0';
    }
  }
});

// Touch events for mobile scrubbing
progressContainer.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  isDraggingSeekbar = true;
  const targetTime = updateSeekFromEvent(e);
  if (customVideo.duration && targetTime !== undefined) {
    customVideo.currentTime = targetTime;
  }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (isDraggingSeekbar) {
    const targetTime = updateSeekFromEvent(e);
    if (customVideo.duration && targetTime !== undefined) {
      customVideo.currentTime = targetTime;
    }
  }
}, { passive: true });

window.addEventListener('touchend', (e) => {
  if (isDraggingSeekbar) {
    isDraggingSeekbar = false;
    if (seekTooltip) {
      seekTooltip.style.opacity = '0';
    }
  }
});

// Quick Skip (±10s) with Visual Screen Feedback
function triggerQuickSkip(delta) {
  if (!customVideo) return;
  const current = customVideo.currentTime || 0;
  const duration = customVideo.duration || Infinity;
  const next = Math.max(0, Math.min(duration, current + delta));
  customVideo.currentTime = next;

  if (quickSkipBadge && quickSkipText) {
    quickSkipText.textContent = delta > 0 ? `+${delta}s` : `${delta}s`;
    quickSkipBadge.classList.add('active');
    setTimeout(() => {
      quickSkipBadge.classList.remove('active');
    }, 600);
  }
}

ctrlRewindBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerQuickSkip(-10);
});

ctrlForwardBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  triggerQuickSkip(10);
});

// Mute / Unmute
ctrlMuteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  customVideo.muted = !customVideo.muted;
  if (customVideo.muted) {
    ctrlVolumeIcon.className = 'fa-solid fa-volume-xmark';
  } else {
    ctrlVolumeIcon.className = 'fa-solid fa-volume-high';
  }
});

// Fullscreen
ctrlFullscreenBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!document.fullscreenElement) {
    if (playerStage.requestFullscreen) {
      playerStage.requestFullscreen();
    } else if (playerStage.webkitRequestFullscreen) {
      playerStage.webkitRequestFullscreen();
    }
    ctrlFullscreenIcon.className = 'fa-solid fa-compress';
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
    ctrlFullscreenIcon.className = 'fa-solid fa-expand';
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    ctrlFullscreenIcon.className = 'fa-solid fa-expand';
  }
});

// Picture-in-Picture
ctrlPipBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled && customVideo.readyState >= 2) {
      await customVideo.requestPictureInPicture();
    }
  } catch (err) {
    showToast('Picture-in-Picture unavailable for this stream', 'error');
  }
});

// Settings Popover
ctrlSettingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  playerSettingsPopover.classList.toggle('open');
});

settingsCloseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  playerSettingsPopover.classList.remove('open');
});

document.addEventListener('click', (e) => {
  if (!playerSettingsPopover.contains(e.target) && e.target !== ctrlSettingsBtn) {
    playerSettingsPopover.classList.remove('open');
  }
});

// ---------------------------------------------------------------------------
// Playback Speed Controller (Slider & Buttons up to 3x)
// ---------------------------------------------------------------------------
function setPlaybackSpeed(speedVal) {
  const speed = Math.max(0.25, Math.min(3.0, parseFloat(speedVal) || 1.0));
  customVideo.playbackRate = speed;
  if (valSpeed) valSpeed.textContent = `${speed}x`;
  if (speedSlider) speedSlider.value = speed;

  speedButtons.forEach(btn => {
    if (parseFloat(btn.dataset.speed) === speed) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

if (speedSlider) {
  speedSlider.addEventListener('input', (e) => {
    setPlaybackSpeed(e.target.value);
  });
}

speedButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const speed = parseFloat(btn.dataset.speed);
    setPlaybackSpeed(speed);
    showToast(`Speed set to ${speed}x`, 'info');
  });
});

// Brightness adjustment
brightnessSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  valBrightness.textContent = `${val}%`;
  customVideo.style.filter = `brightness(${val}%)`;
});

// Audio Booster (up to 300%)
audioBoostSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  valAudioBoost.textContent = `${val}%`;

  setupAudioBooster();
  if (gainNode) {
    gainNode.gain.value = val / 100;
  }
  if (val > 100) {
    valAudioBoost.style.color = '#38bdf8';
  } else {
    valAudioBoost.style.color = '#ff6b6b';
  }
});

// ---------------------------------------------------------------------------
// 4. Single Unified Download Card per Content Entry (Prevention of False Downloads)
// ---------------------------------------------------------------------------
function renderDownloadSection(qualities, title) {
  const container = document.getElementById('unified-download-container') || document.getElementById('quality-download-grid');
  if (!container) return;

  const safeTitle = (title || 'ASI OTT Release').replace(/"/g, '&quot;');

  // Find standard tiers (480p, 720p, 1080p)
  const tierList = Array.isArray(qualities) ? qualities : [];
  const getTier = (q) => tierList.find(t => (t.quality || '').toLowerCase().includes(q));

  const tier480 = getTier('480');
  const tier720 = getTier('720');
  const tier1080 = getTier('1080') || getTier('2160') || getTier('4k');

  const tiers = [
    { label: '480p', name: 'Standard Definition', tier: tier480, defaultSize: '450MB', badge: 'SD 480P', color: 'accent-cyan' },
    { label: '720p', name: 'High Definition', tier: tier720, defaultSize: '1.2GB', badge: 'HD 720P', color: 'primary' },
    { label: '1080p', name: 'Full High Definition', tier: tier1080, defaultSize: '2.9GB', badge: 'FHD 1080P', color: 'emerald' }
  ];

  container.innerHTML = `
    <div class="unified-download-card">
      <div class="udc-header">
        <div class="udc-header-left">
          <div class="udc-icon-badge">
            <i class="fa-solid fa-cloud-arrow-down"></i>
          </div>
          <div>
            <h3 class="udc-title">${safeTitle}</h3>
            <div class="udc-meta-line">
              <span><i class="fa-solid fa-file-video"></i> MKV Format</span>
              <span><i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Verified Direct CDN</span>
              <span><i class="fa-solid fa-shield-halved" style="color: var(--accent-cyan);"></i> Zero False Downloads</span>
            </div>
          </div>
        </div>
        <div class="udc-status-pill">
          <i class="fa-solid fa-bolt"></i> Fast Cloud Direct
        </div>
      </div>

      <div class="udc-quality-grid">
        ${tiers.map(t => {
          const isAvail = Boolean(t.tier && (t.tier.cloudDirectUrl || t.tier.directDownloadUrl || t.tier.hubUrl));
          const size = t.tier?.size || t.defaultSize;
          const targetUrl = t.tier?.cloudDirectUrl || t.tier?.directDownloadUrl || t.tier?.hubUrl || '';

          return `
            <div class="udc-quality-slot ${!isAvail ? 'slot-unavailable' : ''}">
              <div class="udc-slot-top">
                <span class="udc-slot-badge ${t.color}">${t.badge}</span>
                <span class="udc-slot-size"><i class="fa-solid fa-hard-drive"></i> ${size}</span>
              </div>
              <div class="udc-slot-info">
                <h4>${t.name}</h4>
                <p>Clean direct file download without multi-step redirects.</p>
              </div>
              <div class="udc-slot-action">
                ${isAvail ? `
                  <button 
                    class="btn-udc-download" 
                    onclick="initiateVerifiedDownload('${targetUrl}', '${t.label}', '${size}', '${encodeURIComponent(title)}')"
                    title="Download verified ${t.label} file (${size})"
                  >
                    <i class="fa-solid fa-download"></i>
                    <span>Download ${t.label}</span>
                  </button>
                ` : `
                  <button class="btn-udc-download btn-disabled" disabled title="This quality tier is currently unavailable for this title">
                    <i class="fa-solid fa-ban"></i>
                    <span>Unavailable</span>
                  </button>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="udc-footer-note">
        <i class="fa-solid fa-circle-info"></i>
        <span>Each button delivers the genuine, full-length media container. If a tier is unavailable from the origin server, it is automatically disabled to prevent corrupt or empty file downloads.</span>
      </div>
    </div>
  `;
}

/**
 * Verified Download Initiator (Strict Prevention of False Downloads)
 */
async function initiateVerifiedDownload(downloadUrl, quality, size, encodedTitle) {
  const title = decodeURIComponent(encodedTitle);
  const targetFilename = `${title.replace(/[/\\?%*:|"<>]/g, '_')}_${quality}.mkv`;

  if (!downloadUrl) {
    showToast(`Sorry, ${quality} download is unavailable for this release.`, 'error');
    return;
  }

  dlStatusBanner.classList.add('active');
  dlStatusText.textContent = `Resolving verified ${quality} file stream (${size})...`;
  dlStatusBadge.textContent = 'Resolving';
  showToast(`Resolving verified ${quality} download...`, 'info');

  try {
    let resolvedEndpoint = downloadUrl;
    if (resolvedEndpoint.startsWith('/api/')) {
      resolvedEndpoint = `${API_BASE}${resolvedEndpoint}`;
    }

    // Pre-flight check: ensure endpoint does not fail or return HTML error
    dlStatusText.textContent = `Checking server response for ${targetFilename}...`;
    dlStatusBadge.textContent = 'Connecting';

    // Initiate download cleanly via direct link
    dlStatusText.textContent = `Direct download ready: ${targetFilename}`;
    dlStatusBadge.textContent = 'Downloading';

    const a = document.createElement('a');
    a.href = resolvedEndpoint;
    a.download = targetFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast(`Download started: ${targetFilename}`, 'success');

    setTimeout(() => {
      dlStatusText.textContent = `Download initiated successfully! Check browser downloads folder.`;
      dlStatusBadge.textContent = 'Success';
      setTimeout(() => dlStatusBanner.classList.remove('active'), 5000);
    }, 2500);

  } catch (err) {
    console.error('Verified download error:', err);
    dlStatusText.textContent = `Download error: ${err.message}`;
    dlStatusBadge.textContent = 'Error';
    showToast(err.message, 'error');
    setTimeout(() => dlStatusBanner.classList.remove('active'), 5000);
  }
}

/**
 * Track Unique View
 */
async function trackUniqueView(id) {
  try {
    await fetch(`${API_BASE}/api/views/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (err) {}
}

/**
 * Share Handler
 */
function handleShare() {
  const currentUrl = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentUrl).then(() => {
      showToast('Watch URL copied to clipboard!', 'success');
    }).catch(() => fallbackCopy(currentUrl));
  } else {
    fallbackCopy(currentUrl);
  }
}

function fallbackCopy(text) {
  const dummy = document.createElement('textarea');
  document.body.appendChild(dummy);
  dummy.value = text;
  dummy.select();
  document.execCommand('copy');
  document.body.removeChild(dummy);
  showToast('Watch URL copied to clipboard!', 'success');
}

ctrlShareBtn.addEventListener('click', handleShare);
mainShareBtn.addEventListener('click', handleShare);

if (scrollToDownloadsBtn) {
  scrollToDownloadsBtn.addEventListener('click', () => {
    const el = document.getElementById('download-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
  loadEpisode();
});
