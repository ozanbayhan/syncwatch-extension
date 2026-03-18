// WeWatch Popup Script — v3.0 Production

document.addEventListener('DOMContentLoaded', () => {
    // ─── Elements ─────────────────────────────────────────────
    const statusDot = document.getElementById('statusDot');
    const viewDisconnected = document.getElementById('viewDisconnected');
    const viewWaiting = document.getElementById('viewWaiting');
    const viewSynced = document.getElementById('viewSynced');
    const viewBrowse = document.getElementById('viewBrowse');
    const viewRequestPending = document.getElementById('viewRequestPending');
    const viewTrending = document.getElementById('viewTrending');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    const btnCreate = document.getElementById('btnCreate');
    const btnJoin = document.getElementById('btnJoin');
    const inputRoomId = document.getElementById('inputRoomId');
    const roomCode = document.getElementById('roomCode');
    const btnCopy = document.getElementById('btnCopy');
    const btnLeaveWaiting = document.getElementById('btnLeaveWaiting');
    const btnCancelRequest = document.getElementById('btnCancelRequest');
    const syncRoomId = document.getElementById('syncRoomId');
    const mediaLabel = document.getElementById('mediaLabel');
    const mediaDuration = document.getElementById('mediaDuration');
    const btnDisconnect = document.getElementById('btnDisconnect');

    const presenceBar = document.getElementById('presenceBar');
    const presenceText = document.getElementById('presenceText');
    const urlStatus = document.getElementById('urlStatus');
    const urlStatusIcon = document.getElementById('urlStatusIcon');
    const urlStatusText = document.getElementById('urlStatusText');
    const btnGoToPage = document.getElementById('btnGoToPage');
    const langSelect = document.getElementById('langSelect');

    // Advanced options elements
    const btnAdvanced = document.getElementById('btnAdvanced');
    const roomOptions = document.getElementById('roomOptions');
    const publicRoomToggle = document.getElementById('publicRoomToggle');
    const roomName = document.getElementById('roomName');
    const roomDescription = document.getElementById('roomDescription');

    // Browse view elements
    const btnBrowse = document.getElementById('btnBrowse');
    const btnBackFromBrowse = document.getElementById('btnBackFromBrowse');
    const filterOccupancy = document.getElementById('filterOccupancy');
    const roomsList = document.getElementById('roomsList');

    // Trending elements
    const btnTrending = document.getElementById('btnTrending');
    const btnBackFromTrending = document.getElementById('btnBackFromTrending');
    const trendingList = document.getElementById('trendingList');
    const ytLiveList = document.getElementById('ytLiveList');
    const ytCategoryFilters = document.getElementById('ytCategoryFilters');

    // Trending tab elements
    const tabWeWatch = document.getElementById('tabWeWatch');
    const tabYouTube = document.getElementById('tabYouTube');
    const panelWeWatch = document.getElementById('panelWeWatch');
    const panelYouTube = document.getElementById('panelYouTube');
    let ytLoaded = false;

    // Matchmaking elements
    const matchToggle = document.getElementById('matchToggle');
    const matchableUsers = document.getElementById('matchableUsers');

    // Host Approval elements
    const joinReqCountWaiting = document.getElementById('joinReqCountWaiting');
    const requestListWaiting = document.getElementById('requestListWaiting');
    const joinRequestsPanelWaiting = document.getElementById('joinRequestsPanelWaiting');

    const joinReqCountSynced = document.getElementById('joinReqCountSynced');
    const requestListSynced = document.getElementById('requestListSynced');
    const joinRequestsPanelSynced = document.getElementById('joinRequestsPanelSynced');

    // ─── i18n ─────────────────────────────────────────────────
    let currentLang = 'en';

    function _(key) {
        return t(key, currentLang);
    }

    function initLangSelector() {
        // Populate language dropdown
        langSelect.innerHTML = '';
        for (const [code, locale] of Object.entries(WeWatch_LOCALES)) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = `${locale.flag} ${locale.name}`;
            langSelect.appendChild(opt);
        }

        // Load saved language
        getSavedLang((lang) => {
            currentLang = lang;
            langSelect.value = lang;
            applyTranslations();
        });

        langSelect.addEventListener('change', () => {
            currentLang = langSelect.value;
            saveLang(currentLang);
            applyTranslations();

            // Notify content script about language change
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'lang_changed',
                        lang: currentLang
                    }).catch(() => {});
                }
            });
        });
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = _(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = _(key);
        });
    }

    // ─── View Management ──────────────────────────────────────
    function showView(view) {
        viewDisconnected.classList.add('hidden');
        viewWaiting.classList.add('hidden');
        viewSynced.classList.add('hidden');
        viewBrowse.classList.add('hidden');
        viewRequestPending.classList.add('hidden');
        viewTrending.classList.add('hidden');
        view.classList.remove('hidden');
    }

    // ─── State Update ─────────────────────────────────────────
    function updateUI(state) {
        // Presence bar
        if (state.presenceCount && state.presenceCount > 0) {
            presenceBar.style.display = 'flex';
            presenceText.textContent = `${state.presenceCount} ${_('usersOnPage')}`;
        } else {
            presenceBar.style.display = 'none';
        }

        if (!state.isConnected && !state.roomId) {
            statusDot.className = 'status-dot';
            statusDot.title = _('disconnected');
            if (viewBrowse.classList.contains('hidden') && viewTrending.classList.contains('hidden')) {
                showView(viewDisconnected);
            }
        } else if (state.waitingForApproval) {
            statusDot.className = 'status-dot';
            statusDot.title = 'Waiting...';
            showView(viewRequestPending);
        } else if (state.roomId && !state.peerConnected) {
            if (state.isHost) {
                statusDot.className = 'status-dot connected';
                statusDot.title = _('waitingPeer');
                roomCode.textContent = state.roomId;
                showView(viewWaiting);
            } else {
                showToast(_('hostDisconnected'), 'error');
                chrome.runtime.sendMessage({ type: 'leave_room' });
            }
        } else if (state.roomId && state.peerConnected) {
            statusDot.className = 'status-dot synced';
            statusDot.title = _('synced');
            syncRoomId.textContent = state.roomId;
            showView(viewSynced);
            checkMediaStatus();

            // URL Match Status
            if (state.urlMatch === true) {
                urlStatus.style.display = 'flex';
                urlStatus.className = 'url-status match';
                urlStatusIcon.textContent = '✅';
                urlStatusText.textContent = _('samePage');
                btnGoToPage.style.display = 'none';
            } else if (state.urlMatch === false) {
                urlStatus.style.display = 'flex';
                urlStatus.className = 'url-status mismatch';
                urlStatusIcon.textContent = '⚠️';
                urlStatusText.textContent = _('diffPage');
                btnGoToPage.style.display = 'flex';
                btnGoToPage.textContent = `→ ${_('goToPage')}`;
            } else {
                urlStatus.style.display = 'none';
                btnGoToPage.style.display = 'none';
            }
        }

        // Render Join Requests if host
        if (state.isHost && state.joinRequests) {
            renderJoinRequests(state.joinRequests);
        } else {
            joinRequestsPanelWaiting.classList.add('hidden');
            joinRequestsPanelSynced.classList.add('hidden');
        }

        if (state.error) {
            showToast(state.error, 'error');
        }
    }

    // ─── Toast ────────────────────────────────────────────────
    function showToast(message, type = 'error') {
        toastMessage.textContent = message;
        toast.className = `toast ${type === 'success' ? 'success' : ''}`;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    // ─── Format Time ──────────────────────────────────────────
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        const pad = (num) => num.toString().padStart(2, '0');
        
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    }

    // ─── Media Status ─────────────────────────────────────────
    function checkMediaStatus() {
        chrome.storage.local.get(['mediaInfo'], (result) => {
            if (result.mediaInfo) {
                const type = result.mediaInfo.tagName === 'VIDEO' ? _('videoDetected') : _('audioDetected');
                mediaLabel.textContent = type;
                
                if (result.mediaInfo.duration > 0) {
                    const ct = formatTime(result.mediaInfo.currentTime);
                    const dt = formatTime(result.mediaInfo.duration);
                    mediaDuration.textContent = `${ct} / ${dt}`;
                    mediaDuration.style.display = 'block';
                } else {
                    mediaDuration.style.display = 'none';
                }
            } else {
                mediaLabel.textContent = _('noMedia');
                mediaDuration.style.display = 'none';
            }
        });
    }

    // ─── Event Handlers ───────────────────────────────────────

    // Advanced options toggle
    btnAdvanced.addEventListener('click', () => {
        const isVisible = roomOptions.style.display !== 'none';
        roomOptions.style.display = isVisible ? 'none' : 'block';
        btnAdvanced.textContent = _(isVisible ? 'advancedOptions' : 'hideOptions');
    });

    // Show/hide name/description when public is toggled
    publicRoomToggle.addEventListener('change', () => {
        const isPublic = publicRoomToggle.checked;
        roomName.style.display = isPublic ? 'block' : 'none';
        roomDescription.style.display = isPublic ? 'block' : 'none';
    });

    btnCreate.addEventListener('click', () => {
        btnCreate.disabled = true;

        const isPublic = publicRoomToggle.checked;
        const name = roomName.value.trim();
        const desc = roomDescription.value.trim();

        chrome.runtime.sendMessage({
            type: 'create_room',
            isPublic: isPublic,
            name: name || null,
            description: desc || null
        }, () => {
            btnCreate.disabled = false;
        });
    });

    btnJoin.addEventListener('click', () => {
        const code = inputRoomId.value.trim().toUpperCase();
        if (code.length < 4) {
            showToast(_('invalidCode'));
            return;
        }
        btnJoin.disabled = true;
        chrome.runtime.sendMessage({ type: 'join_room', roomId: code }, () => {
            btnJoin.disabled = false;
        });
    });

    inputRoomId.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnJoin.click();
    });

    // Only allow valid room code characters
    inputRoomId.addEventListener('input', () => {
        inputRoomId.value = inputRoomId.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    });

    btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(roomCode.textContent).then(() => {
            showToast(_('codeCopied'), 'success');
        });
    });

    btnLeaveWaiting.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnCancelRequest.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnDisconnect.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'leave_room' });
    });

    btnGoToPage.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'navigate_to_peer' });
    });

    // Browse view handlers
    btnBrowse.addEventListener('click', () => {
        showView(viewBrowse);
        loadPublicRooms();
    });

    btnBackFromBrowse.addEventListener('click', () => {
        showView(viewDisconnected);
    });

    // Trending view handlers
    btnTrending.addEventListener('click', () => {
        showView(viewTrending);
        loadTrending();
    });

    btnBackFromTrending.addEventListener('click', () => {
        showView(viewDisconnected);
    });

    // Trending tab switching
    if (tabWeWatch && tabYouTube) {
        tabWeWatch.addEventListener('click', () => {
            tabWeWatch.classList.add('active');
            tabYouTube.classList.remove('active');
            panelWeWatch.classList.remove('hidden');
            panelYouTube.classList.add('hidden');
        });

        tabYouTube.addEventListener('click', () => {
            tabYouTube.classList.add('active');
            tabWeWatch.classList.remove('active');
            panelYouTube.classList.remove('hidden');
            panelWeWatch.classList.add('hidden');
            if (!ytLoaded) {
                ytLoaded = true;
                loadYouTubeLive('');
            }
        });
    }

    // YouTube category filter handlers
    if (ytCategoryFilters) {
        ytCategoryFilters.addEventListener('click', (e) => {
            const btn = e.target.closest('.yt-cat-btn');
            if (!btn) return;
            ytCategoryFilters.querySelectorAll('.yt-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadYouTubeLive(btn.dataset.cat || '');
        });
    }

    // Matchmaking handlers
    if (matchToggle) {
        // Load saved state
        chrome.storage.local.get(['openToMatch'], (result) => {
            matchToggle.checked = !!result.openToMatch;
            if (result.openToMatch) fetchMatchableUsers();
        });

        matchToggle.addEventListener('change', () => {
            const enabled = matchToggle.checked;
            chrome.runtime.sendMessage({ type: 'set_matchmaking', enabled }, () => {
                if (enabled) fetchMatchableUsers();
                else matchableUsers.classList.add('hidden');
            });
        });
    }

    function fetchMatchableUsers() {
        if (!matchToggle || !matchToggle.checked) return;
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (!tab || !tab.url) return;
            const currentUrl = tab.url;
            const currentTitle = tab.title || '';

            chrome.runtime.sendMessage({ type: 'get_matchable_users', url: currentUrl }, (response) => {
                if (chrome.runtime.lastError) return;

                // Also check incoming requests
                checkIncomingRequests();

                if (!response || !response.users || response.users.length === 0) {
                    matchableUsers.innerHTML = '<div class="match-empty">No users to match on this page yet...</div>';
                    matchableUsers.classList.remove('hidden');
                    return;
                }
                matchableUsers.classList.remove('hidden');

                // Build HTML for matchable users + incoming requests section
                let html = response.users.map(user => `
                    <div class="match-user">
                        <div class="match-user-info">
                            <span class="match-user-dot"></span>
                            <span class="match-user-title">${escapeHtml(user.title)}</span>
                        </div>
                        <button class="btn-match" data-peer="${escapeHtml(user.peerId)}"
                                data-url="${escapeHtml(currentUrl)}"
                                data-title="${escapeHtml(currentTitle)}">🤝 Match</button>
                    </div>
                `).join('');

                matchableUsers.innerHTML = html;

                document.querySelectorAll('.btn-match').forEach(btn => {
                    btn.addEventListener('click', () => {
                        btn.disabled = true;
                        btn.textContent = 'Sent ✓';
                        chrome.runtime.sendMessage({
                            type: 'send_match_request',
                            targetPeerId: btn.dataset.peer,
                            url: btn.dataset.url,
                            title: btn.dataset.title
                        }, (res) => {
                            if (res && res.ok) {
                                showToast('Match request sent! Waiting for approval...', 'success');
                            } else {
                                showToast('Could not send request', 'error');
                                btn.disabled = false;
                                btn.textContent = '🤝 Match';
                            }
                        });
                    });
                });
            });
        });
    }

    function checkIncomingRequests() {
        chrome.runtime.sendMessage({ type: 'get_match_requests' }, (response) => {
            if (chrome.runtime.lastError || !response || !response.requests || response.requests.length === 0) return;

            const incomingDiv = document.getElementById('incomingRequests') || (() => {
                const div = document.createElement('div');
                div.id = 'incomingRequests';
                div.className = 'incoming-requests';
                matchableUsers.parentElement.appendChild(div);
                return div;
            })();

            incomingDiv.innerHTML = '<div class="incoming-header">📩 Match Requests</div>' +
                response.requests.map(req => `
                    <div class="match-request">
                        <div class="match-user-info">
                            <span class="match-user-dot" style="background:#f59e0b"></span>
                            <span class="match-user-title">${escapeHtml(req.title || 'Someone')} wants to watch together</span>
                        </div>
                        <div class="match-actions">
                            <button class="btn-accept" data-from="${escapeHtml(req.fromPeerId)}">✓</button>
                            <button class="btn-decline" data-from="${escapeHtml(req.fromPeerId)}">✕</button>
                        </div>
                    </div>
                `).join('');

            incomingDiv.querySelectorAll('.btn-accept').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.disabled = true;
                    chrome.runtime.sendMessage({
                        type: 'accept_match',
                        fromPeerId: btn.dataset.from
                    }, (res) => {
                        if (res && res.ok) {
                            showToast('Matched! Room created 🎉', 'success');
                        } else {
                            showToast('Match failed', 'error');
                        }
                    });
                });
            });

            incomingDiv.querySelectorAll('.btn-decline').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.closest('.match-request').remove();
                    chrome.runtime.sendMessage({
                        type: 'decline_match',
                        fromPeerId: btn.dataset.from
                    });
                });
            });
        });
    }

    // Poll for incoming match requests every 3 seconds
    let matchPollInterval = null;
    if (matchToggle) {
        matchToggle.addEventListener('change', () => {
            if (matchToggle.checked) {
                matchPollInterval = setInterval(checkIncomingRequests, 3000);
            } else {
                clearInterval(matchPollInterval);
                const inc = document.getElementById('incomingRequests');
                if (inc) inc.remove();
            }
        });
        // Start polling if already enabled
        if (matchToggle.checked) {
            matchPollInterval = setInterval(checkIncomingRequests, 3000);
        }
    }

    filterOccupancy.addEventListener('change', loadPublicRooms);

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function loadPublicRooms() {
        const occupancyFilter = filterOccupancy.value;

        chrome.runtime.sendMessage({ type: 'get_public_rooms' }, (response) => {
            if (!response || !response.rooms) {
                roomsList.innerHTML = `<p class="no-rooms" data-i18n="noRoomsFound">No public rooms found</p>`;
                return;
            }

            let rooms = response.rooms;

            // Client-side occupancy filter
            if (occupancyFilter) {
                rooms = rooms.filter(r => {
                    const ratio = r.userCount / r.maxPeers;
                    if (occupancyFilter === 'empty') return r.userCount === 0;
                    if (occupancyFilter === 'half') return ratio > 0 && ratio <= 0.6;
                    if (occupancyFilter === 'almost') return ratio > 0.6;
                    return true;
                });
            }

            if (rooms.length === 0) {
                roomsList.innerHTML = `<p class="no-rooms">No rooms match your filter</p>`;
                return;
            }

            roomsList.innerHTML = rooms.map(room => `
                <div class="room-item">
                    <div class="room-header">
                        <span class="room-name">${escapeHtml(room.name)}</span>
                        <span class="room-badge">${room.userCount}/${room.maxPeers}</span>
                    </div>
                    <div class="room-meta">
                        <span class="room-site">🌐 ${escapeHtml(room.currentSite)}</span>
                        <span class="room-time">⏱ ${room.timeAgo}</span>
                    </div>
                    ${room.description ? `<p class="room-desc">${escapeHtml(room.description)}</p>` : ''}
                    <button class="btn-join-room" data-room-id="${room.roomId}">${_('joinRoom')}</button>
                </div>
            `).join('');

            // Attach click handlers
            document.querySelectorAll('.btn-join-room').forEach(btn => {
                btn.addEventListener('click', () => {
                    const roomId = btn.getAttribute('data-room-id');
                    chrome.runtime.sendMessage({ type: 'join_public_room', roomId }, (res) => {
                        if (res && !res.error) {
                            // Will be handled by state update
                        } else {
                            showToast(res.error || 'Failed to join', 'error');
                        }
                    });
                });
            });
        });
    }

    // ─── Trending ─────────────────────────────────────────────

    function loadTrending() {
        trendingList.innerHTML = '<div class="trending-loading"><span class="pulse">Scanning pages...</span></div>';

        chrome.runtime.sendMessage({ type: 'get_trending' }, (response) => {
            if (!response || !response.pages || response.pages.length === 0) {
                trendingList.innerHTML = '<div class="trending-empty">No trending pages right now.<br>Pages appear when 2+ users are watching.</div>';
                return;
            }

            trendingList.innerHTML = response.pages.map((page, index) => {
                const rank = index + 1;
                const rankClass = rank <= 3 ? 'top3' : '';
                return `
                    <div class="trending-item" data-url="${escapeHtml(page.url)}" title="${escapeHtml(page.url)}">
                        <span class="trending-rank ${rankClass}">${rank}</span>
                        <div class="trending-info">
                            <span class="trending-title">${escapeHtml(page.title)}</span>
                            <span class="trending-domain">🌐 ${escapeHtml(page.domain)}</span>
                        </div>
                        <span class="trending-count">👥 ${page.count}</span>
                    </div>
                `;
            }).join('');

            // Click to navigate
            document.querySelectorAll('.trending-item').forEach(item => {
                item.addEventListener('click', () => {
                    const url = item.getAttribute('data-url');
                    if (url) {
                        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                            if (tab) chrome.tabs.update(tab.id, { url });
                        });
                    }
                });
            });
        });
    }

    // ─── YouTube Live ─────────────────────────────────────────

    function formatViewers(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    }

    function loadYouTubeLive(query) {
        if (!ytLiveList) return;
        ytLiveList.innerHTML = '<div class="trending-loading"><span class="pulse">Loading live streams...</span></div>';

        chrome.runtime.sendMessage({ type: 'get_youtube_live', query: query || '' }, (response) => {
            if (chrome.runtime.lastError) {
                ytLiveList.innerHTML = `<div class="trending-empty">Connection error</div>`;
                return;
            }
            if (!response || !response.videos || response.videos.length === 0) {
                const errMsg = response?.error || 'No live streams found';
                ytLiveList.innerHTML = `<div class="trending-empty">${escapeHtml(errMsg)}</div>`;
                return;
            }

            ytLiveList.innerHTML = response.videos.map(video => `
                <div class="yt-live-item" data-url="${escapeHtml(video.url)}" title="${escapeHtml(video.title)}">
                    <img class="yt-thumb" src="${escapeHtml(video.thumbnail)}" alt="">
                    <div class="trending-info">
                        <span class="trending-title">${escapeHtml(video.title)}</span>
                        <span class="trending-domain">${escapeHtml(video.channel)}</span>
                    </div>
                    <span class="yt-viewers">
                        <span class="yt-live-dot"></span>
                        ${formatViewers(video.viewers)}
                    </span>
                </div>
            `).join('');

            // Click to navigate
            document.querySelectorAll('.yt-live-item').forEach(item => {
                item.addEventListener('click', () => {
                    const url = item.getAttribute('data-url');
                    if (url) {
                        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                            if (tab) chrome.tabs.update(tab.id, { url });
                        });
                    }
                });
            });
        });
    }

    // ─── Host Approval Handlers ───────────────────────────────

    function renderJoinRequests(requests) {
        const count = requests.length;

        // Waiting View Update
        joinReqCountWaiting.textContent = count;
        requestListWaiting.innerHTML = '';
        if (count > 0 && !viewWaiting.classList.contains('hidden')) {
            joinRequestsPanelWaiting.classList.remove('hidden');
        } else {
            joinRequestsPanelWaiting.classList.add('hidden');
        }

        // Synced View Update
        joinReqCountSynced.textContent = count;
        requestListSynced.innerHTML = '';
        if (count > 0 && !viewSynced.classList.contains('hidden')) {
            joinRequestsPanelSynced.classList.remove('hidden');
        } else {
            joinRequestsPanelSynced.classList.add('hidden');
        }

        if (count === 0) return;

        const html = requests.map(req => {
            const domain = req.url ? escapeHtml(new URL(req.url).hostname) : 'Unknown site';
            return `
                <div class="request-item">
                    <div class="request-info">
                        <span class="request-name">${escapeHtml(req.username)}</span>
                        <span class="request-site">${domain}</span>
                    </div>
                    <div class="request-actions">
                        <button class="btn-req accept" data-id="${escapeHtml(req.id)}">✓</button>
                        <button class="btn-req deny" data-id="${escapeHtml(req.id)}">✕</button>
                    </div>
                </div>
            `;
        }).join('');

        requestListWaiting.innerHTML = html;
        requestListSynced.innerHTML = html;

        document.querySelectorAll('.btn-req.accept').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                chrome.runtime.sendMessage({ type: 'accept_join_request', requesterId: id });
            });
        });

        document.querySelectorAll('.btn-req.deny').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                chrome.runtime.sendMessage({ type: 'deny_join_request', requesterId: id });
            });
        });
    }

    // ─── State Listener ───────────────────────────────────────

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'state_update') updateUI(msg);
    });

    // ─── Initialization ───────────────────────────────────────

    function fetchState() {
        chrome.runtime.sendMessage({ type: 'get_state' }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response) updateUI(response);
        });
    }

    function fetchPresence() {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab && tab.url) {
                chrome.runtime.sendMessage({ type: 'get_presence', url: tab.url }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response && response.count > 0) {
                        presenceBar.style.display = 'flex';
                        presenceText.textContent = `${response.count} ${_('usersOnPage')}`;
                    }
                });
            }
        });
    }

    initLangSelector();
    fetchState();
    fetchPresence();

    setInterval(fetchState, 1000);
    setInterval(fetchPresence, 15000);

    // Update media duration much faster (every second) to seem real-time
    setInterval(() => {
        if (!viewSynced.classList.contains('hidden')) checkMediaStatus();
    }, 1000);
    
    // Attempt to restore overlay in the active tab when popup opens
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'restore_overlay' }).catch(() => {});
        }
    });
});
