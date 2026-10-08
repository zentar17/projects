let currentGuild = null;
let knownGuilds = { predcord: null, community: null, masterclassServer: null };
let currentCommands = {};
let editingName = null;
let currentMembers = [];
let currentModlogs = [];
let currentRoles = [];
let currentChannels = [];
let currentVideos = [];
let editingVideoId = null;
let videoRolesLoaded = false;
let rolesLoaded = false;
let configLoaded = false;
let dashboardPermissions = {
    createRoles: [],
    editRoles: [],
    deleteRoles: [],
    viewLogsRoles: [],
    adminUsers: [],
    ownerUsers: [],
    projectedRoles: []
};
let isAdmin = false;
let isDiscord = false;
let myRole = 'none';
let canAccessMasterclass = false;
let canUploadVideos = false;
let canManageVideos = false;
let canMcTickets = false;
let canRoleSync = false;
let canDropmaps = false;
let mcTicketsStatus = 'open';
let selectedServer = null;
let serverAccess = { predcord: true, community: true, masterclassServer: true };
let myPermissions = {
    createRoles: false,
    editRoles: false,
    deleteRoles: false,
    viewLogsRoles: false,
    managePermissions: false
};

function isOwner() {
    return isAdmin || myRole === 'owner';
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showAccessDenied() {
    const el = document.getElementById('accessDeniedToast');
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('show');
    if (window._accessDeniedTimeout) clearTimeout(window._accessDeniedTimeout);
    window._accessDeniedTimeout = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.classList.add('hidden'), 300);
    }, 2000);
}

function shakeModal(modalSelector = '#modal') {
    const modalContent = document.querySelector(`${modalSelector} .modal-content, ${modalSelector} .cm-dialog`);
    if (!modalContent) return;
    modalContent.classList.remove('shake');
    void modalContent.offsetWidth;
    modalContent.classList.add('shake');
}

function showFormToast(message = 'Fill all fields') {
    const toast = document.getElementById('formToast');
    if (!toast) return;
    const textEl = toast.querySelector('.form-toast-text');
    if (textEl) textEl.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    if (window._formToastTimeout) clearTimeout(window._formToastTimeout);
    window._formToastTimeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

function hideFormToast() {
    const toast = document.getElementById('formToast');
    if (!toast) return;
    if (window._formToastTimeout) clearTimeout(window._formToastTimeout);
    toast.classList.remove('show');
    toast.classList.add('hidden');
}

function clearInvalidFields() {
    document.querySelectorAll('.field-invalid').forEach(el => {
        el.classList.remove('field-invalid');
    });
}

function markFieldInvalid(el) {
    if (!el) return;
    el.classList.add('field-invalid');
    el.addEventListener('input', function handler() {
        el.classList.remove('field-invalid');
        el.removeEventListener('input', handler);
    });
    el.addEventListener('change', function handler2() {
        el.classList.remove('field-invalid');
        el.removeEventListener('change', handler2);
    });
}

function showConfirmDialog(title, message, onConfirm, confirmLabel) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const textEl = document.getElementById('confirmModalText');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    if (!modal || !titleEl || !textEl || !okBtn || !cancelBtn) return;

    titleEl.textContent = title;
    textEl.textContent = message;
    okBtn.textContent = confirmLabel || 'Delete';
    okBtn.classList.toggle('btn-danger', !confirmLabel);
    okBtn.classList.toggle('btn-primary', !!confirmLabel);

    const closeDialog = () => {
        modal.classList.add('hidden');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
    };

    okBtn.onclick = () => {
        closeDialog();
        if (typeof onConfirm === 'function') onConfirm();
    };

    cancelBtn.onclick = closeDialog;

    modal.onclick = (e) => {
        if (e.target.id === 'confirmModal') closeDialog();
    };

    modal.classList.remove('hidden');
}

function showReasonDialog(currentReason, onSave) {
    const modal = document.getElementById('reasonModal');
    const currentEl = document.getElementById('reasonModalCurrent');
    const input = document.getElementById('reasonModalInput');
    const okBtn = document.getElementById('reasonOkBtn');
    const cancelBtn = document.getElementById('reasonCancelBtn');

    if (!modal || !currentEl || !input || !okBtn || !cancelBtn) return;

    currentEl.textContent = currentReason || 'No reason provided';
    input.value = '';

    const closeDialog = () => {
        modal.classList.add('hidden');
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
        input.onkeydown = null;
    };

    const submit = () => {
        const value = input.value.trim();
        if (!value) {
            input.classList.add('field-invalid');
            return;
        }
        closeDialog();
        if (typeof onSave === 'function') onSave(value);
    };

    okBtn.onclick = submit;
    cancelBtn.onclick = closeDialog;

    input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
    };

    modal.onclick = (e) => {
        if (e.target.id === 'reasonModal') closeDialog();
    };

    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 60);
}

function brightenColor(hex, percent = 45) {
    if (!hex || typeof hex !== 'string') return null;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return null;

    let r = parseInt(c.substring(0, 2), 16);
    let g = parseInt(c.substring(2, 4), 16);
    let b = parseInt(c.substring(4, 6), 16);

    r = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
    g = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
    b = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));

    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function init() {
    try {
        const me = await fetch('/api/me', { credentials: 'same-origin' });
        if (!me.ok) {
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
            return;
        }
        const meData = await me.json();
        isAdmin = !!meData.isAdmin;
        isDiscord = !!meData.isDiscord;
        myRole = meData.role || 'none';
        serverAccess = meData.access || { predcord: true, community: true, masterclassServer: true };
        canAccessMasterclass = !!meData.canAccessMasterclass;
        canUploadVideos = !!meData.canUploadVideos;
        canManageVideos = !!meData.canManageVideos;
        canMcTickets = !!meData.canMcTickets;
        canRoleSync = !!meData.canRoleSync;
        canDropmaps = !!meData.canDropmaps;

        const navVideosGroup = document.getElementById('navVideosGroup');
        if (navVideosGroup) navVideosGroup.classList.toggle('visible', !!meData.canViewVideos);
        try { localStorage.setItem('pdCanViewVideos', meData.canViewVideos ? '1' : '0'); } catch (e) {}

        await loadMyPermissions();
        await loadGuilds();
        setupEvents();
        setupUserMenu();
        setupLangSwitcher();
        await loadUserMenu();
        updatePreview();
        updatePermissionsTabVisibility();
        applyServerAccessRestrictions();
        await openTicketsFromHash();
        await restoreDashState();
    } catch (e) {
        console.error('[INIT] Error:', e);
        endRestoring();
    }
}

async function openTicketsFromHash() {
    if (window.location.hash !== '#mc-tickets') return;
    if (!isOwner() && !canMcTickets) return;
    await selectServer('masterclass');
    const ticketsTab = document.getElementById('navTabMcTickets');
    if (ticketsTab) ticketsTab.click();
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) {}
}

function saveDashState(patch) {
    try {
        const cur = JSON.parse(localStorage.getItem('pdDashState') || '{}');
        localStorage.setItem('pdDashState', JSON.stringify(Object.assign(cur, patch)));
    } catch (e) {}
}

function loadDashState() {
    try { return JSON.parse(localStorage.getItem('pdDashState') || '{}') || {}; } catch (e) { return {}; }
}

function clearDashState() {
    try { localStorage.removeItem('pdDashState'); } catch (e) {}
}

function endRestoring() {
    document.documentElement.classList.remove('pd-restoring');
}

async function restoreDashState() {
    try {
        await restoreDashStateInner();
    } finally {
        endRestoring();
    }
}

async function restoreDashStateInner() {
    if (selectedServer) return;
    const st = loadDashState();
    if (!st.server) return;
    if (st.server === 'masterclass') {
        if (!isOwner() && !canAccessMasterclass && !canMcTickets) return;
    } else if (!SERVER_INFO[st.server] || (serverAccess && serverAccess[st.server] === false)) {
        return;
    }
    await selectServer(st.server);
    if (st.tab) {
        const tab = document.querySelector(`.nav-tab[data-tab="${st.tab}"]`);
        if (tab && !tab.classList.contains('hidden') && tab.offsetParent !== null) tab.click();
    }
}

function applyServerAccessRestrictions() {
    const communityCard = document.querySelector('.server-select-card[data-server="community"]');
    const predcordCard = document.querySelector('.server-select-card[data-server="predcord"]');
    const masterclassCard = document.getElementById('masterclassSelectCard');
    const masterclassServerCard = document.querySelector('.server-select-card[data-server="masterclassServer"]');
    if (masterclassServerCard) masterclassServerCard.classList.toggle('hidden', !serverAccess.masterclassServer);
    if (communityCard) communityCard.classList.toggle('hidden', !serverAccess.community);
    if (predcordCard) predcordCard.classList.toggle('hidden', !serverAccess.predcord);
    if (masterclassCard) masterclassCard.classList.toggle('hidden', !isOwner() && !canAccessMasterclass && !canMcTickets);
    refreshSideUserRole();

    const allowed = Object.keys(serverAccess).filter(k => serverAccess[k]);

    const changeServerBtn = document.getElementById('changeServerBtn');
    if (changeServerBtn) changeServerBtn.classList.toggle('hidden', allowed.length <= 1);

    if (allowed.length === 1) {
        selectServer(allowed[0]);
    }
}

function setupUserMenu() {
    const btn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdown');

    if (!btn || !dropdown) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.style.left = '';
        dropdown.style.bottom = '';
        dropdown.classList.toggle('hidden');
    };

    const sideUser = document.getElementById('sideUser');
    if (sideUser) {
        const openFromSide = (e) => {
            e.stopPropagation();
            if (!dropdown.classList.contains('hidden')) {
                dropdown.classList.add('hidden');
                return;
            }
            const r = sideUser.getBoundingClientRect();
            dropdown.style.left = Math.max(8, r.left) + 'px';
            dropdown.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
            dropdown.classList.remove('hidden');
        };
        sideUser.onclick = openFromSide;
        sideUser.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFromSide(e);
            }
        };
    }

    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !e.target.closest('#userMenu')) {
            dropdown.classList.add('hidden');
        }
    });
}

const DASH_FLAGS = {
    it: '<svg viewBox="0 0 30 20"><rect width="10" height="20" x="0" fill="#009246"/><rect width="10" height="20" x="10" fill="#fff"/><rect width="10" height="20" x="20" fill="#ce2b37"/></svg>',
    en: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#00247d"/><path d="M0,0 L30,20 M30,0 L0,20" stroke="#fff" stroke-width="4"/><path d="M0,0 L30,20 M30,0 L0,20" stroke="#cf142b" stroke-width="2"/><path d="M15,0 V20 M0,10 H30" stroke="#fff" stroke-width="6"/><path d="M15,0 V20 M0,10 H30" stroke="#cf142b" stroke-width="3.2"/></svg>',
    de: '<svg viewBox="0 0 30 20"><rect width="30" height="6.66" y="0" fill="#000"/><rect width="30" height="6.66" y="6.66" fill="#dd0000"/><rect width="30" height="6.67" y="13.33" fill="#ffce00"/></svg>',
    es: '<svg viewBox="0 0 30 20"><rect width="30" height="20" fill="#aa151b"/><rect width="30" height="10" y="5" fill="#f1bf00"/></svg>',
    fr: '<svg viewBox="0 0 30 20"><rect width="10" height="20" x="0" fill="#0055a4"/><rect width="10" height="20" x="10" fill="#fff"/><rect width="10" height="20" x="20" fill="#ef4135"/></svg>'
};

const DASH_LANGS = [
    { code: 'it', name: 'Italiano' },
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' }
];

let dashCurrentLang = 'en';

function setupLangSwitcher() {
    const langBtn = document.getElementById('langBtn');
    const langBtnFlag = document.getElementById('langBtnFlag');
    const langDropdown = document.getElementById('langDropdown');
    if (!langBtn || !langBtnFlag || !langDropdown) return;

    function renderLangUI() {
        langBtnFlag.innerHTML = DASH_FLAGS[dashCurrentLang];
        langDropdown.innerHTML = DASH_LANGS.map(l => {
            return `<button class="lang-option${l.code === dashCurrentLang ? ' active' : ''}" data-code="${l.code}">` +
                `<span class="flag-icon">${DASH_FLAGS[l.code]}</span><span>${l.name}</span>` +
            `</button>`;
        }).join('');
    }

    langBtn.onclick = (e) => {
        e.stopPropagation();
        langDropdown.classList.toggle('open');
    };

    langDropdown.onclick = (e) => {
        const opt = e.target.closest('.lang-option');
        if (!opt) return;
        dashCurrentLang = opt.getAttribute('data-code');
        langDropdown.classList.remove('open');
        renderLangUI();
    };

    document.addEventListener('click', () => {
        langDropdown.classList.remove('open');
    });

    renderLangUI();
}

function refreshSideUserRole() {
    const el = document.getElementById('sideUserRole');
    if (!el) return;
    let label = 'Staff';
    if (myRole === 'owner') label = 'Owner';
    else if (isAdmin) label = 'Admin';
    el.textContent = label;
    const ssRole = document.getElementById('ssUserRole');
    if (ssRole) ssRole.textContent = myRole === 'owner' ? 'Owner' : 'Admin';
    document.querySelectorAll('.ss-role').forEach(b => {
        b.textContent = myRole === 'owner' ? 'Owner' : 'Admin';
    });
}

function updateNavGroups() {
    document.querySelectorAll('.nav-group-label').forEach(label => {
        let visible = false;
        let el = label.nextElementSibling;
        while (el && !el.classList.contains('nav-group-label')) {
            if (el.classList.contains('nav-tab') && !el.classList.contains('hidden')) {
                visible = true;
                break;
            }
            el = el.nextElementSibling;
        }
        label.classList.toggle('hidden', !visible);
    });
}

