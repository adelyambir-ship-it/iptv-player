// IPTV Player - Main JS

// State
let channels = [];
let categories = {};
let favorites = JSON.parse(localStorage.getItem('iptv_favorites') || '[]');
let currentChannel = null;
let currentCategory = 'all';
let hls = null;

// DOM Elements (initialized after DOM ready)
let m3uUrlInput, loadBtn, searchInput, categoryList, channelsList;
let videoPlayer, playerOverlay, currentTitle, currentLogo, favBtn;
let allCount, favCount, channelCount, channelsTitle;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM ready');
    console.log('Tauri available:', !!window.__TAURI__);
    console.log('Tauri core:', !!window.__TAURI__?.core);
    console.log('Tauri invoke:', typeof window.__TAURI__?.core?.invoke);

    // Get DOM elements
    m3uUrlInput = document.getElementById('m3uUrl');
    loadBtn = document.getElementById('loadBtn');
    searchInput = document.getElementById('searchInput');
    categoryList = document.getElementById('categoryList');
    channelsList = document.getElementById('channelsList');
    videoPlayer = document.getElementById('videoPlayer');
    playerOverlay = document.getElementById('playerOverlay');
    currentTitle = document.getElementById('currentTitle');
    currentLogo = document.getElementById('currentLogo');
    favBtn = document.getElementById('favBtn');
    allCount = document.getElementById('allCount');
    favCount = document.getElementById('favCount');
    channelCount = document.getElementById('channelCount');
    channelsTitle = document.getElementById('channelsTitle');

    // Load saved URL
    const savedUrl = localStorage.getItem('iptv_url');
    if (savedUrl) {
        m3uUrlInput.value = savedUrl;
    }

    // Event listeners
    loadBtn.addEventListener('click', () => {
        const url = m3uUrlInput.value.trim();
        if (url) {
            localStorage.setItem('iptv_url', url);
            loadM3U(url);
        }
    });

    m3uUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadBtn.click();
    });

    searchInput.addEventListener('input', filterChannels);

    favBtn.addEventListener('click', toggleCurrentFavorite);

    // Stop button
    document.getElementById('stopBtn').addEventListener('click', stopStream);

    // Fullscreen button
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

    // Double-click video for fullscreen
    document.getElementById('playerContainer').addEventListener('dblclick', toggleFullscreen);

    // Category clicks
    document.getElementById('categories').addEventListener('click', (e) => {
        const item = e.target.closest('.category-item');
        if (item) {
            selectCategory(item.dataset.category);
        }
    });

    updateFavCount();
});

// Parse M3U
function parseM3U(content) {
    const lines = content.split('\n');
    const parsedChannels = [];
    let currentInfo = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXTINF:')) {
            const info = {};
            const nameMatch = line.match(/tvg-name="([^"]*)"/);
            info.tvgName = nameMatch ? nameMatch[1] : '';

            const logoMatch = line.match(/tvg-logo="([^"]*)"/);
            info.logo = logoMatch ? logoMatch[1] : '';

            const groupMatch = line.match(/group-title="([^"]*)"/);
            info.group = groupMatch ? groupMatch[1] : 'Diger';

            const commaIndex = line.lastIndexOf(',');
            info.name = commaIndex > -1 ? line.substring(commaIndex + 1).trim() : info.tvgName;

            currentInfo = info;
        } else if (line && !line.startsWith('#') && currentInfo) {
            parsedChannels.push({
                id: parsedChannels.length,
                name: currentInfo.name || 'Bilinmeyen',
                logo: currentInfo.logo,
                group: currentInfo.group,
                url: line
            });
            currentInfo = null;
        }
    }

    return parsedChannels;
}

