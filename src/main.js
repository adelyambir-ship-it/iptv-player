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

// Play video with HLS.js
function playVideo(url) {
    if (hls) {
        hls.destroy();
        hls = null;
    }

    if (url.includes('.m3u8') || url.includes('m3u8')) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true
            });
            hls.loadSource(url);
            hls.attachMedia(videoPlayer);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoPlayer.play().catch(() => {});
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS error:', data);
                if (data.fatal) {
                    playerOverlay.classList.remove('hidden');
                    playerOverlay.querySelector('p').textContent = 'Kanal yuklenemedi';
                }
            });
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = url;
            videoPlayer.play().catch(() => {});
        }
    } else {
        videoPlayer.src = url;
        videoPlayer.play().catch(() => {});
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