async function loadUserMenu() {
    const defaultAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

    const avatarBtnImg = document.getElementById('userAvatarImg');
    const ddAvatar = document.getElementById('userDropdownAvatar');
    const ddDisplayName = document.getElementById('userDropdownDisplayName');
    const ddUsername = document.getElementById('userDropdownUsername');
    const ddRoles = document.getElementById('userDropdownRoles');

    try {
        const meRes = await fetch('/api/me', { credentials: 'same-origin' });
        if (!meRes.ok) throw new Error('Failed to load user');
        const meRaw = await meRes.json();
        const me = meRaw.user || meRaw;

        let avatarUrl = defaultAvatar;
        if (me.avatar) {
            if (typeof me.avatar === 'string' && me.avatar.startsWith('http')) {
                avatarUrl = me.avatar;
            } else if (me.id) {
                const ext = me.avatar.startsWith('a_') ? 'gif' : 'png';
                avatarUrl = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${ext}?size=128`;
            }
        } else if (me.id) {
            try {
                const index = Number(BigInt(me.id) >> 22n) % 6;
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
            } catch {
                avatarUrl = defaultAvatar;
            }
        }

        if (avatarBtnImg) {
            avatarBtnImg.src = avatarUrl;
            avatarBtnImg.onerror = () => { avatarBtnImg.src = defaultAvatar; };
        }
        if (ddAvatar) {
            ddAvatar.src = avatarUrl;
            ddAvatar.onerror = () => { ddAvatar.src = defaultAvatar; };
        }
        const sideAvatar = document.getElementById('sideUserAvatar');
        if (sideAvatar) {
            sideAvatar.src = avatarUrl;
            sideAvatar.onerror = () => { sideAvatar.src = defaultAvatar; };
        }

        let displayName = me.displayName || me.global_name || me.username || 'User';
        const username = me.username || '';
        const sideName = document.getElementById('sideUserName');
        if (sideName) sideName.textContent = displayName;
        const ssAvatar = document.getElementById('ssUserAvatar');
        if (ssAvatar) {
            ssAvatar.src = avatarUrl;
            ssAvatar.onerror = () => { ssAvatar.src = defaultAvatar; };
        }
        const ssName = document.getElementById('ssUserName');
        if (ssName) ssName.textContent = displayName;
        refreshSideUserRole();

        if (ddDisplayName) ddDisplayName.textContent = displayName;
        if (ddUsername) {
            ddUsername.textContent = username || (me.id ? `ID: ${me.id}` : '—');
            ddUsername.title = me.id ? `ID: ${me.id}` : '';
            if (me.id) {
                ddUsername.style.cursor = 'pointer';
                ddUsername.onclick = () => {
                    navigator.clipboard.writeText(me.id).then(() => {
                        showToast('User ID copied');
                    }).catch(() => {});
                };
            }
        }

        const rolesSection = document.getElementById('userDropdownRolesSection');
        if (rolesSection) rolesSection.classList.add('hidden');

        try {
            const fullRes = await fetch('/api/me/full', { credentials: 'same-origin' });
            if (fullRes.ok) {
                const full = await fullRes.json();

                if (full.avatar) {
                    const fullAvatar = full.avatar;
                    if (avatarBtnImg) {
                        avatarBtnImg.src = fullAvatar;
                        avatarBtnImg.onerror = () => { avatarBtnImg.src = defaultAvatar; };
                    }
                    if (ddAvatar) {
                        ddAvatar.src = fullAvatar;
                        ddAvatar.onerror = () => { ddAvatar.src = defaultAvatar; };
                    }
                    const sideAvatar2 = document.getElementById('sideUserAvatar');
                    if (sideAvatar2) {
                        sideAvatar2.src = fullAvatar;
                        sideAvatar2.onerror = () => { sideAvatar2.src = defaultAvatar; };
                    }
                }

                if (full.displayName) {
                    displayName = full.displayName;
                    if (ddDisplayName) ddDisplayName.textContent = displayName;
                    const sideName2 = document.getElementById('sideUserName');
                    if (sideName2) sideName2.textContent = displayName;
                }
            }
        } catch (err) {
            console.error('[ME-FULL]', err);
        }
    } catch (e) {
        console.error('[USER-MENU] Error:', e);
        if (ddDisplayName) ddDisplayName.textContent = 'User';
        if (ddUsername) ddUsername.textContent = '—';
    }
}

async function loadUserRolesForGuild(guildId) {
    const rolesSection = document.getElementById('userDropdownRolesSection');
    const ddRoles = document.getElementById('userDropdownRoles');
    if (!guildId || !rolesSection || !ddRoles) return;

    ddRoles.innerHTML = '<span class="loading-text">Loading...</span>';
    rolesSection.classList.remove('hidden');

    try {
        const fullRes = await fetch(`/api/me/full?guildId=${guildId}`, { credentials: 'same-origin' });
        if (!fullRes.ok) throw new Error('Failed to load roles');
        const full = await fullRes.json();
        const roles = Array.isArray(full.roles) ? full.roles : [];

        if (roles.length === 0) {
            ddRoles.innerHTML = '<span class="loading-text">No roles</span>';
        } else {
            ddRoles.innerHTML = roles.map(r => {
                const rawColor = r.color;
                const hasColor = typeof rawColor === 'string' && rawColor !== '#000000' && rawColor !== '#000';
                const bright = hasColor ? brightenColor(rawColor, 50) : null;
                const style = bright
                    ? `style="color:${bright}; border-color:${bright}66; background:${bright}22; box-shadow:0 0 8px ${bright}55, inset 0 0 8px ${bright}22;"`
                    : '';
                return `<span class="user-role-badge" ${style}>${escapeHtml(r.name)}</span>`;
            }).join('');
        }
    } catch (err) {
        console.error('[ME-FULL]', err);
        ddRoles.innerHTML = '<span class="loading-text">Error</span>';
    }
}

async function loadMyPermissions() {
    try {
        const url = currentGuild ? `/api/my-permissions?guildId=${currentGuild}` : '/api/my-permissions';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load user permissions');
        myPermissions = await res.json();
    } catch (e) {
        console.error('[MY-PERMISSIONS] Error:', e);
        myPermissions = { createRoles: false, editRoles: false, deleteRoles: false, viewLogsRoles: false, managePermissions: false };
    }
}

function updatePermissionsTabVisibility() {
    const permTab = document.getElementById('navTabPermissions');
    const configTab = document.getElementById('navTabConfig');
    const ticketsTab = document.getElementById('navTabTickets');

    if (permTab) {
        if (myPermissions.managePermissions) permTab.classList.remove('hidden');
        else permTab.classList.add('hidden');
    }

    const isCommunity = selectedServer === 'community';

    if (configTab) {
        if (isOwner()) configTab.classList.remove('hidden');
        else configTab.classList.add('hidden');
    }

    if (ticketsTab) {
        if (selectedServer === 'predcord' && isOwner()) ticketsTab.classList.remove('hidden');
        else ticketsTab.classList.add('hidden');
    }

    const roleSyncTab = document.getElementById('navTabRoleSync');
    if (roleSyncTab) {
        if (canRoleSync) roleSyncTab.classList.remove('hidden');
        else roleSyncTab.classList.add('hidden');
    }

    const dropmapsTab = document.getElementById('navTabDropmaps');
    if (dropmapsTab) {
        if (canDropmaps && isCommunity) dropmapsTab.classList.remove('hidden');
        else dropmapsTab.classList.add('hidden');
    }

    const statsTab = document.getElementById('navTabStats');
    if (statsTab) {
        if (isOwner()) statsTab.classList.remove('hidden');
        else statsTab.classList.add('hidden');
    }

    const videosTab = document.getElementById('navTabVideos');
    if (videosTab) {
        if (isOwner() || canAccessMasterclass) videosTab.classList.remove('hidden');
        else videosTab.classList.add('hidden');
    }

    const mcTicketsTab = document.getElementById('navTabMcTickets');
    if (mcTicketsTab) {
        if (isOwner() || canMcTickets) mcTicketsTab.classList.remove('hidden');
        else mcTicketsTab.classList.add('hidden');
    }

    const mcPermissionsTab = document.getElementById('navTabMasterclassPermissions');
    if (mcPermissionsTab) {
        if (isOwner()) mcPermissionsTab.classList.remove('hidden');
        else mcPermissionsTab.classList.add('hidden');
    }

    if (isCommunity) {
        const activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && (activeTab.dataset.tab === 'config' || activeTab.dataset.tab === 'tickets')) {
            const commandsTab = document.querySelector('.nav-tab[data-tab="commands"]');
            if (commandsTab) commandsTab.click();
        }
    } else {
        const activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.dataset.tab === 'dropmaps') {
            const commandsTab = document.querySelector('.nav-tab[data-tab="commands"]');
            if (commandsTab) commandsTab.click();
        }
    }
}

const SERVER_INFO = {
    community: { name: 'Predage Community', img: '/images/dragon-pfp.webp' },
    predcord: { name: 'PredCord', img: '/images/predcord-pfp.webp' },
    masterclassServer: { name: 'Masterclass', img: '/images/masterclass-pfp.png' }
};

let masterclassGuildKey = 'masterclassServer';

async function selectServer(server) {
    const guildNav = document.getElementById('guildNavTabs');
    const mcNav = document.getElementById('masterclassNavTabs');

    if (server === 'masterclass') {
        if (!isOwner() && !canAccessMasterclass && !canMcTickets) return;
        selectedServer = 'masterclass';
        saveDashState({ server: 'masterclass', tab: null });

        if (guildNav) guildNav.classList.add('hidden');
        if (mcNav) mcNav.classList.remove('hidden');

        const badge = document.getElementById('currentServerBadge');
        const badgeImg = document.getElementById('currentServerBadgeImg');
        const badgeName = document.getElementById('currentServerBadgeName');
        if (badgeImg) badgeImg.src = '/images/dragon-logo.png';
        if (badgeName) badgeName.textContent = 'Masterclass Control';
        if (badge) badge.classList.remove('hidden');

        const selectScreen = document.getElementById('serverSelectScreen');
        const dashboardMain = document.getElementById('dashboardMain');
        if (selectScreen) selectScreen.classList.add('hidden');
        if (dashboardMain) dashboardMain.classList.remove('hidden');

        await ensureKnownGuilds();
        setMasterclassGuild(masterclassGuildKey);
        updatePermissionsTabVisibility();
        return;
    }

    if (!SERVER_INFO[server]) return;
    if (serverAccess && serverAccess[server] === false) return;
    selectedServer = server;
    saveDashState({ server: server, tab: null });

    if (guildNav) guildNav.classList.remove('hidden');
    if (mcNav) mcNav.classList.add('hidden');

    const badge = document.getElementById('currentServerBadge');
    const badgeImg = document.getElementById('currentServerBadgeImg');
    const badgeName = document.getElementById('currentServerBadgeName');
    if (badgeImg) badgeImg.src = SERVER_INFO[server].img;
    if (badgeName) badgeName.textContent = SERVER_INFO[server].name;
    if (badge) badge.classList.remove('hidden');

    const selectScreen = document.getElementById('serverSelectScreen');
    const dashboardMain = document.getElementById('dashboardMain');
    if (selectScreen) selectScreen.classList.add('hidden');
    if (dashboardMain) dashboardMain.classList.remove('hidden');

    await ensureKnownGuilds();
    currentGuild = knownGuilds[server] || null;

    loadUserRolesForGuild(currentGuild);

    rolesLoaded = false;
    configLoaded = false;

    await loadMyPermissions();
    updatePermissionsTabVisibility();
    refreshSideUserRole();

    const commandsTab = document.querySelector('.nav-tab[data-tab="commands"]');
    if (commandsTab) commandsTab.click();

    loadPermissions();
}

function setMasterclassGuild(key) {
    masterclassGuildKey = 'masterclassServer';
    currentGuild = knownGuilds.masterclassServer || '1557430638783627304';

    rolesLoaded = false;

    if (isOwner() || canAccessMasterclass) {
        const videosTab = document.getElementById('navTabVideos');
        if (videosTab) videosTab.click();
    } else {
        const ticketsTab = document.getElementById('navTabMcTickets');
        if (ticketsTab) ticketsTab.click();
    }
}

function showServerSelectScreen() {
    clearDashState();
    const selectScreen = document.getElementById('serverSelectScreen');
    const dashboardMain = document.getElementById('dashboardMain');
    if (selectScreen) selectScreen.classList.remove('hidden');
    if (dashboardMain) dashboardMain.classList.add('hidden');

    const rolesSection = document.getElementById('userDropdownRolesSection');
    if (rolesSection) rolesSection.classList.add('hidden');
}

async function loadGuilds() {
    try {
        const res = await fetch('/api/guilds');
        if (!res.ok) throw new Error('GET /api/guilds → ' + res.status);
        const guilds = await res.json();

        if (!Array.isArray(guilds) || guilds.length === 0) {
            document.getElementById('commandsList').innerHTML =
                '<div class="empty-state"><h3>No server found</h3><p>Invite the bot to a server</p></div>';
            return;
        }

        currentGuild = guilds[0].id;
        await loadPermissions();
        await loadCommands();
    } catch (e) {
        console.error('[INIT] loadGuilds error:', e);
        document.getElementById('commandsList').innerHTML =
            `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

async function loadPermissions() {
    if (!currentGuild) return;
    try {
        const res = await fetch(`/api/permissions/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load permissions');
        dashboardPermissions = await res.json();
    } catch (e) {
        console.error('[PERMISSIONS] loadPermissions error:', e);
        dashboardPermissions = { createRoles: [], editRoles: [], deleteRoles: [], viewLogsRoles: [], adminUsers: [], ownerUsers: [], projectedRoles: [] };
    }
}

function userHasDashboardPermission(permKey) {
    if (isAdmin) return true;
    return !!myPermissions[permKey];
}

async function loadCommands() {
    if (!currentGuild) {
        document.getElementById('commandsList').innerHTML =
            '<div class="empty-state"><h3>No server selected</h3></div>';
        return;
    }
    const list = document.getElementById('commandsList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/commands/${currentGuild}`);
        if (!res.ok) throw new Error(`GET /api/commands → status ${res.status}`);
        currentCommands = await res.json();
        renderCommands();
    } catch (e) {
        console.error('[INIT] loadCommands error:', e);
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderCommands() {
    const list = document.getElementById('commandsList');
    const entries = Object.entries(currentCommands);

    if (entries.length === 0) {
        list.innerHTML = `<div class="empty-state">
            <h3>No custom commands</h3>
            <p>Click "+ New Command" to create one</p>
        </div>`;
        return;
    }

    list.innerHTML = entries.map(([name, cmd]) => {
        let badge = '<span class="command-badge none">No roles</span>';
        if (Array.isArray(cmd.allowedRoles) && cmd.allowedRoles.length > 0) {
            badge = `<span class="command-badge roles">${cmd.allowedRoles.length} role${cmd.allowedRoles.length === 1 ? '' : 's'}</span>`;
        }

        const typeLabels = { text: 'Normal', embed: 'Embed', ban: 'Ban', kick: 'Kick', mute: 'Mute', warn: 'Warn', role: 'Role' };
        const typeBadge = `<span class="command-badge type">${escapeHtml(typeLabels[cmd.type || 'text'] || cmd.type)}</span>`;
        const offBadge = cmd.enabled === false ? '<span class="command-badge none">Disabled</span>' : '';

        const cardClass = 'command-card';

        return `
        <div class="${cardClass}">
            <div class="command-info">
                <h4>${escapeHtml((cmd.prefix || '*') + name)}</h4>
                <div class="command-badges">${typeBadge}${badge}${offBadge}</div>
            </div>
            <div class="command-actions">
                <button class="btn-edit" data-name="${escapeAttr(name)}">Edit</button>
                <button class="btn-delete" data-name="${escapeAttr(name)}">Delete</button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => {
        if (!userHasDashboardPermission('editRoles')) {
            showAccessDenied();
            return;
        }
        openModal(b.dataset.name);
    });

    list.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => {
        if (!userHasDashboardPermission('deleteRoles')) {
            showAccessDenied();
            return;
        }
        deleteCommand(b.dataset.name);
    });
}

function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '...' : str;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/"/g, '&quot;');
}

async function loadVideos() {
    const newVideoBtn = document.getElementById('newVideoBtn');
    if (newVideoBtn) newVideoBtn.classList.toggle('hidden', !isOwner() && !canUploadVideos);

    const list = document.getElementById('videosList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch('/api/videos');
        if (!res.ok) throw new Error(`GET /api/videos → status ${res.status}`);
        currentVideos = await res.json();
        renderVideos();
    } catch (e) {
        console.error('[VIDEOS] loadVideos error:', e);
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
    loadVideoAccessRoles();
}

async function loadVideoAccessRoles() {
    if (!currentGuild) return;
    const list = document.getElementById('videoAccessRolesList');
    list.innerHTML = '<p class="loading-text">Loading...</p>';
    try {
        const [rolesRes, accessRes] = await Promise.all([
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/video-access/${currentGuild}`)
        ]);
        if (!rolesRes.ok) throw new Error('Failed to load roles');
        if (!accessRes.ok) throw new Error('Failed to load video access');

        const roles = await rolesRes.json();
        const access = await accessRes.json();
        const selected = Array.isArray(access.roleIds) ? access.roleIds : [];

        if (!roles || roles.length === 0) {
            list.innerHTML = '<p class="loading-text">No roles available.</p>';
            return;
        }

        list.innerHTML = roles.map(role => {
            const checked = selected.includes(role.id) ? 'checked' : '';
            return `
            <div class="role-item" data-role-id="${escapeAttr(role.id)}">
                <span class="role-name">${escapeHtml(role.name)}</span>
                <label class="role-toggle">
                    <input type="checkbox" class="role-toggle-input video-access-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                    <span class="role-toggle-switch"></span>
                </label>
            </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
    }
}

async function saveVideoAccessRoles() {
    if (!currentGuild) return;
    const btn = document.getElementById('saveVideoAccessBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const roleIds = Array.from(document.querySelectorAll('#videoAccessRolesList .video-access-toggle-input:checked'))
        .map(cb => cb.value);

    try {
        const res = await fetch(`/api/video-access/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleIds })
        });
        if (!res.ok) throw new Error(`POST /api/video-access → status ${res.status}`);
        showToast('Access saved');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function renderVideos() {
    const list = document.getElementById('videosList');
    const migrateBtn = document.getElementById('migrateVideosBtn');

    const canManage = isOwner() || canManageVideos;
    const pendingCount = Array.isArray(currentVideos) ? currentVideos.filter(v => !v.hlsReady).length : 0;

    if (migrateBtn) {
        migrateBtn.classList.toggle('hidden', !canManage || pendingCount === 0);
        migrateBtn.textContent = pendingCount > 0 ? `Protect Old Videos (${pendingCount})` : 'Protect Old Videos';
    }

    if (!Array.isArray(currentVideos) || currentVideos.length === 0) {
        list.innerHTML = `<div class="empty-state">
            <h3>No videos</h3>
            <p>Click "+ New Video" to upload one</p>
        </div>`;
        return;
    }

    list.innerHTML = currentVideos.map(v => {
        const roleCount = Array.isArray(v.requiredRoleIds) ? v.requiredRoleIds.length : 0;
        const badge = roleCount > 0
            ? `<span class="command-badge roles">${roleCount} role${roleCount === 1 ? '' : 's'}</span>`
            : '<span class="command-badge none">Everyone</span>';
        const protectionBadge = v.hlsReady
            ? '<span class="command-badge none">Protected</span>'
            : '<span class="command-badge roles">Not protected</span>';
        const thumb = v.thumbnailUrl
            ? `<img class="video-thumb" src="${escapeAttr(v.thumbnailUrl)}" alt="">`
            : `<div class="video-thumb video-thumb-empty">&#9654;</div>`;

        const actions = canManage
            ? `<div class="command-actions">
                <button class="btn-edit" data-id="${escapeAttr(v._id)}">Edit</button>
                <button class="btn-delete" data-id="${escapeAttr(v._id)}">Delete</button>
            </div>`
            : '';

        return `
        <div class="video-card">
            ${thumb}
            <div class="video-card-body">
                <h4>${escapeHtml(v.title)}</h4>
                <div class="command-badges">${badge}${protectionBadge}</div>
            </div>
            ${actions}
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-edit').forEach(b => b.onclick = () => {
        const video = currentVideos.find(v => v._id === b.dataset.id);
        if (video) openVideoModal(video);
    });
    list.querySelectorAll('.btn-delete').forEach(b => b.onclick = () => deleteVideo(b.dataset.id));
}

async function migrateOldVideos() {
    const btn = document.getElementById('migrateVideosBtn');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.textContent = 'Protecting...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/videos/migrate-hls', { method: 'POST' });
        if (!res.ok) throw new Error(`POST /api/videos/migrate-hls → status ${res.status}`);
        const data = await res.json();
        const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
        if (failedCount > 0) {
            showToast(`Protected ${data.migrated.length}, failed ${failedCount}`, 'error');
        } else {
            showToast(`Protected ${data.migrated.length} video(s)`);
        }
        loadVideos();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

let videoPreviewObjectUrl = null;

function resetVideoFilePreview() {
    const preview = document.getElementById('videoFilePreview');
    if (videoPreviewObjectUrl) {
        URL.revokeObjectURL(videoPreviewObjectUrl);
        videoPreviewObjectUrl = null;
    }
    if (preview) {
        preview.pause();
        preview.removeAttribute('src');
        preview.load();
        preview.classList.add('hidden');
    }

    const thumbFileInput = document.getElementById('videoThumbnailFile');
    if (thumbFileInput) thumbFileInput.value = '';

    const thumbPreview = document.getElementById('videoThumbnailPreview');
    if (thumbPreview) {
        thumbPreview.removeAttribute('src');
        thumbPreview.classList.add('hidden');
    }

    const thumbInput = document.getElementById('videoThumbnail');
    if (thumbInput) thumbInput.value = '';
}

function openVideoModal(video) {
    editingVideoId = video ? video._id : null;
    videoRolesLoaded = false;
    const form = document.getElementById('videoForm');
    if (form) form.reset();
    resetVideoFilePreview();

    const modalTitle = document.querySelector('#videoModal h2');
    if (modalTitle) modalTitle.textContent = video ? 'Edit Video' : 'New Video';

    const fileHint = document.getElementById('videoFileHint');
    if (fileHint) {
        fileHint.textContent = video
            ? 'MP4 only. Leave empty to keep the current video file.'
            : 'MP4 only. Large files may take a while to upload.';
    }

    const submitBtn = document.querySelector('#videoForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = video ? 'Update Video' : 'Save Video';

    if (video) {
        const titleInput = document.getElementById('videoTitle');
        const descInput = document.getElementById('videoDescription');
        if (titleInput) titleInput.value = video.title || '';
        if (descInput) descInput.value = video.description || '';

        if (video.thumbnailUrl) {
            const thumbInput = document.getElementById('videoThumbnail');
            const thumbPreview = document.getElementById('videoThumbnailPreview');
            if (thumbInput) thumbInput.value = video.thumbnailUrl;
            if (thumbPreview) {
                thumbPreview.src = video.thumbnailUrl;
                thumbPreview.classList.remove('hidden');
            }
        }
    }

    document.getElementById('videoRolesList').innerHTML = '<p class="loading-text">Loading roles...</p>';
    document.getElementById('videoModal').classList.remove('hidden');
    loadVideoRoles(video ? (video.requiredRoleIds || []) : []);
}

function closeVideoModal() {
    document.getElementById('videoModal').classList.add('hidden');
    resetVideoFilePreview();
}

let videoPreselectedRoleIds = [];

async function loadVideoRoles(preselected = []) {
    if (!currentGuild) return;
    videoPreselectedRoleIds = Array.isArray(preselected) ? preselected : [];
    const list = document.getElementById('videoRolesList');
    try {
        const res = await fetch(`/api/roles/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load roles');
        currentRoles = await res.json();
        videoRolesLoaded = true;
        renderVideoRoles();
    } catch (e) {
        list.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
    }
}

function renderVideoRoles() {
    const list = document.getElementById('videoRolesList');

    if (!currentRoles || currentRoles.length === 0) {
        list.innerHTML = '<p class="loading-text">No roles available.</p>';
        return;
    }

    list.innerHTML = currentRoles.map(role => {
        const checked = videoPreselectedRoleIds.includes(role.id) ? 'checked' : '';
        return `
        <div class="role-item" data-role-id="${escapeAttr(role.id)}">
            <span class="role-name">${escapeHtml(role.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input video-role-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');
}

async function saveVideo(e) {
    e.preventDefault();

    const isEditing = !!editingVideoId;
    const titleInput = document.getElementById('videoTitle');
    const descInput = document.getElementById('videoDescription');
    const fileInput = document.getElementById('videoFile');

    const title = titleInput.value.trim();
    const description = descInput.value.trim();
    const file = fileInput.files[0];

    let invalid = false;
    if (title.length < 5) {
        markFieldInvalid(titleInput);
        invalid = true;
    }
    if (description.length < 5) {
        markFieldInvalid(descInput);
        invalid = true;
    }
    if (!file && !isEditing) {
        markFieldInvalid(fileInput);
        invalid = true;
    } else if (file && file.type !== 'video/mp4') {
        markFieldInvalid(fileInput);
        invalid = true;
        showFormToast('Only MP4 files are allowed');
        shakeModal('#videoModal');
        return;
    }

    if (invalid) {
        showFormToast('Title and description must be at least 5 characters');
        shakeModal('#videoModal');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = isEditing ? 'Saving...' : 'Uploading...';
    btn.disabled = true;

    let requiredRoleIds = [];
    if (videoRolesLoaded) {
        requiredRoleIds = Array.from(document.querySelectorAll('#videoRolesList .video-role-toggle-input:checked'))
            .map(cb => cb.value);
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('thumbnailUrl', document.getElementById('videoThumbnail').value.trim());
    formData.append('requiredRoleIds', JSON.stringify(requiredRoleIds));
    if (file) {
        formData.append('video', file);
        const previewEl = document.getElementById('videoFilePreview');
        if (previewEl && isFinite(previewEl.duration) && previewEl.duration > 0) {
            formData.append('duration', String(Math.round(previewEl.duration)));
        }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);

    try {
        const res = await fetch(isEditing ? `/api/videos/${editingVideoId}` : '/api/videos/upload', {
            method: isEditing ? 'PATCH' : 'POST',
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `${isEditing ? 'PATCH' : 'POST'} → status ${res.status}`);
        }
        closeVideoModal();
        loadVideos();
        showToast(isEditing ? 'Video updated' : 'Video uploaded');
    } catch (e) {
        clearTimeout(timeoutId);
        const message = e.name === 'AbortError' ? 'Upload timed out' : e.message;
        showToast(`Error: ${message}`, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

let masterclassPermissions = { viewUserIds: [], uploadUserIds: [], manageUserIds: [], ticketStaffUserIds: [], ticketNotifyChannelId: '' };

const MC_LIST_CONFIG = {
    view: { key: 'viewUserIds', containerId: 'mcViewUsersList', inputId: 'mcViewUserInput' },
    upload: { key: 'uploadUserIds', containerId: 'mcUploadUsersList', inputId: 'mcUploadUserInput' },
    manage: { key: 'manageUserIds', containerId: 'mcManageUsersList', inputId: 'mcManageUserInput' },
    tickets: { key: 'ticketStaffUserIds', containerId: 'mcTicketStaffList', inputId: 'mcTicketStaffInput' }
};

async function renderMcUsers(type) {
    const cfg = MC_LIST_CONFIG[type];
    if (!cfg) return;
    const list = document.getElementById(cfg.containerId);
    if (!list) return;
    const userIds = masterclassPermissions[cfg.key] || [];

    if (userIds.length === 0) {
        list.innerHTML = '<p class="loading-text">No users.</p>';
        return;
    }

    list.innerHTML = '';

    for (const userId of userIds) {
        const item = document.createElement('div');
        item.className = 'special-user-item';
        item.dataset.userId = userId;

        let username = `User ${userId}`;
        let avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

        try {
            const res = await fetch(`/api/user-info/${userId}`);
            if (res.ok) {
                const data = await res.json();
                username = data.displayName || data.username || username;
                avatar = data.avatar || avatar;
            }
        } catch {}

        item.innerHTML = `
            <img class="special-user-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="special-user-info">
                <div class="special-user-name">${escapeHtml(username)}</div>
                <div class="special-user-id">${escapeHtml(userId)}</div>
            </div>
            <button type="button" class="special-user-remove" data-user-id="${escapeAttr(userId)}" data-mc-type="${type}" title="Remove">&times;</button>
        `;

        list.appendChild(item);
    }

    list.querySelectorAll('.special-user-remove').forEach(btn => {
        btn.onclick = () => removeMcUser(btn.dataset.userId, btn.dataset.mcType);
    });
}

function removeMcUser(userId, type) {
    const cfg = MC_LIST_CONFIG[type];
    if (!cfg) return;
    masterclassPermissions[cfg.key] = (masterclassPermissions[cfg.key] || []).filter(id => id !== userId);
    renderMcUsers(type);
}

function addMcUser(type) {
    const cfg = MC_LIST_CONFIG[type];
    if (!cfg) return;
    const input = document.getElementById(cfg.inputId);
    if (!input) return;

    const userId = input.value.trim();
    if (!/^\d+$/.test(userId)) {
        showToast('Invalid Discord ID (numbers only)', 'error');
        return;
    }

    if (!masterclassPermissions[cfg.key]) masterclassPermissions[cfg.key] = [];
    if (masterclassPermissions[cfg.key].includes(userId)) {
        showToast('User already in this list', 'error');
        return;
    }

    masterclassPermissions[cfg.key].push(userId);
    input.value = '';
    renderMcUsers(type);
    showToast('User added (remember to save)');
}

async function loadMasterclassPermissions() {
    try {
        const res = await fetch('/api/masterclass/permissions');
        if (!res.ok) throw new Error('Failed to load permissions');
        masterclassPermissions = await res.json();
    } catch (e) {
        console.error('[MC-PERMISSIONS] load error:', e);
        masterclassPermissions = { viewUserIds: [], uploadUserIds: [], manageUserIds: [], ticketStaffUserIds: [], ticketNotifyChannelId: '' };
    }
    const notifyInput = document.getElementById('mcTicketNotifyChannelInput');
    if (notifyInput) notifyInput.value = masterclassPermissions.ticketNotifyChannelId || '';
    for (const type of Object.keys(MC_LIST_CONFIG)) {
        await renderMcUsers(type);
    }
}

async function saveMasterclassPermissions() {
    const btn = document.getElementById('saveMasterclassPermissionsBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const notifyInput = document.getElementById('mcTicketNotifyChannelInput');
    if (notifyInput) {
        const channelId = notifyInput.value.trim();
        if (channelId && !/^\d+$/.test(channelId)) {
            showToast('Invalid channel ID (numbers only)', 'error');
            btn.textContent = originalText;
            btn.disabled = false;
            return;
        }
        masterclassPermissions.ticketNotifyChannelId = channelId;
    }

    try {
        const res = await fetch('/api/masterclass/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(masterclassPermissions)
        });
        if (!res.ok) throw new Error(`POST /api/masterclass/permissions → status ${res.status}`);
        masterclassPermissions = await res.json();
        if (notifyInput) notifyInput.value = masterclassPermissions.ticketNotifyChannelId || '';
        showToast('Permissions saved');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function timeAgo(date) {
    if (!date) return '';
    const diff = Math.max(0, Date.now() - new Date(date).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeUntil(date) {
    const diff = new Date(date).getTime() - Date.now();
    if (diff <= 0) return 'a moment';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function loadMcTickets() {
    const list = document.getElementById('mcTicketsList');
    const count = document.getElementById('mcTicketsCount');
    if (!list) return;

    const filter = document.getElementById('mcTicketsFilter');
    if (filter && !filter.dataset.bound) {
        filter.dataset.bound = '1';
        filter.querySelectorAll('.stats-period-btn').forEach(btn => {
            btn.onclick = () => {
                filter.querySelectorAll('.stats-period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                mcTicketsStatus = btn.dataset.status;
                loadMcTickets();
            };
        });
    }

    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/masterclass/tickets?status=${encodeURIComponent(mcTicketsStatus)}`);
        if (res.status === 403) {
            showAccessDenied();
            list.innerHTML = '';
            return;
        }
        if (!res.ok) throw new Error('Failed to load tickets');
        const tickets = await res.json();
        const isTranscripts = mcTicketsStatus === 'transcripts';
        if (count) count.textContent = isTranscripts
            ? `${tickets.length} transcript${tickets.length === 1 ? '' : 's'} · closed tickets are deleted 24h after closing, transcripts are kept`
            : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;

        if (!tickets.length) {
            list.innerHTML = isTranscripts
                ? '<div class="empty-state"><h3>No transcripts</h3><p>Transcripts are saved when a ticket is closed</p></div>'
                : '<div class="empty-state"><h3>No tickets</h3><p>No Masterclass tickets in this view</p></div>';
            return;
        }

        list.innerHTML = tickets.map(t => {
            const num = String(t.ticketNumber).padStart(4, '0');
            const price = t.price ? ` · ${escapeHtml(t.price)} / month` : '';
            const statusLabel = t.status === 'open' ? 'Open' : t.status === 'closed' ? 'Closed' : 'Transcript';
            const claimChip = t.claimedByName
                ? `<span class="mc-ticket-claim claimed">Claimed by ${escapeHtml(t.claimedByName)}</span>`
                : (t.status === 'open' ? '<span class="mc-ticket-claim">Unclaimed</span>' : '');
            const deleteInfo = t.status === 'closed' && t.deleteAt
                ? `<span class="mc-ticket-delete">Deleted in ${escapeHtml(timeUntil(t.deleteAt))}</span>`
                : '';
            return `
            <a class="mc-ticket-card" href="/ticket/${t.ticketNumber}" target="_blank" rel="noopener">
                <img class="mc-ticket-avatar" src="${escapeAttr(t.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div class="mc-ticket-main">
                    <div class="mc-ticket-top">
                        <span class="mc-ticket-num">#${num}</span>
                        <span class="mc-ticket-plan">${escapeHtml(t.plan || '')}${price}</span>
                        <span class="mc-ticket-status ${escapeAttr(t.status)}">${statusLabel}</span>
                        ${claimChip}
                        ${deleteInfo}
                    </div>
                    <div class="mc-ticket-user">${escapeHtml(t.userName || t.userId)} · ${escapeHtml(t.email || '')}</div>
                </div>
                <div class="mc-ticket-time">${escapeHtml(timeAgo(t.lastMessageAt || t.createdAt))}</div>
            </a>`;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function deleteVideo(videoId) {
    showConfirmDialog('Delete video', 'Are you sure you want to delete this video?', async () => {
        try {
            const res = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`DELETE /api/videos → status ${res.status}`);
            loadVideos();
            showToast('Video deleted');
        } catch (e) {
            showToast(`Error: ${e.message}`, 'error');
        }
    });
}

const CM_MSG_TYPES = [
    { value: 'text', label: 'Normal', dot: '#f97316' },
    { value: 'embed', label: 'Embed', dot: '#f97316' }
];
const CM_ACTIONS = [
    { value: 'ban', label: 'Ban', dot: '#ef4444' },
    { value: 'kick', label: 'Kick', dot: '#ef4444' },
    { value: 'mute', label: 'Mute', dot: '#ef4444' },
    { value: 'warn', label: 'Warn', dot: '#ef4444' },
    { value: 'role', label: 'Role', dot: '#3b82f6' }
];
const CM_ROLE_ACTIONS = [
    { value: 'add', label: 'Add', sub: 'Gives the role' },
    { value: 'remove', label: 'Remove', sub: 'Takes the role away' },
    { value: 'toggle', label: 'Toggle', sub: 'Adds it, or removes it if present' },
    { value: 'temp', label: 'Temp Role', sub: 'Gives the role for a set time' },
    { value: 'remove_warn', label: 'Remove + Warn', sub: 'Removes the role and warns the user' },
    { value: 'remove_mute', label: 'Remove + Mute', sub: 'Removes the role and mutes the user' }
];
const CM_UNITS = [
    { value: 'minutes', label: 'Minutes' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' }
];
const CM_UNITS_BAN = CM_UNITS.concat([{ value: 'perm', label: 'Perm' }]);
const CM_COLORS = ['#2563eb', '#f97316', '#ef4444', '#22c55e', '#a855f7'];
const CM_UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 };
const CM_MAX_MUTE_MINUTES = 28 * 1440;

const CM_VARS_MSG = [
    ['Users', [
        ['{user}', 'Mentions who ran the command'],
        ['{username}', 'Their name'],
        ['{userid}', 'Their ID'],
        ['{target}', 'Mentioned user, or you']
    ]],
    ['Server', [
        ['{server}', 'Server name'],
        ['{membercount}', 'Member count'],
        ['{channel}', 'Current channel']
    ]],
    ['Command', [
        ['{args}', 'Everything after the command'],
        ['$1 $2 $3', 'Single arguments'],
        ['{md}', 'Moderation history'],
        ['{date}', "Today's date"],
        ['{hammertime+N}', 'Time N minutes from now']
    ]]
];
const CM_VARS_REASON = [
    ['Users', [
        ['{user}', 'Mentions the target'],
        ['{username}', 'Target name']
    ]],
    ['Server', [
        ['{server}', 'Server name'],
        ['{membercount}', 'Member count']
    ]],
    ['Command', [
        ['$1 $2 $3', 'Single arguments'],
        ['{md}', 'Moderation history'],
        ['{hammertime+N}', 'Time N minutes from now']
    ]]
];

const cmSelects = {};
let cmRoles = [];
let cmChannels = [];
let cmRolesLoaded = false;
let cmChannelsLoaded = false;
let cmSelRoles = new Set();
let cmSelChannels = new Set();
let cmPermTab = 'roles';
let cmExpanded = new Set();
let cmTargetRoleId = '';
let cmLoadToken = 0;
let cmCopyTimer = null;
let cmReady = false;

const CM_CHK = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
const CM_MINUS = '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
const CM_CHEV_R = '<svg class="cm-arw" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

function cmSelectInit(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return null;
    const st = {
        id,
        el,
        options: cfg.options || [],
        value: cfg.value || '',
        placeholder: cfg.placeholder || 'Select...',
        noneLabel: cfg.noneLabel || null,
        onChange: cfg.onChange || null,
        disabled: false
    };
    el.innerHTML = '<button type="button" class="cm-sel-btn"><span class="cm-sel-v"></span><svg viewBox="0 0 24 24"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></button>';
    st.btn = el.firstChild;
    st.btn.onclick = (e) => {
        e.stopPropagation();
        if (st.disabled) return;
        cmOpenSelect(st);
    };
    cmSelects[id] = st;
    cmSelectRender(st);
    return st;
}

function cmSelectRender(st) {
    const o = st.options.find(x => x.value === st.value);
    const v = st.btn.querySelector('.cm-sel-v');
    if (o) {
        v.className = 'cm-sel-v';
        v.innerHTML = (o.dot ? `<span class="cm-dot" style="background:${escapeAttr(o.dot)}"></span>` : '') + escapeHtml(o.label);
    } else {
        v.className = 'cm-sel-v ph';
        v.textContent = st.disabled ? 'Disabled' : st.placeholder;
    }
    st.el.classList.toggle('disabled', st.disabled);
}

function cmSelectGet(id) {
    return cmSelects[id] ? cmSelects[id].value : '';
}

function cmSelectSet(id, value) {
    const st = cmSelects[id];
    if (!st) return;
    st.value = value || '';
    cmSelectRender(st);
}

function cmSelectSetOptions(id, options) {
    const st = cmSelects[id];
    if (!st) return;
    st.options = options;
    cmSelectRender(st);
}

function cmSelectDisable(id, disabled) {
    const st = cmSelects[id];
    if (!st) return;
    st.disabled = !!disabled;
    cmSelectRender(st);
}

function cmClosePops() {
    const sel = document.getElementById('cmSelPop');
    const vr = document.getElementById('cmVarPop');
    if (sel) sel.classList.add('hidden');
    if (vr) vr.classList.add('hidden');
    const vb = document.getElementById('cmVarBtn');
    if (vb) vb.classList.remove('on');
}

function cmPlacePop(pop, anchor, minWidth) {
    const r = anchor.getBoundingClientRect();
    pop.style.minWidth = (minWidth || r.width) + 'px';
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.classList.remove('hidden');
    const ph = pop.offsetHeight;
    const pw = pop.offsetWidth;
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) {
        const above = r.top - ph - 4;
        top = above >= 8 ? above : Math.max(8, window.innerHeight - ph - 8);
    }
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
}

function cmOpenSelect(st) {
    const pop = document.getElementById('cmSelPop');
    const wasOpen = !pop.classList.contains('hidden') && pop.dataset.owner === st.id;
    cmClosePops();
    if (wasOpen) return;
    pop.dataset.owner = st.id;
    let html = '';
    if (st.noneLabel && st.value) {
        html += `<div class="cm-it none" data-v="">${escapeHtml(st.noneLabel)}</div>`;
    }
    html += st.options.map(o => {
        const sel = o.value === st.value;
        const dot = o.dot ? `<span class="cm-dot" style="background:${escapeAttr(o.dot)}"></span>` : '';
        const sub = o.sub ? `<span class="cm-sub">${escapeHtml(o.sub)}</span>` : '';
        return `<div class="cm-it${sel ? ' hl' : ''}" data-v="${escapeAttr(o.value)}">${dot}<div class="cm-it-main">${escapeHtml(o.label)}${sub}</div>${sel ? '<svg class="cm-ck" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' : ''}</div>`;
    }).join('');
    if (!st.options.length) html += '<div class="cm-it none">No options</div>';
    pop.innerHTML = html;
    pop.querySelectorAll('.cm-it[data-v]').forEach(item => {
        item.onclick = (e) => {
            e.stopPropagation();
            const v = item.dataset.v;
            cmClosePops();
            if (v === st.value) return;
            st.value = v;
            cmSelectRender(st);
            if (st.onChange) st.onChange(v);
        };
    });
    cmPlacePop(pop, st.btn, st.btn.offsetWidth);
}

function cmParseName() {
    const raw = (document.getElementById('cmdName').value || '').trim();
    let prefix = '*';
    let name = raw;
    if (raw && !/[a-zA-Z0-9]/.test(raw.charAt(0))) {
        prefix = raw.charAt(0);
        name = raw.slice(1);
    }
    name = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    return { prefix, name };
}

function cmUnitWord(n, unit) {
    const w = { minutes: 'minute', hours: 'hour', days: 'day' }[unit] || 'day';
    return `${n} ${w}${Number(n) === 1 ? '' : 's'}`;
}

function cmReadDuration(inputId, unitId) {
    const unit = cmSelectGet(unitId) || 'days';
    const raw = (document.getElementById(inputId).value || '').trim();
    const n = parseInt(raw, 10);
    return { unit, n: isNaN(n) || n < 1 ? null : n };
}

function cmCurrentKind() {
    const msg = cmSelectGet('cmMsgType');
    const action = cmSelectGet('cmAction');
    return { msg, action, type: msg || action || '' };
}

function cmRoleName(id) {
    const r = cmRoles.find(x => x.id === id);
    return r ? r.name : null;
}

function cmDurationVisible() {
    const { action } = cmCurrentKind();
    return action === 'ban' || action === 'mute';
}

function cmTempDurVisible() {
    const { action } = cmCurrentKind();
    const ra = cmSelectGet('cmRoleAction');
    return action === 'role' && (ra === 'temp' || ra === 'remove_mute');
}

function cmBuildInfo() {
    const { action } = cmCurrentKind();
    const { prefix, name } = cmParseName();
    const base = `${prefix}${name || 'name'}`;
    let usage = `${base} @user [reason]`;
    let text = '';
    if (action === 'ban') {
        const d = cmReadDuration('cmdDuration', 'cmDurUnit');
        if (d.unit === 'perm') text = 'Bans the user permanently';
        else text = d.n ? `Bans the user for ${cmUnitWord(d.n, d.unit)}` : 'Bans the user for a set time';
    } else if (action === 'kick') {
        text = 'Kicks the user from the server';
    } else if (action === 'mute') {
        const d = cmReadDuration('cmdDuration', 'cmDurUnit');
        text = d.n ? `Mutes the user for ${cmUnitWord(d.n, d.unit)}` : 'Mutes the user for 28 days';
    } else if (action === 'warn') {
        text = 'Warns the user';
    } else if (action === 'role') {
        const ra = cmSelectGet('cmRoleAction');
        const rn = cmRoleName(cmTargetRoleId);
        const r = `<b>${escapeHtml(rn || 'the role')}</b>`;
        usage = `${base} @user`;
        if (ra === 'add') text = `Gives ${r} to the user`;
        else if (ra === 'remove') text = `Removes ${r} from the user`;
        else if (ra === 'toggle') text = `Adds or removes ${r} from the user`;
        else if (ra === 'temp') {
            const d = cmReadDuration('cmdTempDuration', 'cmTempDurUnit');
            text = d.n ? `Gives ${r} to the user for ${cmUnitWord(d.n, d.unit)}` : `Gives ${r} to the user for a set time`;
        } else if (ra === 'remove_warn') {
            usage = `${base} @user [reason]`;
            text = `Removes ${r} and warns the user`;
        } else if (ra === 'remove_mute') {
            usage = `${base} @user [reason]`;
            const d = cmReadDuration('cmdTempDuration', 'cmTempDurUnit');
            text = d.n ? `Removes ${r} and mutes the user for ${cmUnitWord(d.n, d.unit)}` : `Removes ${r} and mutes the user`;
        } else {
            text = 'Changes a role of the user';
        }
    }
    return { usage, text };
}

function cmRefreshInfo() {
    const { msg, action } = cmCurrentKind();
    const info = document.getElementById('cmInfoSection');
    if (action && !msg) {
        const b = cmBuildInfo();
        document.getElementById('cmInfoUsage').textContent = b.usage;
        document.getElementById('cmInfoAction').innerHTML = b.text;
        info.classList.remove('hidden');
    } else {
        info.classList.add('hidden');
    }
    const pu = document.getElementById('cmPrevUsage');
    if (pu) {
        const { prefix, name } = cmParseName();
        pu.textContent = `${prefix}${name || 'name'}`;
    }
}

function updateTypeUI() {
    const { msg, action } = cmCurrentKind();
    const isMsg = !!msg;
    const isEmbed = msg === 'embed';
    const isText = msg === 'text';
    const isMod = ['ban', 'kick', 'mute', 'warn'].includes(action);
    const roleAct = cmSelectGet('cmRoleAction');
    const isRole = action === 'role';
    const showDur = action === 'ban' || action === 'mute';
    const roleReason = isRole && (roleAct === 'remove_warn' || roleAct === 'remove_mute');
    const hasContent = isMsg || isMod || roleReason;

    cmSelectDisable('cmAction', isMsg);
    cmSelectDisable('cmMsgType', !!action && !showDur && !isRole);

    document.getElementById('cmSlotMsg').classList.toggle('hidden', showDur || isRole);
    document.getElementById('cmSlotDur').classList.toggle('hidden', !showDur);
    document.getElementById('cmSlotRoleAct').classList.toggle('hidden', !isRole);
    document.getElementById('cmTargetRoleWrap').classList.toggle('hidden', !isRole);

    if (showDur) {
        const opts = action === 'ban' ? CM_UNITS_BAN : CM_UNITS;
        cmSelectSetOptions('cmDurUnit', opts);
        let u = cmSelectGet('cmDurUnit');
        if (!opts.find(o => o.value === u)) {
            u = action === 'ban' ? 'perm' : 'days';
            cmSelectSet('cmDurUnit', u);
        }
        const di = document.getElementById('cmdDuration');
        const perm = u === 'perm';
        di.disabled = perm;
        if (perm) di.value = '';
        di.placeholder = perm ? '-' : '0';
    }

    const tempDur = cmTempDurVisible();
    document.getElementById('cmTempDurWrap').classList.toggle('hidden', !tempDur);
    if (tempDur) {
        document.getElementById('cmTempDurLabel').textContent = roleAct === 'remove_mute' ? 'Mute duration' : 'Duration';
        if (!cmSelectGet('cmTempDurUnit')) cmSelectSet('cmTempDurUnit', 'days');
    }

    document.getElementById('labelTitle').classList.toggle('hidden', !isEmbed);
    document.getElementById('labelColor').classList.toggle('hidden', !isEmbed);
    document.getElementById('labelButtons').classList.toggle('hidden', !isMsg);
    document.getElementById('cmMoreWrap').classList.toggle('hidden', !isMsg);
    document.getElementById('labelThumbnail').classList.toggle('hidden', !isEmbed);
    document.getElementById('extraEmbedsWrap').classList.toggle('hidden', !isEmbed);
    document.getElementById('labelImage').classList.toggle('hidden', !isMsg);

    const resp = document.getElementById('labelResponse');
    resp.classList.toggle('hidden', !hasContent);
    const lbl = document.getElementById('responseLabelText');
    if (isText) lbl.innerHTML = 'Response <span class="cm-req">*</span>';
    else if (isEmbed) lbl.textContent = 'Description';
    else lbl.textContent = 'Default reason';

    document.getElementById('previewSection').classList.toggle('hidden', !isMsg);

    cmRefreshInfo();
    updatePreview();
}

function cmOnMsgChange(v) {
    if (v === 'embed') {
        const c = document.getElementById('cmdColor');
        if (c && /^#e67e22$/i.test(c.value)) c.value = '#2563eb';
        cmSyncColor();
    }
    updateTypeUI();
}

function cmOnActionChange(v) {
    if (v === 'ban') {
        const di = document.getElementById('cmdDuration');
        if (!di.value) cmSelectSet('cmDurUnit', 'perm');
    } else if (v === 'mute') {
        if (cmSelectGet('cmDurUnit') === 'perm') cmSelectSet('cmDurUnit', 'days');
    }
    if (v === 'role') {
        cmFillTargetRoles();
        cmEnsureGuildData();
    }
    updateTypeUI();
}

function cmFillTargetRoles() {
    const opts = cmRoles.map(r => ({
        value: r.id,
        label: r.name,
        dot: (r.color && r.color !== '#000000') ? r.color : '#a1a1aa'
    }));
    if (cmTargetRoleId && !opts.find(o => o.value === cmTargetRoleId)) {
        opts.unshift({ value: cmTargetRoleId, label: cmRolesLoaded ? 'Unknown role' : 'Loading...', dot: '#a1a1aa' });
    }
    cmSelectSetOptions('cmTargetRole', opts);
    cmSelectSet('cmTargetRole', cmTargetRoleId);
}

function cmSyncColor() {
    const c = document.getElementById('cmdColor');
    const hex = (c.value || '#2563eb').toLowerCase();
    document.querySelectorAll('#cmSwatches .cm-sw-item').forEach(b => {
        b.classList.toggle('sel', b.dataset.c.toLowerCase() === hex);
    });
    const h = document.getElementById('cmHex');
    if (h) h.textContent = hex.toUpperCase();
}

function cmBuildSwatches() {
    const wrap = document.getElementById('cmSwatches');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    const picker = document.getElementById('cmdColor');
    CM_COLORS.forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-sw-item';
        b.dataset.c = c;
        b.style.background = c;
        b.onclick = () => {
            picker.value = c;
            cmSyncColor();
            updatePreview();
        };
        wrap.insertBefore(b, picker);
    });
}

function cmUpdatePermBadges() {
    const rolesN = cmSelRoles.size;
    let chN;
    if (cmChannelsLoaded) {
        const textIds = cmChannels.filter(c => c.type !== 'category').map(c => c);
        chN = textIds.filter(c => cmSelChannels.has(c.id) || (c.parentId && cmSelChannels.has(c.parentId))).length;
    } else {
        chN = cmSelChannels.size;
    }
    document.getElementById('cmPermRoles').textContent = rolesN ? `${rolesN} role${rolesN === 1 ? '' : 's'}` : 'No roles';
    document.getElementById('cmPermChannels').textContent = chN ? `${chN} channel${chN === 1 ? '' : 's'}` : 'No channels';
    document.getElementById('cmTabRolesCount').textContent = rolesN;
    document.getElementById('cmTabChannelsCount').textContent = chN;
}

async function cmEnsureGuildData() {
    if (!currentGuild) return;
    const token = cmLoadToken;
    const guild = currentGuild;
    if (!cmRolesLoaded) {
        try {
            const res = await fetch(`/api/roles/${guild}`);
            if (res.ok) {
                const data = await res.json();
                if (token === cmLoadToken) {
                    cmRoles = data;
                    cmRolesLoaded = true;
                    cmFillTargetRoles();
                    cmRefreshInfo();
                    if (!document.getElementById('permissionsBox').classList.contains('hidden')) cmRenderPermList();
                }
            }
        } catch (e) {}
    }
    if (!cmChannelsLoaded) {
        try {
            const res = await fetch(`/api/channels/${guild}`);
            if (res.ok) {
                const data = await res.json();
                if (token === cmLoadToken) {
                    cmChannels = data;
                    cmChannelsLoaded = true;
                    cmUpdatePermBadges();
                    if (!document.getElementById('permissionsBox').classList.contains('hidden')) cmRenderPermList();
                }
            }
        } catch (e) {}
    }
}

function cmRenderPermList() {
    const list = document.getElementById('rolesList');
    const q = (document.getElementById('cmPermSearch').value || '').trim().toLowerCase();
    document.querySelectorAll('.cm-tab').forEach(t => t.classList.toggle('active', t.dataset.ptab === cmPermTab));
    document.getElementById('cmPermSearch').placeholder = cmPermTab === 'roles' ? 'Search roles...' : 'Search channels...';

    if (cmPermTab === 'roles') {
        if (!cmRolesLoaded) { list.innerHTML = '<div class="cm-empty">Loading...</div>'; return; }
        const rows = cmRoles.filter(r => !q || r.name.toLowerCase().includes(q));
        if (!rows.length) { list.innerHTML = '<div class="cm-empty">No roles</div>'; return; }
        list.innerHTML = rows.map(r => {
            const on = cmSelRoles.has(r.id);
            const col = (r.color && r.color !== '#000000') ? r.color : '#a1a1aa';
            return `<div class="cm-row" data-id="${escapeAttr(r.id)}"><span class="cm-cb${on ? ' on' : ''}">${on ? CM_CHK : ''}</span><span class="cm-dot" style="background:${escapeAttr(col)}"></span>${escapeHtml(r.name)}</div>`;
        }).join('');
        list.querySelectorAll('.cm-row').forEach(row => {
            row.onclick = () => {
                const id = row.dataset.id;
                if (cmSelRoles.has(id)) cmSelRoles.delete(id); else cmSelRoles.add(id);
                cmRenderPermList();
                cmUpdatePermBadges();
            };
        });
        return;
    }

    if (!cmChannelsLoaded) { list.innerHTML = '<div class="cm-empty">Loading...</div>'; return; }
    const cats = cmChannels.filter(c => c.type === 'category');
    const loose = cmChannels.filter(c => c.type !== 'category' && !c.parentId);
    const kidsOf = (id) => cmChannels.filter(c => c.type !== 'category' && c.parentId === id);
    const isOn = (c) => cmSelChannels.has(c.id) || (c.parentId && cmSelChannels.has(c.parentId));
    let html = '';
    loose.filter(c => !q || c.name.toLowerCase().includes(q)).forEach(c => {
        const on = isOn(c);
        html += `<div class="cm-row" data-ch="${escapeAttr(c.id)}"><span class="cm-cb${on ? ' on' : ''}">${on ? CM_CHK : ''}</span><span class="cm-hash">#</span>${escapeHtml(c.name)}</div>`;
    });
    cats.forEach(cat => {
        const kids = kidsOf(cat.id);
        const matchKids = q ? kids.filter(k => k.name.toLowerCase().includes(q)) : kids;
        if (q && !cat.name.toLowerCase().includes(q) && !matchKids.length) return;
        const shownKids = q && cat.name.toLowerCase().includes(q) && !matchKids.length ? kids : matchKids;
        const all = cmSelChannels.has(cat.id) || (kids.length > 0 && kids.every(k => cmSelChannels.has(k.id)));
        const some = !all && kids.some(k => cmSelChannels.has(k.id));
        const open = q ? true : cmExpanded.has(cat.id);
        const cnt = kids.filter(k => isOn(k)).length;
        const cbCls = all ? ' on' : (some ? ' on' : '');
        const cbIn = all ? CM_CHK : (some ? CM_MINUS : '');
        html += `<div class="cm-row cat" data-cat="${escapeAttr(cat.id)}"><svg class="cm-arw${open ? ' open' : ''}" data-arrow="1" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg><span class="cm-cb${cbCls}">${cbIn}</span><span class="cm-cn">${escapeHtml(cat.name)}</span>${cnt ? `<span class="cm-cnt">${cnt}</span>` : ''}</div>`;
        if (open) {
            shownKids.forEach(k => {
                const on = isOn(k);
                html += `<div class="cm-row kid" data-ch="${escapeAttr(k.id)}"><span class="cm-cb${on ? ' on' : ''}">${on ? CM_CHK : ''}</span><span class="cm-hash">#</span>${escapeHtml(k.name)}</div>`;
            });
        }
    });
    list.innerHTML = html || '<div class="cm-empty">No channels</div>';

    list.querySelectorAll('.cm-row[data-ch]').forEach(row => {
        row.onclick = () => cmToggleChannel(row.dataset.ch);
    });
    list.querySelectorAll('.cm-row.cat').forEach(row => {
        row.onclick = (e) => {
            const id = row.dataset.cat;
            if (e.target.closest('[data-arrow]')) {
                if (cmExpanded.has(id)) cmExpanded.delete(id); else cmExpanded.add(id);
                cmRenderPermList();
                return;
            }
            cmToggleCategory(id);
        };
    });
}

function cmToggleCategory(catId) {
    const kids = cmChannels.filter(c => c.type !== 'category' && c.parentId === catId);
    const all = cmSelChannels.has(catId) || (kids.length > 0 && kids.every(k => cmSelChannels.has(k.id)));
    if (all) {
        cmSelChannels.delete(catId);
        kids.forEach(k => cmSelChannels.delete(k.id));
    } else {
        cmSelChannels.add(catId);
        kids.forEach(k => cmSelChannels.add(k.id));
    }
    cmRenderPermList();
    cmUpdatePermBadges();
}

function cmToggleChannel(id) {
    const ch = cmChannels.find(c => c.id === id);
    if (!ch) return;
    const parent = ch.parentId;
    if (parent && cmSelChannels.has(parent)) {
        cmSelChannels.delete(parent);
        cmChannels.filter(c => c.type !== 'category' && c.parentId === parent).forEach(k => cmSelChannels.add(k.id));
    }
    if (cmSelChannels.has(id)) cmSelChannels.delete(id); else cmSelChannels.add(id);
    if (parent) {
        const kids = cmChannels.filter(c => c.type !== 'category' && c.parentId === parent);
        if (kids.length && kids.every(k => cmSelChannels.has(k.id))) cmSelChannels.add(parent);
        else cmSelChannels.delete(parent);
    }
    cmRenderPermList();
    cmUpdatePermBadges();
}

function openPermissionsBox() {
    cmClosePops();
    cmPermTab = 'roles';
    cmExpanded = new Set();
    document.getElementById('cmPermSearch').value = '';
    document.getElementById('permissionsBox').classList.remove('hidden');
    cmRenderPermList();
    cmEnsureGuildData();
}

function closePermissionsBox() {
    const box = document.getElementById('permissionsBox');
    if (box) box.classList.add('hidden');
    cmUpdatePermBadges();
}

function cmCopy(text) {
    const done = () => {
        const t = document.getElementById('cmCopyToast');
        t.querySelector('span').textContent = `Copied ${text}`;
        t.classList.remove('hidden');
        if (cmCopyTimer) clearTimeout(cmCopyTimer);
        cmCopyTimer = setTimeout(() => t.classList.add('hidden'), 1600);
    };
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
        fallback();
    }
}

function cmOpenVariables() {
    const pop = document.getElementById('cmVarPop');
    const btn = document.getElementById('cmVarBtn');
    const wasOpen = !pop.classList.contains('hidden');
    cmClosePops();
    if (wasOpen) return;
    const { msg } = cmCurrentKind();
    const groups = msg ? CM_VARS_MSG : CM_VARS_REASON;
    const cpy = '<svg class="cm-cpy" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    pop.innerHTML = groups.map(([g, items]) =>
        `<div class="cm-g">${escapeHtml(g)}</div>` + items.map(([c, d]) =>
            `<div class="cm-it" data-copy="${escapeAttr(c)}"><span class="cm-code">${escapeHtml(c)}</span><span class="cm-d">${escapeHtml(d)}</span>${cpy}</div>`
        ).join('')
    ).join('');
    pop.querySelectorAll('.cm-it[data-copy]').forEach(it => {
        it.onclick = (e) => {
            e.stopPropagation();
            cmCopy(it.dataset.copy);
        };
    });
    btn.classList.add('on');
    cmPlacePop(pop, btn, 400);
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.right - pw)) + 'px';
}

function cmInitComponents() {
    if (cmReady) return;
    cmSelectInit('cmMsgType', { options: CM_MSG_TYPES, placeholder: 'Select...', noneLabel: 'None', onChange: cmOnMsgChange });
    cmSelectInit('cmAction', { options: CM_ACTIONS, placeholder: 'Select...', noneLabel: 'None', onChange: cmOnActionChange });
    cmSelectInit('cmRoleAction', { options: CM_ROLE_ACTIONS, placeholder: 'Select...', onChange: updateTypeUI });
    cmSelectInit('cmDurUnit', { options: CM_UNITS_BAN, value: 'days', onChange: updateTypeUI });
    cmSelectInit('cmTempDurUnit', { options: CM_UNITS, value: 'days', onChange: updateTypeUI });
    cmSelectInit('cmTargetRole', {
        options: [],
        placeholder: 'Select a role...',
        onChange: (v) => { cmTargetRoleId = v; cmRefreshInfo(); }
    });
    cmBuildSwatches();
    cmReady = true;
}

function cmResetState() {
    cmSelectSet('cmMsgType', '');
    cmSelectSet('cmAction', '');
    cmSelectSet('cmRoleAction', '');
    cmSelectSet('cmDurUnit', 'days');
    cmSelectSet('cmTempDurUnit', 'days');
    cmTargetRoleId = '';
    cmSelectSet('cmTargetRole', '');
    cmSelRoles = new Set();
    cmSelChannels = new Set();
    cmPermTab = 'roles';
    cmExpanded = new Set();
}

function openModal(name = null) {
    if (!userHasDashboardPermission('createRoles') && !userHasDashboardPermission('editRoles')) {
        showAccessDenied();
        return;
    }

    cmInitComponents();
    clearInvalidFields();
    hideFormToast();
    cmClosePops();

    editingName = name;
    cmLoadToken++;
    cmRoles = [];
    cmChannels = [];
    cmRolesLoaded = false;
    cmChannelsLoaded = false;

    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('cmdForm');
    form.reset();
    cmResetState();
    document.getElementById('cmdDuration').disabled = false;

    if (name && currentCommands[name]) {
        const cmd = currentCommands[name];
        title.textContent = 'Edit command';
        const nameEl = document.getElementById('cmdName');
        nameEl.value = `${cmd.prefix || '*'}${name}`;
        nameEl.disabled = true;

        const type = cmd.type || 'text';
        if (type === 'text' || type === 'embed') cmSelectSet('cmMsgType', type);
        else if (['ban', 'kick', 'mute', 'warn', 'role'].includes(type)) cmSelectSet('cmAction', type);

        document.getElementById('cmdTitle').value = cmd.title || '';
        document.getElementById('cmdResponse').value = cmd.response || '';
        document.getElementById('cmdColor').value = '#' + (typeof cmd.color === 'number' ? cmd.color : 0x2563eb).toString(16).padStart(6, '0');
        document.getElementById('cmdThumbnail').value = cmd.thumbnail || '';
        document.getElementById('cmdImage').value = cmd.image || '';
        document.getElementById('cmdDelete').checked = cmd.deleteCommand !== false;
        document.getElementById('cmdEnabled').checked = cmd.enabled !== false;

        const unit = cmd.durationUnit || 'days';
        if (type === 'ban' || type === 'mute') {
            if (type === 'ban' && (!cmd.duration || unit === 'perm')) {
                cmSelectSet('cmDurUnit', 'perm');
            } else {
                cmSelectSet('cmDurUnit', unit === 'perm' ? 'days' : unit);
                document.getElementById('cmdDuration').value = cmd.duration || '';
            }
        }
        if (type === 'role') {
            cmSelectSet('cmRoleAction', cmd.roleAction || '');
            cmTargetRoleId = cmd.targetRoleId || '';
            cmSelectSet('cmTempDurUnit', unit === 'perm' ? 'days' : unit);
            document.getElementById('cmdTempDuration').value = cmd.duration || '';
        }

        cmSelRoles = new Set(Array.isArray(cmd.allowedRoles) ? cmd.allowedRoles : []);
        cmSelChannels = new Set(Array.isArray(cmd.blockedChannels) ? cmd.blockedChannels : []);

        clearExtraEmbeds();
        if (Array.isArray(cmd.extraEmbeds)) cmd.extraEmbeds.forEach(e => addEmbedBlock(e, true));
        clearButtons();
        if (Array.isArray(cmd.buttons)) cmd.buttons.forEach(b => addButtonBlock(b, true));
    } else {
        title.textContent = 'New command';
        document.getElementById('cmdName').disabled = false;
        document.getElementById('cmdColor').value = '#2563eb';
        document.getElementById('cmdThumbnail').value = '';
        document.getElementById('cmdImage').value = '';
        document.getElementById('cmdDelete').checked = true;
        document.getElementById('cmdEnabled').checked = true;
        clearExtraEmbeds();
        clearButtons();
    }

    cmSyncColor();
    cmFillTargetRoles();
    closePermissionsBox();
    closeMoreOptions();
    cmUpdatePermBadges();

    updateTypeUI();
    modal.classList.remove('hidden');
    cmEnsureGuildData();
    setTimeout(() => {
        const n = document.getElementById('cmdName');
        if (n && !n.disabled) n.focus();
    }, 100);
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.classList.add('hidden');
    cmClosePops();
    closePermissionsBox();
    closeMoreOptions();
    editingName = null;
    cmLoadToken++;
    clearInvalidFields();
    hideFormToast();
}

let extraEmbedCounter = 0;

function addEmbedBlock(data = {}, silent = false) {
    const list = document.getElementById('extraEmbedsList');
    if (!list) return;
    const idx = extraEmbedCounter++;
    const colorHex = '#' + (typeof data.color === 'number' ? data.color : 0x7289DA).toString(16).padStart(6, '0');
    const block = document.createElement('div');
    block.className = 'extra-embed-block';
    block.dataset.idx = idx;
    block.innerHTML = `
        <div class="extra-embed-header">
            <span>Embed</span>
            <button type="button" class="extra-embed-remove">&times;</button>
        </div>
        <label>Title</label>
        <input type="text" class="ee-title" value="${escapeAttr(data.title || '')}">
        <label>Description</label>
        <textarea class="ee-response" rows="3">${escapeHtml(data.response || '')}</textarea>
        <label>Color</label>
        <input type="color" class="ee-color" value="${colorHex}">
        <label>Thumbnail URL</label>
        <input type="url" class="ee-thumbnail" value="${escapeAttr(data.thumbnail || '')}">
        <label>Image URL</label>
        <input type="url" class="ee-image" value="${escapeAttr(data.image || '')}">
    `;
    block.querySelector('.extra-embed-remove').onclick = () => { block.remove(); updatePreview(); };
    block.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', updatePreview));
    list.appendChild(block);
    if (!silent) updatePreview();
}

function clearExtraEmbeds() {
    const list = document.getElementById('extraEmbedsList');
    if (list) list.innerHTML = '';
}

function collectExtraEmbeds() {
    return Array.from(document.querySelectorAll('#extraEmbedsList .extra-embed-block')).map(block => ({
        title: block.querySelector('.ee-title').value || '',
        response: block.querySelector('.ee-response').value || '',
        color: parseInt((block.querySelector('.ee-color').value || '#7289da').replace('#', ''), 16),
        thumbnail: block.querySelector('.ee-thumbnail').value || null,
        image: block.querySelector('.ee-image').value || null
    }));
}

let buttonBlockCounter = 0;

function updateAddButtonBtnState() {
    const list = document.getElementById('cmdButtonsList');
    const btn = document.getElementById('addButtonBtn');
    const counter = document.getElementById('cmBtnCount');
    if (!list || !btn) return;
    const count = list.querySelectorAll('.cmd-button-block').length;
    btn.disabled = count >= 5;
    if (counter) {
        if (count >= 1) {
            counter.textContent = `${count}/5`;
            counter.classList.remove('hidden');
        } else {
            counter.textContent = '';
            counter.classList.add('hidden');
        }
    }
}

function addButtonBlock(data = {}, silent = false) {
    const list = document.getElementById('cmdButtonsList');
    if (!list) return;
    if (list.querySelectorAll('.cmd-button-block').length >= 5) return;
    const idx = buttonBlockCounter++;
    const block = document.createElement('div');
    block.className = 'cm-btn-row cmd-button-block';
    block.dataset.idx = idx;
    block.innerHTML = `
        <input type="text" class="cm-input cb-label" maxlength="80" value="${escapeAttr(data.label || '')}" placeholder="Label">
        <input type="url" class="cm-input cb-url" value="${escapeAttr(data.url || '')}" placeholder="https://...">
        <button type="button" class="cm-icon-btn extra-embed-remove" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    `;
    block.querySelector('.extra-embed-remove').onclick = () => { block.remove(); updateAddButtonBtnState(); updatePreview(); };
    block.querySelectorAll('input').forEach(el => el.addEventListener('input', updatePreview));
    list.appendChild(block);
    updateAddButtonBtnState();
    if (!silent) updatePreview();
}

function clearButtons() {
    const list = document.getElementById('cmdButtonsList');
    if (list) list.innerHTML = '';
    updateAddButtonBtnState();
}

function collectButtons() {
    return Array.from(document.querySelectorAll('#cmdButtonsList .cmd-button-block'))
        .map(block => ({
            label: block.querySelector('.cb-label').value || '',
            url: block.querySelector('.cb-url').value || ''
        }))
        .filter(b => b.label.trim() && b.url.trim());
}

function closeMoreOptions() {
    const panel = document.getElementById('moreOptions');
    const btn = document.getElementById('moreBtn');
    if (panel) panel.classList.add('hidden');
    if (btn) btn.classList.remove('open');
}

function toggleMoreOptions() {
    const panel = document.getElementById('moreOptions');
    const btn = document.getElementById('moreBtn');
    if (!panel || !btn) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    btn.classList.toggle('open', isHidden);
}

function renderPreviewEmbed(title, colorHex, thumbnail, responseRaw, text, image) {
    let html = `<div class="discord-embed" style="border-left-color: ${escapeAttr(colorHex)};">`;
    if (thumbnail) {
        html += `<img class="discord-embed-thumb" src="${escapeAttr(thumbnail)}" alt="" onerror="this.style.display='none'">`;
    }
    if (title) {
        html += `<div class="discord-embed-title">${escapeHtml(title)}</div>`;
    }
    if (responseRaw.trim()) {
        html += `<div class="discord-embed-desc">${escapeHtml(text)}</div>`;
    } else {
        html += `<div class="discord-embed-desc preview-empty">Fill in the description to see the text.</div>`;
    }
    if (image) {
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;discord-embed-image-error&quot;>Image not loading (link expired or invalid)</div>'">`;
    }
    html += `</div>`;
    return html;
}

function renderPreviewButtons() {
    const buttons = collectButtons();
    if (!buttons.length) return '';
    let html = '<div class="discord-buttons-row">';
    buttons.forEach(b => {
        html += `<span class="discord-link-button">${escapeHtml(b.label)}</span>`;
    });
    html += '</div>';
    return html;
}

function cmPreviewText(raw) {
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return String(raw || '')
        .replace(/{user}/g, '@Mario')
        .replace(/{username}/g, 'Mario')
        .replace(/{userid}/g, '123456789012345678')
        .replace(/{target}/g, '@Mario')
        .replace(/{server}/g, 'PredCord')
        .replace(/{membercount}/g, '42')
        .replace(/{channel}/g, '#general')
        .replace(/{date}/g, date)
        .replace(/{args}/g, 'example args')
        .replace(/{md}/g, '[modlogs placeholder]')
        .replace(/{hammertime[+-]\d+}/g, '[time]')
        .replace(/\$(\d+)/g, (m, num) => `[arg${num}]`);
}

function updatePreview() {
    const preview = document.getElementById('previewContent');
    if (!preview) return;
    if (!cmSelects.cmMsgType) return;

    const { msg } = cmCurrentKind();
    cmRefreshInfo();
    if (!msg) return;

    const response = document.getElementById('cmdResponse').value || '';
    const title = document.getElementById('cmdTitle').value || '';
    const colorHex = document.getElementById('cmdColor').value || '#2563eb';
    const thumbnail = document.getElementById('cmdThumbnail').value || '';
    const image = document.getElementById('cmdImage').value || '';
    const text = cmPreviewText(response);

    if (msg === 'embed') {
        let html = renderPreviewEmbed(cmPreviewText(title), colorHex, thumbnail, response, text, image);
        document.querySelectorAll('#extraEmbedsList .extra-embed-block').forEach(block => {
            const eResponse = block.querySelector('.ee-response').value || '';
            html += renderPreviewEmbed(
                cmPreviewText(block.querySelector('.ee-title').value || ''),
                block.querySelector('.ee-color').value || '#7289da',
                block.querySelector('.ee-thumbnail').value || '',
                eResponse,
                cmPreviewText(eResponse),
                block.querySelector('.ee-image').value || ''
            );
        });
        html += renderPreviewButtons();
        preview.innerHTML = html;
        return;
    }

    if (!response.trim()) {
        preview.innerHTML = '<p class="preview-empty">Fill in the response to see the preview.</p>';
        return;
    }

    if (image) {
        let html = `<div class="discord-embed" style="border-left-color: ${escapeAttr(colorHex)};">`;
        html += `<div class="discord-embed-desc">${escapeHtml(text)}</div>`;
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;discord-embed-image-error&quot;>Image not loading (link expired or invalid)</div>'">`;
        html += `</div>`;
        html += renderPreviewButtons();
        preview.innerHTML = html;
    } else {
        preview.innerHTML = escapeHtml(text).replace(/\n/g, '<br>') + renderPreviewButtons();
    }
}

function cmFail(el, message) {
    if (el) markFieldInvalid(el);
    showFormToast(message || 'Fill all fields');
    shakeModal();
}

async function saveCommand(e) {
    e.preventDefault();

    if (editingName) {
        if (!userHasDashboardPermission('editRoles')) { showAccessDenied(); return; }
    } else {
        if (!userHasDashboardPermission('createRoles')) { showAccessDenied(); return; }
    }

    clearInvalidFields();

    const nameInput = document.getElementById('cmdName');
    const parsed = cmParseName();
    const name = (editingName || parsed.name).toLowerCase();
    const prefix = editingName ? ((currentCommands[editingName] && currentCommands[editingName].prefix) || '*') : parsed.prefix;
    const { msg, action, type } = cmCurrentKind();

    if (!name || !/^[a-z0-9]{1,32}$/i.test(name)) {
        cmFail(nameInput);
        return;
    }
    if (!type) {
        cmFail(cmSelects.cmMsgType.btn);
        markFieldInvalid(cmSelects.cmAction.btn);
        return;
    }

    const responseEl = document.getElementById('cmdResponse');
    if (msg === 'text' && !responseEl.value.trim()) {
        cmFail(responseEl);
        return;
    }

    let duration = null;
    let durationUnit = 'days';
    let roleAction = null;
    let targetRoleId = null;

    if (action === 'ban') {
        const d = cmReadDuration('cmdDuration', 'cmDurUnit');
        durationUnit = d.unit;
        if (d.unit === 'perm') {
            duration = null;
        } else if (!d.n) {
            cmFail(document.getElementById('cmdDuration'), 'Enter a duration or choose Perm');
            return;
        } else {
            duration = d.n;
        }
    } else if (action === 'mute') {
        const d = cmReadDuration('cmdDuration', 'cmDurUnit');
        durationUnit = d.unit;
        duration = d.n;
        if (duration && duration * CM_UNIT_MINUTES[d.unit] > CM_MAX_MUTE_MINUTES) {
            cmFail(document.getElementById('cmdDuration'), 'Mute duration cannot exceed 28 days');
            return;
        }
    } else if (action === 'role') {
        roleAction = cmSelectGet('cmRoleAction');
        if (!roleAction) {
            cmFail(cmSelects.cmRoleAction.btn);
            return;
        }
        targetRoleId = cmTargetRoleId;
        if (!targetRoleId) {
            cmFail(cmSelects.cmTargetRole.btn, 'Select a target role');
            return;
        }
        if (roleAction === 'temp' || roleAction === 'remove_mute') {
            const d = cmReadDuration('cmdTempDuration', 'cmTempDurUnit');
            durationUnit = d.unit;
            duration = d.n;
            if (!duration) {
                cmFail(document.getElementById('cmdTempDuration'), 'Enter a duration');
                return;
            }
            if (roleAction === 'remove_mute' && duration * CM_UNIT_MINUTES[d.unit] > CM_MAX_MUTE_MINUTES) {
                cmFail(document.getElementById('cmdTempDuration'), 'Mute duration cannot exceed 28 days');
                return;
            }
        }
    }

    const colorHex = document.getElementById('cmdColor').value;
    const btn = document.getElementById('cmSaveBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const hasResponse = msg || ['ban', 'kick', 'mute', 'warn'].includes(action) || (action === 'role' && (roleAction === 'remove_warn' || roleAction === 'remove_mute'));

    const data = {
        prefix,
        type,
        title: msg === 'embed' ? document.getElementById('cmdTitle').value : '',
        response: hasResponse ? responseEl.value : '',
        color: parseInt(colorHex.replace('#', ''), 16),
        thumbnail: msg === 'embed' ? (document.getElementById('cmdThumbnail').value || null) : null,
        image: msg ? (document.getElementById('cmdImage').value || null) : null,
        extraEmbeds: msg === 'embed' ? collectExtraEmbeds() : [],
        buttons: msg ? collectButtons() : [],
        deleteCommand: document.getElementById('cmdDelete').checked,
        enabled: document.getElementById('cmdEnabled').checked,
        allowedRoles: Array.from(cmSelRoles),
        blockedChannels: Array.from(cmSelChannels),
        duration,
        durationUnit,
        roleAction,
        targetRoleId
    };

    try {
        const res = await fetch(`/api/commands/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data, isEdit: !!editingName })
        });
        if (res.ok) {
            closeModal();
            await loadCommands();
            showToast(`Command ${prefix}${name} saved`);
        } else {
            const err = await res.json().catch(() => ({}));
            if (res.status === 403) {
                showAccessDenied();
            } else {
                showToast(err.error || 'Error', 'error');
            }
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function setupCommandModal() {
    cmInitComponents();

    const nameEl = document.getElementById('cmdName');
    if (nameEl) nameEl.oninput = () => {
        let v = nameEl.value.replace(/\s/g, '');
        let pre = '';
        if (v && !/[a-zA-Z0-9]/.test(v.charAt(0))) {
            pre = v.charAt(0);
            v = v.slice(1);
        }
        v = v.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
        nameEl.value = pre + v;
        cmRefreshInfo();
    };

    ['cmdDuration', 'cmdTempDuration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = () => {
            el.value = el.value.replace(/[^0-9]/g, '');
            cmRefreshInfo();
        };
    });

    ['cmdResponse', 'cmdTitle', 'cmdThumbnail', 'cmdImage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = updatePreview;
    });

    const color = document.getElementById('cmdColor');
    if (color) color.oninput = () => { cmSyncColor(); updatePreview(); };

    const moreBtn = document.getElementById('moreBtn');
    if (moreBtn) moreBtn.onclick = toggleMoreOptions;

    const addEmbedBtn = document.getElementById('addEmbedBtn');
    if (addEmbedBtn) addEmbedBtn.onclick = () => addEmbedBlock();

    const addButtonBtn = document.getElementById('addButtonBtn');
    if (addButtonBtn) addButtonBtn.onclick = () => addButtonBlock();

    const permBtn = document.getElementById('permissionsBtn');
    if (permBtn) permBtn.onclick = openPermissionsBox;

    const permClose = document.getElementById('permissionsClose');
    if (permClose) permClose.onclick = closePermissionsBox;

    const varBtn = document.getElementById('cmVarBtn');
    if (varBtn) varBtn.onclick = (e) => { e.stopPropagation(); cmOpenVariables(); };

    document.querySelectorAll('.cm-tab').forEach(t => {
        t.onclick = () => {
            cmPermTab = t.dataset.ptab;
            document.getElementById('cmPermSearch').value = '';
            cmRenderPermList();
        };
    });

    const search = document.getElementById('cmPermSearch');
    if (search) search.oninput = cmRenderPermList;

    const box = document.getElementById('permissionsBox');
    if (box) box.addEventListener('mousedown', (e) => {
        if (e.target === box) closePermissionsBox();
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('#cmSelPop') || e.target.closest('#cmVarPop')) return;
        cmClosePops();
    });

    const dialog = document.getElementById('cmDialog');
    if (dialog) dialog.addEventListener('scroll', cmClosePops);
    window.addEventListener('resize', cmClosePops);
}

async function deleteCommand(name) {
    if (!userHasDashboardPermission('deleteRoles')) {
        showAccessDenied();
        return;
    }

    showConfirmDialog(
        'Confirm deletion',
        `Do you want to delete the command *${name}? This action is irreversible.`,
        async () => {
            try {
                const res = await fetch(`/api/commands/${currentGuild}/${name}`, { method: 'DELETE' });
                if (res.ok) {
                    await loadCommands();
                    showToast(`Command deleted`);
                } else if (res.status === 403) {
                    showAccessDenied();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.error || 'Error while deleting', 'error');
                }
            } catch (e) {
                showToast('Error: ' + e.message, 'error');
            }
        }
    );
}

async function loadModlogs() {
    if (!currentGuild) return;
    const list = document.getElementById('modlogsList');
    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/dashboard-logs/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        currentModlogs = await res.json();
        renderModlogs(currentModlogs);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function logLine(log) {
    const user = `<span class="log-user">${escapeHtml(log.userTag || 'Unknown')}</span>`;
    const target = `<span class="log-user">${escapeHtml(log.targetTag || 'Unknown')}</span>`;
    switch (log.action) {
        case 'ticket_created': return `Ticket created by ${user}`;
        case 'ticket_claimed': return `Ticket claimed by ${user}`;
        case 'ticket_closed': return `Ticket closed by ${user}`;
        case 'report_created': return `Report created by ${user}`;
        case 'user_banned': case 'user_banned_auto': return `${target} has been banned`;
        case 'user_unbanned': case 'user_unbanned_auto': return `${target} has been unbanned`;
        case 'user_kicked': case 'user_kicked_auto': return `${target} has been kicked`;
        case 'user_muted': case 'user_muted_auto': return `${target} has been muted`;
        case 'user_unmuted': return `${target} has been unmuted`;
        case 'user_warned': return `${target} has been warned`;
        case 'messages_purged': return `${user} purged messages`;
        case 'custom_command_used': case 'native_command_used': return `${user} used a command`;
        default: return `${user} — ${escapeHtml(log.details || log.action || '')}`;
    }
}

function renderModlogs(logs) {
    const list = document.getElementById('modlogsList');
    if (!logs || logs.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No actions</h3><p>No logs recorded</p></div>';
        return;
    }
    list.innerHTML = logs.map((log, i) => {
        const action = log.action || log.type || 'generic';
        const date = log.date ? new Date(log.date).toLocaleString('en-US') : '';
        const extra = log.extra || {};

        const rows = [];
        if (log.reason) rows.push(`<div><b>Reason:</b> ${escapeHtml(log.reason)}</div>`);
        if (log.details) rows.push(`<div><b>Details:</b> ${escapeHtml(log.details)}</div>`);
        if (extra.channelName) rows.push(`<div><b>Channel:</b> ${escapeHtml(extra.channelName)}</div>`);
        if (extra.ticketOwnerTag) rows.push(`<div><b>Ticket owner:</b> ${escapeHtml(extra.ticketOwnerTag)}</div>`);
        if (extra.claimedByTag) rows.push(`<div><b>Claimed by:</b> ${escapeHtml(extra.claimedByTag)}</div>`);
        rows.push(`<div><b>Date:</b> ${escapeHtml(date)}</div>`);

        const transcriptBtn = log.transcriptId
            ? `<a class="modlog-transcript-btn" href="/dashboard/transcript/${escapeAttr(log.transcriptId)}" target="_blank" rel="noopener">Transcript</a>`
            : '';

        return `
        <div class="modlog-card" data-idx="${i}">
            <div class="modlog-row">
                <span class="modlog-badge ${escapeAttr(action)}">${escapeHtml(action.replace(/_/g, ' '))}</span>
                <span class="modlog-line">${logLine(log)}</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    ${rows.join('')}
                    ${transcriptBtn}
                </div>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.modlog-card').forEach(card => {
        card.querySelector('.modlog-row').addEventListener('click', () => {
            card.classList.toggle('open');
        });
    });
}

async function ensureKnownGuilds() {
    if (knownGuilds.predcord || knownGuilds.community || knownGuilds.masterclassServer) return;
    try {
        const res = await fetch('/api/known-guilds');
        if (res.ok) knownGuilds = await res.json();
    } catch (e) {
        console.error('[BANS] known-guilds error:', e);
    }
}

async function loadBans() {
    const list = document.getElementById('bansList');
    if (!currentGuild) {
        list.innerHTML = '<div class="empty-state"><h3>Not configured</h3><p>Missing guild ID for this server</p></div>';
        return;
    }

    list.innerHTML = '<div class="loading">Loading</div>';
    try {
        const res = await fetch(`/api/bans/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        const bans = await res.json();
        renderBans(bans);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderBans(bans) {
    const list = document.getElementById('bansList');
    const count = document.getElementById('bansCount');
    if (count) count.textContent = `${bans ? bans.length : 0} ban`;
    if (!bans || bans.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No bans</h3><p>No bans recorded</p></div>';
        return;
    }
    list.innerHTML = bans.map((ban, i) => {
        const date = ban.date ? new Date(ban.date).toLocaleString('en-US') : '';
        return `
        <div class="modlog-card" data-idx="${i}" data-target-id="${escapeAttr(ban.targetId)}">
            <div class="modlog-row">
                <img class="ban-avatar" src="${escapeAttr(ban.avatarURL)}" alt="">
                <span class="modlog-line"><span class="log-user">${escapeHtml(ban.targetTag || 'Unknown')}</span> (${escapeHtml(ban.targetId || '')})</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    <div><b>Reason:</b> <span class="ban-reason-text">${escapeHtml(ban.reason || 'No reason provided')}</span></div>
                    <div><b>Banned by:</b> ${escapeHtml(ban.moderatorTag || 'Unknown')}</div>
                    <div><b>Date:</b> ${escapeHtml(date)}</div>
                    <div class="modlog-actions">
                        <button type="button" class="modlog-action-btn unban" data-action="unban">Unban</button>
                        <button type="button" class="modlog-action-btn change-reason" data-action="change-reason">Change Reason</button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.modlog-card').forEach(card => {
        card.querySelector('.modlog-row').addEventListener('click', () => {
            card.classList.toggle('open');
        });

        const targetId = card.getAttribute('data-target-id');

        const unbanBtn = card.querySelector('[data-action="unban"]');
        if (unbanBtn) {
            unbanBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirmDialog('Unban user', 'Are you sure you want to unban this user?', async () => {
                    try {
                        const res = await fetch(`/api/moderation/${currentGuild}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'unban', userId: targetId, reason: 'Unbanned from dashboard' })
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err.error || 'Error');
                        }
                        showToast('User unbanned');
                        loadBans();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                });
            });
        }

        const reasonBtn = card.querySelector('[data-action="change-reason"]');
        if (reasonBtn) {
            reasonBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reasonEl = card.querySelector('.ban-reason-text');
                showReasonDialog(reasonEl ? reasonEl.textContent : '', (newReason) => {
                    fetch(`/api/moderation/${currentGuild}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'change_reason', userId: targetId, reason: newReason })
                    }).then(async (res) => {
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err.error || 'Error');
                        }
                        if (reasonEl) reasonEl.textContent = newReason;
                        showToast('Reason updated');
                    }).catch((err) => showToast(err.message, 'error'));
                });
            });
        }
    });
}