// Load M3U from URL
async function loadM3U(url) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Yukleniyor...';
    channelsList.innerHTML = '<div class="loading">M3U indiriliyor ve parse ediliyor...</div>';

    try {
        console.log('Loading M3U from:', url);

        const invoke = window.__TAURI__?.core?.invoke;
        if (!invoke) {
            throw new Error('Tauri API bulunamadi');
        }

        // Fetch and parse in Rust - returns channel array directly
        console.log('Calling fetch_m3u...');
        channels = await invoke('fetch_m3u', { url: url });
        console.log('Received', channels.length, 'channels');

        if (!channels || channels.length === 0) {
            throw new Error('Hic kanal bulunamadi');
        }

        // Build categories
        channelsList.innerHTML = '<div class="loading">Kategoriler hazirlaniyor...</div>';
        await new Promise(r => setTimeout(r, 50));

        categories = {};
        channels.forEach(ch => {
            if (!categories[ch.group]) {
                categories[ch.group] = [];
            }
            categories[ch.group].push(ch);
        });

        renderCategories();
        renderChannels();
        updateCounts();

        console.log(`${channels.length} kanal yuklendi`);
    } catch (err) {
        console.error('M3U HATA:', err);
        const errorMsg = typeof err === 'string' ? err : (err.message || JSON.stringify(err));
        channelsList.innerHTML = `<div class="empty-state"><p>Hata: ${errorMsg}</p></div>`;
    }

    loadBtn.disabled = false;
    loadBtn.textContent = 'Yukle';
}

// Render categories
function renderCategories() {
    const sorted = Object.keys(categories).sort();

    categoryList.innerHTML = sorted.map(cat => `
        <div class="category-item" data-category="${escapeHtml(cat)}">
            <span class="category-icon">${getCategoryIcon(cat)}</span>
            <span class="category-name">${escapeHtml(cat)}</span>
            <span class="category-count">${categories[cat].length}</span>
        </div>
    `).join('');
}

// Get category icon
function getCategoryIcon(cat) {
    const lower = cat.toLowerCase();
    if (lower.includes('spor') || lower.includes('sport')) return '⚽';
    if (lower.includes('film') || lower.includes('movie') || lower.includes('sinema')) return '🎬';
    if (lower.includes('dizi') || lower.includes('series')) return '📺';
    if (lower.includes('haber') || lower.includes('news')) return '📰';
    if (lower.includes('cocuk') || lower.includes('kid') || lower.includes('child')) return '🧸';
    if (lower.includes('muzik') || lower.includes('music')) return '🎵';
    if (lower.includes('belgesel') || lower.includes('document')) return '🎥';
    if (lower.includes('turk')) return '🇹🇷';
    if (lower.includes('fr') || lower.includes('france')) return '🇫🇷';
    if (lower.includes('de') || lower.includes('german')) return '🇩🇪';
    if (lower.includes('uk') || lower.includes('eng')) return '🇬🇧';
    if (lower.includes('usa') || lower.includes('us ')) return '🇺🇸';
    return '📁';
}

// Select category
function selectCategory(cat) {
    currentCategory = cat;

    document.querySelectorAll('.category-item').forEach(el => {
        el.classList.toggle('active', el.dataset.category === cat);
    });

    if (cat === 'all') {
        channelsTitle.textContent = 'Tum Kanallar';
    } else if (cat === 'favorites') {
        channelsTitle.textContent = 'Favoriler';
    } else {
        channelsTitle.textContent = cat;
    }

    renderChannels();
}

// Render state
let currentList = [];
let renderOffset = 0;
const RENDER_BATCH = 100;

// Render channels
function renderChannels() {
    currentList = [];

    if (currentCategory === 'all') {
        currentList = channels;
    } else if (currentCategory === 'favorites') {
        currentList = channels.filter(ch => favorites.includes(ch.id));
    } else {
        currentList = categories[currentCategory] || [];
    }

    const search = searchInput.value.toLowerCase().trim();
    if (search) {
        currentList = currentList.filter(ch =>
            ch.name.toLowerCase().includes(search) ||
            ch.group.toLowerCase().includes(search)
        );
    }

    channelCount.textContent = `${currentList.length} kanal`;

    if (currentList.length === 0) {
        channelsList.innerHTML = '<div class="empty-state"><p>Kanal bulunamadi</p></div>';
        return;
    }

    // Reset and render first batch
    renderOffset = 0;
    channelsList.innerHTML = '';
    renderMoreChannels();

    // Scroll listener for lazy loading
    channelsList.onscroll = () => {
        if (channelsList.scrollTop + channelsList.clientHeight >= channelsList.scrollHeight - 200) {
            renderMoreChannels();
        }
    };
}

