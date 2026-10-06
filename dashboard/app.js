let currentGuild = null;
let knownGuilds = { predcord: null, community: null };
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
let selectedServer = null;
let serverAccess = { predcord: true, community: true };
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
    const modalContent = document.querySelector(`${modalSelector} .modal-content`);
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

function showConfirmDialog(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const textEl = document.getElementById('confirmModalText');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    if (!modal || !titleEl || !textEl || !okBtn || !cancelBtn) return;

    titleEl.textContent = title;
    textEl.textContent = message;

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
        serverAccess = meData.access || { predcord: true, community: true };
        canAccessMasterclass = !!meData.canAccessMasterclass;
        canUploadVideos = !!meData.canUploadVideos;
        canManageVideos = !!meData.canManageVideos;

        const navVideosGroup = document.getElementById('navVideosGroup');
        if (navVideosGroup) navVideosGroup.classList.toggle('visible', !!meData.canViewVideos);

        await loadMyPermissions();
        await loadGuilds();
        setupEvents();
        setupUserMenu();
        setupLangSwitcher();
        await loadUserMenu();
        updatePreview();
        updatePermissionsTabVisibility();
        applyServerAccessRestrictions();
    } catch (e) {
        console.error('[INIT] Error:', e);
    }
}

function applyServerAccessRestrictions() {
    const communityCard = document.querySelector('.server-select-card[data-server="community"]');
    const predcordCard = document.querySelector('.server-select-card[data-server="predcord"]');
    const masterclassCard = document.getElementById('masterclassSelectCard');
    if (communityCard) communityCard.classList.toggle('hidden', !serverAccess.community);
    if (predcordCard) predcordCard.classList.toggle('hidden', !serverAccess.predcord);
    if (masterclassCard) masterclassCard.classList.toggle('hidden', !isOwner() && !canAccessMasterclass);

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
        dropdown.classList.toggle('hidden');
    };

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

        let displayName = me.displayName || me.global_name || me.username || 'User';
        const username = me.username || '';

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
                }

                if (full.displayName) {
                    displayName = full.displayName;
                    if (ddDisplayName) ddDisplayName.textContent = displayName;
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
        if (!isCommunity && isOwner()) ticketsTab.classList.remove('hidden');
        else ticketsTab.classList.add('hidden');
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
    }
}

const SERVER_INFO = {
    community: { name: 'Predage Community', img: '/images/dragon-pfp.webp' },
    predcord: { name: 'PredCord', img: '/images/predcord-pfp.webp' }
};

let masterclassGuildKey = 'community';

async function selectServer(server) {
    const guildNav = document.getElementById('guildNavTabs');
    const mcNav = document.getElementById('masterclassNavTabs');

    if (server === 'masterclass') {
        if (!isOwner() && !canAccessMasterclass) return;
        selectedServer = 'masterclass';

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
    currentGuild = server === 'community' ? knownGuilds.community : knownGuilds.predcord;

    loadUserRolesForGuild(currentGuild);

    rolesLoaded = false;
    configLoaded = false;

    await loadMyPermissions();
    updatePermissionsTabVisibility();

    const commandsTab = document.querySelector('.nav-tab[data-tab="commands"]');
    if (commandsTab) commandsTab.click();

    loadPermissions();
}

function setMasterclassGuild(key) {
    masterclassGuildKey = key === 'predcord' ? 'predcord' : 'community';
    currentGuild = masterclassGuildKey === 'community' ? knownGuilds.community : knownGuilds.predcord;

    document.querySelectorAll('.masterclass-guild-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.guild === masterclassGuildKey);
    });

    rolesLoaded = false;

    const videosTab = document.getElementById('navTabVideos');
    if (videosTab) videosTab.click();
}