let roleSyncData = { guilds: [], rules: [] };
let roleSyncRoles = {};
let roleSyncStatusTimer = null;

function setRoleSyncStatus(state, text) {
    const el = document.getElementById('roleSyncStatus');
    if (!el) return;
    clearTimeout(roleSyncStatusTimer);
    el.className = `role-sync-status ${state}`;
    if (state === 'saving') el.textContent = 'Saving…';
    else if (state === 'saved') el.innerHTML = '&#10003; All changes saved';
    else if (state === 'error') el.textContent = text || 'Could not save';
    else el.textContent = '';
}

function roleSyncGuild(guildId) {
    return roleSyncData.guilds.find(g => g.id === guildId) || { id: guildId, name: 'Unknown server', icon: null };
}

function roleSyncGuildIcon(guild) {
    return guild.icon || '/images/dragon-logo.png';
}

function roleSyncGuildOptions(selectedId) {
    return roleSyncData.guilds.map(g =>
        `<option value="${escapeAttr(g.id)}"${g.id === selectedId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');
}

function roleSyncRoleOptions(guildId, selectedId, forTarget) {
    const roles = (roleSyncRoles[guildId] || []).filter(r => !forTarget || !r.managed);
    const placeholder = `<option value="">Select a role…</option>`;
    return placeholder + roles.map(r =>
        `<option value="${escapeAttr(r.id)}"${r.id === selectedId ? ' selected' : ''}>${escapeHtml(r.name)}</option>`
    ).join('');
}

function roleSyncRoleColor(guildId, roleId) {
    const role = (roleSyncRoles[guildId] || []).find(r => r.id === roleId);
    if (!role || !role.color || role.color === '#000000') return '#99aab5';
    return role.color;
}

function renderRoleSync() {
    const list = document.getElementById('roleSyncList');
    if (!list) return;
    const rules = roleSyncData.rules || [];

    if (!rules.length) {
        list.innerHTML = '<div class="empty-state"><h3>No rules yet</h3><p>Create a rule to start syncing roles between your servers</p></div>';
        return;
    }

    list.innerHTML = rules.map(rule => {
        const source = roleSyncGuild(rule.sourceGuildId);
        const target = roleSyncGuild(rule.targetGuildId);
        const side = (label, guild, roleId, field, forTarget) => `
            <div class="role-sync-side">
                <span class="role-sync-label">${label}</span>
                <img class="role-sync-icon" src="${escapeAttr(roleSyncGuildIcon(guild))}" alt="" onerror="this.src='/images/dragon-logo.png'">
                <label class="role-sync-guild-select">
                    <select data-rule-id="${escapeAttr(rule.id)}" data-guild-field="${field === 'sourceRoleId' ? 'source' : 'target'}">${roleSyncGuildOptions(guild.id)}</select>
                </label>
                <label class="role-sync-pill">
                    <span class="role-sync-dot" style="background:${escapeAttr(roleSyncRoleColor(guild.id, roleId))}"></span>
                    <select data-rule-id="${escapeAttr(rule.id)}" data-field="${field}">${roleSyncRoleOptions(guild.id, roleId, forTarget)}</select>
                </label>
            </div>`;
        return `
        <div class="role-sync-card${rule.warning ? ' has-warning' : ''}">
            <div class="role-sync-row">
                ${side('Source server', source, rule.sourceRoleId, 'sourceRoleId', false)}
                <div class="role-sync-middle">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    <span class="role-sync-mode">One way</span>
                    <button type="button" class="role-sync-swap" data-rule-id="${escapeAttr(rule.id)}" title="Swap source and target">&#8644; Swap</button>
                </div>
                ${side('Target server', target, rule.targetRoleId, 'targetRoleId', true)}
            </div>
            ${rule.warning ? `<div class="role-sync-warning">${escapeHtml(rule.warning)}</div>` : ''}
            <button type="button" class="role-sync-delete" data-rule-id="${escapeAttr(rule.id)}">Delete</button>
        </div>`;
    }).join('');

    list.querySelectorAll('select[data-field]').forEach(sel => {
        sel.onchange = () => patchRoleSyncRule(sel.dataset.ruleId, { [sel.dataset.field]: sel.value || null });
    });
    list.querySelectorAll('select[data-guild-field]').forEach(sel => {
        sel.onchange = () => {
            const rule = roleSyncData.rules.find(r => r.id === sel.dataset.ruleId);
            if (!rule) return;
            const isSource = sel.dataset.guildField === 'source';
            const otherGuildId = isSource ? rule.targetGuildId : rule.sourceGuildId;
            const changes = isSource
                ? { sourceGuildId: sel.value, sourceRoleId: null }
                : { targetGuildId: sel.value, targetRoleId: null };
            if (sel.value === otherGuildId) {
                if (isSource) {
                    changes.targetGuildId = rule.sourceGuildId;
                    changes.targetRoleId = null;
                } else {
                    changes.sourceGuildId = rule.targetGuildId;
                    changes.sourceRoleId = null;
                }
            }
            patchRoleSyncRule(rule.id, changes);
        };
    });
    list.querySelectorAll('.role-sync-swap').forEach(btn => {
        btn.onclick = () => {
            const rule = roleSyncData.rules.find(r => r.id === btn.dataset.ruleId);
            if (!rule) return;
            patchRoleSyncRule(rule.id, {
                sourceGuildId: rule.targetGuildId,
                sourceRoleId: rule.targetRoleId,
                targetGuildId: rule.sourceGuildId,
                targetRoleId: rule.sourceRoleId
            });
        };
    });
    list.querySelectorAll('.role-sync-delete').forEach(btn => {
        btn.onclick = () => {
            showConfirmDialog('Delete rule', 'Delete this Role Sync rule? Roles already given will not be removed.', () => deleteRoleSyncRule(btn.dataset.ruleId));
        };
    });
}

async function patchRoleSyncRule(ruleId, changes) {
    setRoleSyncStatus('saving');
    try {
        const res = await fetch(`/api/role-sync/${encodeURIComponent(ruleId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(changes)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not save');
        roleSyncData.rules = roleSyncData.rules.map(r => r.id === ruleId ? body : r);
        renderRoleSync();
        setRoleSyncStatus('saved');
    } catch (e) {
        setRoleSyncStatus('error', e.message);
        renderRoleSync();
    }
}

let roleSyncDraft = null;

function roleSyncSetIcon(el, guildId) {
    if (!el) return;
    if (!guildId) {
        el.innerHTML = '?';
        el.classList.add('empty');
        return;
    }
    const guild = roleSyncGuild(guildId);
    el.classList.remove('empty');
    el.innerHTML = `<img src="${escapeAttr(roleSyncGuildIcon(guild))}" alt="" onerror="this.src='/images/dragon-logo.png'">`;
}

function renderRoleSyncModal() {
    const d = roleSyncDraft;
    if (!d) return;
    const sourceGuild = document.getElementById('rsmSourceGuild');
    const targetGuild = document.getElementById('rsmTargetGuild');
    const sourceRole = document.getElementById('rsmSourceRole');
    const targetRole = document.getElementById('rsmTargetRole');
    const save = document.getElementById('rsmSave');

    sourceGuild.innerHTML = `<option value="">Select a server…</option>` + roleSyncData.guilds.map(g =>
        `<option value="${escapeAttr(g.id)}"${g.id === d.sourceGuildId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');
    targetGuild.innerHTML = `<option value="">Select other server…</option>` + roleSyncData.guilds
        .filter(g => g.id !== d.sourceGuildId)
        .map(g => `<option value="${escapeAttr(g.id)}"${g.id === d.targetGuildId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`)
        .join('');

    sourceRole.innerHTML = d.sourceGuildId ? roleSyncRoleOptions(d.sourceGuildId, d.sourceRoleId, false) : `<option value="">Select a role…</option>`;
    targetRole.innerHTML = d.targetGuildId ? roleSyncRoleOptions(d.targetGuildId, d.targetRoleId, true) : `<option value="">Select a role…</option>`;
    sourceRole.disabled = !d.sourceGuildId;
    targetRole.disabled = !d.targetGuildId;

    sourceGuild.classList.toggle('placeholder', !d.sourceGuildId);
    targetGuild.classList.toggle('placeholder', !d.targetGuildId);
    sourceRole.classList.toggle('placeholder', !d.sourceRoleId);
    targetRole.classList.toggle('placeholder', !d.targetRoleId);

    roleSyncSetIcon(document.getElementById('rsmSourceIcon'), d.sourceGuildId);
    roleSyncSetIcon(document.getElementById('rsmTargetIcon'), d.targetGuildId);

    save.disabled = !(d.sourceGuildId && d.targetGuildId && d.sourceRoleId && d.targetRoleId) || d.saving;
}

function closeRoleSyncModal() {
    const modal = document.getElementById('roleSyncModal');
    if (modal) modal.classList.add('hidden');
    roleSyncDraft = null;
}

function openRoleSyncModal() {
    const modal = document.getElementById('roleSyncModal');
    if (!modal) return;
    const ids = roleSyncData.guilds.map(g => g.id);
    roleSyncDraft = {
        sourceGuildId: ids.includes(currentGuild) ? currentGuild : (ids[0] || null),
        sourceRoleId: null,
        targetGuildId: null,
        targetRoleId: null,
        saving: false
    };
    const error = document.getElementById('rsmError');
    error.classList.add('hidden');
    error.textContent = '';

    document.getElementById('rsmSourceGuild').onchange = (e) => {
        roleSyncDraft.sourceGuildId = e.target.value || null;
        roleSyncDraft.sourceRoleId = null;
        if (roleSyncDraft.targetGuildId === roleSyncDraft.sourceGuildId) {
            roleSyncDraft.targetGuildId = null;
            roleSyncDraft.targetRoleId = null;
        }
        renderRoleSyncModal();
    };
    document.getElementById('rsmTargetGuild').onchange = (e) => {
        roleSyncDraft.targetGuildId = e.target.value || null;
        roleSyncDraft.targetRoleId = null;
        renderRoleSyncModal();
    };
    document.getElementById('rsmSourceRole').onchange = (e) => {
        roleSyncDraft.sourceRoleId = e.target.value || null;
        renderRoleSyncModal();
    };
    document.getElementById('rsmTargetRole').onchange = (e) => {
        roleSyncDraft.targetRoleId = e.target.value || null;
        renderRoleSyncModal();
    };
    document.getElementById('rsmSwap').onclick = () => {
        const d = roleSyncDraft;
        const targetRoleOk = d.sourceRoleId && (roleSyncRoles[d.sourceGuildId] || []).some(r => r.id === d.sourceRoleId && !r.managed);
        roleSyncDraft = {
            sourceGuildId: d.targetGuildId,
            sourceRoleId: d.targetRoleId,
            targetGuildId: d.sourceGuildId,
            targetRoleId: targetRoleOk ? d.sourceRoleId : null,
            saving: false
        };
        renderRoleSyncModal();
    };
    document.getElementById('rsmCancel').onclick = closeRoleSyncModal;
    document.getElementById('rsmSave').onclick = createRoleSyncRule;
    modal.onclick = (e) => {
        if (e.target.id === 'roleSyncModal') closeRoleSyncModal();
    };

    renderRoleSyncModal();
    modal.classList.remove('hidden');
}

async function createRoleSyncRule() {
    const d = roleSyncDraft;
    if (!d || !(d.sourceGuildId && d.targetGuildId && d.sourceRoleId && d.targetRoleId)) return;
    const error = document.getElementById('rsmError');
    d.saving = true;
    renderRoleSyncModal();
    try {
        const res = await fetch('/api/role-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceGuildId: d.sourceGuildId,
                sourceRoleId: d.sourceRoleId,
                targetGuildId: d.targetGuildId,
                targetRoleId: d.targetRoleId
            })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not create the rule');
        roleSyncData.rules.push(body);
        closeRoleSyncModal();
        renderRoleSync();
        setRoleSyncStatus('saved');
    } catch (e) {
        if (roleSyncDraft) {
            roleSyncDraft.saving = false;
            renderRoleSyncModal();
        }
        error.textContent = e.message;
        error.classList.remove('hidden');
    }
}

async function deleteRoleSyncRule(ruleId) {
    setRoleSyncStatus('saving');
    try {
        const res = await fetch(`/api/role-sync/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not delete the rule');
        roleSyncData.rules = roleSyncData.rules.filter(r => r.id !== ruleId);
        renderRoleSync();
        setRoleSyncStatus('saved');
    } catch (e) {
        setRoleSyncStatus('error', e.message);
    }
}

async function loadRoleSync() {
    const list = document.getElementById('roleSyncList');
    if (!list) return;
    list.innerHTML = '<div class="loading">Loading</div>';
    setRoleSyncStatus('');

    const newBtn = document.getElementById('roleSyncNewBtn');
    if (newBtn) newBtn.onclick = openRoleSyncModal;

    try {
        const res = await fetch('/api/role-sync');
        if (res.status === 403) {
            showAccessDenied();
            list.innerHTML = '';
            return;
        }
        if (!res.ok) throw new Error('Failed to load Role Sync');
        roleSyncData = await res.json();

        roleSyncRoles = roleSyncData.roles || {};

        renderRoleSync();
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

let dropmapData = { areas: [], miniAreas: [] };
let dropmapExpanded = new Set();
let dropmapStatusTimer = null;
let dropmapModalState = null;

function setDropmapStatus(state, text) {
    const el = document.getElementById('dropmapStatus');
    if (!el) return;
    clearTimeout(dropmapStatusTimer);
    el.className = `role-sync-status ${state}`;
    if (state === 'saving') el.textContent = 'Saving…';
    else if (state === 'saved') {
        el.innerHTML = '&#10003; Saved';
        dropmapStatusTimer = setTimeout(() => { el.textContent = ''; }, 2500);
    } else if (state === 'error') el.textContent = text || 'Could not save';
    else el.textContent = '';
}

function dropmapThumb(src, caption, extraClass) {
    if (!src) return `<div class="dm-thumb dm-thumb-empty ${extraClass || ''}">No image</div>`;
    return `<button type="button" class="dm-thumb ${extraClass || ''}" data-src="${escapeAttr(src)}" data-caption="${escapeAttr(caption)}"><img src="${escapeAttr(src)}" alt="" loading="lazy"></button>`;
}

function dropmapMatches(query, ...parts) {
    if (!query) return true;
    return parts.filter(Boolean).some(p => String(p).toLowerCase().includes(query));
}

function renderDropmaps() {
    const areasEl = document.getElementById('dropmapAreas');
    const minisEl = document.getElementById('dropmapMinis');
    const countsEl = document.getElementById('dropmapCounts');
    if (!areasEl || !minisEl) return;
    const query = (document.getElementById('dropmapSearch')?.value || '').trim().toLowerCase();

    const subCount = dropmapData.areas.reduce((n, a) => n + a.subAreas.length, 0);
    if (countsEl) countsEl.textContent = `${dropmapData.areas.length} areas · ${subCount} sub-areas · ${dropmapData.miniAreas.length} mini areas`;

    const areaHtml = dropmapData.areas.map(area => {
        const areaMatch = dropmapMatches(query, area.name);
        const subs = area.subAreas.filter(s => areaMatch || dropmapMatches(query, s.name));
        if (query && !areaMatch && !subs.length) return '';
        const open = !!query || dropmapExpanded.has(area.name);
        const subsHtml = subs.map(sub => `
            <div class="dm-tile">
                ${dropmapThumb(sub.src, `${area.name} - ${sub.name}`)}
                <div class="dm-tile-info">
                    <div class="dm-tile-name" title="${escapeAttr(sub.name)}">${escapeHtml(sub.name)}</div>
                </div>
                <div class="dm-tile-actions">
                    <button type="button" class="dm-icon-btn" data-action="edit-sub" data-area="${escapeAttr(area.name)}" data-sub="${escapeAttr(sub.name)}" title="Edit">&#9998;</button>
                    <button type="button" class="dm-icon-btn danger" data-action="delete-sub" data-area="${escapeAttr(area.name)}" data-sub="${escapeAttr(sub.name)}" title="Delete">&#10005;</button>
                </div>
            </div>`).join('');
        return `
        <div class="dm-area${open ? ' open' : ''}">
            <div class="dm-area-head" data-toggle="${escapeAttr(area.name)}">
                ${dropmapThumb(area.src, area.name, 'dm-thumb-small')}
                <div class="dm-area-title">
                    <span class="dm-area-name">${escapeHtml(area.name)}</span>
                    <span class="dm-area-sub">${area.subAreas.length} sub-area${area.subAreas.length === 1 ? '' : 's'}</span>
                </div>
                <div class="dm-area-actions">
                    <button type="button" class="dm-small-btn" data-action="add-sub" data-area="${escapeAttr(area.name)}">+ Sub-area</button>
                    <button type="button" class="dm-icon-btn" data-action="edit-area" data-area="${escapeAttr(area.name)}" title="Edit">&#9998;</button>
                    <button type="button" class="dm-icon-btn danger" data-action="delete-area" data-area="${escapeAttr(area.name)}" title="Delete">&#10005;</button>
                    <span class="dm-chevron">&#9662;</span>
                </div>
            </div>
            <div class="dm-area-body">
                ${subsHtml ? `<div class="dropmap-grid">${subsHtml}</div>` : '<p class="dm-empty">No sub-areas yet.</p>'}
            </div>
        </div>`;
    }).join('');

    areasEl.innerHTML = areaHtml || `<div class="empty-state"><h3>${query ? 'No results' : 'No areas yet'}</h3><p>${query ? 'Try a different search' : 'Create an area to add its sub-areas'}</p></div>`;

    const miniHtml = dropmapData.miniAreas
        .filter(mini => dropmapMatches(query, mini.name))
        .map(mini => `
            <div class="dm-tile">
                ${dropmapThumb(mini.src, mini.name)}
                <div class="dm-tile-info">
                    <div class="dm-tile-name" title="${escapeAttr(mini.name)}">${escapeHtml(mini.name)}</div>
                </div>
                <div class="dm-tile-actions">
                    <button type="button" class="dm-icon-btn" data-action="edit-mini" data-area="${escapeAttr(mini.name)}" title="Edit">&#9998;</button>
                    <button type="button" class="dm-icon-btn danger" data-action="delete-mini" data-area="${escapeAttr(mini.name)}" title="Delete">&#10005;</button>
                </div>
            </div>`).join('');
    minisEl.innerHTML = miniHtml || `<div class="empty-state"><h3>${query ? 'No results' : 'No mini areas yet'}</h3></div>`;

    bindDropmapEvents();
}

function bindDropmapEvents() {
    const root = document.getElementById('tab-dropmaps');
    if (!root) return;

    root.querySelectorAll('.dm-area-head').forEach(head => {
        head.onclick = (e) => {
            if (e.target.closest('button, input')) return;
            const name = head.dataset.toggle;
            if (dropmapExpanded.has(name)) dropmapExpanded.delete(name);
            else dropmapExpanded.add(name);
            head.parentElement.classList.toggle('open');
        };
    });

    root.querySelectorAll('.dm-thumb[data-src]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            openDropmapLightbox(btn.dataset.src, btn.dataset.caption);
        };
    });

    root.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const area = btn.dataset.area;
            const sub = btn.dataset.sub;
            const findArea = () => dropmapData.areas.find(a => a.name === area) || dropmapData.miniAreas.find(m => m.name === area);
            if (action === 'add-sub') openDropmapModal({ mode: 'add-sub', area });
            else if (action === 'edit-area' || action === 'edit-mini') {
                const item = findArea();
                if (item) openDropmapModal({ mode: action, area, name: item.name, image: item.image, src: item.src });
            } else if (action === 'edit-sub') {
                const parent = dropmapData.areas.find(a => a.name === area);
                const item = parent && parent.subAreas.find(s => s.name === sub);
                if (item) openDropmapModal({ mode: 'edit-sub', area, sub, name: item.name, image: item.image, src: item.src });
            } else if (action === 'delete-area' || action === 'delete-mini') {
                const label = action === 'delete-area' ? `Delete the area "${area}" and all its sub-areas?` : `Delete the mini area "${area}"?`;
                showConfirmDialog('Delete dropmap', label, () => dropmapRequest('DELETE', `/api/dropmaps/areas/${encodeURIComponent(area)}`));
            } else if (action === 'delete-sub') {
                showConfirmDialog('Delete sub-area', `Delete "${sub}" from "${area}"?`, () => dropmapRequest('DELETE', `/api/dropmaps/areas/${encodeURIComponent(area)}/subareas/${encodeURIComponent(sub)}`));
            }
        };
    });
}