// Render more channels (lazy loading)
function renderMoreChannels() {
    const batch = currentList.slice(renderOffset, renderOffset + RENDER_BATCH);
    if (batch.length === 0) return;

    const fragment = document.createDocumentFragment();
    batch.forEach(ch => {
        const card = document.createElement('div');
        card.className = `channel-card ${currentChannel?.id === ch.id ? 'active' : ''}`;
        card.dataset.id = ch.id;
        card.innerHTML = `
            <div class="ch-logo">
                ${ch.logo ? `<img src="${escapeHtml(ch.logo)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" loading="lazy"><span style="display:none">📺</span>` : '<span>📺</span>'}
            </div>
            <div class="ch-info">
                <div class="ch-name">${escapeHtml(ch.name)}</div>
                <div class="ch-category">${escapeHtml(ch.group)}</div>
            </div>
            ${favorites.includes(ch.id) ? '<span class="ch-fav">★</span>' : ''}
        `;
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.id);
            const channel = channels.find(c => c.id === id);
            if (channel) playChannel(channel);
        });
        fragment.appendChild(card);
    });

    channelsList.appendChild(fragment);
    renderOffset += RENDER_BATCH;
}

// Filter channels
function filterChannels() {
    renderChannels();
}

// Play channel
function playChannel(channel) {
    currentChannel = channel;

    currentTitle.textContent = channel.name;
    currentLogo.innerHTML = channel.logo
        ? `<img src="${escapeHtml(channel.logo)}" onerror="this.style.display='none'">`
        : '';

    favBtn.classList.toggle('active', favorites.includes(channel.id));
    favBtn.textContent = favorites.includes(channel.id) ? '★' : '☆';

    playerOverlay.classList.add('hidden');

    document.querySelectorAll('.channel-card').forEach(card => {
        card.classList.toggle('active', parseInt(card.dataset.id) === channel.id);
    });

    playVideo(channel.url);
}

// Play video with ffmpeg transcoding (embedded in app)
async function playVideo(url) {
    console.log('Starting stream:', url);

    // First, stop any existing stream
    if (hls) {
        hls.destroy();
        hls = null;
    }
    videoPlayer.src = '';
    videoPlayer.load();

    // Show loading
    playerOverlay.classList.remove('hidden');
    playerOverlay.querySelector('p').textContent = 'Stream hazirlaniyor...';

    try {
        const invoke = window.__TAURI__?.core?.invoke;

        // Stop previous stream first
        await invoke('stop_stream');

        // Start ffmpeg transcoding
        const hlsUrl = await invoke('start_stream', { url });
        console.log('HLS URL:', hlsUrl);

        playerOverlay.querySelector('p').textContent = 'Baglaniyor...';

        // Play with HLS.js
        if (Hls.isSupported()) {
            if (hls) {
                hls.destroy();
            }
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 30,
                maxBufferLength: 10,
                maxMaxBufferLength: 30,
                liveSyncDurationCount: 1,
                liveMaxLatencyDurationCount: 5,
                liveDurationInfinity: true,
                levelLoadingTimeOut: 10000,
                manifestLoadingTimeOut: 5000,
                fragLoadingTimeOut: 10000,
                manifestLoadingMaxRetry: 2,
                levelLoadingMaxRetry: 2,
                fragLoadingMaxRetry: 2
            });
            hls.loadSource(hlsUrl);
            hls.attachMedia(videoPlayer);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('HLS manifest parsed, playing...');
                playerOverlay.classList.add('hidden');
                videoPlayer.play();
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS error:', data);
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                        // Try to recover
                        console.log('Attempting to recover from network error...');
                        hls.startLoad();
                    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        console.log('Attempting to recover from media error...');
                        hls.recoverMediaError();
                    } else {
                        playerOverlay.classList.remove('hidden');
                        playerOverlay.querySelector('p').textContent = 'Oynatma hatasi - tekrar deneyin';
                    }
                }
            });

            // Handle buffering
            hls.on(Hls.Events.FRAG_BUFFERED, () => {
                playerOverlay.classList.add('hidden');
            });
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            videoPlayer.src = hlsUrl;
            videoPlayer.addEventListener('loadedmetadata', () => {
                playerOverlay.classList.add('hidden');
                videoPlayer.play();
            });
        }
    } catch (err) {
        console.error('Stream error:', err);
        playerOverlay.classList.remove('hidden');
        playerOverlay.querySelector('p').textContent = 'Hata: ' + err.toString();
    }
}