function showServerSelectScreen() {
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
            `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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

        const baseBadge = cmd.isBase
            ? '<span class="command-badge base">BASE</span>'
            : '';

        const cardClass = cmd.isBase ? 'command-card base-command' : 'command-card';

        return `
        <div class="${cardClass}">
            <div class="command-info">
                <h4>${escapeHtml(name)}</h4>
                <div class="command-badges">${badge}${baseBadge}</div>
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
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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
        list.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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
        list.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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

let masterclassPermissions = { viewUserIds: [], uploadUserIds: [], manageUserIds: [] };

const MC_LIST_CONFIG = {
    view: { key: 'viewUserIds', containerId: 'mcViewUsersList', inputId: 'mcViewUserInput' },
    upload: { key: 'uploadUserIds', containerId: 'mcUploadUsersList', inputId: 'mcUploadUserInput' },
    manage: { key: 'manageUserIds', containerId: 'mcManageUsersList', inputId: 'mcManageUserInput' }
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
        masterclassPermissions = { viewUserIds: [], uploadUserIds: [], manageUserIds: [] };
    }
    for (const type of Object.keys(MC_LIST_CONFIG)) {
        await renderMcUsers(type);
    }
}

async function saveMasterclassPermissions() {
    const btn = document.getElementById('saveMasterclassPermissionsBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/masterclass/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(masterclassPermissions)
        });
        if (!res.ok) throw new Error(`POST /api/masterclass/permissions → status ${res.status}`);
        masterclassPermissions = await res.json();
        showToast('Permissions saved');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
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

function openModal(name = null) {
    if (!userHasDashboardPermission('createRoles') && !userHasDashboardPermission('editRoles')) {
        showAccessDenied();
        return;
    }

    clearInvalidFields();
    hideFormToast();

    editingName = name;
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('cmdForm');
    form.reset();

    updatePurgeOptionVisibility();

    if (name && currentCommands[name]) {
        const cmd = currentCommands[name];
        title.textContent = 'Edit Command';
        document.getElementById('cmdName').value = name;
        document.getElementById('cmdName').disabled = true;
        document.getElementById('cmdPrefix').value = cmd.prefix || '*';
        document.getElementById('cmdType').value = cmd.type || 'text';
        document.getElementById('cmdTitle').value = cmd.title || '';
        document.getElementById('cmdResponse').value = cmd.response || '';
        document.getElementById('cmdColor').value = '#' + (typeof cmd.color === 'number' ? cmd.color : 0xE67E22).toString(16).padStart(6, '0');
        document.getElementById('cmdThumbnail').value = cmd.thumbnail || '';
        document.getElementById('cmdImage').value = cmd.image || '';
        document.getElementById('cmdDelete').checked = cmd.deleteCommand !== false;
        document.getElementById('cmdDuration').value = cmd.duration || '';

        clearExtraEmbeds();
        if (Array.isArray(cmd.extraEmbeds)) {
            cmd.extraEmbeds.forEach(e => addEmbedBlock(e, true));
        }

        clearButtons();
        if (Array.isArray(cmd.buttons)) {
            cmd.buttons.forEach(b => addButtonBlock(b, true));
        }

        const baseToggle = document.getElementById('cmdIsBase');
        if (baseToggle) {
            baseToggle.checked = !!cmd.isBase;
        }
    } else {
        title.textContent = 'New Command';
        document.getElementById('cmdName').disabled = false;
        document.getElementById('cmdPrefix').value = '*';
        document.getElementById('cmdColor').value = '#E67E22';
        document.getElementById('cmdThumbnail').value = '';
        document.getElementById('cmdImage').value = '';
        document.getElementById('cmdDelete').checked = true;
        document.getElementById('cmdDuration').value = '';

        clearExtraEmbeds();
        clearButtons();

        const baseToggle = document.getElementById('cmdIsBase');
        if (baseToggle) {
            baseToggle.checked = false;
        }
    }

    updateBaseToggleVisibility();

    rolesLoaded = false;
    currentRoles = [];
    document.getElementById('rolesList').innerHTML = '<p class="loading-text">Open to load roles...</p>';
    closePermissionsBox();
    closeMoreOptions();

    updateTypeUI();
    updatePreview();
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('cmdName').focus(), 100);
}

function updatePurgeOptionVisibility() {
    const purgeOpt = document.getElementById('purgeOption');
    if (!purgeOpt) return;
    if (myRole === 'owner' || isAdmin) {
        purgeOpt.classList.remove('hidden');
        purgeOpt.disabled = false;
    } else {
        purgeOpt.classList.add('hidden');
        purgeOpt.disabled = true;
    }
}