async function dropmapRequest(method, url, body) {
    setDropmapStatus('saving');
    try {
        const res = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save');
        dropmapData = data;
        renderDropmaps();
        setDropmapStatus('saved');
        return { ok: true };
    } catch (e) {
        setDropmapStatus('error', e.message);
        return { ok: false, error: e.message };
    }
}

function openDropmapLightbox(src, caption) {
    const box = document.getElementById('dropmapLightbox');
    const img = document.getElementById('dropmapLightboxImg');
    const cap = document.getElementById('dropmapLightboxCaption');
    if (!box || !img) return;
    img.src = src;
    cap.textContent = caption || '';
    box.classList.remove('hidden');
    box.onclick = () => box.classList.add('hidden');
}

function setDropmapModalPreview(src) {
    const preview = document.getElementById('dropmapModalPreview');
    if (!preview) return;
    preview.innerHTML = src ? `<img src="${escapeAttr(src)}" alt="">` : '<span>No image</span>';
    const img = preview.querySelector('img');
    if (img) img.onerror = () => { preview.innerHTML = '<span>Image could not be loaded</span>'; };
}

function closeDropmapModal() {
    document.getElementById('dropmapModal')?.classList.add('hidden');
    dropmapModalState = null;
}

function openDropmapModal(state) {
    const modal = document.getElementById('dropmapModal');
    if (!modal) return;
    dropmapModalState = { ...state, imageRef: state.image || null, uploading: false };
    const titles = {
        'add-area': 'New area',
        'add-mini': 'New mini area',
        'add-sub': `New sub-area · ${state.area}`,
        'edit-area': 'Edit area',
        'edit-mini': 'Edit mini area',
        'edit-sub': `Edit sub-area · ${state.area}`
    };
    document.getElementById('dropmapModalTitle').textContent = titles[state.mode] || 'Dropmap';
    const nameInput = document.getElementById('dropmapModalName');
    const urlInput = document.getElementById('dropmapModalUrl');
    const fileInput = document.getElementById('dropmapModalFile');
    const error = document.getElementById('dropmapModalError');
    const saveBtn = document.getElementById('dropmapModalSave');
    nameInput.value = state.name || '';
    urlInput.value = state.image && !state.image.startsWith('upload:') ? state.image : '';
    urlInput.placeholder = state.image && state.image.startsWith('upload:') ? 'Uploaded image (paste a URL to replace it)' : 'Paste an image URL...';
    error.classList.add('hidden');
    saveBtn.disabled = false;
    setDropmapModalPreview(state.src || null);

    urlInput.oninput = () => {
        const v = urlInput.value.trim();
        if (v) {
            dropmapModalState.imageRef = v;
            setDropmapModalPreview(/^https?:\/\//i.test(v) ? `/api/dropmaps/image?ref=${encodeURIComponent(v)}` : null);
        } else {
            dropmapModalState.imageRef = state.image && state.image.startsWith('upload:') ? state.image : null;
            setDropmapModalPreview(dropmapModalState.imageRef ? state.src : null);
        }
    };

    document.getElementById('dropmapModalUploadBtn').onclick = () => fileInput.click();
    fileInput.value = '';
    fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
            error.textContent = 'Image too large (max 8 MB)';
            error.classList.remove('hidden');
            return;
        }
        const form = new FormData();
        form.append('image', file);
        dropmapModalState.uploading = true;
        saveBtn.disabled = true;
        error.classList.add('hidden');
        document.getElementById('dropmapModalPreview').innerHTML = '<span>Uploading…</span>';
        try {
            const res = await fetch('/api/dropmaps/upload', { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            if (!dropmapModalState) return;
            dropmapModalState.imageRef = data.ref;
            urlInput.value = '';
            urlInput.placeholder = 'Uploaded image (paste a URL to replace it)';
            setDropmapModalPreview(data.src);
        } catch (e) {
            error.textContent = e.message;
            error.classList.remove('hidden');
            setDropmapModalPreview(dropmapModalState && dropmapModalState.imageRef ? state.src : null);
        } finally {
            if (dropmapModalState) dropmapModalState.uploading = false;
            saveBtn.disabled = false;
        }
    };

    saveBtn.onclick = submitDropmapModal;
    document.getElementById('dropmapModalCancel').onclick = closeDropmapModal;
    nameInput.onkeydown = (e) => { if (e.key === 'Enter') submitDropmapModal(); };
    modal.onclick = (e) => { if (e.target.id === 'dropmapModal') closeDropmapModal(); };

    modal.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 60);
}

