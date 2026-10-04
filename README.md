# ASI OTT - Testing Frontend & Streamlined Video Delivery System

A complete full-stack web application built for testing modern UI layouts, vertical drama playback, and streamlined video delivery without modifying live production servers.

---

## 🌟 Key Architecture & Updated Features

### 1. Header & Privacy Refinements
- **Complete Privacy**: All source domain texts, backend URLs, and test badges have been removed from the header.
- **Custom Vector Favicon**: Implemented at `/favicon.svg` with glowing play icon badge.
- **Mobile Responsive Layout**: Optimized for all device viewports with clean touch targets and 2-column mobile grid.

### 2. Custom Video Player Interface
- **Instant Playback Trigger**: Clicking directly anywhere on the video thumbnail, stage, or play button instantly starts playback unmuted with audio.
- **Timeline Formatting**: Converted from raw seconds/minutes into standard hour/minute format (e.g. `1 hour 35 minutes 1 second`).
- **Integrated In-Player Settings**: Settings gear button placed directly on the video control bar, offering floating popover controls for:
  - Brightness adjustment (40% to 200%)
  - Playback speed presets (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x)
  - Audio booster (up to 300%)
- **Player Modes**: Toggle between Custom Player and Source Embed Player.

### 3. Streamlined Direct Download System
- **Genuine .MKV Delivery**: Automatically resolves the high-speed Cloudflare R2 direct stream (`fast_cloud_r2_download`), bypassing dead 404 links and dummy files.
- **Preserved Metadata**: Retains original `.mkv` filename and genuine file size (e.g. `~1.88 GB`).
- **Direct Silent Delivery**: Downloads initiate directly on this site via `Content-Disposition: attachment` headers with zero external redirects, zero new tabs, and zero dead links.

### 4. Fully Functional Pagination
- **Multi-Page Navigation**: Supports dynamic page switching (`?page=1`, `?page=2`, `...`, `?page=33`) with smart pagination controls (`« Prev`, `1`, `2`, `3`, `...`, `Next »`).
- **Deep-linking & History**: Synchronizes with browser history (`history.pushState`) and scrolls smoothly to the top of the grid upon page transition.

---

## 📁 Project Structure

```
ASI OTT BIND/
├── data/
│   └── views.json           # Local storage for unique IP analytics view tracking
├── node_modules/            # Dependencies
├── public/
│   ├── favicon.svg          # Modern vector site favicon
│   ├── css/
│   │   └── style.css        # Premium dark OTT streaming theme
│   ├── js/
│   │   ├── app.js           # Homepage logic, pagination, search, card rendering
│   │   └── player.js        # Video player logic, in-player settings, .mkv direct downloads
│   ├── index.html           # Dynamic homepage with live search & pagination
│   └── watch.html           # Dedicated video viewing page with integrated player
├── package.json             # NPM package specification
├── package-lock.json        # Lockfile
├── server.js                # Express backend & API endpoints
└── README.md                # Project documentation
```

---

## 📡 API Reference

| Endpoint | Method | Query / Body | Description |
|---|---|---|---|
| `/api/content` | `GET` | `?page=1` | Fetches dramas with pagination metadata (`currentPage`, `totalPages`, `pages`). |
| `/api/search` | `GET` | `?q=biwi&page=1` | Queries search with multi-page pagination support. |
| `/api/post` | `GET` | `?slug=:slug` | Fetches post details, genuine `.mkv` media filename, and direct stream URL. |
| `/api/download-resolve` | `POST` | `{ downloadPhpUrl, type }` | Resolves the genuine Cloudflare R2 `.mkv` download URL. |
| `/api/stream-download` | `GET` | `?url=...&filename=...` | Streams media directly to browser with attachment headers. |
| `/api/views/track` | `POST` | `{ id: "slug" }` | Registers unique IP-based view counter. |
| `/api/views/get` | `GET` | `?id=:id` | Retrieves independent view count. |