// Toggle fullscreen - use Tauri window API for true fullscreen
let isInFullscreen = false;

async function toggleFullscreen() {
    try {
        const win = window.__TAURI__?.window;
        if (win && win.getCurrentWindow) {
            const currentWin = win.getCurrentWindow();

            if (!isInFullscreen) {
                // Enter fullscreen
                await currentWin.setFullscreen(true);
                isInFullscreen = true;
                document.body.classList.add('fullscreen-mode');

                // Hide sidebar, keep channels at bottom
                document.querySelector('.sidebar').style.display = 'none';
                document.querySelector('.now-playing').style.display = 'none';
                document.querySelector('.player-container').style.maxHeight = 'calc(100vh - 120px)';
                document.querySelector('.player-section').style.flex = '1';
                document.querySelector('.channels-section').style.height = '120px';
                document.querySelector('.channels-section').style.flex = 'none';
            } else {
                // Exit fullscreen
                await currentWin.setFullscreen(false);
                isInFullscreen = false;
                document.body.classList.remove('fullscreen-mode');

                // Restore UI
                document.querySelector('.sidebar').style.display = '';
                document.querySelector('.now-playing').style.display = '';
                document.querySelector('.player-container').style.maxHeight = '';
                document.querySelector('.player-section').style.flex = '';
                document.querySelector('.channels-section').style.height = '';
                document.querySelector('.channels-section').style.flex = '';
            }
            return;
        }
    } catch (e) {
        console.log('Tauri fullscreen error:', e);
    }

    // Fallback to HTML5 Fullscreen API
    const video = document.getElementById('videoPlayer');
    if (video.requestFullscreen) {
        video.requestFullscreen().catch(console.log);
    } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
    }
}

// Handle ESC key to exit fullscreen
document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && isInFullscreen) {
        await toggleFullscreen();
    }
});


// Stop stream
async function stopStream() {
    try {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        videoPlayer.src = '';
        videoPlayer.load();

        const invoke = window.__TAURI__?.core?.invoke;
        await invoke('stop_stream');

        playerOverlay.classList.remove('hidden');
        playerOverlay.querySelector('p').textContent = 'Kanal secin';
    } catch (err) {
        console.error('Stop error:', err);
    }
}

// Toggle favorite
function toggleCurrentFavorite() {
    if (!currentChannel) return;

    const id = currentChannel.id;
    const index = favorites.indexOf(id);

    if (index > -1) {
        favorites.splice(index, 1);
        favBtn.textContent = '☆';
        favBtn.classList.remove('active');
    } else {
        favorites.push(id);
        favBtn.textContent = '★';
        favBtn.classList.add('active');
    }

    localStorage.setItem('iptv_favorites', JSON.stringify(favorites));
    updateFavCount();
    renderChannels();
}

// Update counts
function updateCounts() {
    allCount.textContent = channels.length;
    updateFavCount();
}

function updateFavCount() {
    favCount.textContent = favorites.length;
}

// Escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}

// =====================
// SUBTITLE FUNCTIONALITY
// =====================

let subtitles = []; // Parsed subtitles
let subtitleTimeout = null;