async function submitDropmapModal() {
    const st = dropmapModalState;
    if (!st || st.uploading) return;
    const error = document.getElementById('dropmapModalError');
    const saveBtn = document.getElementById('dropmapModalSave');
    const name = document.getElementById('dropmapModalName').value.trim();
    const image = st.imageRef;
    const fail = (msg) => {
        error.textContent = msg;
        error.classList.remove('hidden');
    };
    if (!name) return fail('Enter a name');
    if (!image) return fail('Add an image (URL or upload)');

    let method = 'POST';
    let url = '/api/dropmaps/areas';
    let body;
    const areaPath = `/api/dropmaps/areas/${encodeURIComponent(st.area || '')}`;
    if (st.mode === 'add-area' || st.mode === 'add-mini') {
        body = { name, image, kind: st.mode === 'add-mini' ? 'miniarea' : 'area' };
    } else if (st.mode === 'add-sub') {
        url = `${areaPath}/subareas`;
        body = { name, image };
    } else if (st.mode === 'edit-area' || st.mode === 'edit-mini') {
        method = 'PATCH';
        url = areaPath;
        body = { newName: name, image };
    } else if (st.mode === 'edit-sub') {
        method = 'PATCH';
        url = `${areaPath}/subareas/${encodeURIComponent(st.sub)}`;
        body = { newName: name, image };
    }

    saveBtn.disabled = true;
    const result = await dropmapRequest(method, url, body);
    saveBtn.disabled = false;
    if (!result.ok) return fail(result.error);
    if (st.mode === 'add-sub') dropmapExpanded.add(st.area);
    if (st.mode === 'edit-area' && st.area !== name && dropmapExpanded.has(st.area)) {
        dropmapExpanded.delete(st.area);
        dropmapExpanded.add(name);
        renderDropmaps();
    }
    closeDropmapModal();
}