function updateBaseToggleVisibility() {
    const wrap = document.getElementById('baseToggleWrap');
    if (!wrap) return;
    if (myRole === 'owner' || isAdmin) {
        wrap.classList.remove('hidden');
    } else {
        wrap.classList.add('hidden');
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').classList.remove('open-with-permissions');
    closePermissionsBox();
    closeMoreOptions();
    editingName = null;
    rolesLoaded = false;
    currentRoles = [];

    clearInvalidFields();
    hideFormToast();
}

function updateTypeUI() {
    const type = document.getElementById('cmdType').value;
    const hint = document.getElementById('responseHint');
    const responseLabel = document.getElementById('responseLabelText');
    const response = document.getElementById('cmdResponse');
    const deleteCheck = document.getElementById('cmdDelete');

    const wrapTitle = document.getElementById('labelTitle');
    const wrapColor = document.getElementById('labelColor');
    const wrapThumb = document.getElementById('labelThumbnail');
    const wrapImage = document.getElementById('labelImage');
    const wrapButtons = document.getElementById('labelButtons');
    const wrapExtraEmbeds = document.getElementById('extraEmbedsWrap');
    const wrapDuration = document.getElementById('labelDuration');
    const durationInput = document.getElementById('cmdDuration');
    const durationHint = document.getElementById('durationHint');
    const durationLabelText = document.getElementById('durationLabelText');
    const previewSection = document.getElementById('previewSection');
    const labelResponse = document.getElementById('labelResponse');

    const hints = {
        text: 'The bot replies with this text. Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N} | Positional args: $1 $2 $3 ...',
        embed: 'The bot replies with an embed. Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N} | Positional args: $1 $2 $3 ...',
        ban: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        kick: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        mute: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        warn: 'Usage: {prefix}command @user reason. The reason in Response is optional (uses default). Supports $1 $2 $3 ...',
        purge: 'Usage: {prefix}command [number] - Deletes N messages in the current channel (1-100).'
    };

    const currentPrefix = document.getElementById('cmdPrefix').value || '*';
    let hintText = hints[type] || '';
    hintText = hintText.replace(/{prefix}/g, currentPrefix);
    hint.textContent = hintText;

    const isEmbed = type === 'embed';
    const isText = type === 'text';
    const isPurge = type === 'purge';
    const isModAction = ['ban', 'kick', 'mute', 'warn'].includes(type);
    const isBan = type === 'ban';
    const isMute = type === 'mute';
    const showDuration = isBan || isMute;

    wrapTitle.style.display = isEmbed ? 'block' : 'none';
    wrapColor.style.display = isEmbed ? 'block' : 'none';
    wrapThumb.style.display = isEmbed ? 'block' : 'none';
    wrapImage.style.display = (isEmbed || isText) ? 'block' : 'none';
    if (wrapButtons) wrapButtons.style.display = (isEmbed || isText) ? 'block' : 'none';
    wrapDuration.style.display = showDuration ? 'block' : 'none';
    if (wrapExtraEmbeds) wrapExtraEmbeds.style.display = isEmbed ? 'block' : 'none';

    if (labelResponse) {
        labelResponse.style.display = isPurge ? 'none' : 'block';
    }

    if (previewSection) {
        previewSection.style.display = (isEmbed || isText) ? 'block' : 'none';
    }

    if (isEmbed) {
        const colorInput = document.getElementById('cmdColor');
        if (colorInput && (!colorInput.value || colorInput.value === '#e67e22' || colorInput.value === '#E67E22')) {
            colorInput.value = '#7289da';
        }
    }

    if (isBan) {
        durationInput.removeAttribute('max');
        durationInput.placeholder = 'e.g. 7 (leave empty for permanent ban)';
        durationLabelText.textContent = 'Duration (days)';
        durationHint.textContent = 'Leave empty for permanent ban. If filled, the bot will auto-unban after N days.';
    } else if (isMute) {
        durationInput.max = 28;
        durationInput.placeholder = 'e.g. 7 (leave empty for 28 days, max)';
        durationLabelText.textContent = 'Duration (days)';
        durationHint.textContent = 'Maximum 28 days. If empty, mute will last 28 days.';
    }

    if (isPurge) {
        response.required = false;
        response.value = '';
    } else if (isModAction) {
        responseLabel.textContent = 'Reason (optional)';
        response.placeholder = 'Default reason (optional)';
        response.required = false;
        if (deleteCheck) deleteCheck.checked = true;
    } else {
        responseLabel.textContent = 'Response';
        response.placeholder = 'Variables: {user} {username} {server} {membercount} {args} {md} {hammertime+N}';
        response.required = false;
    }

    updatePreview();
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
            <span>Embed extra</span>
            <button type="button" class="extra-embed-remove">&times;</button>
        </div>
        <label>Title</label>
        <input type="text" class="ee-title" value="${escapeAttr(data.title || '')}">
        <label>Response</label>
        <textarea class="ee-response" rows="3">${escapeHtml(data.response || '')}</textarea>
        <label>Color</label>
        <input type="color" class="ee-color" value="${colorHex}">
        <label>Thumbnail URL (optional)</label>
        <input type="url" class="ee-thumbnail" value="${escapeAttr(data.thumbnail || '')}">
        <label>Image URL (optional)</label>
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
    if (!list || !btn) return;
    const count = list.querySelectorAll('.cmd-button-block').length;
    if (count >= 5) {
        btn.disabled = true;
        btn.textContent = 'Max 5 buttons';
    } else {
        btn.disabled = false;
        btn.textContent = '+ Add buttons';
    }
}

function addButtonBlock(data = {}, silent = false) {
    const list = document.getElementById('cmdButtonsList');
    if (!list) return;
    if (list.querySelectorAll('.cmd-button-block').length >= 5) return;
    const idx = buttonBlockCounter++;
    const block = document.createElement('div');
    block.className = 'extra-embed-block cmd-button-block';
    block.dataset.idx = idx;
    block.innerHTML = `
        <div class="extra-embed-header">
            <span>Button</span>
            <button type="button" class="extra-embed-remove">&times;</button>
        </div>
        <label>Button label</label>
        <input type="text" class="cb-label" maxlength="80" value="${escapeAttr(data.label || '')}" placeholder="e.g: Join our server">
        <label>Button URL</label>
        <input type="url" class="cb-url" value="${escapeAttr(data.url || '')}" placeholder="https://...">
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
    if (isHidden) {
        panel.classList.remove('hidden');
        btn.classList.add('open');
    } else {
        panel.classList.add('hidden');
        btn.classList.remove('open');
    }
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
        html += `<div class="discord-embed-desc preview-empty">Fill in the Response field to see the text.</div>`;
    }
    if (image) {
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" onerror="this.style.display='none'">`;
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

function updatePreview() {
    const preview = document.getElementById('previewContent');
    const avatar = document.getElementById('previewAvatar');
    if (!preview) return;

    if (avatar) {
        avatar.src = 'https://images-ext-1.discordapp.net/external/Lir9nmM9QUd1ClFMcchk0JDU4CPNed97Iui2Sm_rfOk/%3Fsize%3D1024/https/cdn.discordapp.com/avatars/1510639493642850355/9774661e36e8458550112734ce78dc14.webp?format=webp&width=320&height=320';
    }

    const type = document.getElementById('cmdType').value;
    const response = document.getElementById('cmdResponse').value || '';
    const title = document.getElementById('cmdTitle').value || '';
    const colorHex = document.getElementById('cmdColor').value || '#E67E22';
    const thumbnail = document.getElementById('cmdThumbnail').value || '';
    const image = document.getElementById('cmdImage').value || '';

    const isEmbed = type === 'embed';
    const isText = type === 'text';

    const text = response
        .replace(/{user}/g, '@Mario')
        .replace(/{username}/g, 'Mario')
        .replace(/{server}/g, 'PredCord')
        .replace(/{membercount}/g, '42')
        .replace(/{args}/g, 'example args')
        .replace(/{md}/g, '[modlogs placeholder]')
        .replace(/{hammertime[+-]\d+}/g, '[orario]')
        .replace(/\$(\d+)/g, (match, num) => `[arg${num}]`);

    if (isEmbed) {
        let html = renderPreviewEmbed(title, colorHex, thumbnail, response, text, image);

        document.querySelectorAll('#extraEmbedsList .extra-embed-block').forEach(block => {
            const eTitle = block.querySelector('.ee-title').value || '';
            const eColor = block.querySelector('.ee-color').value || '#7289da';
            const eThumb = block.querySelector('.ee-thumbnail').value || '';
            const eImage = block.querySelector('.ee-image').value || '';
            const eResponse = block.querySelector('.ee-response').value || '';
            const eText = eResponse
                .replace(/{user}/g, '@Mario')
                .replace(/{username}/g, 'Mario')
                .replace(/{server}/g, 'PredCord')
                .replace(/{membercount}/g, '42')
                .replace(/{args}/g, 'example args')
                .replace(/{md}/g, '[modlogs placeholder]')
                .replace(/{hammertime[+-]\d+}/g, '[orario]')
                .replace(/\$(\d+)/g, (match, num) => `[arg${num}]`);
            html += renderPreviewEmbed(eTitle, eColor, eThumb, eResponse, eText, eImage);
        });

        html += renderPreviewButtons();
        preview.innerHTML = html;
        return;
    }

    if (!response.trim()) {
        preview.innerHTML = '<p class="preview-empty">Fill in the Response field to see the preview.</p>';
        return;
    }

    if (isText && image) {
        let html = `<div class="discord-embed" style="border-left-color: ${escapeAttr(colorHex)};">`;
        html += `<div class="discord-embed-desc">${escapeHtml(text)}</div>`;
        html += `<img class="discord-embed-image" src="${escapeAttr(image)}" alt="" onerror="this.style.display='none'">`;
        html += `</div>`;
        html += renderPreviewButtons();
        preview.innerHTML = html;
    } else {
        preview.innerHTML = escapeHtml(text).replace(/\n/g, '<br>') + renderPreviewButtons();
    }
}

function openPermissionsBox() {
    const box = document.getElementById('permissionsBox');
    const modal = document.getElementById('modal');

    box.classList.remove('hidden');
    modal.classList.add('open-with-permissions');

    if (!rolesLoaded) loadRoles();
}

function closePermissionsBox() {
    document.getElementById('permissionsBox').classList.add('hidden');
    document.getElementById('modal').classList.remove('open-with-permissions');
}

function togglePermissions() {
    const box = document.getElementById('permissionsBox');
    if (box.classList.contains('hidden')) {
        openPermissionsBox();
    } else {
        closePermissionsBox();
    }
}

async function loadRoles() {
    if (!currentGuild) return;
    const list = document.getElementById('rolesList');
    list.innerHTML = '<p class="loading-text">Loading roles...</p>';

    try {
        const res = await fetch(`/api/roles/${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load roles');
        currentRoles = await res.json();
        rolesLoaded = true;
        renderRoles();
    } catch (e) {
        list.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
    }
}

function renderRoles() {
    const list = document.getElementById('rolesList');

    if (!currentRoles || currentRoles.length === 0) {
        list.innerHTML = '<p class="loading-text">No roles available.</p>';
        return;
    }

    let selected = [];
    if (editingName && currentCommands[editingName] && Array.isArray(currentCommands[editingName].allowedRoles)) {
        selected = currentCommands[editingName].allowedRoles;
    }

    list.innerHTML = currentRoles.map(role => {
        const checked = selected.includes(role.id) ? 'checked' : '';
        return `
        <div class="role-item" data-role-id="${escapeAttr(role.id)}">
            <span class="role-name">${escapeHtml(role.name)}</span>
            <label class="role-toggle">
                <input type="checkbox" class="role-toggle-input" value="${escapeAttr(role.id)}" ${checked}>
                <span class="role-toggle-switch"></span>
            </label>
        </div>`;
    }).join('');
}

async function saveCommand(e) {
    e.preventDefault();

    if (editingName) {
        if (!userHasDashboardPermission('editRoles')) {
            showAccessDenied();
            return;
        }
    } else {
        if (!userHasDashboardPermission('createRoles')) {
            showAccessDenied();
            return;
        }
    }

    const nameInput = document.getElementById('cmdName');
    const responseInput = document.getElementById('cmdResponse');
    const typeValue = document.getElementById('cmdType').value;

    const name = nameInput.value.trim().toLowerCase();
    const isPurge = typeValue === 'purge';

    let invalid = false;

    if (!name || !/^[a-z0-9]{1,32}$/i.test(name)) {
        markFieldInvalid(nameInput);
        invalid = true;
    }

    if (invalid) {
        showFormToast('Fill all fields');
        shakeModal();
        return;
    }

    const colorHex = document.getElementById('cmdColor').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.disabled = true;

    let prefix = document.getElementById('cmdPrefix').value.trim();
    if (prefix.length !== 1) prefix = '*';

    let allowedRoles;
    if (rolesLoaded) {
        allowedRoles = Array.from(document.querySelectorAll('#rolesList .role-toggle-input:checked'))
            .map(cb => cb.value);
    } else if (editingName && currentCommands[editingName] && Array.isArray(currentCommands[editingName].allowedRoles)) {
        allowedRoles = currentCommands[editingName].allowedRoles;
    } else {
        allowedRoles = [];
    }

    const durationRaw = document.getElementById('cmdDuration').value;
    const durationValue = parseInt(durationRaw);
    const duration = isNaN(durationValue) || durationValue < 1 ? null : durationValue;

    const data = {
        prefix: prefix,
        type: typeValue,
        title: document.getElementById('cmdTitle').value,
        response: isPurge ? '' : document.getElementById('cmdResponse').value,
        color: parseInt(colorHex.replace('#', ''), 16),
        thumbnail: document.getElementById('cmdThumbnail').value || null,
        image: document.getElementById('cmdImage').value || null,
        extraEmbeds: typeValue === 'embed' ? collectExtraEmbeds() : [],
        buttons: (typeValue === 'embed' || typeValue === 'text') ? collectButtons() : [],
        deleteCommand: document.getElementById('cmdDelete').checked,
        allowedRoles: allowedRoles,
        duration: duration
    };

    try {
        const res = await fetch(`/api/commands/${currentGuild}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data, isEdit: !!editingName })
        });
        if (res.ok) {
            const baseToggle = document.getElementById('cmdIsBase');
            if (baseToggle && (myRole === 'owner' || isAdmin)) {
                const wantBase = baseToggle.checked;
                const currentBase = editingName && currentCommands[editingName] ? !!currentCommands[editingName].isBase : false;
                if (wantBase !== currentBase) {
                    await fetch(`/api/commands/${currentGuild}/${name}/setbase`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isBase: wantBase })
                    });
                }
            }

            closeModal();
            await loadCommands();
            showToast(`Command ${prefix}${name} saved`);
        } else {
            const err = await res.json();
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

async function deleteCommand(name) {
    if (!userHasDashboardPermission('deleteRoles')) {
        showAccessDenied();
        return;
    }

    const cmd = currentCommands[name];
    if (cmd && cmd.isBase) {
        showToast('This command is Base: remove the Base flag first to delete it', 'error');
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
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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
    if (knownGuilds.predcord || knownGuilds.community) return;
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
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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

async function loadBlacklist() {
    const list = document.getElementById('blacklistList');
    list.innerHTML = '<div class="loading">Loading</div>';

    try {
        const res = await fetch(`/api/blacklist?guildId=${currentGuild}`);
        if (!res.ok) throw new Error('Failed to load');
        const entries = await res.json();
        renderBlacklist(entries);
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${e.message}</p></div>`;
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
        const servers = (entry.servers || []).length;
        return `
        <div class="modlog-card" data-idx="${i}" data-target-id="${escapeAttr(entry.userId)}">
            <div class="modlog-row">
                <span class="modlog-line"><span class="log-user">${escapeHtml(entry.userTag || entry.userId)}</span> (${escapeHtml(entry.userId || '')})</span>
                <button class="modlog-arrow" type="button" aria-label="Details">&#9662;</button>
            </div>
            <div class="modlog-details">
                <div class="modlog-details-inner">
                    <div><b>Reason:</b> <span class="ban-reason-text">${escapeHtml(entry.reason || 'No reason provided')}</span></div>
                    <div><b>Blacklisted by:</b> ${escapeHtml(entry.modTag || entry.modId || 'Unknown')}</div>
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
        if (createList) createList.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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

        configLoaded = true;
    } catch (e) {
        console.error('[CONFIG] loadConfigSection error:', e);
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
        });
    }
}

let statsPeriod = 'tutto';

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
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.joins}</span><span class="stat-label">Joins (selected period)</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.leaves}</span><span class="stat-label">Leaves (selected period)</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.windowed.joins - data.windowed.leaves}</span><span class="stat-label">Net (selected period)</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.memberCount ?? '—'}</span><span class="stat-label">Current members</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.totals.joins}</span><span class="stat-label">Total joins (all time)</span></div>
            <div class="permission-card stat-tile"><span class="stat-value">${data.totals.leaves}</span><span class="stat-label">Total leaves (all time)</span></div>
        `;

        renderJoinLeaveChart(data.series || []);
    } catch (e) {
        grid.innerHTML = `<div class="permission-card"><h3>Error: ${e.message}</h3></div>`;
    }
}

let joinLeaveChartInstance = null;

function renderJoinLeaveChart(series) {
    const canvas = document.getElementById('joinLeaveChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (joinLeaveChartInstance) {
        joinLeaveChartInstance.destroy();
        joinLeaveChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    const chartHeight = canvas.parentElement ? canvas.parentElement.clientHeight : 320;

    const joinsGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    joinsGradient.addColorStop(0, 'rgba(52, 211, 153, 0.95)');
    joinsGradient.addColorStop(1, 'rgba(52, 211, 153, 0.35)');

    const leavesGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    leavesGradient.addColorStop(0, 'rgba(239, 68, 68, 0.95)');
    leavesGradient.addColorStop(1, 'rgba(239, 68, 68, 0.35)');

    const netAreaGradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    netAreaGradient.addColorStop(0, 'rgba(230, 126, 34, 0.35)');
    netAreaGradient.addColorStop(1, 'rgba(230, 126, 34, 0)');

    const labels = series.map(s => {
        const d = new Date(s.day);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    joinLeaveChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Joins',
                    data: series.map(s => s.joins),
                    backgroundColor: joinsGradient,
                    hoverBackgroundColor: 'rgba(52, 211, 153, 1)',
                    borderRadius: { topLeft: 6, topRight: 6 },
                    borderSkipped: false,
                    barPercentage: 0.7,
                    categoryPercentage: 0.6,
                    order: 2
                },
                {
                    type: 'bar',
                    label: 'Leaves',
                    data: series.map(s => s.leaves),
                    backgroundColor: leavesGradient,
                    hoverBackgroundColor: 'rgba(239, 68, 68, 1)',
                    borderRadius: { topLeft: 6, topRight: 6 },
                    borderSkipped: false,
                    barPercentage: 0.7,
                    categoryPercentage: 0.6,
                    order: 2
                },
                {
                    type: 'line',
                    label: 'Net',
                    data: series.map(s => s.joins - s.leaves),
                    borderColor: '#E67E22',
                    backgroundColor: netAreaGradient,
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointBackgroundColor: '#E67E22',
                    pointBorderColor: '#15151c',
                    pointBorderWidth: 1.5,
                    pointHoverRadius: 5,
                    tension: 0.4,
                    fill: true,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 900, easing: 'easeOutQuart' },
            scales: {
                x: {
                    ticks: { color: '#9aa0ab', font: { family: "'Manrope', sans-serif", size: 11 } },
                    grid: { display: false },
                    border: { color: 'rgba(255,255,255,0.08)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9aa0ab', precision: 0, font: { family: "'Manrope', sans-serif", size: 11 } },
                    grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false },
                    border: { display: false }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#e4e6eb',
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 8,
                        font: { family: "'Manrope', sans-serif", size: 12, weight: '600' },
                        padding: 18
                    }
                },
                tooltip: {
                    backgroundColor: '#15151cf2',
                    titleColor: '#fff',
                    bodyColor: '#c7cad1',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 10,
                    displayColors: true,
                    usePointStyle: true,
                    titleFont: { family: "'Manrope', sans-serif", weight: '700' },
                    bodyFont: { family: "'Manrope', sans-serif" }
                }
            }
        }
    });
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
        list.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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
        result.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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
        modTargetInviteGuildId: (document.getElementById('cfgModTargetInviteGuildId') || {}).value || null
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
    document.getElementById('staffAppCommunityCard')?.classList.toggle('hidden', !isCommunity);
    document.getElementById('staffAppPredcordCard')?.classList.toggle('hidden', isCommunity);

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
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
        });
    }
}

async function loadBanAppealConfig() {
    if (!isOwner()) return;

    const isCommunity = selectedServer === 'community';
    document.getElementById('banAppealCommunityCard')?.classList.toggle('hidden', !isCommunity);
    document.getElementById('banAppealPredcordCard')?.classList.toggle('hidden', isCommunity);

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
            if (el) el.innerHTML = `<p class="loading-text">Error: ${e.message}</p>`;
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
    document.querySelectorAll('.server-select-card').forEach(card => {
        card.onclick = () => selectServer(card.getAttribute('data-server'));
    });

    const changeServerBtn = document.getElementById('changeServerBtn');
    if (changeServerBtn) changeServerBtn.onclick = showServerSelectScreen;

    document.querySelectorAll('.masterclass-guild-pill').forEach(pill => {
        pill.onclick = () => setMasterclassGuild(pill.getAttribute('data-guild'));
    });

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

    const cmdType = document.getElementById('cmdType');
    if (cmdType) cmdType.onchange = updateTypeUI;

    const cmdNameInput = document.getElementById('cmdName');
    if (cmdNameInput) cmdNameInput.oninput = () => {
        cmdNameInput.value = cmdNameInput.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    };

    const cmdPrefix = document.getElementById('cmdPrefix');
    if (cmdPrefix) cmdPrefix.oninput = () => {
        cmdPrefix.value = cmdPrefix.value.replace(/[a-zA-Z0-9\s]/g, '').slice(0, 1);
        updateTypeUI();
    };

    const cmdDuration = document.getElementById('cmdDuration');
    if (cmdDuration) cmdDuration.oninput = () => {
        cmdDuration.value = cmdDuration.value.replace(/[^0-9]/g, '');
    };

    const cmdResponse = document.getElementById('cmdResponse');
    if (cmdResponse) cmdResponse.oninput = updatePreview;

    const cmdTitle = document.getElementById('cmdTitle');
    if (cmdTitle) cmdTitle.oninput = updatePreview;

    const cmdColor = document.getElementById('cmdColor');
    if (cmdColor) cmdColor.oninput = updatePreview;

    const cmdThumbnail = document.getElementById('cmdThumbnail');
    if (cmdThumbnail) cmdThumbnail.oninput = updatePreview;

    const cmdImage = document.getElementById('cmdImage');
    if (cmdImage) cmdImage.oninput = updatePreview;

    const moreBtn = document.getElementById('moreBtn');
    if (moreBtn) moreBtn.onclick = toggleMoreOptions;

    const addEmbedBtn = document.getElementById('addEmbedBtn');
    if (addEmbedBtn) addEmbedBtn.onclick = () => addEmbedBlock();

    const addButtonBtn = document.getElementById('addButtonBtn');
    if (addButtonBtn) addButtonBtn.onclick = () => addButtonBlock();

    const permissionsBtn = document.getElementById('permissionsBtn');
    if (permissionsBtn) permissionsBtn.onclick = togglePermissions;

    const permissionsClose = document.getElementById('permissionsClose');
    if (permissionsClose) permissionsClose.onclick = closePermissionsBox;

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
                    }, 350);
                });
            }, 180);
        };
    });

    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) modalCloseBtn.onclick = closeModal;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
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