// Initialize subtitle UI
document.addEventListener('DOMContentLoaded', () => {
    const subBtn = document.getElementById('subBtn');
    const subtitleModal = document.getElementById('subtitleModal');
    const closeSubModal = document.getElementById('closeSubModal');
    const subSearchInput = document.getElementById('subSearchInput');
    const subSearchBtn = document.getElementById('subSearchBtn');
    const subResults = document.getElementById('subResults');
    const subtitleDisplay = document.getElementById('subtitleDisplay');

    // Open subtitle modal
    subBtn.addEventListener('click', () => {
        subtitleModal.classList.add('open');
        subSearchInput.focus();
        // Pre-fill with current channel name
        if (currentChannel) {
            subSearchInput.value = currentChannel.name.replace(/HD|FHD|4K|SD/gi, '').trim();
        }
    });

    // Close modal
    closeSubModal.addEventListener('click', () => {
        subtitleModal.classList.remove('open');
    });

    subtitleModal.addEventListener('click', (e) => {
        if (e.target === subtitleModal) {
            subtitleModal.classList.remove('open');
        }
    });

    // Search subtitles
    subSearchBtn.addEventListener('click', searchSubtitles);
    subSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchSubtitles();
    });

    async function searchSubtitles() {
        const query = subSearchInput.value.trim();
        if (!query) return;

        subResults.innerHTML = '<div class="loading">Altyazi araniyor...</div>';

        try {
            const invoke = window.__TAURI__?.core?.invoke;
            const results = await invoke('search_subtitles', { query });

            if (results.length === 0) {
                subResults.innerHTML = '<p class="sub-hint">Altyazi bulunamadi</p>';
                return;
            }

            subResults.innerHTML = results.map(sub => `
                <div class="sub-item" data-id="${sub.id}">
                    <div class="sub-item-title">${escapeHtml(sub.release_name)}</div>
                    <div class="sub-item-lang">Turkce</div>
                </div>
            `).join('');

            // Add click handlers
            subResults.querySelectorAll('.sub-item').forEach(item => {
                item.addEventListener('click', () => loadSubtitle(item.dataset.id));
            });
        } catch (err) {
            console.error('Subtitle search error:', err);
            subResults.innerHTML = `<p class="sub-hint">Hata: ${err}</p>`;
        }
    }

    async function loadSubtitle(fileId) {
        subResults.innerHTML = '<div class="loading">Altyazi yukleniyor...</div>';

        try {
            const invoke = window.__TAURI__?.core?.invoke;
            const content = await invoke('download_subtitle', { fileId });

            subtitles = parseSRT(content);
            console.log('Loaded', subtitles.length, 'subtitle cues');

            subtitleModal.classList.remove('open');
            subBtn.classList.add('active');

            // Start subtitle sync
            startSubtitleSync();
        } catch (err) {
            console.error('Subtitle load error:', err);
            subResults.innerHTML = `<p class="sub-hint">Hata: ${err}</p>`;
        }
    }

    // Parse SRT format
    function parseSRT(content) {
        const cues = [];
        const blocks = content.trim().split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 3) continue;

            // Parse time line: 00:01:23,456 --> 00:01:26,789
            const timeLine = lines[1];
            const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);

            if (!timeMatch) continue;

            const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
            const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;

            const text = lines.slice(2).join('\n').replace(/<[^>]+>/g, ''); // Remove HTML tags

            cues.push({ start, end, text });
        }

        return cues;
    }

    // Sync subtitles with video
    function startSubtitleSync() {
        const video = document.getElementById('videoPlayer');

        video.addEventListener('timeupdate', updateSubtitle);
    }

    function updateSubtitle() {
        const video = document.getElementById('videoPlayer');
        const time = video.currentTime;

        const cue = subtitles.find(s => time >= s.start && time <= s.end);

        if (cue) {
            subtitleDisplay.textContent = cue.text;
            subtitleDisplay.classList.add('visible');
        } else {
            subtitleDisplay.classList.remove('visible');
        }
    }
});