async function loadDropmaps() {
    const areasEl = document.getElementById('dropmapAreas');
    if (!areasEl) return;
    areasEl.innerHTML = '<div class="loading">Loading</div>';
    document.getElementById('dropmapMinis').innerHTML = '';
    setDropmapStatus('');

    document.getElementById('dropmapNewAreaBtn').onclick = () => openDropmapModal({ mode: 'add-area' });
    document.getElementById('dropmapNewMiniBtn').onclick = () => openDropmapModal({ mode: 'add-mini' });
    const search = document.getElementById('dropmapSearch');
    if (search) search.oninput = () => renderDropmaps();

    try {
        const res = await fetch('/api/dropmaps');
        if (res.status === 403) {
            showAccessDenied();
            areasEl.innerHTML = '';
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load dropmaps');
        dropmapData = data;
        renderDropmaps();
    } catch (e) {
        areasEl.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function formatSyncDate(value) {
    return value ? new Date(value).toLocaleString('en-US') : '';
}

async function loadBlacklistSettings() {
    const box = document.getElementById('blacklistSettings');
    const saveBtn = document.getElementById('saveBlacklistSettingsBtn');
    if (!box || !saveBtn) return;

    if (!['predcord', 'community', 'masterclassServer'].includes(selectedServer) || !currentGuild) {
        box.classList.add('hidden');
        saveBtn.classList.add('hidden');
        return;
    }

    try {
        const [settingsRes, channelsRes] = await Promise.all([
            fetch(`/api/blacklist/settings?guildId=${encodeURIComponent(currentGuild)}`),
            fetch(`/api/channels/${currentGuild}`)
        ]);
        if (!settingsRes.ok || !channelsRes.ok) throw new Error('Failed to load');
        const settings = await settingsRes.json();
        const channels = await channelsRes.json();

        const textChannels = channels.filter(c => c.type === 'text').map(c => ({ id: c.id, name: c.name }));
        if (settings.logChannelId && !textChannels.some(c => c.id === settings.logChannelId)) {
            textChannels.unshift({ id: settings.logChannelId, name: `${settings.logChannelName || settings.logChannelId} (other server)` });
        }

        renderSingleSelectList('blLogChannelList', textChannels, settings.logChannelId, 'blLogChannel');
        renderPermissionsList('blBanServersList', settings.guilds || [], settings.banGuildIds || []);
        await renderBlacklistCommandRoles(settings);

        box.classList.remove('hidden');
        const syncBtn = document.getElementById('blacklistSyncBtn');
        if (syncBtn) syncBtn.classList.toggle('hidden', !settings.canEdit);
        if (settings.canEdit) {
            saveBtn.classList.remove('hidden');
        } else {
            saveBtn.classList.add('hidden');
            box.querySelectorAll('.role-toggle-input').forEach(i => { i.disabled = true; });
            box.classList.add('readonly');
        }
    } catch (e) {
        box.classList.add('hidden');
        saveBtn.classList.add('hidden');
        const syncBtnErr = document.getElementById('blacklistSyncBtn');
        if (syncBtnErr) syncBtnErr.classList.add('hidden');
    }
}

let blacklistSyncPoll = null;

function setBlacklistSyncRunning(running) {
    const btn = document.getElementById('blacklistSyncBtn');
    if (!btn) return;
    btn.disabled = running;
    btn.textContent = running ? 'Syncing...' : 'Sync Blacklist';
}

function pollBlacklistSync() {
    if (blacklistSyncPoll) clearTimeout(blacklistSyncPoll);
    blacklistSyncPoll = setTimeout(async () => {
        try {
            const res = await fetch(`/api/blacklist/sync-status?guildId=${encodeURIComponent(currentGuild)}`);
            const data = res.ok ? await res.json() : { running: false };
            if (data.running) {
                pollBlacklistSync();
            } else {
                blacklistSyncPoll = null;
                setBlacklistSyncRunning(false);
                showToast('Blacklist sync completed');
                loadBlacklist();
            }
        } catch (e) {
            blacklistSyncPoll = null;
            setBlacklistSyncRunning(false);
        }
    }, 3000);
}

function startBlacklistSync() {
    if (!isOwner()) return;
    showConfirmDialog(
        'Sync Blacklist',
        `The bot will check all blacklisted users in ${(SERVER_INFO[selectedServer] && SERVER_INFO[selectedServer].name) || 'this server'} and ban the ones who are not banned. Continue?`,
        async () => {
            setBlacklistSyncRunning(true);
            try {
                const res = await fetch('/api/blacklist/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ guildId: currentGuild })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setBlacklistSyncRunning(false);
                    showToast(data.error || 'Sync failed', 'error');
                    return;
                }
                showToast(data.started ? 'Blacklist sync started' : 'Sync already running');
                pollBlacklistSync();
            } catch (e) {
                setBlacklistSyncRunning(false);
                showToast('Connection error', 'error');
            }
        },
        'Confirm'
    );
}

let blacklistCommandGuilds = [];

async function renderBlacklistCommandRoles(settings) {
    const host = document.getElementById('blacklistCommandRoles');
    if (!host) return;
    const guilds = (settings.guilds || []).filter(g => g.id === currentGuild);
    blacklistCommandGuilds = guilds.map(g => g.id);
    host.innerHTML = guilds.map(g => `
        <div class="permissions-grid">
            <div class="permission-card">
                <h3>Blacklist &amp; Unblacklist &amp; Reason Command</h3>
                <p class="permission-desc">Roles that can use -blacklist, -unblacklist and -reason</p>
                <div id="blCmdManage_${escapeAttr(g.id)}" class="roles-list"><p class="loading-text">Loading...</p></div>
            </div>
            <div class="permission-card">
                <h3>Bll Command</h3>
                <p class="permission-desc">Roles that can use -bll</p>
                <div id="blCmdView_${escapeAttr(g.id)}" class="roles-list"><p class="loading-text">Loading...</p></div>
            </div>
            <div class="permission-card">
                <h3>Protected Roles</h3>
                <p class="permission-desc">Users with these roles can't be blacklisted</p>
                <div id="blCmdProtected_${escapeAttr(g.id)}" class="roles-list"><p class="loading-text">Loading...</p></div>
            </div>
        </div>`).join('');

    await Promise.all(guilds.map(async (g) => {
        let roles = [];
        try {
            const res = await fetch(`/api/roles/${g.id}`);
            if (res.ok) roles = await res.json();
        } catch (e) {}
        const cfg = (settings.commandRoles || {})[g.id] || {};
        renderPermissionsList(`blCmdManage_${g.id}`, roles, cfg.manage || []);
        renderPermissionsList(`blCmdView_${g.id}`, roles, cfg.view || []);
        renderPermissionsList(`blCmdProtected_${g.id}`, roles, cfg.protected || []);
    }));
}

function collectBlacklistCommandRoles() {
    const out = {};
    blacklistCommandGuilds.forEach(gid => {
        out[gid] = {
            manage: getCheckedIds(`blCmdManage_${gid}`),
            view: getCheckedIds(`blCmdView_${gid}`),
            protected: getCheckedIds(`blCmdProtected_${gid}`)
        };
    });
    return out;
}

async function saveBlacklistSettings() {
    const btn = document.getElementById('saveBlacklistSettingsBtn');
    if (!btn || !isOwner()) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;
    try {
        const res = await fetch('/api/blacklist/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guildId: currentGuild,
                logChannelId: getSelectedValue('blLogChannelList'),
                banGuildIds: getCheckedIds('blBanServersList'),
                commandRoles: collectBlacklistCommandRoles()
            })
        });
        if (res.ok) {
            showToast('Blacklist settings saved');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || 'Error', 'error');
        }
    } catch (e) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadBlacklist() {
    const list = document.getElementById('blacklistList');
    list.innerHTML = '<div class="loading">Loading</div>';
    const blBox = document.getElementById('blacklistSettings');
    if (blBox) blBox.classList.remove('readonly');
    loadBlacklistSettings();

    try {
        const res = await fetch(`/api/blacklist?guildId=${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        const entries = await res.json();
        renderBlacklist(entries);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

function renderBlacklist(entries) {
    const list = document.getElementById('blacklistList');
    const count = document.getElementById('blacklistCount');
    if (count) count.textContent = `${entries ? entries.length : 0} blacklisted`;
    if (!entries || entries.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>Blacklist is empty</h3><p>No blacklisted users</p></div>';
        return;
    }
    list.innerHTML = entries.map((entry, i) => {
        const date = entry.date ? new Date(entry.date).toLocaleString('en-US') : '';
        const servers = (entry.bannedServers || []).length;
        return `
        <div class="modlog-card" data-idx="${i}" data-target-id="${escapeAttr(entry.userId)}">
            <div class="modlog-row">
                <span class="modlog-line"><span class="log-user">${escapeHtml(entry.userName || entry.userId)}</span> (${escapeHtml(entry.userId || '')})</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    <div><b>Reason:</b> <span class="ban-reason-text">${escapeHtml(entry.reason || 'No reason provided')}</span></div>
                    <div><b>Blacklisted by:</b> ${escapeHtml(entry.bannedBy || entry.bannedById || 'Unknown')}</div>
                    <div><b>Date:</b> ${escapeHtml(date)}</div>
                    <div><b>Servers:</b> ${servers}</div>
                    <div class="modlog-actions">
                        <button type="button" class="modlog-action-btn change-reason" data-action="change-reason">Change Reason</button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.modlog-card').forEach(card => {
        card.querySelector('.modlog-row').addEventListener('click', () => {
            card.classList.toggle('open');
        });

        const targetId = card.getAttribute('data-target-id');

        const reasonBtn = card.querySelector('[data-action="change-reason"]');
        if (reasonBtn) {
            reasonBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reasonEl = card.querySelector('.ban-reason-text');
                showReasonDialog(reasonEl ? reasonEl.textContent : '', (newReason) => {
                    fetch('/api/blacklist-action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'change_reason', userId: targetId, reason: newReason, guildId: currentGuild })
                    }).then(async (res) => {
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err.error || 'Error');
                        }
                        if (reasonEl) reasonEl.textContent = newReason;
                        showToast('Reason updated');
                    }).catch((err) => showToast(err.message, 'error'));
                });
            });
        }
    });
}

async function loadPermissionsSection() {
    if (!currentGuild) return;

    if (!myPermissions.managePermissions) {
        showAccessDenied();
        return;
    }

    const createList = document.getElementById('createRolesList');
    const editList = document.getElementById('editRolesList');
    const deleteList = document.getElementById('deleteRolesList');
    const viewLogsList = document.getElementById('viewLogsRolesList');
    const projectedList = document.getElementById('projectedRolesList');

    if (createList) createList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (editList) editList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (deleteList) deleteList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (viewLogsList) viewLogsList.innerHTML = '<p class="loading-text">Loading...</p>';
    if (projectedList) projectedList.innerHTML = '<p class="loading-text">Loading...</p>';

    try {
        const [rolesRes, permsRes] = await Promise.all([
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/permissions/${currentGuild}`)
        ]);

        if (!rolesRes.ok || !permsRes.ok) throw new Error('Failed to load');

        const roles = await rolesRes.json();
        const perms = await permsRes.json();

        currentRoles = roles;
        dashboardPermissions = {
            createRoles: perms.createRoles || [],
            editRoles: perms.editRoles || [],
            deleteRoles: perms.deleteRoles || [],
            viewLogsRoles: perms.viewLogsRoles || [],
            adminUsers: perms.adminUsers || [],
            ownerUsers: perms.ownerUsers || [],
            projectedRoles: perms.projectedRoles || []
        };

        if (createList) renderPermissionsList('createRolesList', roles, dashboardPermissions.createRoles);
        if (editList) renderPermissionsList('editRolesList', roles, dashboardPermissions.editRoles);
        if (deleteList) renderPermissionsList('deleteRolesList', roles, dashboardPermissions.deleteRoles);
        if (viewLogsList) renderPermissionsList('viewLogsRolesList', roles, dashboardPermissions.viewLogsRoles);
        if (projectedList) renderPermissionsList('projectedRolesList', roles, dashboardPermissions.projectedRoles);

        renderSpecialUsers('adminUsersList', dashboardPermissions.adminUsers, 'admin');
        renderSpecialUsers('ownerUsersList', dashboardPermissions.ownerUsers, 'owner');

    } catch (e) {
        if (createList) createList.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
    }
}

function renderPermissionsList(containerId, roles, selected) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!roles || roles.length === 0) {
        list.innerHTML = '<p class="loading-text">No roles.</p>';
        return;
    }

    const itemsHtml = roles.map(role => {
        const checked = selected.includes(role.id) ? 'checked' : '';
        return `
        <div class="role-item" data-role-id="${escapeAttr(role.id)}" data-search="${escapeAttr(role.name.toLowerCase())}">
            <span class="role-name">${escapeHtml(role.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');

    list.innerHTML = buildSearchableListHtml(itemsHtml);
    bindListSearch(list);
}

async function renderSpecialUsers(containerId, userIds, type) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!userIds || userIds.length === 0) {
        list.innerHTML = '<p class="loading-text">No users.</p>';
        return;
    }

    list.innerHTML = '';

    for (const userId of userIds) {
        const item = document.createElement('div');
        item.className = 'special-user-item';
        item.dataset.userId = userId;

        let username = `User ${userId}`;
        let avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';

        try {
            const res = await fetch(`/api/user-info/${userId}`);
            if (res.ok) {
                const data = await res.json();
                username = data.displayName || data.username || username;
                avatar = data.avatar || avatar;
            }
        } catch {}

        item.innerHTML = `
            <img class="special-user-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="special-user-info">
                <div class="special-user-name">${escapeHtml(username)}</div>
                <div class="special-user-id">${escapeHtml(userId)}</div>
            </div>
            <button type="button" class="special-user-remove" data-user-id="${escapeAttr(userId)}" data-type="${escapeAttr(type)}" title="Remove">&times;</button>
        `;

        list.appendChild(item);
    }

    list.querySelectorAll('.special-user-remove').forEach(btn => {
        btn.onclick = () => {
            removeSpecialUser(btn.dataset.userId, btn.dataset.type);
        };
    });
}

function removeSpecialUser(userId, type) {
    if (type === 'admin') {
        dashboardPermissions.adminUsers = dashboardPermissions.adminUsers.filter(id => id !== userId);
    } else if (type === 'owner') {
        dashboardPermissions.ownerUsers = dashboardPermissions.ownerUsers.filter(id => id !== userId);
    }

    const containerId = type === 'admin' ? 'adminUsersList' : 'ownerUsersList';
    renderSpecialUsers(containerId, type === 'admin' ? dashboardPermissions.adminUsers : dashboardPermissions.ownerUsers, type);
}

async function addSpecialUser(type) {
    const inputId = type === 'admin' ? 'adminUserInput' : 'ownerUserInput';
    const input = document.getElementById(inputId);
    if (!input) return;

    const userId = input.value.trim();

    if (!/^\d+$/.test(userId)) {
        showToast('Invalid Discord ID (numbers only)', 'error');
        return;
    }

    if (type === 'admin') {
        if (dashboardPermissions.adminUsers.includes(userId)) {
            showToast('User already in Admin list', 'error');
            return;
        }
        if (dashboardPermissions.ownerUsers.includes(userId)) {
            showToast('User already in Owner list', 'error');
            return;
        }
        dashboardPermissions.adminUsers.push(userId);
    } else if (type === 'owner') {
        if (dashboardPermissions.ownerUsers.includes(userId)) {
            showToast('User already in Owner list', 'error');
            return;
        }
        if (dashboardPermissions.adminUsers.includes(userId)) {
            showToast('User already in Admin list', 'error');
            return;
        }
        dashboardPermissions.ownerUsers.push(userId);
    }

    input.value = '';

    const containerId = type === 'admin' ? 'adminUsersList' : 'ownerUsersList';
    await renderSpecialUsers(containerId, type === 'admin' ? dashboardPermissions.adminUsers : dashboardPermissions.ownerUsers, type);

    showToast('User added (remember to save)');
}

async function savePermissions() {
    if (!myPermissions.managePermissions) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('savePermissionsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const getChecked = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return [];
        return Array.from(container.querySelectorAll('.role-toggle-input:checked'))
            .map(cb => cb.value);
    };

    const payload = {
        createRoles: getChecked('createRolesList'),
        editRoles: getChecked('editRolesList'),
        deleteRoles: getChecked('deleteRolesList'),
        viewLogsRoles: getChecked('viewLogsRolesList'),
        adminUsers: dashboardPermissions.adminUsers || [],
        ownerUsers: dashboardPermissions.ownerUsers || [],
        projectedRoles: getChecked('projectedRolesList')
    };

    try {
        const res = await fetch(`/api/permissions/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            dashboardPermissions = { ...dashboardPermissions, ...payload };
            showToast('Permissions saved');
        } else if (res.status === 403) {
            showAccessDenied();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function buildSearchableListHtml(itemsHtml) {
    return `
        <div class="roles-search-box">
            <input type="text" class="roles-search-input" placeholder="Search..." autocomplete="off">
        </div>
        <div class="roles-search-items">${itemsHtml}</div>
    `;
}

function bindListSearch(list) {
    const input = list.querySelector('.roles-search-input');
    if (!input) return;
    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        list.querySelectorAll('.role-item').forEach(item => {
            const name = item.dataset.search || (item.querySelector('.role-name')?.textContent || '').toLowerCase();
            item.style.display = !query || name.includes(query) ? '' : 'none';
        });
    });
}

function renderSingleSelectList(containerId, items, selectedId, configKey) {
    const list = document.getElementById(containerId);
    if (!list) return;

    if (!items || items.length === 0) {
        list.innerHTML = '<p class="loading-text">No items.</p>';
        return;
    }

    const itemsHtml = items.map(item => {
        const checked = item.id === selectedId ? 'checked' : '';
        return `
        <div class="role-item" data-search="${escapeAttr(item.name.toLowerCase())}">
            <span class="role-name">${escapeHtml(item.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input radio-toggle" data-config="${configKey}" value="${escapeAttr(item.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');

    list.innerHTML = buildSearchableListHtml(itemsHtml);
    bindListSearch(list);

    list.querySelectorAll('.role-toggle-input.radio-toggle').forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) {
                list.querySelectorAll('.role-toggle-input.radio-toggle').forEach(other => {
                    if (other !== input) other.checked = false;
                });
            }
        });
    });
}

async function loadConfigSection() {
    if (!currentGuild) return;

    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const containers = ['cfgJoinLeaveList', 'cfgModLogList', 'cfgStaffRoleList', 'cfgAdminRoleList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const [channelsRes, rolesRes, configRes] = await Promise.all([
            fetch(`/api/channels/${currentGuild}`),
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/guildconfig/${currentGuild}`)
        ]);

        if (!channelsRes.ok || !rolesRes.ok || !configRes.ok) throw new Error('Failed to load');

        const channels = await channelsRes.json();
        const roles = await rolesRes.json();
        const config = await configRes.json();

        currentChannels = channels;
        currentRoles = roles;

        const textChannels = channels.filter(c => c.type === 'text');

        renderSingleSelectList('cfgJoinLeaveList', textChannels, config.joinLeaveLogChannelId, 'joinLeaveLogChannelId');
        renderSingleSelectList('cfgModLogList', textChannels, config.modLogChannelId, 'modLogChannelId');
        renderPermissionsList('cfgStaffRoleList', roles, config.supportRoleIds || []);
        renderPermissionsList('cfgAdminRoleList', roles, config.adminRoleIds || []);

        const categoryChannels = channels.filter(c => c.type === 'category');

        renderSingleSelectList('cfgMessageLogList', textChannels, config.messageLogChannelId, 'messageLogChannelId');
        renderSingleSelectList('cfgInviteLogList', textChannels, config.inviteLogChannelId, 'inviteLogChannelId');
        renderSingleSelectList('cfgRoleLogList', textChannels, config.roleLogChannelId, 'roleLogChannelId');
        renderSingleSelectList('cfgDropmapLogList', textChannels, config.dropmapLogChannelId, 'dropmapLogChannelId');
        renderSingleSelectList('cfgModInviteLogList', textChannels, config.modInviteLogChannelId, 'modInviteLogChannelId');
        renderSingleSelectList('cfgTicketLogList', textChannels, config.ticketLogChannelId, 'ticketLogChannelId');
        renderSingleSelectList('cfgAntiAltList', textChannels, config.antiAltWarningChannelId, 'antiAltWarningChannelId');

        renderSingleSelectList('cfgGeneralCatList', categoryChannels, config.generalCategoryId, 'generalCategoryId');
        renderSingleSelectList('cfgDropmapCatList', categoryChannels, config.dropmapCategoryId, 'dropmapCategoryId');
        renderSingleSelectList('cfgUnbanCatList', categoryChannels, config.unbanCategoryId, 'unbanCategoryId');
        renderSingleSelectList('cfgMasterclassCatList', categoryChannels, config.masterclassCategoryId, 'masterclassCategoryId');

        renderSingleSelectList('cfgAutoroleList', roles, config.autoroleId, 'autoroleId');

        renderPermissionsList('cfgModRoleIdsList', roles, config.modRoleIds || []);
        renderPermissionsList('cfgTrialModRoleIdsList', roles, config.trialModRoleIds || []);
        renderPermissionsList('cfgHeadModRoleIdsList', roles, config.headModRoleIds || []);

        renderSingleSelectList('cfgInviteTrigger1List', roles, config.inviteTriggerRoleId1, 'inviteTriggerRoleId1');
        renderSingleSelectList('cfgInviteTrigger2List', roles, config.inviteTriggerRoleId2, 'inviteTriggerRoleId2');

        const targetGuildInput = document.getElementById('cfgTargetInviteGuildId');
        if (targetGuildInput) targetGuildInput.value = config.targetInviteGuildId || '';
        const modTargetGuildInput = document.getElementById('cfgModTargetInviteGuildId');
        if (modTargetGuildInput) modTargetGuildInput.value = config.modTargetInviteGuildId || '';
        const moderationDmInput = document.getElementById('cfgModerationDm');
        if (moderationDmInput) moderationDmInput.checked = !!config.moderationDmEnabled;

        configLoaded = true;
    } catch (e) {
        console.error('[CONFIG] loadConfigSection error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
        });
    }
}

async function loadTicketsSection() {
    if (!currentGuild) return;

    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const containers = ['ticketCategoryList', 'ticketLogsList', 'ticketStaffRoleList', 'ticketAdminRoleList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const [channelsRes, rolesRes, configRes] = await Promise.all([
            fetch(`/api/channels/${currentGuild}`),
            fetch(`/api/roles/${currentGuild}`),
            fetch(`/api/guildconfig/${currentGuild}`)
        ]);

        if (!channelsRes.ok || !rolesRes.ok || !configRes.ok) throw new Error('Loading error');

        const channels = await channelsRes.json();
        const roles = await rolesRes.json();
        const config = await configRes.json();

        currentChannels = channels;
        currentRoles = roles;

        const textChannels = channels.filter(c => c.type === 'text');
        const categoryChannels = channels.filter(c => c.type === 'category');

        renderSingleSelectList('ticketCategoryList', categoryChannels, config.supportCategoryId, 'supportCategoryId');
        renderSingleSelectList('ticketLogsList', textChannels, config.transcriptsChannelId, 'transcriptsChannelId');
        renderPermissionsList('ticketStaffRoleList', roles, config.supportRoleIds || []);
        renderPermissionsList('ticketAdminRoleList', roles, config.adminRoleIds || []);
    } catch (e) {
        console.error('[TICKETS] loadTicketsSection error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
        });
    }
}

let statsPeriod = 'oggi';

async function loadStatsSection() {
    if (!currentGuild) return;

    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const switchEl = document.getElementById('statsPeriodSwitch');
    if (switchEl && !switchEl.dataset.bound) {
        switchEl.dataset.bound = '1';
        switchEl.querySelectorAll('.stats-period-btn').forEach(btn => {
            btn.onclick = () => {
                switchEl.querySelectorAll('.stats-period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                statsPeriod = btn.dataset.period;
                loadJoinLeaveStats();
            };
        });
    }

    const searchBtn = document.getElementById('statsModUserBtn');
    if (searchBtn && !searchBtn.dataset.bound) {
        searchBtn.dataset.bound = '1';
        searchBtn.onclick = loadModeratorStats;
    }

    await Promise.all([loadJoinLeaveStats(), loadTicketStats()]);
}

async function loadJoinLeaveStats() {
    const grid = document.getElementById('statsJoinLeaveGrid');
    if (!grid || !currentGuild) return;
    grid.innerHTML = '<div class="permission-card"><h3>Loading...</h3></div>';

    try {
        const res = await fetch(`/api/stats/joinleave/${currentGuild}?period=${statsPeriod}`);
        if (!res.ok) throw new Error('Loading error');
        const data = await res.json();

        grid.innerHTML = `
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.joins}</span><span class="stat-label">Joins</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.leaves}</span><span class="stat-label">Leaves</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.joins - data.windowed.leaves}</span><span class="stat-label">Net</span></div>
        `;

        renderJoinLeaveChart(data);
    } catch (e) {
        grid.innerHTML = `<div class="permission-card"><h3>Error: ${escapeHtml(e.message)}</h3></div>`;
    }
}

const JL_SERIES = [
    { key: 'joins', label: 'Joins', color: '#fafafa' },
    { key: 'leaves', label: 'Leaves', color: '#8b8b94' }
];

const JL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function jlPad(n) {
    return String(n).padStart(2, '0');
}

function jlDayLabel(date) {
    return JL_MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate();
}

function jlBuildPoints(data) {
    const series = data.series || [];
    const byKey = {};
    series.forEach(s => { byKey[s.day] = s; });
    const start = new Date(data.rangeStart);
    const end = new Date(data.rangeEnd);
    const points = [];

    if (data.granularity === 'hour') {
        const dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        const now = Date.now();
        for (let h = 0; h < 24; h++) {
            const t = new Date(dayStart + h * 3600000);
            const key = `${t.getUTCFullYear()}-${jlPad(t.getUTCMonth() + 1)}-${jlPad(t.getUTCDate())} ${jlPad(t.getUTCHours())}`;
            const row = byKey[key] || { joins: 0, leaves: 0 };
            points.push({
                label: `${jlPad(h)}:00`,
                title: `${jlDayLabel(t)}, ${jlPad(h)}:00 - ${jlPad(h)}:59 UTC`,
                joins: row.joins,
                leaves: row.leaves,
                future: t.getTime() > now
            });
        }
        return points;
    }

    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = `${d.getUTCFullYear()}-${jlPad(d.getUTCMonth() + 1)}-${jlPad(d.getUTCDate())}`;
        const row = byKey[key] || { joins: 0, leaves: 0 };
        points.push({
            label: jlDayLabel(d),
            title: jlDayLabel(d) + ', ' + d.getUTCFullYear(),
            joins: row.joins,
            leaves: row.leaves,
            future: false
        });
    }
    return points;
}

function jlSmoothPath(xs, ys) {
    const n = xs.length;
    if (n === 0) return '';
    if (n === 1) return `M${xs[0]},${ys[0]}`;
    const dx = [];
    const m = [];
    for (let i = 0; i < n - 1; i++) {
        dx.push(xs[i + 1] - xs[i]);
        m.push((ys[i + 1] - ys[i]) / dx[i]);
    }
    const t = [m[0]];
    for (let i = 1; i < n - 1; i++) {
        t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    }
    t.push(m[n - 2]);
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) {
            t[i] = 0;
            t[i + 1] = 0;
        } else {
            const a = t[i] / m[i];
            const b = t[i + 1] / m[i];
            const h = Math.hypot(a, b);
            if (h > 3) {
                const k = 3 / h;
                t[i] = k * a * m[i];
                t[i + 1] = k * b * m[i];
            }
        }
    }
    let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
        const c1x = xs[i] + dx[i] / 3;
        const c1y = ys[i] + t[i] * dx[i] / 3;
        const c2x = xs[i + 1] - dx[i] / 3;
        const c2y = ys[i + 1] - t[i + 1] * dx[i] / 3;
        d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
    }
    return d;
}

let joinLeaveLastData = null;
let joinLeaveResizeBound = false;

function renderJoinLeaveChart(data) {
    const host = document.getElementById('joinLeaveChart');
    if (!host) return;
    if (data) joinLeaveLastData = data;
    if (!joinLeaveLastData) return;

    const legend = document.getElementById('joinLeaveLegend');
    if (legend) {
        legend.innerHTML = JL_SERIES.map(m => `<span class="jl-legend-item"><i style="background:${m.color}"></i>${m.label}</span>`).join('');
    }

    const points = jlBuildPoints(joinLeaveLastData);
    const W = Math.max(host.clientWidth, 200);
    const H = Math.max(host.clientHeight, 200);
    const pad = { top: 10, right: 6, bottom: 30, left: 6 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const n = points.length;
    const step = n > 1 ? plotW / (n - 1) : 0;
    const xAt = i => pad.left + (n > 1 ? i * step : plotW / 2);

    const rawMax = Math.max(1, ...points.map(p => Math.max(p.joins, p.leaves)));
    const maxY = rawMax * 1.12;
    const yAt = v => pad.top + plotH - (v / maxY) * plotH;

    const lastReal = points.reduce((acc, p, i) => (p.future ? acc : i), -1);
    const live = points.slice(0, lastReal + 1);

    let svg = `<svg class="jl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>`;
    JL_SERIES.forEach(m => {
        svg += `<linearGradient id="jlGrad-${m.key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${m.color}" stop-opacity="0.5"/><stop offset="100%" stop-color="${m.color}" stop-opacity="0.02"/></linearGradient>`;
    });
    svg += '</defs>';

    for (let g = 0; g <= 4; g++) {
        const y = pad.top + (plotH / 4) * g;
        svg += `<line class="jl-grid" x1="${pad.left}" x2="${W - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    }

    const bottom = pad.top + plotH;
    const order = ['leaves', 'joins'];
    order.forEach(key => {
        const meta = JL_SERIES.find(m => m.key === key);
        if (!live.length) return;
        const xs = live.map((p, i) => xAt(i));
        const ys = live.map(p => yAt(p[key]));
        const line = jlSmoothPath(xs, ys);
        if (live.length > 1) {
            const area = `${line} L${xs[xs.length - 1].toFixed(2)},${bottom} L${xs[0].toFixed(2)},${bottom} Z`;
            svg += `<path d="${area}" fill="url(#jlGrad-${key})"/>`;
            svg += `<path d="${line}" fill="none" stroke="${meta.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
        } else {
            svg += `<circle cx="${xs[0]}" cy="${ys[0]}" r="3.5" fill="${meta.color}"/>`;
        }
    });

    const maxLabels = Math.max(2, Math.floor(plotW / 78));
    const every = Math.max(1, Math.ceil(n / maxLabels));
    points.forEach((p, i) => {
        if (i % every !== 0) return;
        const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
        svg += `<text class="jl-xlabel" x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${p.label}</text>`;
    });

    svg += `<line class="jl-cursor" id="jlCursor" x1="0" x2="0" y1="${pad.top}" y2="${bottom}" style="opacity:0"/>`;
    JL_SERIES.forEach(m => {
        svg += `<circle class="jl-dot" id="jlDot-${m.key}" r="4.5" fill="${m.color}" style="opacity:0"/>`;
    });
    svg += `<rect id="jlHit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
    svg += '</svg>';

    host.innerHTML = svg + '<div class="jl-tooltip" id="jlTooltip"></div>';

    const hit = host.querySelector('#jlHit');
    const tip = host.querySelector('#jlTooltip');
    const cursor = host.querySelector('#jlCursor');
    const dots = {};
    JL_SERIES.forEach(m => { dots[m.key] = host.querySelector('#jlDot-' + m.key); });

    const hide = () => {
        tip.style.opacity = '0';
        cursor.style.opacity = '0';
        JL_SERIES.forEach(m => { dots[m.key].style.opacity = '0'; });
    };

    const show = (clientX) => {
        const rect = host.getBoundingClientRect();
        const px = clientX - rect.left;
        let idx = n > 1 ? Math.round((px - pad.left) / step) : 0;
        idx = Math.max(0, Math.min(n - 1, idx));
        const p = points[idx];
        if (p.future) { hide(); return; }
        const x = xAt(idx);
        cursor.setAttribute('x1', x);
        cursor.setAttribute('x2', x);
        cursor.style.opacity = '1';
        JL_SERIES.forEach(m => {
            dots[m.key].setAttribute('cx', x);
            dots[m.key].setAttribute('cy', yAt(p[m.key]));
            dots[m.key].style.opacity = '1';
        });
        tip.innerHTML = `<div class="jl-tt-title">${escapeHtml(p.title)}</div>` + JL_SERIES.map(m =>
            `<div class="jl-tt-row"><i style="background:${m.color}"></i><span class="jl-tt-label">${m.label}</span><b>${p[m.key]}</b></div>`
        ).join('');
        tip.style.opacity = '1';
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = x + 14;
        if (left + tw > W - 4) left = x - tw - 14;
        if (left < 4) left = 4;
        const top = Math.max(4, Math.min(yAt(Math.max(p.joins, p.leaves)) - th / 2, H - th - 4));
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    };

    hit.addEventListener('pointermove', e => show(e.clientX));
    hit.addEventListener('pointerdown', e => show(e.clientX));
    hit.addEventListener('pointerleave', hide);

    if (!joinLeaveResizeBound) {
        joinLeaveResizeBound = true;
        let t = null;
        window.addEventListener('resize', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const tab = document.getElementById('tab-stats');
                if (tab && !tab.classList.contains('hidden')) renderJoinLeaveChart();
            }, 120);
        });
    }
}

async function loadTicketStats() {
    const list = document.getElementById('statsTicketsList');
    if (!list || !currentGuild) return;
    list.innerHTML = '<div class="loading">Loading</div>';

    try {
        const res = await fetch(`/api/stats/tickets/${currentGuild}`);
        if (!res.ok) throw new Error('Loading error');
        const data = await res.json();

        if (!data.moderators || data.moderators.length === 0) {
            list.innerHTML = '<p class="loading-text">No closed tickets yet.</p>';
            return;
        }

        list.innerHTML = data.moderators.map(m => `
            <div class="modlog-card">
                <div class="modlog-row">
                    <span class="modlog-line"><span class="log-user">${escapeHtml(m.moderatorTag || m.moderatorId)}</span></span>
                    <span class="modlog-line">${m.count} ticket(s) closed</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
    }
}

async function loadModeratorStats() {
    const input = document.getElementById('statsModUserInput');
    const result = document.getElementById('statsModeratorResult');
    if (!input || !result || !currentGuild) return;
    const userId = input.value.trim();
    if (!/^\d+$/.test(userId)) {
        showToast('Invalid Discord ID', 'error');
        return;
    }

    result.innerHTML = '<div class="loading">Loading</div>';

    try {
        const res = await fetch(`/api/stats/moderator/${currentGuild}/${userId}`);
        if (!res.ok) throw new Error('Loading error');
        const data = await res.json();

        const rows = Object.entries(data).map(([label, counts]) => `
            <div class="modlog-card">
                <div class="modlog-row">
                    <span class="modlog-badge">${escapeHtml(label)}</span>
                    <span class="modlog-line">7d: ${counts.day7} • 30d: ${counts.day30} • All time: ${counts.all}</span>
                </div>
            </div>
        `).join('');

        result.innerHTML = rows || '<p class="loading-text">No data.</p>';
    } catch (e) {
        result.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
    }
}

function getSelectedValue(containerId) {
    const list = document.getElementById(containerId);
    if (!list) return null;
    const checked = list.querySelector('.role-toggle-input.radio-toggle:checked');
    return checked ? (checked.value || null) : null;
}

function getCheckedIds(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.role-toggle-input:checked')).map(cb => cb.value);
}

async function saveConfig() {
    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('saveConfigBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const payload = {
        joinLeaveLogChannelId: getSelectedValue('cfgJoinLeaveList'),
        modLogChannelId: getSelectedValue('cfgModLogList'),
        messageLogChannelId: getSelectedValue('cfgMessageLogList'),
        inviteLogChannelId: getSelectedValue('cfgInviteLogList'),
        roleLogChannelId: getSelectedValue('cfgRoleLogList'),
        dropmapLogChannelId: getSelectedValue('cfgDropmapLogList'),
        modInviteLogChannelId: getSelectedValue('cfgModInviteLogList'),
        ticketLogChannelId: getSelectedValue('cfgTicketLogList'),
        antiAltWarningChannelId: getSelectedValue('cfgAntiAltList'),
        generalCategoryId: getSelectedValue('cfgGeneralCatList'),
        dropmapCategoryId: getSelectedValue('cfgDropmapCatList'),
        unbanCategoryId: getSelectedValue('cfgUnbanCatList'),
        masterclassCategoryId: getSelectedValue('cfgMasterclassCatList'),
        autoroleId: getSelectedValue('cfgAutoroleList'),
        adminRoleIds: getCheckedIds('cfgAdminRoleList'),
        modRoleIds: getCheckedIds('cfgModRoleIdsList'),
        trialModRoleIds: getCheckedIds('cfgTrialModRoleIdsList'),
        headModRoleIds: getCheckedIds('cfgHeadModRoleIdsList'),
        supportRoleIds: getCheckedIds('cfgStaffRoleList'),
        inviteTriggerRoleId1: getSelectedValue('cfgInviteTrigger1List'),
        inviteTriggerRoleId2: getSelectedValue('cfgInviteTrigger2List'),
        targetInviteGuildId: (document.getElementById('cfgTargetInviteGuildId') || {}).value || null,
        modTargetInviteGuildId: (document.getElementById('cfgModTargetInviteGuildId') || {}).value || null,
        moderationDmEnabled: !!(document.getElementById('cfgModerationDm') || {}).checked
    };

    try {
        const [configRes, staffAppRes, banAppealRes] = await Promise.all([
            fetch(`/api/guildconfig/${currentGuild}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }),
            fetch('/api/staff-app-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    communityChannelId: getSelectedValue('cfgStaffAppCommunityList'),
                    predcordChannelId: getSelectedValue('cfgStaffAppPredcordList')
                })
            }),
            fetch('/api/ban-appeal-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    communityChannelId: getSelectedValue('cfgBanAppealCommunityList'),
                    predcordChannelId: getSelectedValue('cfgBanAppealPredcordList')
                })
            })
        ]);

        if (configRes.ok && staffAppRes.ok && banAppealRes.ok) {
            showToast('Configuration saved');
        } else if (configRes.status === 403 || staffAppRes.status === 403 || banAppealRes.status === 403) {
            showAccessDenied();
        } else {
            showToast('Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function loadStaffAppConfig() {
    if (!isOwner()) return;

    const isCommunity = selectedServer === 'community';
    const isPredcord = selectedServer === 'predcord';
    document.getElementById('staffAppCommunityCard')?.classList.toggle('hidden', !isCommunity);
    document.getElementById('staffAppPredcordCard')?.classList.toggle('hidden', !isPredcord);

    const containers = ['cfgStaffAppCommunityList', 'cfgStaffAppPredcordList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const res = await fetch('/api/staff-app-config');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        if (!data.community.guildFound) {
            document.getElementById('cfgStaffAppCommunityList').innerHTML = '<p class="loading-text">Bot not in this server, or COMMUNITY_GUILD_ID is missing/wrong.</p>';
        } else {
            renderSingleSelectList('cfgStaffAppCommunityList', data.community.channels, data.community.selected, 'communityChannelId');
        }

        if (!data.predcord.guildFound) {
            document.getElementById('cfgStaffAppPredcordList').innerHTML = '<p class="loading-text">Bot not in this server, or MAIN_GUILD_ID is missing/wrong.</p>';
        } else {
            renderSingleSelectList('cfgStaffAppPredcordList', data.predcord.channels, data.predcord.selected, 'predcordChannelId');
        }
    } catch (e) {
        console.error('[STAFF APP CONFIG] load error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
        });
    }
}

async function loadBanAppealConfig() {
    if (!isOwner()) return;

    const isCommunity = selectedServer === 'community';
    const isPredcord = selectedServer === 'predcord';
    document.getElementById('banAppealCommunityCard')?.classList.toggle('hidden', !isCommunity);
    document.getElementById('banAppealPredcordCard')?.classList.toggle('hidden', !isPredcord);

    const containers = ['cfgBanAppealCommunityList', 'cfgBanAppealPredcordList'];
    containers.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<p class="loading-text">Loading...</p>';
    });

    try {
        const res = await fetch('/api/ban-appeal-config');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        if (!data.community.guildFound) {
            document.getElementById('cfgBanAppealCommunityList').innerHTML = '<p class="loading-text">Bot not in this server, or COMMUNITY_GUILD_ID is missing/wrong.</p>';
        } else {
            renderSingleSelectList('cfgBanAppealCommunityList', data.community.channels, data.community.selected, 'communityChannelId');
        }

        if (!data.predcord.guildFound) {
            document.getElementById('cfgBanAppealPredcordList').innerHTML = '<p class="loading-text">Bot not in this server, or MAIN_GUILD_ID is missing/wrong.</p>';
        } else {
            renderSingleSelectList('cfgBanAppealPredcordList', data.predcord.channels, data.predcord.selected, 'predcordChannelId');
        }
    } catch (e) {
        console.error('[BAN APPEAL CONFIG] load error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${escapeHtml(e.message)}</p>`;
        });
    }
}

async function saveTicketsConfig() {
    if (!isOwner()) {
        showAccessDenied();
        return;
    }

    const btn = document.getElementById('saveTicketsBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    const payload = {
        supportCategoryId: getSelectedValue('ticketCategoryList'),
        transcriptsChannelId: getSelectedValue('ticketLogsList'),
        supportRoleIds: getCheckedIds('ticketStaffRoleList'),
        adminRoleIds: getCheckedIds('ticketAdminRoleList')
    };

    try {
        const res = await fetch(`/api/guildconfig/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('Ticket configuration saved');
        } else if (res.status === 403) {
            showAccessDenied();
        } else {
            const err = await res.json();
            showToast(err.error || 'Error', 'error');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function setupEvents() {
    const guildNav = document.getElementById('guildNavTabs');
    if (guildNav && typeof MutationObserver !== 'undefined') {
        new MutationObserver(updateNavGroups).observe(guildNav, { attributes: true, subtree: true, attributeFilter: ['class'] });
        updateNavGroups();
    }

    document.querySelectorAll('.server-select-card').forEach(card => {
        card.onclick = () => selectServer(card.getAttribute('data-server'));
    });

    const changeServerBtn = document.getElementById('changeServerBtn');
    if (changeServerBtn) changeServerBtn.onclick = showServerSelectScreen;

    const saveBlacklistSettingsBtn = document.getElementById('saveBlacklistSettingsBtn');
    if (saveBlacklistSettingsBtn) saveBlacklistSettingsBtn.onclick = saveBlacklistSettings;
    const blacklistSyncBtn = document.getElementById('blacklistSyncBtn');
    if (blacklistSyncBtn) blacklistSyncBtn.onclick = startBlacklistSync;


    const newCmdBtn = document.getElementById('newCmdBtn');
    if (newCmdBtn) newCmdBtn.onclick = () => openModal();

    const newVideoBtn = document.getElementById('newVideoBtn');
    if (newVideoBtn) newVideoBtn.onclick = () => openVideoModal();

    const migrateVideosBtn = document.getElementById('migrateVideosBtn');
    if (migrateVideosBtn) migrateVideosBtn.onclick = () => migrateOldVideos();

    const videoModalCloseBtn = document.getElementById('videoModalCloseBtn');
    if (videoModalCloseBtn) videoModalCloseBtn.onclick = closeVideoModal;

    const videoForm = document.getElementById('videoForm');
    if (videoForm) videoForm.onsubmit = saveVideo;

    const videoFileInput = document.getElementById('videoFile');
    if (videoFileInput) videoFileInput.onchange = () => {
        const preview = document.getElementById('videoFilePreview');
        const file = videoFileInput.files[0];
        if (videoPreviewObjectUrl) {
            URL.revokeObjectURL(videoPreviewObjectUrl);
            videoPreviewObjectUrl = null;
        }
        if (!file || !preview) return;
        videoPreviewObjectUrl = URL.createObjectURL(file);
        preview.src = videoPreviewObjectUrl;
        preview.classList.remove('hidden');
    };

    const videoThumbnailFileInput = document.getElementById('videoThumbnailFile');
    if (videoThumbnailFileInput) videoThumbnailFileInput.onchange = () => {
        const file = videoThumbnailFileInput.files[0];
        const thumbInput = document.getElementById('videoThumbnail');
        const thumbPreview = document.getElementById('videoThumbnailPreview');
        if (!file) {
            if (thumbInput) thumbInput.value = '';
            if (thumbPreview) {
                thumbPreview.removeAttribute('src');
                thumbPreview.classList.add('hidden');
            }
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            if (thumbInput) thumbInput.value = dataUrl;
            if (thumbPreview) {
                thumbPreview.src = dataUrl;
                thumbPreview.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    };

    const saveVideoAccessBtn = document.getElementById('saveVideoAccessBtn');
    if (saveVideoAccessBtn) saveVideoAccessBtn.onclick = saveVideoAccessRoles;

    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) cancelBtn.onclick = closeModal;

    const cmdForm = document.getElementById('cmdForm');
    if (cmdForm) cmdForm.onsubmit = saveCommand;

    setupCommandModal();

    const savePermissionsBtn = document.getElementById('savePermissionsBtn');
    if (savePermissionsBtn) savePermissionsBtn.onclick = savePermissions;

    const saveConfigBtn = document.getElementById('saveConfigBtn');
    if (saveConfigBtn) saveConfigBtn.onclick = saveConfig;

    const saveTicketsBtn = document.getElementById('saveTicketsBtn');
    if (saveTicketsBtn) saveTicketsBtn.onclick = saveTicketsConfig;

    const adminUserAdd = document.getElementById('adminUserAdd');
    if (adminUserAdd) adminUserAdd.onclick = () => addSpecialUser('admin');

    const ownerUserAdd = document.getElementById('ownerUserAdd');
    if (ownerUserAdd) ownerUserAdd.onclick = () => addSpecialUser('owner');

    const adminUserInput = document.getElementById('adminUserInput');
    if (adminUserInput) adminUserInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSpecialUser('admin');
        }
    };

    const ownerUserInput = document.getElementById('ownerUserInput');
    if (ownerUserInput) ownerUserInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSpecialUser('owner');
        }
    };

    const saveMasterclassPermissionsBtn = document.getElementById('saveMasterclassPermissionsBtn');
    if (saveMasterclassPermissionsBtn) saveMasterclassPermissionsBtn.onclick = saveMasterclassPermissions;

    Object.keys(MC_LIST_CONFIG).forEach(type => {
        const cfg = MC_LIST_CONFIG[type];
        const addBtn = document.getElementById(cfg.inputId.replace('Input', 'Add'));
        if (addBtn) addBtn.onclick = () => addMcUser(type);

        const input = document.getElementById(cfg.inputId);
        if (input) input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addMcUser(type);
            }
        };
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = async () => {
        try { localStorage.removeItem('pdCanViewVideos'); } catch (e) {}
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    };

    let tabTransitionToken = 0;

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.onclick = () => {
            const target = tab.dataset.tab;
            const targetContent = document.getElementById(`tab-${target}`);
            if (!targetContent) return;

            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            saveDashState({ tab: target });

            const myToken = ++tabTransitionToken;

            const currentActive = document.querySelector('.tab-content:not(.hidden)');

            const loadTarget = () => {
                if (target === 'logs') {
                    if (!userHasDashboardPermission('viewLogsRoles')) {
                        showAccessDenied();
                        return;
                    }
                    loadModlogs();
                } else if (target === 'bans') {
                    if (!userHasDashboardPermission('viewLogsRoles')) {
                        showAccessDenied();
                        return;
                    }
                    loadBans();
                } else if (target === 'role-sync') {
                    if (!canRoleSync) {
                        showAccessDenied();
                        return;
                    }
                    loadRoleSync();
                } else if (target === 'dropmaps') {
                    if (!canDropmaps || selectedServer !== 'community') {
                        showAccessDenied();
                        return;
                    }
                    loadDropmaps();
                } else if (target === 'blacklist') {
                    if (!userHasDashboardPermission('viewLogsRoles')) {
                        showAccessDenied();
                        return;
                    }
                    loadBlacklist();
                } else if (target === 'permissions') {
                    loadPermissionsSection();
                } else if (target === 'config') {
                    loadConfigSection();
                    loadStaffAppConfig();
                    loadBanAppealConfig();
                } else if (target === 'tickets') {
                    loadTicketsSection();
                } else if (target === 'stats') {
                    loadStatsSection();
                } else if (target === 'commands') {
                    loadCommands();
                } else if (target === 'videos') {
                    if (!isOwner() && !canAccessMasterclass) {
                        showAccessDenied();
                        return;
                    }
                    loadVideos();
                } else if (target === 'mc-tickets') {
                    if (!isOwner() && !canMcTickets) {
                        showAccessDenied();
                        return;
                    }
                    loadMcTickets();
                } else if (target === 'masterclass-permissions') {
                    if (!isOwner()) {
                        showAccessDenied();
                        return;
                    }
                    loadMasterclassPermissions();
                }
            };

            if (!currentActive || currentActive === targetContent) {
                loadTarget();
                return;
            }

            currentActive.classList.add('fade-out');

            setTimeout(() => {
                if (myToken !== tabTransitionToken) return;

                document.querySelectorAll('.tab-content').forEach(c => {
                    if (c !== targetContent) {
                        c.classList.add('hidden');
                        c.classList.remove('fade-out');
                        c.style.opacity = '';
                    }
                });

                targetContent.classList.remove('hidden');
                targetContent.style.opacity = '0';

                requestAnimationFrame(() => {
                    if (myToken !== tabTransitionToken) return;
                    targetContent.style.opacity = '1';
                    loadTarget();

                    setTimeout(() => {
                        if (myToken !== tabTransitionToken) return;
                        targetContent.style.opacity = '';
                    }, 160);
                });
            }, 70);
        };
    });

    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) modalCloseBtn.onclick = closeModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const selPop = document.getElementById('cmSelPop');
            const varPop = document.getElementById('cmVarPop');
            const permBox = document.getElementById('permissionsBox');
            if ((selPop && !selPop.classList.contains('hidden')) || (varPop && !varPop.classList.contains('hidden'))) {
                cmClosePops();
            } else if (permBox && !permBox.classList.contains('hidden')) {
                closePermissionsBox();
            } else {
                closeModal();
            }
        }
    });
}

function startAdminsFontCycle() {
    const el = document.getElementById('adminsFontCycle');
    if (!el) return;
    const fonts = [
        "'JetBrains Mono', monospace",
        "Georgia, serif",
        "'Courier New', monospace",
        "Impact, sans-serif",
        "'Comic Sans MS', cursive",
        "'Times New Roman', serif",
        "Verdana, sans-serif",
        "'Brush Script MT', cursive",
        "'Lucida Console', monospace",
        "'Trebuchet MS', sans-serif",
        "Papyrus, fantasy",
        "Copperplate, fantasy",
        "'Segoe Print', cursive",
        "'Palatino Linotype', serif",
        "Garamond, serif",
        "'Arial Black', sans-serif",
        "Didot, serif",
        "Futura, sans-serif",
        "Rockwell, serif",
        "'Monotype Corsiva', cursive",
        "'Franklin Gothic Medium', sans-serif",
        "cursive",
        "fantasy"
    ];
    let i = 0;
    const interval = setInterval(() => {
        el.style.fontFamily = fonts[i % fonts.length];
        i++;
        if (i >= fonts.length) {
            clearInterval(interval);
            el.style.fontFamily = "'Manrope', sans-serif";
        }
    }, 60);
}

startAdminsFontCycle();
init();
