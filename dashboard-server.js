const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const os = require('os');
const mongoose = require('mongoose');
const multer = require('multer');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
require('dotenv').config();

require('./index.js');

function waitForBot(timeout = 300000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (global.PredCord && global.PredCord.client && global.PredCord.client.isReady()) {
                resolve();
            } else if (Date.now() - start > timeout) {
                reject(new Error('Bot timeout'));
            } else {
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

const ADMIN_USERNAME = process.env.DASH_USER || 'admin';
const ADMIN_PASSWORD = process.env.DASH_PASS || 'predcord2024';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:10000/auth/discord/callback';
const DISCORD_SITE_REDIRECT_URI = process.env.DISCORD_SITE_REDIRECT_URI || 'http://localhost:10000/site-auth/discord/callback';
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID;
const COMMUNITY_GUILD_ID = process.env.COMMUNITY_GUILD_ID;
const MASTERCLASS_GUILD_ID = process.env.MASTERCLASS_GUILD_ID || '1557430638783627304';

const SUPER_OWNER_IDS = ['887758994683338772', '1297667554487042130', '1346238732495355944', '825654941238034462'];

const COMMUNITY_ACCESS_ROLE_IDS = ['1341039063641358388', '1494738070405124096', '1465472561172451646', '1548720844434571284'];
const PREDCORD_ACCESS_ROLE_IDS = ['1498132188552761545', '1549525442493685900', '1497945553013571674'];

const APPLY_BLOCKED_ROLE_IDS = {
    community: ['1495402579608469596', '1341039013389271082'],
    predcord: ['1549506505487941643', '1498132188552761545']
};

const MAX_BASE_COMMANDS = 10;
const SUBMISSION_COOLDOWN_SECONDS = 36 * 60 * 60;

const app = express();
const PORT = process.env.PORT || 10000;
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const SITE_DIR = path.join(__dirname, 'site');

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 60 * 60 * 24 * 7,
        collectionName: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'predcord-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7,
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later.' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' }
});

const siteFormLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many submissions, please try again later.' }
});

const mcTicketMessageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many messages, please slow down.' }
});

const VIDEO_UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'predcord-video-uploads');
if (!fs.existsSync(VIDEO_UPLOAD_TMP_DIR)) fs.mkdirSync(VIDEO_UPLOAD_TMP_DIR, { recursive: true });

const videoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, VIDEO_UPLOAD_TMP_DIR),
        filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}`)
    }),
    limits: { fileSize: 1024 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isMp4 = file.mimetype === 'video/mp4' && path.extname(file.originalname).toLowerCase() === '.mp4';
        if (!isMp4) return cb(new Error('Only MP4 video files are allowed'));
        cb(null, true);
    }
});

function uploadVideoMiddleware(req, res, next) {
    videoUpload.single('video')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
        next();
    });
}

const HLS_TMP_DIR = path.join(os.tmpdir(), 'predcord-hls-tmp');
if (!fs.existsSync(HLS_TMP_DIR)) fs.mkdirSync(HLS_TMP_DIR, { recursive: true });

function runFfmpegHls(inputPath, outputDir) {
    return new Promise((resolve, reject) => {
        const manifestPath = path.join(outputDir, 'index.m3u8');
        const args = [
            '-i', inputPath,
            '-c', 'copy',
            '-map', '0',
            '-f', 'hls',
            '-hls_time', '6',
            '-hls_list_size', '0',
            '-hls_segment_filename', path.join(outputDir, 'seg_%05d.ts'),
            manifestPath
        ];
        const proc = spawn(ffmpegPath, args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve(manifestPath);
            else reject(new Error('ffmpeg exited with code ' + code + ': ' + stderr.slice(-500)));
        });
    });
}

function parseHlsManifest(manifestPath) {
    const text = fs.readFileSync(manifestPath, 'utf8');
    const lines = text.split('\n').map((l) => l.trim());
    const segments = [];
    let pendingDuration = null;
    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const match = /#EXTINF:([\d.]+)/.exec(line);
            pendingDuration = match ? parseFloat(match[1]) : 6;
        } else if (line && !line.startsWith('#')) {
            segments.push({ filename: line, duration: pendingDuration || 6 });
            pendingDuration = null;
        }
    }
    return segments;
}

async function uploadHlsSegmentsToGridFS(db, outputDir, segments) {
    const bucket = db.getVideoBucket();
    const uploaded = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = path.join(outputDir, seg.filename);
        const fileId = await new Promise((resolve, reject) => {
            const uploadStream = bucket.openUploadStream(seg.filename, { contentType: 'video/mp2t' });
            const readStream = fs.createReadStream(segPath);
            const onError = (err) => { readStream.destroy(); uploadStream.destroy(); reject(err); };
            readStream.on('error', onError);
            uploadStream.on('error', onError);
            uploadStream.on('finish', () => resolve(uploadStream.id));
            readStream.pipe(uploadStream);
        });
        uploaded.push({ index: i, fileId, duration: seg.duration });
    }
    return uploaded;
}

async function downloadVideoFileToTemp(db, fileId) {
    const bucket = db.getVideoBucket();
    const tmpPath = path.join(VIDEO_UPLOAD_TMP_DIR, `migrate-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    await new Promise((resolve, reject) => {
        const readStream = bucket.openDownloadStream(fileId);
        const writeStream = fs.createWriteStream(tmpPath);
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
    });
    return tmpPath;
}

async function processVideoToHls(db, inputPath) {
    const workDir = path.join(HLS_TMP_DIR, `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
        const manifestPath = await runFfmpegHls(inputPath, workDir);
        const segments = parseHlsManifest(manifestPath);
        if (segments.length === 0) throw new Error('HLS segmentation produced no segments');
        return await uploadHlsSegmentsToGridFS(db, workDir, segments);
    } finally {
        fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
}

const HLS_TOKEN_SECRET = process.env.SESSION_SECRET || 'predcord-secret';
const HLS_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

function signSegmentToken(videoId) {
    const exp = Date.now() + HLS_TOKEN_TTL_MS;
    const payload = videoId + '.' + exp;
    const sig = crypto.createHmac('sha256', HLS_TOKEN_SECRET).update(payload).digest('hex');
    return Buffer.from(payload + '.' + sig).toString('base64url');
}

function verifySegmentToken(videoId, token) {
    if (!token) return false;
    let decoded;
    try { decoded = Buffer.from(token, 'base64url').toString('utf8'); } catch { return false; }
    const parts = decoded.split('.');
    if (parts.length !== 3) return false;
    const [tokenVideoId, expStr, sig] = parts;
    if (tokenVideoId !== videoId) return false;
    const exp = parseInt(expStr, 10);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const expected = crypto.createHmac('sha256', HLS_TOKEN_SECRET).update(tokenVideoId + '.' + expStr).digest('hex');
    if (expected.length !== sig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

async function authorizeVideoAccess(req, video) {
    const { db, client } = global.PredCord;
    if (req.session.user && getUserRole(req) === 'owner') return true;
    if (!req.session.siteUser) return false;
    const u = req.session.siteUser;
    const allowedPage = await canUserViewVideosPage(u.id);
    if (!allowedPage) return false;
    if (!video.requiredRoleIds || video.requiredRoleIds.length === 0) return true;
    const settings = await db.getMasterclassSettingsDB();
    if ((settings.viewUserIds || []).includes(u.id)) return true;
    const userRoles = await getUserMergedRoles(client, u.id);
    return video.requiredRoleIds.some((r) => userRoles.has(r));
}

app.use('/api/', apiLimiter);
app.use(['/login', '/auth/discord', '/site-auth/discord'], authLimiter);
app.use(['/api/site/apply', '/api/site/appeal'], siteFormLimiter);
app.use('/api/site/mc-tickets/create', siteFormLimiter);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

async function resolveOneGuildAccess(discordUserId, guildId, fixedRoleIds) {
    const { client, db } = global.PredCord;
    const out = { access: false, role: null, roles: [] };
    if (!guildId) return out;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return out;
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) return out;

    const userRoles = member.roles.cache.map(r => r.id);
    out.roles = userRoles;

    const specialUsers = await db.getDashboardSpecialUsersDB(guildId);
    if (specialUsers.ownerUsers.includes(discordUserId)) {
        out.access = true;
        out.role = 'owner';
    } else if (specialUsers.adminUsers.includes(discordUserId)) {
        out.access = true;
        out.role = 'admin';
    } else {
        const permissions = await db.getDashboardPermissionsDB(guildId);
        const allAllowed = [
            ...(permissions.createRoles || []),
            ...(permissions.editRoles || []),
            ...(permissions.deleteRoles || []),
            ...(permissions.viewLogsRoles || [])
        ];
        const hasConfiguredRole = allAllowed.some(roleId => userRoles.includes(roleId));
        const hasFixedRole = (fixedRoleIds || []).some(roleId => userRoles.includes(roleId));
        if (hasConfiguredRole || hasFixedRole) {
            out.access = true;
            out.role = 'user';
        }
    }
    return out;
}

async function resolveGuildAccess(discordUserId) {
    if (SUPER_OWNER_IDS.includes(discordUserId)) {
        const full = { access: true, role: 'owner', roles: [] };
        return { predcord: { ...full }, community: { ...full }, masterclassServer: { ...full } };
    }

    return {
        predcord: await resolveOneGuildAccess(discordUserId, MAIN_GUILD_ID, PREDCORD_ACCESS_ROLE_IDS),
        community: await resolveOneGuildAccess(discordUserId, COMMUNITY_GUILD_ID, COMMUNITY_ACCESS_ROLE_IDS),
        masterclassServer: await resolveOneGuildAccess(discordUserId, MASTERCLASS_GUILD_ID, [])
    };
}

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const access = await resolveGuildAccess(profile.id);

        if (!access.predcord.access && !access.community.access && !access.masterclassServer.access) {
            return done(null, false, { message: 'You do not have the authorized roles on any server' });
        }

        const globalRole = access.predcord.role === 'owner' ? 'owner'
            : access.predcord.role === 'admin' ? 'admin'
            : null;

        return done(null, {
            id: profile.id,
            username: profile.username,
            discriminator: profile.discriminator,
            avatar: profile.avatar,
            isDiscord: true,
            role: globalRole,
            roles: access.predcord.roles,
            predcordAccess: access.predcord.access,
            predcordRole: access.predcord.role,
            community: {
                access: access.community.access,
                role: access.community.role,
                roles: access.community.roles
            },
            masterclassServer: {
                access: access.masterclassServer.access,
                role: access.masterclassServer.role,
                roles: access.masterclassServer.roles
            }
        });
    } catch (err) {
        return done(err, null);
    }
}));

passport.use('discord-site', new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_SITE_REDIRECT_URI,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, {
        id: profile.id,
        username: profile.username,
        discriminator: profile.discriminator,
        avatar: profile.avatar,
        isSitePublic: true
    });
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/videos.html', async (req, res, next) => {
    if (!req.session.siteUser) return res.redirect('/');
    try {
        const allowed = await canUserViewVideosPage(req.session.siteUser.id);
        if (!allowed) return res.redirect('/');
    } catch (e) {
        return res.redirect('/');
    }
    next();
});

app.use('/dashboard', express.static(DASHBOARD_DIR));
app.use(express.static(SITE_DIR));

async function trySiteUserAsAdmin(req) {
    if (!req.session.siteUser) return false;

    if (SUPER_OWNER_IDS.includes(req.session.siteUser.id)) {
        const u = req.session.siteUser;
        req.session.user = {
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            role: 'owner',
            isDiscord: true
        };
        return true;
    }

    if (!MAIN_GUILD_ID) return false;
    try {
        const { client, db } = global.PredCord;
        const guild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!guild) return false;

        const u = req.session.siteUser;
        const specialUsers = await db.getDashboardSpecialUsersDB(MAIN_GUILD_ID);

        let role = null;
        if (specialUsers.ownerUsers.includes(u.id)) {
            role = 'owner';
        } else if (specialUsers.adminUsers.includes(u.id)) {
            role = 'admin';
        } else {
            const member = await guild.members.fetch(u.id).catch(() => null);
            if (!member) return false;

            const permissions = await db.getDashboardPermissionsDB(MAIN_GUILD_ID);
            const userRoles = member.roles.cache.map(r => r.id);
            const allAllowed = [
                ...(permissions.createRoles || []),
                ...(permissions.editRoles || []),
                ...(permissions.deleteRoles || []),
                ...(permissions.viewLogsRoles || [])
            ];
            if (!allAllowed.some(roleId => userRoles.includes(roleId))) return false;
            role = 'user';
        }

        req.session.user = {
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            role: role,
            isDiscord: true
        };
        return true;
    } catch (e) {
        console.error('[SITE->ADMIN] resolve failed:', e.message);
        return false;
    }
}

function requireAuth(req, res, next) {
    if (req.session.user || (req.user && req.user.isDiscord)) return next();

    trySiteUserAsAdmin(req).then((ok) => {
        if (!ok) {
            if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
            if (req.session.siteUser) {
                res.set('Cache-Control', 'no-store');
                return res.status(403).sendFile(path.join(DASHBOARD_DIR, 'access-denied.html'));
            }
            return res.redirect('/login');
        }
        req.session.save((err) => {
            if (err) console.error('[SESSION] save error:', err);
            next();
        });
    }).catch((e) => {
        console.error('[AUTH] requireAuth error:', e.message);
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        res.redirect('/login');
    });
}

function isDashboardAdmin(req) {
    if (req.session.user && req.session.user.username === ADMIN_USERNAME && !req.session.user.isDiscord) return true;
    return false;
}

function getUserRole(req) {
    if (isDashboardAdmin(req)) return 'owner';
    if (req.session.user && req.session.user.isDiscord) {
        return req.session.user.role || 'user';
    }
    return null;
}

function getExtraGuildAccess(req, guildId) {
    if (!guildId) return null;
    if (guildId === COMMUNITY_GUILD_ID) return (req.user && req.user.community) || { access: false, role: null, roles: [] };
    if (guildId === MASTERCLASS_GUILD_ID) return (req.user && req.user.masterclassServer) || { access: false, role: null, roles: [] };
    return null;
}

async function userHasPermission(req, permKey, guildId) {
    const role = getUserRole(req);

    if (role === 'owner' || role === 'admin') {
        return true;
    }

    const targetGuildId = guildId || MAIN_GUILD_ID;

    const extra = getExtraGuildAccess(req, targetGuildId);
    if (extra) {
        if (extra.role === 'owner' || extra.role === 'admin') return true;

        const permissions = await global.PredCord.db.getDashboardPermissionsDB(targetGuildId);
        const allowed = permissions[permKey] || [];
        if (allowed.length === 0) return false;
        const userRoles = extra.roles || [];
        return userRoles.some(roleId => allowed.includes(roleId));
    }

    if (role === 'user') {
        const permissions = await global.PredCord.db.getDashboardPermissionsDB(targetGuildId);
        const allowed = permissions[permKey] || [];
        if (allowed.length === 0) return false;
        const userRoles = req.user ? (req.user.roles || []) : [];
        return userRoles.some(roleId => allowed.includes(roleId));
    }

    return false;
}

function canManagePermissions(req, guildId) {
    return isOwner(req, guildId);
}

function isOwner(req, guildId) {
    const role = getUserRole(req);
    if (role === 'owner') return true;
    const extra = getExtraGuildAccess(req, guildId);
    if (extra && extra.role === 'owner') return true;
    return false;
}

function canAccessGuild(req, guildId) {
    const role = getUserRole(req);
    if (role === 'owner' || role === 'admin') return true;
    if (!guildId) return false;
    if (guildId === MAIN_GUILD_ID) return !!(req.user && req.user.predcordAccess);
    const extra = getExtraGuildAccess(req, guildId);
    if (extra) return !!extra.access;
    return false;
}

app.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.session.user || (req.user && req.user.isDiscord)) return res.redirect('/dashboard');
    res.sendFile(path.join(DASHBOARD_DIR, 'login.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/login?error=access_denied' }),
    (req, res) => {
        req.session.user = {
            id: req.user.id,
            username: req.user.username,
            avatar: req.user.avatar,
            role: req.user.role,
            isDiscord: true
        };
        req.session.save((err) => {
            if (err) console.error('[SESSION] save error:', err);
            res.redirect('/dashboard');
        });
    }
);

app.get('/site-auth/discord', (req, res, next) => {
    req.session.siteReturnTo = (req.query.next && req.query.next.startsWith('/')) ? req.query.next : '/';
    next();
}, passport.authenticate('discord-site'));

app.get('/site-auth/discord/callback',
    passport.authenticate('discord-site', { failureRedirect: '/' }),
    (req, res) => {
        req.session.siteUser = {
            id: req.user.id,
            username: req.user.username,
            globalName: req.user.global_name || null,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar
        };
        const returnTo = req.session.siteReturnTo || '/';
        delete req.session.siteReturnTo;
        req.session.save((err) => {
            if (err) console.error('[SESSION] site save error:', err);
            res.redirect(returnTo);
        });
    }
);

async function canUserViewVideosPage(userId) {
    if (SUPER_OWNER_IDS.includes(userId)) return true;
    try {
        const { client, db } = global.PredCord;
        const settings = await db.getMasterclassSettingsDB();
        if ((settings.viewUserIds || []).includes(userId) || (settings.manageUserIds || []).includes(userId)) return true;
        const guildIds = [MASTERCLASS_GUILD_ID].filter(Boolean);
        for (const guildId of guildIds) {
            const roleIds = await db.getVideoAccessRolesDB(guildId);
            if (!roleIds || roleIds.length === 0) continue;
            const guild = client.guilds.cache.get(guildId);
            const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
            if (!member) continue;
            const userRoles = member.roles.cache.map(r => r.id);
            if (roleIds.some(r => userRoles.includes(r))) return true;
        }
        return false;
    } catch (e) {
        console.error('[VIDEOS ACCESS] check failed:', e.message);
        return false;
    }
}

app.get('/api/site/me', async (req, res) => {
    if (!req.session.siteUser) return res.json({ loggedIn: false });
    const u = req.session.siteUser;
    const avatarUrl = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(parseInt(u.discriminator, 10) || 0) % 5}.png`;

    let canAccessDashboard = false;
    try {
        if (SUPER_OWNER_IDS.includes(u.id)) {
            canAccessDashboard = true;
            const canViewVideos = await canUserViewVideosPage(u.id);
            return res.json({ loggedIn: true, id: u.id, username: u.username, avatar: avatarUrl, canAccessDashboard, canViewVideos });
        }
        const { client, db } = global.PredCord;
        const guild = MAIN_GUILD_ID ? client.guilds.cache.get(MAIN_GUILD_ID) : null;
        if (guild) {
            const specialUsers = await db.getDashboardSpecialUsersDB(MAIN_GUILD_ID);
            if (specialUsers.ownerUsers.includes(u.id) || specialUsers.adminUsers.includes(u.id)) {
                canAccessDashboard = true;
            } else {
                const member = await guild.members.fetch(u.id).catch(() => null);
                if (member) {
                    const permissions = await db.getDashboardPermissionsDB(MAIN_GUILD_ID);
                    const userRoles = member.roles.cache.map(r => r.id);
                    const allAllowed = [
                        ...(permissions.createRoles || []),
                        ...(permissions.editRoles || []),
                        ...(permissions.deleteRoles || []),
                        ...(permissions.viewLogsRoles || [])
                    ];
                    canAccessDashboard = allAllowed.some(roleId => userRoles.includes(roleId));
                }
            }
        }
    } catch (e) {
        console.error('[SITE ME] canAccessDashboard check failed:', e.message);
    }

    const canViewVideos = await canUserViewVideosPage(u.id);

    res.json({ loggedIn: true, id: u.id, username: u.username, avatar: avatarUrl, canAccessDashboard, canViewVideos });
});

app.post('/api/site/logout', (req, res) => {
    delete req.session.siteUser;
    req.session.save(() => res.json({ success: true }));
});

async function buildUserInfoField(client, guildId, userId) {
    const lines = [`User: <@${userId}>`];
    try {
        const guild = client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member) {
            const createdTs = Math.floor(member.user.createdTimestamp / 1000);
            lines.push(`Account Created: <t:${createdTs}:F> (<t:${createdTs}:R>)`);
            if (member.joinedTimestamp) {
                const joinedTs = Math.floor(member.joinedTimestamp / 1000);
                lines.push(`Joined Server: <t:${joinedTs}:F> (<t:${joinedTs}:R>)`);
            }
            const roles = member.roles.cache.filter(r => r.id !== guild.id);
            if (roles.size > 0) {
                lines.push(`Roles: ${roles.map(r => `<@&${r.id}>`).join(', ')}`);
            }
        }
    } catch (e) {
        console.error('[USER INFO] fetch failed:', e.message);
    }
    return lines.join('\n');
}

async function getGuildEligibility(client, targetGuildId, userId, team) {
    const guild = client.guilds.cache.get(targetGuildId);
    if (!guild) return { isMember: false, isBanned: false, isMuted: false, hasBlockedRole: false, guildFound: false };

    const member = await guild.members.fetch(userId).catch(() => null);
    const isMember = !!member;
    const isMuted = !!(member && member.communicationDisabledUntil && new Date(member.communicationDisabledUntil) > new Date());

    const blockedRoleIds = APPLY_BLOCKED_ROLE_IDS[team] || [];
    const hasBlockedRole = !!(member && blockedRoleIds.some(roleId => member.roles.cache.has(roleId)));

    let isBanned = false;
    try {
        await guild.bans.fetch(userId);
        isBanned = true;
    } catch (e) {
        isBanned = false;
    }

    return { isMember, isBanned, isMuted, hasBlockedRole, guildFound: true };
}

app.get('/api/site/eligibility', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });

    const team = req.query.team;
    if (!['community', 'predcord'].includes(team)) return res.status(400).json({ error: 'invalid_team' });

    try {
        const rolesClient = global.PredCord.getRolesClient ? global.PredCord.getRolesClient() : global.PredCord.client;
        const targetGuildId = team === 'community' ? COMMUNITY_GUILD_ID : MAIN_GUILD_ID;
        if (!targetGuildId) return res.status(503).json({ error: 'guild_not_configured' });

        const { isMember, isBanned, isMuted, hasBlockedRole, guildFound } = await getGuildEligibility(rolesClient, targetGuildId, req.session.siteUser.id, team);
        if (!guildFound) return res.status(503).json({ error: 'guild_not_found' });

        res.json({ isMember, isBanned, isMuted, hasBlockedRole });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/apply', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });

    const { team, answers } = req.body;
    if (!['community', 'predcord'].includes(team)) return res.status(400).json({ error: 'invalid_team' });
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'invalid_answers' });

    try {
        const { client, db } = global.PredCord;
        const targetGuildId = team === 'community' ? COMMUNITY_GUILD_ID : MAIN_GUILD_ID;
        if (!targetGuildId) return res.status(503).json({ error: 'guild_not_configured' });

        const user = req.session.siteUser;

        const rolesClient = global.PredCord.getRolesClient ? global.PredCord.getRolesClient() : client;
        const eligibility = await getGuildEligibility(rolesClient, targetGuildId, user.id, team);
        if (eligibility.guildFound && !eligibility.isMember) {
            return res.status(403).json({ error: 'not_member' });
        }
        if (eligibility.guildFound && eligibility.hasBlockedRole) {
            return res.status(403).json({ error: 'blocked_role' });
        }

        const cooldown = await db.getCommandCooldownDB(user.id, targetGuildId, 'staff_application');
        if (cooldown) {
            return res.status(429).json({ error: 'cooldown', retryAt: cooldown.expiresAt });
        }

        const guildConfig = await db.getGuildConfigDB(targetGuildId);
        const channelId = guildConfig.staffApplicationChannelId;
        if (!channelId) return res.status(503).json({ error: 'channel_not_configured' });

        const channel = await client.channels.fetch(channelId);
        if (!channel) return res.status(503).json({ error: 'channel_not_found' });
        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${(parseInt(user.discriminator, 10) || 0) % 5}.png`;

        const embed = new EmbedBuilder()
            .setColor(team === 'community' ? 0xE67E22 : 0x38BDF8)
            .setAuthor({ name: `${user.username} (${user.id})`, iconURL: avatarUrl })
            .setTitle(team === 'community' ? 'Predage Community Staff Application' : 'PredCord Staff Application');

        for (const [question, answer] of Object.entries(answers)) {
            embed.addFields({ name: String(question).slice(0, 256), value: String(answer || 'N/A').slice(0, 1024) });
        }

        embed.addFields({ name: 'User Info', value: await buildUserInfoField(client, targetGuildId, user.id) });

        const appRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_accept_${user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`app_reject_${user.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [appRow] });
        await db.setCommandCooldownDB(user.id, targetGuildId, 'staff_application', SUBMISSION_COOLDOWN_SECONDS);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/appeal', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });

    const { team, answers } = req.body;
    if (!['community', 'predcord'].includes(team)) return res.status(400).json({ error: 'invalid_team' });
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'invalid_answers' });

    try {
        const { client, db } = global.PredCord;
        const targetGuildId = team === 'community' ? COMMUNITY_GUILD_ID : MAIN_GUILD_ID;
        if (!targetGuildId) return res.status(503).json({ error: 'guild_not_configured' });

        const user = req.session.siteUser;

        const rolesClient = global.PredCord.getRolesClient ? global.PredCord.getRolesClient() : client;
        const eligibility = await getGuildEligibility(rolesClient, targetGuildId, user.id, team);
        if (eligibility.guildFound && !eligibility.isBanned && !eligibility.isMuted) {
            return res.status(403).json({ error: 'not_banned' });
        }

        const cooldown = await db.getCommandCooldownDB(user.id, targetGuildId, 'ban_appeal');
        if (cooldown) {
            return res.status(429).json({ error: 'cooldown', retryAt: cooldown.expiresAt });
        }

        const guildConfig = await db.getGuildConfigDB(targetGuildId);
        const channelId = guildConfig.banAppealChannelId;
        if (!channelId) return res.status(503).json({ error: 'channel_not_configured' });

        const channel = await client.channels.fetch(channelId);
        if (!channel) return res.status(503).json({ error: 'channel_not_found' });

        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${(parseInt(user.discriminator, 10) || 0) % 5}.png`;

        const embed = new EmbedBuilder()
            .setColor(team === 'community' ? 0xE67E22 : 0x38BDF8)
            .setAuthor({ name: `${user.username} (${user.id})`, iconURL: avatarUrl })
            .setTitle(team === 'community' ? 'Predage Community Ban Appeal' : 'PredCord Ban Appeal');

        for (const [question, answer] of Object.entries(answers)) {
            embed.addFields({ name: String(question).slice(0, 256), value: String(answer || 'N/A').slice(0, 1024) });
        }

        embed.addFields({ name: 'User Info', value: await buildUserInfoField(client, targetGuildId, user.id) });

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`appeal_accept_${user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`appeal_deny_${user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`appeal_modlogs_${user.id}`).setLabel('Modlogs').setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ embeds: [embed], components: [actionRow] });
        await db.setCommandCooldownDB(user.id, targetGuildId, 'ban_appeal', SUBMISSION_COOLDOWN_SECONDS);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.logout(() => {
        req.session.destroy(() => res.json({ success: true }));
    });
});

app.get('/api/me', requireAuth, async (req, res) => {
    const role = getUserRole(req);
    const isDiscordUser = req.session.user && req.session.user.isDiscord;

    let access = { predcord: true, community: true, masterclassServer: true };
    if (isDiscordUser && role !== 'owner' && role !== 'admin') {
        access = {
            predcord: !!(req.user && req.user.predcordAccess),
            community: !!(req.user && req.user.community && req.user.community.access),
            masterclassServer: !!(req.user && req.user.masterclassServer && req.user.masterclassServer.access)
        };
    }

    const masterclass = await getMasterclassFlags(req);

    let canViewVideos = false;
    if (role === 'owner' || role === 'admin') {
        canViewVideos = true;
    } else if (req.session.user && req.session.user.id) {
        canViewVideos = await canUserViewVideosPage(req.session.user.id);
    }

    res.json({
        user: req.session.user,
        isAdmin: role === 'owner' || role === 'admin',
        isDiscord: !!isDiscordUser,
        role: role || 'none',
        isOwner: role === 'owner',
        canManagePermissions: canManagePermissions(req),
        canAccessMasterclass: masterclass.canAccess,
        canUploadVideos: masterclass.canUpload,
        canManageVideos: masterclass.canManage,
        canMcTickets: masterclass.canTickets,
        canRoleSync: await canManageRoleSync(req).catch(() => false),
        canDropmaps: canManageDropmaps(req),
        canViewVideos: canViewVideos,
        access: access
    });
});

app.get('/api/me/full', requireAuth, async (req, res) => {
    try {
        const { client } = global.PredCord;

        if (!req.session.user || !req.session.user.isDiscord) {
            return res.json({
                id: req.session.user?.id || null,
                username: req.session.user?.username || 'Admin',
                displayName: req.session.user?.username || 'Admin',
                discriminator: '0000',
                tag: req.session.user?.username || 'Admin',
                avatar: null,
                roles: []
            });
        }

        const targetGuildId = req.query.guildId || MAIN_GUILD_ID;

        if (req.query.guildId && !canAccessGuild(req, targetGuildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const guild = client.guilds.cache.get(targetGuildId);
        if (!guild) {
            return res.json({
                id: req.session.user.id,
                username: req.session.user.username,
                displayName: req.session.user.username,
                discriminator: req.session.user.discriminator || '0000',
                tag: req.session.user.username,
                avatar: req.session.user.avatar,
                roles: []
            });
        }

        let member;
        try {
            member = await guild.members.fetch(req.session.user.id);
        } catch {
            return res.json({
                id: req.session.user.id,
                username: req.session.user.username,
                displayName: req.session.user.username,
                discriminator: req.session.user.discriminator || '0000',
                tag: req.session.user.username,
                avatar: req.session.user.avatar,
                roles: []
            });
        }

        const roles = member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor
            }));

        const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 128 });

        res.json({
            id: member.user.id,
            username: member.user.username,
            displayName: member.displayName,
            discriminator: member.user.discriminator || '0000',
            tag: member.user.tag,
            avatar: avatarUrl,
            roles: roles
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/me/guild-info', requireAuth, async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.isDiscord) {
            return res.status(403).json({ error: 'Discord users only' });
        }

        const { client } = global.PredCord;

        const guildId = req.query.guildId || MAIN_GUILD_ID;
        if (!guildId) {
            return res.status(400).json({ error: 'Missing guildId' });
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        let member;
        try {
            member = await guild.members.fetch(req.session.user.id);
        } catch {
            return res.status(404).json({ error: 'Member not found' });
        }

        const roles = member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color
            }));

        res.json({
            displayName: member.displayName || member.user.username,
            nickname: member.nickname || null,
            roles
        });
    } catch (e) {
        console.error('[ME-GUILD-INFO]', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/my-permissions', requireAuth, async (req, res) => {
    try {
        const role = getUserRole(req);
        const targetGuildId = req.query.guildId || MAIN_GUILD_ID;

        if (role === 'owner' || role === 'admin') {
            return res.json({
                createRoles: true,
                editRoles: true,
                deleteRoles: true,
                viewLogsRoles: true,
                managePermissions: role === 'owner',
                isOwner: role === 'owner'
            });
        }

        const extraAccess = getExtraGuildAccess(req, targetGuildId);
        if (extraAccess) {
            const communityRole = extraAccess.role;

            if (communityRole === 'owner' || communityRole === 'admin') {
                return res.json({
                    createRoles: true,
                    editRoles: true,
                    deleteRoles: true,
                    viewLogsRoles: true,
                    managePermissions: communityRole === 'owner',
                    isOwner: communityRole === 'owner'
                });
            }

            const permissions = await global.PredCord.db.getDashboardPermissionsDB(targetGuildId);
            const userRoles = extraAccess.roles || [];

            const check = (permKey) => {
                const allowed = permissions[permKey] || [];
                if (allowed.length === 0) return false;
                return userRoles.some(roleId => allowed.includes(roleId));
            };

            return res.json({
                createRoles: check('createRoles'),
                editRoles: check('editRoles'),
                deleteRoles: check('deleteRoles'),
                viewLogsRoles: check('viewLogsRoles'),
                managePermissions: false,
                isOwner: false
            });
        }

        if (role === 'user') {
            const permissions = await global.PredCord.db.getDashboardPermissionsDB(targetGuildId);
            const userRoles = req.user ? (req.user.roles || []) : [];

            const check = (permKey) => {
                const allowed = permissions[permKey] || [];
                if (allowed.length === 0) return false;
                return userRoles.some(roleId => allowed.includes(roleId));
            };

            return res.json({
                createRoles: check('createRoles'),
                editRoles: check('editRoles'),
                deleteRoles: check('deleteRoles'),
                viewLogsRoles: check('viewLogsRoles'),
                managePermissions: false,
                isOwner: false
            });
        }

        res.json({
            createRoles: false,
            editRoles: false,
            deleteRoles: false,
            viewLogsRoles: false,
            managePermissions: false,
            isOwner: false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/known-guilds', requireAuth, (req, res) => {
    res.json({ predcord: MAIN_GUILD_ID || null, community: COMMUNITY_GUILD_ID || null, masterclassServer: MASTERCLASS_GUILD_ID || null });
});

app.get('/api/guilds', requireAuth, (req, res) => {
    try {
        const { client } = global.PredCord;
        const ids = [MAIN_GUILD_ID, COMMUNITY_GUILD_ID, MASTERCLASS_GUILD_ID].filter(Boolean);
        const guilds = ids
            .map(id => client.guilds.cache.get(id))
            .filter(Boolean)
            .map(g => ({
                id: g.id,
                name: g.name,
                icon: g.iconURL({ dynamic: true, size: 128 }),
                memberCount: g.memberCount
            }));
        res.json(guilds);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/roles/:guildId', requireAuth, async (req, res) => {
    try {
        let allowed = canAccessGuild(req, req.params.guildId) || isDashboardAdmin(req);
        if (!allowed && req.params.guildId === MASTERCLASS_GUILD_ID) {
            const flags = await getMasterclassFlags(req);
            allowed = !!(flags.canAccess || flags.canUpload || flags.canManage || flags.canTickets);
        }
        if (!allowed) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.hexColor,
                position: r.position,
                managed: r.managed
            }));

        res.json(roles);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function getMasterclassFlags(req) {
    const role = getUserRole(req);
    if (role === 'owner') return { canUpload: true, canManage: true, canAccess: true, canTickets: true };
    const userId = req.session.user && req.session.user.id;
    if (!userId) return { canUpload: false, canManage: false, canAccess: false, canTickets: false };
    const settings = await global.PredCord.db.getMasterclassSettingsDB();
    const canUpload = (settings.uploadUserIds || []).includes(userId);
    const canManage = (settings.manageUserIds || []).includes(userId);
    const canTickets = SUPER_OWNER_IDS.includes(userId) || (settings.ticketStaffUserIds || []).includes(userId);
    return { canUpload, canManage, canAccess: canUpload || canManage, canTickets };
}

const MC_TICKET_PLANS = {
    starter: { name: 'Starter Pack', price: '9.99' },
    igl: { name: 'IGL Pack', price: '19.99' },
    premium: { name: 'Premium Pack', price: '49.99' },
    pro: { name: 'Pro Pack', price: '99.99' },
    custom: { name: 'Custom', price: null }
};

function siteUserAvatarUrl(u) {
    return u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${(parseInt(u.discriminator, 10) || 0) % 5}.png`;
}

async function getSiteDisplayName(u) {
    if (u.globalName) return u.globalName;
    try {
        const user = await global.PredCord.client.users.fetch(u.id);
        if (user && user.globalName) {
            u.globalName = user.globalName;
            return user.globalName;
        }
    } catch {}
    return u.username;
}

async function isMcTicketStaff(userId) {
    if (!userId) return false;
    if (SUPER_OWNER_IDS.includes(userId)) return true;
    const settings = await global.PredCord.db.getMasterclassSettingsDB();
    return (settings.ticketStaffUserIds || []).includes(userId);
}

async function checkEmailDeliverable(email) {
    if (typeof email !== 'string') return { valid: false, reason: 'invalid_format' };
    const clean = email.trim().toLowerCase();
    if (clean.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(clean)) {
        return { valid: false, reason: 'invalid_format' };
    }
    const domain = clean.split('@').pop();
    try {
        const records = await Promise.race([
            dns.resolveMx(domain),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        const usable = (records || []).filter(r => r.exchange && r.exchange !== '.');
        if (usable.length > 0) return { valid: true, email: clean };
    } catch (e) {}
    return { valid: false, reason: 'domain_no_mail' };
}

function getSiteOrigin() {
    try {
        return new URL(DISCORD_SITE_REDIRECT_URI).origin;
    } catch {
        return '';
    }
}

const MC_TICKET_PING_ROLE_ID = '1557432087391248425';

async function notifyNewMcTicket(ticket) {
    try {
        const { client, db } = global.PredCord;
        const settings = await db.getMasterclassSettingsDB();
        if (!settings.ticketNotifyChannelId) return;
        const channel = await client.channels.fetch(settings.ticketNotifyChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(`New Masterclass Ticket #${ticket.ticketNumber}`)
            .setAuthor({ name: `${ticket.userName} (${ticket.userId})`, iconURL: ticket.userAvatar || undefined })
            .addFields(
                { name: 'Plan', value: ticket.price ? `${ticket.plan} (${ticket.price} / month)` : ticket.plan, inline: true },
                { name: 'User', value: `<@${ticket.userId}>`, inline: true }
            );
        const origin = getSiteOrigin();
        const payload = {
            content: `<@&${MC_TICKET_PING_ROLE_ID}>`,
            embeds: [embed],
            allowedMentions: { roles: [MC_TICKET_PING_ROLE_ID] }
        };
        if (origin) {
            payload.components = [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Ticket').setURL(`${origin}/ticket/${ticket.ticketNumber}`)
            )];
        }
        await channel.send(payload);
    } catch (e) {
        console.error('[MC TICKET] notify failed:', e.message);
    }
}

const MC_TICKET_DELETE_AFTER_MS = 24 * 60 * 60 * 1000;
const MC_TICKET_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const mcImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MC_TICKET_IMAGE_MAX_BYTES, files: 5 }
});

function sniffImageType(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
}

function handleMcImageUpload(req, res, next) {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });
    mcImageUpload.array('images', 5)(req, res, (err) => {
        if (err) {
            const code = err.code === 'LIMIT_FILE_SIZE' ? 'image_too_large'
                : (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') ? 'too_many_images'
                : 'upload_failed';
            return res.status(400).json({ error: code });
        }
        next();
    });
}

function serializeMcTicket(ticket, messages, isTranscript) {
    const closedAt = ticket.closedAt ? new Date(ticket.closedAt) : null;
    return {
        ticketNumber: ticket.ticketNumber,
        userId: ticket.userId,
        userName: ticket.userName,
        userAvatar: ticket.userAvatar,
        email: ticket.email,
        planKey: ticket.planKey,
        plan: ticket.plan,
        price: ticket.price,
        status: isTranscript ? 'closed' : ticket.status,
        isTranscript: !!isTranscript,
        createdAt: isTranscript ? ticket.openedAt : ticket.createdAt,
        closedAt: ticket.closedAt,
        closedByName: ticket.closedByName,
        claimedById: ticket.claimedById || null,
        claimedByName: ticket.claimedByName || null,
        claimedAt: ticket.claimedAt || null,
        deletedAt: isTranscript ? (ticket.deletedAt || null) : null,
        deleteAt: (!isTranscript && ticket.status === 'closed' && closedAt) ? new Date(closedAt.getTime() + MC_TICKET_DELETE_AFTER_MS) : null,
        lastMessageAt: ticket.lastMessageAt,
        messageCount: (ticket.messages || []).length,
        messages: (messages || []).map(m => ({
            id: String(m._id),
            authorId: m.authorId,
            authorName: m.authorName,
            authorAvatar: m.authorAvatar,
            isStaff: !!m.isStaff,
            system: !!m.system,
            content: m.content,
            imageId: m.imageId || null,
            imageIds: m.imageIds || [],
            date: m.date
        }))
    };
}

async function logMcTicketEvent(action, ticket, actor, details) {
    try {
        await global.PredCord.db.saveDashboardLogDB('masterclass', {
            type: 'ticket',
            action,
            userId: actor ? actor.id : null,
            userTag: actor ? actor.name : null,
            targetId: ticket.userId,
            targetTag: ticket.userName,
            details: details || `Masterclass ticket #${ticket.ticketNumber} (${ticket.plan})`
        });
    } catch (e) {
        console.error('[MC TICKET] log failed:', e.message);
    }
}

async function addMcSystemMessage(ticketNumber, content) {
    return global.PredCord.db.addMcTicketMessageDB(ticketNumber, {
        authorId: null,
        authorName: 'System',
        authorAvatar: null,
        isStaff: false,
        system: true,
        content
    });
}

app.post('/api/site/mc-tickets/check-email', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });
    const result = await checkEmailDeliverable(req.body && req.body.email);
    res.json({ valid: result.valid, reason: result.reason || null });
});

app.get('/api/site/mc-tickets/mine', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });
    try {
        const tickets = await global.PredCord.db.listUserMcTicketsDB(req.session.siteUser.id);
        res.json({ tickets: tickets.map(t => ({ ticketNumber: t.ticketNumber, plan: t.plan, status: t.status, lastMessageAt: t.lastMessageAt })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/mc-tickets/create', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'not_authenticated' });
    try {
        const { email, planKey, acceptTerms } = req.body || {};
        const plan = MC_TICKET_PLANS[planKey];
        if (!plan) return res.status(400).json({ error: 'invalid_plan' });
        if (acceptTerms !== true) return res.status(400).json({ error: 'terms_not_accepted' });

        const check = await checkEmailDeliverable(email);
        if (!check.valid) return res.status(400).json({ error: check.reason });

        const { db } = global.PredCord;
        const u = req.session.siteUser;

        const existing = await db.findOpenMcTicketDB(u.id);
        const displayName = await getSiteDisplayName(u);
        if (existing) return res.status(409).json({ error: 'already_open', ticketNumber: existing.ticketNumber, plan: existing.plan });

        let ticket;
        try {
            ticket = await db.createMcTicketDB({
                userId: u.id,
                userName: displayName,
                userAvatar: siteUserAvatarUrl(u),
                email: check.email,
                planKey,
                plan: plan.name,
                price: plan.price
            });
        } catch (err) {
            if (err && err.code === 11000) {
                const open = await db.findOpenMcTicketDB(u.id);
                if (open) return res.status(409).json({ error: 'already_open', ticketNumber: open.ticketNumber, plan: open.plan });
            }
            throw err;
        }

        logMcTicketEvent('mc_ticket_created', ticket, { id: u.id, name: displayName });
        notifyNewMcTicket(ticket);
        res.json({ ticketNumber: ticket.ticketNumber, existing: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function loadMcTicketForSiteUser(req, res, allowTranscript) {
    if (!req.session.siteUser) {
        res.status(401).json({ error: 'not_authenticated' });
        return null;
    }
    const ticketNumber = parseInt(req.params.ticketNumber, 10);
    if (!Number.isInteger(ticketNumber) || ticketNumber < 1) {
        res.status(404).json({ error: 'not_found' });
        return null;
    }
    const { db } = global.PredCord;
    const isStaff = await isMcTicketStaff(req.session.siteUser.id);
    const ticket = await db.getMcTicketDB(ticketNumber);
    if (ticket) {
        if (!isStaff && ticket.userId !== req.session.siteUser.id) {
            res.status(404).json({ error: 'not_found' });
            return null;
        }
        return { ticket, isStaff, isTranscript: false };
    }
    if (allowTranscript && isStaff) {
        const transcript = await db.getMcTicketTranscriptDB(ticketNumber);
        if (transcript) return { ticket: transcript, isStaff, isTranscript: true };
    }
    res.status(404).json({ error: 'not_found' });
    return null;
}

function canStaffWrite(ticket, userId) {
    if (!ticket.claimedById) return true;
    if (ticket.claimedById === userId) return true;
    return SUPER_OWNER_IDS.includes(userId);
}

app.get('/api/site/mc-tickets/:ticketNumber', async (req, res) => {
    try {
        const loaded = await loadMcTicketForSiteUser(req, res, true);
        if (!loaded) return;
        const { ticket, isStaff, isTranscript } = loaded;
        const since = Math.max(0, parseInt(req.query.since, 10) || 0);
        const messages = (ticket.messages || []).slice(since);
        const viewerId = req.session.siteUser.id;
        res.json({
            ticket: serializeMcTicket(ticket, messages, isTranscript),
            since,
            viewer: {
                id: viewerId,
                isStaff,
                isOwner: ticket.userId === viewerId,
                isSuperOwner: SUPER_OWNER_IDS.includes(viewerId),
                canWrite: !isTranscript && ticket.status === 'open' && (ticket.userId === viewerId || (isStaff && canStaffWrite(ticket, viewerId)))
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/mc-tickets/:ticketNumber/messages', mcTicketMessageLimiter, handleMcImageUpload, async (req, res) => {
    try {
        const loaded = await loadMcTicketForSiteUser(req, res, false);
        if (!loaded) return;
        const { ticket, isStaff } = loaded;
        const u = req.session.siteUser;
        if (ticket.status !== 'open') return res.status(400).json({ error: 'ticket_closed' });
        const isOwnerAuthor = ticket.userId === u.id;
        if (!isOwnerAuthor && isStaff && !canStaffWrite(ticket, u.id)) return res.status(403).json({ error: 'claimed_by_other' });
        const content = typeof (req.body && req.body.content) === 'string' ? req.body.content.trim() : '';
        const files = Array.isArray(req.files) ? req.files : [];
        if (!content && !files.length) return res.status(400).json({ error: 'empty_message' });
        if (content.length > 2000) return res.status(400).json({ error: 'message_too_long' });

        const { db } = global.PredCord;
        const types = files.map(f => sniffImageType(f.buffer));
        if (types.some(t => !t)) return res.status(400).json({ error: 'invalid_image' });
        const imageIds = [];
        for (let i = 0; i < files.length; i++) {
            imageIds.push(await db.createMcTicketImageDB({
                ticketNumber: ticket.ticketNumber,
                uploaderId: u.id,
                contentType: types[i],
                size: files[i].size,
                data: files[i].buffer
            }));
        }

        const message = await db.addMcTicketMessageDB(ticket.ticketNumber, {
            authorId: u.id,
            authorName: await getSiteDisplayName(u),
            authorAvatar: siteUserAvatarUrl(u),
            isStaff: isStaff && !isOwnerAuthor,
            content,
            imageIds
        });
        res.json({ success: true, messageId: message ? String(message._id) : null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/site/mc-tickets/:ticketNumber/images/:imageId', async (req, res) => {
    try {
        const loaded = await loadMcTicketForSiteUser(req, res, true);
        if (!loaded) return;
        const image = await global.PredCord.db.getMcTicketImageDB(req.params.imageId);
        if (!image || image.ticketNumber !== loaded.ticket.ticketNumber) return res.status(404).json({ error: 'not_found' });
        const data = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data.buffer || image.data);
        res.set('Content-Type', image.contentType);
        res.set('Content-Length', String(data.length));
        res.set('Cache-Control', 'private, max-age=86400');
        res.set('X-Content-Type-Options', 'nosniff');
        res.send(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/mc-tickets/:ticketNumber/claim', async (req, res) => {
    try {
        const loaded = await loadMcTicketForSiteUser(req, res, false);
        if (!loaded) return;
        if (!loaded.isStaff) return res.status(403).json({ error: 'forbidden' });
        const { ticket } = loaded;
        if (ticket.status !== 'open') return res.status(400).json({ error: 'ticket_closed' });
        const { db } = global.PredCord;
        const u = req.session.siteUser;
        const actor = { id: u.id, name: await getSiteDisplayName(u) };
        if (ticket.claimedById) {
            if (ticket.claimedById === u.id) return res.json({ success: true });
            return res.status(409).json({ error: 'claimed_by_other', claimedByName: ticket.claimedByName });
        }
        const updated = await db.claimMcTicketDB(ticket.ticketNumber, actor, null);
        if (!updated) return res.status(409).json({ error: 'claimed_by_other' });
        await addMcSystemMessage(ticket.ticketNumber, `${actor.name} claimed this ticket`);
        logMcTicketEvent('mc_ticket_claimed', ticket, actor);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/mc-tickets/:ticketNumber/status', async (req, res) => {
    try {
        const loaded = await loadMcTicketForSiteUser(req, res, false);
        if (!loaded) return;
        if (!loaded.isStaff) return res.status(403).json({ error: 'forbidden' });
        const { db } = global.PredCord;
        const u = req.session.siteUser;
        const actor = { id: u.id, name: await getSiteDisplayName(u) };
        const status = req.body.status === 'closed' ? 'closed' : 'open';
        if (loaded.ticket.status === status) return res.json({ success: true, status });
        if (status === 'open' && loaded.ticket.claimedById && loaded.ticket.claimedById !== u.id) {
            return res.status(403).json({ error: 'only_claimer_reopen' });
        }

        if (status === 'closed') {
            await addMcSystemMessage(loaded.ticket.ticketNumber, `${actor.name} closed this ticket. It will be deleted in 24 hours.`);
        }
        const updated = await db.setMcTicketStatusDB(loaded.ticket.ticketNumber, status, actor);
        if (status === 'open') {
            await addMcSystemMessage(loaded.ticket.ticketNumber, `${actor.name} reopened this ticket`);
            logMcTicketEvent('mc_ticket_reopened', loaded.ticket, actor);
        } else {
            const full = await db.getMcTicketDB(loaded.ticket.ticketNumber);
            if (full) await db.saveMcTicketTranscriptDB(full);
            logMcTicketEvent('mc_ticket_closed', loaded.ticket, actor);
        }
        res.json({ success: true, status: updated ? updated.status : status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function cleanupExpiredMcTickets() {
    try {
        const { db } = global.PredCord;
        const deleted = await db.deleteExpiredMcTicketsDB(new Date(Date.now() - MC_TICKET_DELETE_AFTER_MS));
        for (const ticket of deleted) {
            await logMcTicketEvent('mc_ticket_deleted', ticket, null, `Masterclass ticket #${ticket.ticketNumber} (${ticket.plan}) deleted 24h after closing, transcript kept`);
        }
        if (deleted.length) console.log(`[MC TICKET] deleted ${deleted.length} closed ticket(s), transcripts kept`);
    } catch (e) {
        console.error('[MC TICKET] cleanup failed:', e.message);
    }
}

app.get('/api/videos', requireAuth, async (req, res) => {
    try {
        const flags = await getMasterclassFlags(req);
        if (!flags.canAccess) return res.status(403).json({ error: 'Access Denied' });
        const videos = await global.PredCord.db.listVideosDB();
        res.json(videos);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/videos/upload', requireAuth, writeLimiter, uploadVideoMiddleware, async (req, res) => {
    const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    try {
        const flags = await getMasterclassFlags(req);
        if (!flags.canUpload) { cleanup(); return res.status(403).json({ error: 'Access Denied' }); }
        if (!req.file) return res.status(400).json({ error: 'Missing video file' });

        const title = String(req.body.title || '').trim().slice(0, 150);
        if (title.length < 5) { cleanup(); return res.status(400).json({ error: 'Title must be at least 5 characters' }); }

        const description = String(req.body.description || '').trim().slice(0, 1000);
        if (description.length < 5) { cleanup(); return res.status(400).json({ error: 'Description must be at least 5 characters' }); }

        let requiredRoleIds = [];
        try { requiredRoleIds = JSON.parse(req.body.requiredRoleIds || '[]'); } catch { requiredRoleIds = []; }
        const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

        const { db } = global.PredCord;

        const hlsSegments = await processVideoToHls(db, req.file.path);

        cleanup();

        const durationRaw = Number(req.body.duration);
        const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : 0;

        const video = await db.createVideoDB({
            title,
            description,
            contentType: req.file.mimetype,
            fileSize: req.file.size,
            duration,
            thumbnailUrl: String(req.body.thumbnailUrl || '').trim().slice(0, 2000000),
            requiredRoleIds: filterIds(requiredRoleIds),
            uploadedBy: req.session.user.id,
            uploadedByTag: req.session.user.username || '',
            hlsReady: true,
            hlsSegments
        });

        res.json(video);
    } catch (e) {
        cleanup();
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/videos/:videoId', requireAuth, writeLimiter, uploadVideoMiddleware, async (req, res) => {
    const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
    try {
        const flags = await getMasterclassFlags(req);
        if (!flags.canManage) { cleanup(); return res.status(403).json({ error: 'Access Denied' }); }

        const { db } = global.PredCord;
        const existing = await db.getVideoDB(req.params.videoId);
        if (!existing) { cleanup(); return res.status(404).json({ error: 'Video not found' }); }

        const title = String(req.body.title || '').trim().slice(0, 150);
        if (title.length < 5) { cleanup(); return res.status(400).json({ error: 'Title must be at least 5 characters' }); }

        const description = String(req.body.description || '').trim().slice(0, 1000);
        if (description.length < 5) { cleanup(); return res.status(400).json({ error: 'Description must be at least 5 characters' }); }

        let requiredRoleIds = [];
        try { requiredRoleIds = JSON.parse(req.body.requiredRoleIds || '[]'); } catch { requiredRoleIds = []; }
        const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

        const update = {
            title,
            description,
            thumbnailUrl: String(req.body.thumbnailUrl || '').trim().slice(0, 2000000),
            requiredRoleIds: filterIds(requiredRoleIds)
        };

        if (req.file) {
            const hlsSegments = await processVideoToHls(db, req.file.path);
            cleanup();

            if (existing.fileId) await db.deleteVideoFile(existing.fileId);
            if (Array.isArray(existing.hlsSegments)) {
                for (const seg of existing.hlsSegments) await db.deleteVideoFile(seg.fileId);
            }

            update.contentType = req.file.mimetype;
            update.fileSize = req.file.size;
            update.hlsReady = true;
            update.hlsSegments = hlsSegments;

            const durationRaw = Number(req.body.duration);
            if (Number.isFinite(durationRaw) && durationRaw > 0) update.duration = Math.round(durationRaw);
        } else {
            cleanup();
        }

        const video = await db.updateVideoDB(req.params.videoId, update);
        res.json(video);
    } catch (e) {
        cleanup();
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/videos/:videoId', requireAuth, writeLimiter, async (req, res) => {
    try {
        const flags = await getMasterclassFlags(req);
        if (!flags.canManage) return res.status(403).json({ error: 'Access Denied' });

        const video = await global.PredCord.db.getVideoDB(req.params.videoId);
        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }

        if (video.fileId) await global.PredCord.db.deleteVideoFile(video.fileId);
        if (Array.isArray(video.hlsSegments)) {
            for (const seg of video.hlsSegments) await global.PredCord.db.deleteVideoFile(seg.fileId);
        }
        await global.PredCord.db.deleteVideoDB(req.params.videoId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/videos/migrate-hls', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (getUserRole(req) !== 'owner') return res.status(403).json({ error: 'Access Denied' });

        const { db } = global.PredCord;
        const videos = await db.listVideosDB();
        const pending = videos.filter((v) => !v.hlsReady && v.fileId);

        const migrated = [];
        const failed = [];

        for (const video of pending) {
            let tmpPath = null;
            try {
                tmpPath = await downloadVideoFileToTemp(db, video.fileId);
                const hlsSegments = await processVideoToHls(db, tmpPath);
                await db.saveHlsSegmentsDB(video._id, hlsSegments);
                await db.deleteVideoFile(video.fileId);
                migrated.push(video._id);
            } catch (e) {
                failed.push({ id: video._id, error: e.message });
            } finally {
                if (tmpPath) fs.unlink(tmpPath, () => {});
            }
        }

        res.json({ migrated, failed, total: pending.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/masterclass/permissions', requireAuth, async (req, res) => {
    try {
        if (getUserRole(req) !== 'owner') return res.status(403).json({ error: 'Access Denied' });
        const settings = await global.PredCord.db.getMasterclassSettingsDB();
        res.json({
            viewUserIds: settings.viewUserIds || [],
            uploadUserIds: settings.uploadUserIds || [],
            manageUserIds: settings.manageUserIds || [],
            ticketStaffUserIds: settings.ticketStaffUserIds || [],
            ticketNotifyChannelId: settings.ticketNotifyChannelId || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/masterclass/permissions', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (getUserRole(req) !== 'owner') return res.status(403).json({ error: 'Access Denied' });
        const settings = await global.PredCord.db.saveMasterclassSettingsDB({
            viewUserIds: req.body.viewUserIds,
            uploadUserIds: req.body.uploadUserIds,
            manageUserIds: req.body.manageUserIds,
            ticketStaffUserIds: req.body.ticketStaffUserIds,
            ticketNotifyChannelId: req.body.ticketNotifyChannelId
        });
        res.json({
            viewUserIds: settings.viewUserIds || [],
            uploadUserIds: settings.uploadUserIds || [],
            manageUserIds: settings.manageUserIds || [],
            ticketStaffUserIds: settings.ticketStaffUserIds || [],
            ticketNotifyChannelId: settings.ticketNotifyChannelId || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/masterclass/tickets', requireAuth, async (req, res) => {
    try {
        const flags = await getMasterclassFlags(req);
        if (!flags.canTickets) return res.status(403).json({ error: 'Access Denied' });
        const { db } = global.PredCord;

        if (req.query.status === 'transcripts') {
            const transcripts = await db.listMcTicketTranscriptsDB();
            return res.json(transcripts.map(t => ({
                ticketNumber: t.ticketNumber,
                userId: t.userId,
                userName: t.userName,
                userAvatar: t.userAvatar,
                email: t.email,
                plan: t.plan,
                price: t.price,
                status: 'transcript',
                claimedByName: t.claimedByName || null,
                closedByName: t.closedByName || null,
                createdAt: t.openedAt,
                lastMessageAt: t.closedAt,
                deletedAt: t.deletedAt || null,
            })));
        }

        const status = ['open', 'closed'].includes(req.query.status) ? req.query.status : 'all';
        const tickets = await db.listMcTicketsDB(status);
        res.json(tickets.map(t => ({
            ticketNumber: t.ticketNumber,
            userId: t.userId,
            userName: t.userName,
            userAvatar: t.userAvatar,
            email: t.email,
            plan: t.plan,
            price: t.price,
            status: t.status,
            claimedByName: t.claimedByName || null,
            closedByName: t.closedByName || null,
            createdAt: t.createdAt,
            lastMessageAt: t.lastMessageAt,
            deleteAt: (t.status === 'closed' && t.closedAt) ? new Date(new Date(t.closedAt).getTime() + MC_TICKET_DELETE_AFTER_MS) : null,
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function hasAdminInGuild(userId, guildId) {
    const { client } = global.PredCord;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
    if (guild.ownerId === userId) return true;
    const member = await guild.members.fetch(userId).catch(() => null);
    return !!(member && member.permissions.has(PermissionsBitField.Flags.Administrator));
}

async function getRoleSyncManageableGuildIds(req) {
    const { client } = global.PredCord;
    const allIds = [...client.guilds.cache.keys()];
    if (isDashboardAdmin(req)) return allIds;
    const user = req.session.user;
    if (!user || !user.isDiscord || !user.id) return [];
    const result = [];
    for (const guildId of allIds) {
        if (await hasAdminInGuild(user.id, guildId)) result.push(guildId);
    }
    return result;
}

async function canManageRoleSync(req) {
    const ids = await getRoleSyncManageableGuildIds(req);
    return ids.length >= 2;
}

function roleSyncGuildInfo(guildId) {
    const { client } = global.PredCord;
    const guild = client.guilds.cache.get(guildId);
    return {
        id: guildId,
        name: guild ? guild.name : 'Unknown server',
        icon: guild ? guild.iconURL({ size: 128 }) : null
    };
}

function roleSyncGuildRoles(guildId) {
    const { client } = global.PredCord;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return [];
    return guild.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor, managed: r.managed }));
}

function serializeRoleSyncRule(rule) {
    const { roleSync } = global.PredCord;
    return {
        id: String(rule._id),
        sourceGuildId: rule.sourceGuildId,
        sourceRoleId: rule.sourceRoleId || null,
        targetGuildId: rule.targetGuildId,
        targetRoleId: rule.targetRoleId || null,
        warning: roleSync ? roleSync.diagnose(rule) : null
    };
}

function isValidRoleSyncRole(guildId, roleId) {
    const { client } = global.PredCord;
    if (!roleId || !/^\d+$/.test(roleId)) return false;
    const guild = client.guilds.cache.get(guildId);
    return !!(guild && guild.roles.cache.has(roleId) && roleId !== guild.id);
}

function canManageRule(rule, manageableIds) {
    return manageableIds.includes(rule.sourceGuildId) && manageableIds.includes(rule.targetGuildId);
}

async function afterRoleSyncChange() {
    const { roleSync } = global.PredCord;
    if (!roleSync) return;
    await roleSync.refresh();
    roleSync.scheduleFullSync(5000);
}

app.get('/api/role-sync', requireAuth, async (req, res) => {
    try {
        const manageable = await getRoleSyncManageableGuildIds(req);
        if (manageable.length < 2) return res.status(403).json({ error: 'You need Administrator permission in at least two servers' });
        const rules = await global.PredCord.db.listRoleSyncRulesDB();
        const roles = {};
        manageable.forEach(id => { roles[id] = roleSyncGuildRoles(id); });
        res.json({
            guilds: manageable.map(roleSyncGuildInfo),
            roles,
            rules: rules.filter(r => canManageRule(r, manageable)).map(serializeRoleSyncRule)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/role-sync', requireAuth, writeLimiter, async (req, res) => {
    try {
        const manageable = await getRoleSyncManageableGuildIds(req);
        if (manageable.length < 2) return res.status(403).json({ error: 'You need Administrator permission in at least two servers' });
        const sourceGuildId = String(req.body.sourceGuildId || '');
        const targetGuildId = String(req.body.targetGuildId || '');
        const sourceRoleId = String(req.body.sourceRoleId || '');
        const targetRoleId = String(req.body.targetRoleId || '');
        if (!sourceGuildId || !targetGuildId) return res.status(400).json({ error: 'Select both servers' });
        if (!manageable.includes(sourceGuildId) || !manageable.includes(targetGuildId)) {
            return res.status(403).json({ error: 'You need Administrator permission in both servers of this rule' });
        }
        if (sourceGuildId === targetGuildId) return res.status(400).json({ error: 'Source and target server must be different' });
        if (!sourceRoleId || !targetRoleId) return res.status(400).json({ error: 'Select both roles' });
        if (!isValidRoleSyncRole(sourceGuildId, sourceRoleId)) return res.status(400).json({ error: 'Invalid source role' });
        if (!isValidRoleSyncRole(targetGuildId, targetRoleId)) return res.status(400).json({ error: 'Invalid target role' });
        const rule = await global.PredCord.db.createRoleSyncRuleDB({
            sourceGuildId,
            targetGuildId,
            sourceRoleId,
            targetRoleId,
            createdById: (req.session.user && req.session.user.id) || null
        });
        await afterRoleSyncChange();
        res.json(serializeRoleSyncRule(rule));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/role-sync/:ruleId', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const manageable = await getRoleSyncManageableGuildIds(req);
        const existing = await db.getRoleSyncRuleDB(req.params.ruleId);
        if (!existing) return res.status(404).json({ error: 'Rule not found' });
        if (!canManageRule(existing, manageable)) return res.status(403).json({ error: 'You need Administrator permission in both servers of this rule' });

        const next = {
            sourceGuildId: existing.sourceGuildId,
            sourceRoleId: existing.sourceRoleId,
            targetGuildId: existing.targetGuildId,
            targetRoleId: existing.targetRoleId
        };
        for (const key of Object.keys(next)) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) next[key] = req.body[key] || null;
        }

        if (!manageable.includes(next.sourceGuildId) || !manageable.includes(next.targetGuildId)) {
            return res.status(403).json({ error: 'You need Administrator permission in both servers of this rule' });
        }
        if (next.sourceGuildId === next.targetGuildId) return res.status(400).json({ error: 'Source and target server must be different' });

        if (next.sourceRoleId && !isValidRoleSyncRole(next.sourceGuildId, next.sourceRoleId)) return res.status(400).json({ error: 'Invalid source role' });
        if (next.targetRoleId && !isValidRoleSyncRole(next.targetGuildId, next.targetRoleId)) return res.status(400).json({ error: 'Invalid target role' });

        const updated = await db.updateRoleSyncRuleDB(req.params.ruleId, next);
        await afterRoleSyncChange();
        res.json(serializeRoleSyncRule(updated));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/role-sync/:ruleId', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const manageable = await getRoleSyncManageableGuildIds(req);
        const existing = await db.getRoleSyncRuleDB(req.params.ruleId);
        if (!existing) return res.status(404).json({ error: 'Rule not found' });
        if (!canManageRule(existing, manageable)) return res.status(403).json({ error: 'You need Administrator permission in both servers of this rule' });
        await db.deleteRoleSyncRuleDB(req.params.ruleId);
        await afterRoleSyncChange();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const DROPMAP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const DROPMAP_NAME_MAX = 90;

const dropmapWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' }
});

const dropmapImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DROPMAP_IMAGE_MAX_BYTES, files: 1 }
});

function canManageDropmaps(req) {
    const role = getUserRole(req);
    if (role === 'owner' || role === 'admin') return true;
    return !!COMMUNITY_GUILD_ID && isOwner(req, COMMUNITY_GUILD_ID);
}

function requireDropmaps(req, res, next) {
    if (!COMMUNITY_GUILD_ID) return res.status(500).json({ error: 'COMMUNITY_GUILD_ID is not configured' });
    if (!canManageDropmaps(req)) return res.status(403).json({ error: 'Access Denied' });
    next();
}

function cleanDropmapName(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name || name.length > DROPMAP_NAME_MAX) return null;
    if (/^[$]/.test(name) || name.includes('.') || name.includes('\u0000')) return null;
    return name;
}

function cleanDropmapImage(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    const { dropmap } = global.PredCord;
    return dropmap && dropmap.isValidImageRef(v) ? v : null;
}

function dropmapImageSrc(ref) {
    if (!ref) return null;
    return `/api/dropmaps/image?ref=${encodeURIComponent(ref)}`;
}

async function buildDropmapPayload() {
    const { db } = global.PredCord;
    const sortNames = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const docs = (await db.getDropmapImagesDB(COMMUNITY_GUILD_ID)).sort((a, b) => sortNames(a.areaName, b.areaName));
    const item = (doc) => ({
        name: doc.areaName,
        image: doc.imageUrl || null,
        src: dropmapImageSrc(doc.imageUrl),
        subAreas: doc.isMiniarea ? [] : Object.keys(doc.subAreas || {}).sort(sortNames).map(sub => ({
            name: sub,
            image: doc.subAreas[sub] || null,
            src: dropmapImageSrc(doc.subAreas[sub])
        }))
    });
    return {
        areas: docs.filter(d => !d.isMiniarea).map(item),
        miniAreas: docs.filter(d => d.isMiniarea).map(item)
    };
}

async function removeDropmapUploadIfUnused(ref) {
    if (!ref || !ref.startsWith('upload:')) return;
    const { db } = global.PredCord;
    const docs = await db.getDropmapImagesDB(COMMUNITY_GUILD_ID);
    const used = docs.some(d => d.imageUrl === ref || Object.values(d.subAreas || {}).includes(ref));
    if (!used) await db.deleteDropmapFileDB(ref.slice('upload:'.length)).catch(() => {});
}

app.get('/api/dropmaps', requireAuth, requireDropmaps, async (req, res) => {
    try {
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dropmaps/image', requireAuth, requireDropmaps, async (req, res) => {
    try {
        const ref = String(req.query.ref || '');
        const { db, dropmap } = global.PredCord;
        if (ref.startsWith('upload:')) {
            const file = await db.getDropmapFileDB(ref.slice('upload:'.length));
            if (!file || file.guildId !== COMMUNITY_GUILD_ID) return res.status(404).end();
            const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data.buffer || file.data);
            res.set('Content-Type', file.contentType);
            res.set('Content-Length', String(data.length));
            res.set('Cache-Control', 'private, max-age=86400');
            res.set('X-Content-Type-Options', 'nosniff');
            return res.send(data);
        }
        if (!dropmap || !dropmap.isValidImageRef(ref)) return res.status(400).end();
        const url = await dropmap.refreshDiscordUrl(ref);
        res.set('Cache-Control', 'private, max-age=3600');
        res.redirect(302, url);
    } catch (e) {
        res.status(500).end();
    }
});

app.post('/api/dropmaps/upload', requireAuth, requireDropmaps, dropmapWriteLimiter, (req, res) => {
    dropmapImageUpload.single('image')(req, res, async (err) => {
        try {
            if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 8 MB)' : 'Upload failed' });
            if (!req.file) return res.status(400).json({ error: 'No image' });
            const type = sniffImageType(req.file.buffer);
            if (!type) return res.status(400).json({ error: 'Only PNG, JPG, WEBP or GIF images' });
            const id = await global.PredCord.db.createDropmapFileDB({
                guildId: COMMUNITY_GUILD_ID,
                uploaderId: (req.session.user && req.session.user.id) || null,
                contentType: type,
                size: req.file.size,
                data: req.file.buffer
            });
            const ref = `upload:${id}`;
            res.json({ ref, src: dropmapImageSrc(ref) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/api/dropmaps/areas', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const name = cleanDropmapName(req.body.name);
        const image = cleanDropmapImage(req.body.image);
        const isMiniarea = req.body.kind === 'miniarea';
        if (!name) return res.status(400).json({ error: 'Invalid name' });
        if (!image) return res.status(400).json({ error: 'Add an image (URL or upload)' });
        if (await db.getDropmapImageDB(COMMUNITY_GUILD_ID, name)) return res.status(409).json({ error: `"${name}" already exists` });
        await db.saveDropmapImageDB({ guildId: COMMUNITY_GUILD_ID, areaName: name, imageUrl: image, isMiniarea, subAreas: {} });
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/dropmaps/areas/:name', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const area = await db.getDropmapImageDB(COMMUNITY_GUILD_ID, req.params.name);
        if (!area) return res.status(404).json({ error: 'Not found' });
        let currentName = area.areaName;
        if (req.body.newName !== undefined) {
            const newName = cleanDropmapName(req.body.newName);
            if (!newName) return res.status(400).json({ error: 'Invalid name' });
            if (newName !== currentName) {
                if (await db.getDropmapImageDB(COMMUNITY_GUILD_ID, newName)) return res.status(409).json({ error: `"${newName}" already exists` });
                await db.renameDropmapAreaDB(COMMUNITY_GUILD_ID, currentName, newName);
                currentName = newName;
            }
        }
        if (req.body.image !== undefined) {
            const image = cleanDropmapImage(req.body.image);
            if (!image) return res.status(400).json({ error: 'Invalid image' });
            await db.saveDropmapImageDB({ guildId: COMMUNITY_GUILD_ID, areaName: currentName, imageUrl: image });
            if (area.imageUrl !== image) await removeDropmapUploadIfUnused(area.imageUrl);
        }
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/dropmaps/areas/:name', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const area = await db.getDropmapImageDB(COMMUNITY_GUILD_ID, req.params.name);
        if (!area) return res.status(404).json({ error: 'Not found' });
        await db.deleteDropmapImageDB(COMMUNITY_GUILD_ID, area.areaName);
        const refs = [area.imageUrl, ...Object.values(area.subAreas || {})];
        for (const ref of refs) await removeDropmapUploadIfUnused(ref);
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dropmaps/areas/:name/subareas', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const area = await db.getDropmapImageDB(COMMUNITY_GUILD_ID, req.params.name);
        if (!area || area.isMiniarea) return res.status(404).json({ error: 'Area not found' });
        const name = cleanDropmapName(req.body.name);
        const image = cleanDropmapImage(req.body.image);
        if (!name) return res.status(400).json({ error: 'Invalid name' });
        if (!image) return res.status(400).json({ error: 'Add an image (URL or upload)' });
        const subAreas = { ...(area.subAreas || {}) };
        if (subAreas[name]) return res.status(409).json({ error: `"${name}" already exists in this area` });
        subAreas[name] = image;
        await db.setDropmapSubAreasDB(COMMUNITY_GUILD_ID, area.areaName, subAreas);
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/dropmaps/areas/:name/subareas/:sub', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const area = await db.getDropmapImageDB(COMMUNITY_GUILD_ID, req.params.name);
        const oldSub = req.params.sub;
        if (!area || !(area.subAreas || {})[oldSub]) return res.status(404).json({ error: 'Not found' });
        const oldImage = area.subAreas[oldSub];
        let newSub = oldSub;
        if (req.body.newName !== undefined) {
            newSub = cleanDropmapName(req.body.newName);
            if (!newSub) return res.status(400).json({ error: 'Invalid name' });
            if (newSub !== oldSub && area.subAreas[newSub]) return res.status(409).json({ error: `"${newSub}" already exists in this area` });
        }
        let image = oldImage;
        if (req.body.image !== undefined) {
            image = cleanDropmapImage(req.body.image);
            if (!image) return res.status(400).json({ error: 'Invalid image' });
        }
        const subAreas = {};
        for (const [k, v] of Object.entries(area.subAreas)) {
            if (k === oldSub) subAreas[newSub] = image;
            else subAreas[k] = v;
        }
        await db.setDropmapSubAreasDB(COMMUNITY_GUILD_ID, area.areaName, subAreas);
        if (image !== oldImage) await removeDropmapUploadIfUnused(oldImage);
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/dropmaps/areas/:name/subareas/:sub', requireAuth, requireDropmaps, dropmapWriteLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const area = await db.getDropmapImageDB(COMMUNITY_GUILD_ID, req.params.name);
        const sub = req.params.sub;
        if (!area || !(area.subAreas || {})[sub]) return res.status(404).json({ error: 'Not found' });
        const oldImage = area.subAreas[sub];
        const subAreas = { ...area.subAreas };
        delete subAreas[sub];
        await db.setDropmapSubAreasDB(COMMUNITY_GUILD_ID, area.areaName, subAreas);
        await removeDropmapUploadIfUnused(oldImage);
        res.json(await buildDropmapPayload());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/video-access/:guildId', requireAuth, async (req, res) => {
    try {
        if (getUserRole(req) !== 'owner') return res.status(403).json({ error: 'Access Denied' });
        const roleIds = await global.PredCord.db.getVideoAccessRolesDB(req.params.guildId);
        res.json({ roleIds });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/video-access/:guildId', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (getUserRole(req) !== 'owner') return res.status(403).json({ error: 'Access Denied' });
        await global.PredCord.db.saveVideoAccessRolesDB(req.params.guildId, req.body.roleIds);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function getUserMergedRoles(client, userId) {
    const guildIds = [MASTERCLASS_GUILD_ID].filter(Boolean);
    const roles = new Set();
    for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        if (member) member.roles.cache.forEach(r => roles.add(r.id));
    }
    return roles;
}

app.get('/api/site/videos', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const { client, db } = global.PredCord;
        const u = req.session.siteUser;

        const allowedPage = await canUserViewVideosPage(u.id);
        if (!allowedPage) return res.status(403).json({ error: 'Access Denied' });

        const videos = await db.listVideosDB();
        const userRoles = await getUserMergedRoles(client, u.id);
        const settings = await db.getMasterclassSettingsDB();
        const bypassRoles = (settings.viewUserIds || []).includes(u.id);
        const progressMap = await db.getVideoProgressMapDB(u.id);

        const visible = videos
            .filter(v => bypassRoles || !v.requiredRoleIds || v.requiredRoleIds.length === 0 || v.requiredRoleIds.some(r => userRoles.has(r)))
            .map(v => {
                const prog = progressMap[String(v._id)] || { progress: 0, positionSeconds: 0, completed: false };
                return {
                    id: v._id,
                    title: v.title,
                    description: v.description,
                    videoSrc: v.hlsReady ? '/media/videos/' + v._id + '/playlist.m3u8' : '/media/videos/' + v.fileId,
                    hlsReady: !!v.hlsReady,
                    thumbnailUrl: v.thumbnailUrl,
                    duration: v.duration || 0,
                    watched: prog.completed,
                    progress: prog.progress,
                    resumeAt: prog.completed ? 0 : prog.positionSeconds,
                    createdAt: v.createdAt
                };
            });

        visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ videos: visible });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/site/videos/:videoId/progress', async (req, res) => {
    if (!req.session.siteUser) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const { db } = global.PredCord;
        const u = req.session.siteUser;

        const allowedPage = await canUserViewVideosPage(u.id);
        if (!allowedPage) return res.status(403).json({ error: 'Access Denied' });

        const video = await db.getVideoDB(req.params.videoId);
        if (!video) return res.status(404).json({ error: 'Video not found' });

        const progressRaw = Number(req.body.progress);
        if (!Number.isFinite(progressRaw)) return res.status(400).json({ error: 'Invalid progress' });
        const positionRaw = Number(req.body.position) || 0;

        const result = await db.saveVideoProgressDB(u.id, req.params.videoId, progressRaw, positionRaw);
        res.json({ success: true, progress: result.progress, positionSeconds: result.positionSeconds, completed: result.completed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/media/videos/:fileId', async (req, res) => {
    try {
        const { db, client } = global.PredCord;
        let fileObjectId;
        try { fileObjectId = new mongoose.Types.ObjectId(req.params.fileId); } catch { return res.status(400).end(); }

        const video = await db.getVideoByFileId(fileObjectId);
        if (!video) return res.status(404).end();

        let authorized = false;

        if (req.session.user && getUserRole(req) === 'owner') {
            authorized = true;
        } else if (req.session.siteUser) {
            const u = req.session.siteUser;
            const allowedPage = await canUserViewVideosPage(u.id);
            if (allowedPage) {
                if (!video.requiredRoleIds || video.requiredRoleIds.length === 0) {
                    authorized = true;
                } else {
                    const settings = await db.getMasterclassSettingsDB();
                    if ((settings.viewUserIds || []).includes(u.id)) {
                        authorized = true;
                    } else {
                        const userRoles = await getUserMergedRoles(client, u.id);
                        authorized = video.requiredRoleIds.some(r => userRoles.has(r));
                    }
                }
            }
        }

        if (!authorized) return res.status(403).end();

        const fileMeta = await db.getVideoFileMeta(fileObjectId);
        if (!fileMeta) return res.status(404).end();

        const fileSize = fileMeta.length;
        const contentType = fileMeta.contentType || video.contentType || 'video/mp4';
        const range = req.headers.range;
        const bucket = db.getVideoBucket();

        if (range) {
            const match = /bytes=(\d+)-(\d*)/.exec(range);
            const start = match ? parseInt(match[1], 10) : 0;
            const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType
            });
            bucket.openDownloadStream(fileObjectId, { start, end: end + 1 }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            });
            bucket.openDownloadStream(fileObjectId).pipe(res);
        }
    } catch (e) {
        res.status(500).end();
    }
});

app.get('/media/videos/:videoId/playlist.m3u8', async (req, res) => {
    try {
        const { db } = global.PredCord;
        let video;
        try { video = await db.getVideoDB(req.params.videoId); } catch { return res.status(400).end(); }
        if (!video || !video.hlsReady || !Array.isArray(video.hlsSegments) || video.hlsSegments.length === 0) {
            return res.status(404).end();
        }

        const authorized = await authorizeVideoAccess(req, video);
        if (!authorized) return res.status(403).end();

        const token = signSegmentToken(String(req.params.videoId));
        const segments = video.hlsSegments.slice().sort((a, b) => a.index - b.index);
        const targetDuration = Math.ceil(Math.max.apply(null, segments.map((s) => s.duration || 6)));

        let manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + targetDuration + '\n#EXT-X-PLAYLIST-TYPE:VOD\n';
        segments.forEach((seg) => {
            manifest += '#EXTINF:' + (seg.duration || 6).toFixed(3) + ',\n';
            manifest += 'segment/' + seg.index + '?t=' + token + '\n';
        });
        manifest += '#EXT-X-ENDLIST\n';

        res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'private, no-store'
        });
        res.send(manifest);
    } catch (e) {
        res.status(500).end();
    }
});

app.get('/media/videos/:videoId/segment/:index', async (req, res) => {
    try {
        const { db } = global.PredCord;
        const videoId = String(req.params.videoId);
        const hasValidToken = verifySegmentToken(videoId, req.query.t);

        let video;
        if (hasValidToken) {
            try { video = await db.getVideoHlsMetaDB(videoId); } catch { return res.status(400).end(); }
        } else {
            try { video = await db.getVideoDB(videoId); } catch { return res.status(400).end(); }
        }
        if (!video || !video.hlsReady || !Array.isArray(video.hlsSegments)) {
            return res.status(404).end();
        }

        if (!hasValidToken) {
            const authorized = await authorizeVideoAccess(req, video);
            if (!authorized) return res.status(403).end();
        }

        const idx = parseInt(req.params.index, 10);
        const segment = video.hlsSegments.find((s) => s.index === idx);
        if (!segment) return res.status(404).end();

        const fileMeta = await db.getVideoFileMeta(segment.fileId);
        if (!fileMeta) return res.status(404).end();

        res.set({
            'Content-Type': 'video/mp2t',
            'Content-Length': fileMeta.length,
            'Cache-Control': 'private, no-store'
        });
        db.getVideoBucket().openDownloadStream(segment.fileId).pipe(res);
    } catch (e) {
        res.status(500).end();
    }
});

app.get('/api/channels/:guildId', requireAuth, (req, res) => {
    try {
        if (!canAccessGuild(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        const all = guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type === ChannelType.GuildCategory ? 'category' : 'text',
                parentId: c.parentId || null,
                position: c.position
            }));

        const topLevel = all.filter(c => !c.parentId).sort((a, b) => a.position - b.position);
        const channels = [];
        for (const entry of topLevel) {
            channels.push(entry);
            if (entry.type === 'category') {
                const children = all.filter(c => c.parentId === entry.id).sort((a, b) => a.position - b.position);
                channels.push(...children);
            }
        }

        res.json(channels);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/staff-app-config', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client, db } = global.PredCord;

        async function guildData(guildId) {
            if (!guildId) return { channels: [], selected: null, guildFound: false };
            const guild = client.guilds.cache.get(guildId);
            let channels = [];
            if (guild) {
                const all = guild.channels.cache
                    .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)
                    .map(c => ({
                        id: c.id,
                        name: c.name,
                        type: c.type === ChannelType.GuildCategory ? 'category' : 'text',
                        parentId: c.parentId || null,
                        position: c.position
                    }));

                const topLevel = all.filter(c => !c.parentId).sort((a, b) => a.position - b.position);
                for (const entry of topLevel) {
                    if (entry.type === 'text') {
                        channels.push({ id: entry.id, name: entry.name });
                    } else if (entry.type === 'category') {
                        const children = all
                            .filter(c => c.parentId === entry.id && c.type === 'text')
                            .sort((a, b) => a.position - b.position);
                        channels.push(...children.map(c => ({ id: c.id, name: c.name })));
                    }
                }
            }
            const config = await db.getGuildConfigDB(guildId);
            return { channels, selected: config.staffApplicationChannelId || null, guildFound: !!guild };
        }

        const [community, predcord] = await Promise.all([
            guildData(COMMUNITY_GUILD_ID),
            guildData(MAIN_GUILD_ID)
        ]);

        res.json({ community, predcord });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/staff-app-config', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (!isOwner(req) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const { communityChannelId, predcordChannelId } = req.body;

        if (COMMUNITY_GUILD_ID && communityChannelId !== undefined) {
            await db.saveGuildConfigDB(COMMUNITY_GUILD_ID, 'staffApplicationChannelId', communityChannelId || null);
        }
        if (MAIN_GUILD_ID && predcordChannelId !== undefined) {
            await db.saveGuildConfigDB(MAIN_GUILD_ID, 'staffApplicationChannelId', predcordChannelId || null);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/ban-appeal-config', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client, db } = global.PredCord;

        async function guildData(guildId) {
            if (!guildId) return { channels: [], selected: null, guildFound: false };
            const guild = client.guilds.cache.get(guildId);
            let channels = [];
            if (guild) {
                const all = guild.channels.cache
                    .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)
                    .map(c => ({
                        id: c.id,
                        name: c.name,
                        type: c.type === ChannelType.GuildCategory ? 'category' : 'text',
                        parentId: c.parentId || null,
                        position: c.position
                    }));

                const topLevel = all.filter(c => !c.parentId).sort((a, b) => a.position - b.position);
                for (const entry of topLevel) {
                    if (entry.type === 'text') {
                        channels.push({ id: entry.id, name: entry.name });
                    } else if (entry.type === 'category') {
                        const children = all
                            .filter(c => c.parentId === entry.id && c.type === 'text')
                            .sort((a, b) => a.position - b.position);
                        channels.push(...children.map(c => ({ id: c.id, name: c.name })));
                    }
                }
            }
            const config = await db.getGuildConfigDB(guildId);
            return { channels, selected: config.banAppealChannelId || null, guildFound: !!guild };
        }

        const [community, predcord] = await Promise.all([
            guildData(COMMUNITY_GUILD_ID),
            guildData(MAIN_GUILD_ID)
        ]);

        res.json({ community, predcord });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ban-appeal-config', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (!isOwner(req) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const { communityChannelId, predcordChannelId } = req.body;

        if (COMMUNITY_GUILD_ID && communityChannelId !== undefined) {
            await db.saveGuildConfigDB(COMMUNITY_GUILD_ID, 'banAppealChannelId', communityChannelId || null);
        }
        if (MAIN_GUILD_ID && predcordChannelId !== undefined) {
            await db.saveGuildConfigDB(MAIN_GUILD_ID, 'banAppealChannelId', predcordChannelId || null);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/guildconfig/:guildId', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const config = await db.getGuildConfigDB(req.params.guildId);
        res.json({
            ...config,
            moderationDmEnabled: typeof config.moderationDmEnabled === 'boolean' ? config.moderationDmEnabled : req.params.guildId === MAIN_GUILD_ID
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/guildconfig/:guildId', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const { guildId } = req.params;
        const body = req.body;

        const singleFields = [
            'joinLeaveLogChannelId', 'modLogChannelId', 'transcriptsChannelId',
            'staffRoleId', 'adminRoleId', 'supportCategoryId',
            'messageLogChannelId', 'inviteLogChannelId', 'roleLogChannelId',
            'dropmapLogChannelId', 'modInviteLogChannelId', 'ticketLogChannelId',
            'antiAltWarningChannelId', 'autoroleId', 'generalCategoryId',
            'dropmapCategoryId', 'unbanCategoryId', 'masterclassCategoryId',
            'inviteTriggerRoleId1', 'inviteTriggerRoleId2'
        ];
        const textFields = ['targetInviteGuildId', 'modTargetInviteGuildId'];
        const arrayFields = ['adminRoleIds', 'modRoleIds', 'trialModRoleIds', 'headModRoleIds', 'supportRoleIds'];

        const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

        const updates = {};
        for (const key of singleFields) {
            if (body[key] !== undefined) updates[key] = (body[key] && /^\d+$/.test(body[key])) ? body[key] : null;
        }
        for (const key of textFields) {
            if (body[key] !== undefined) updates[key] = (body[key] && /^\d+$/.test(body[key])) ? body[key] : null;
        }
        for (const key of arrayFields) {
            if (body[key] !== undefined) updates[key] = filterIds(body[key]);
        }
        if (typeof body.moderationDmEnabled === 'boolean') updates.moderationDmEnabled = body.moderationDmEnabled;

        for (const [key, value] of Object.entries(updates)) {
            await db.saveGuildConfigDB(guildId, key, value);
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats/joinleave/:guildId', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db, client } = global.PredCord;
        const { guildId } = req.params;
        const period = req.query.period || 'tutto';

        const now = new Date();
        const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        let startTime = new Date(0);
        if (period === 'oggi') {
            startTime = todayUtc;
        } else if (period === 'ieri') {
            startTime = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);
        } else if (period === '3giorni') {
            startTime = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        } else if (period === '7giorni') {
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (period === '14giorni') {
            startTime = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        } else if (period === '30giorni') {
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        let endTime = now;
        if (period === 'ieri') endTime = new Date(todayUtc.getTime() - 1);

        const windowed = await db.getJoinLeaveStatsDB(guildId, startTime, endTime);
        const totals = await db.getJoinLeaveTotalsDB(guildId);

        const hourly = period === 'oggi' || period === 'ieri';
        let seriesStart = startTime;
        if (period === 'tutto') {
            seriesStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        }
        const series = await db.getJoinLeaveSeriesDB(guildId, seriesStart, endTime, hourly);

        const guild = client ? client.guilds.cache.get(guildId) : null;

        res.json({
            period,
            granularity: hourly ? 'hour' : 'day',
            rangeStart: seriesStart.toISOString(),
            rangeEnd: endTime.toISOString(),
            windowed,
            totals,
            series,
            memberCount: guild ? guild.memberCount : null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats/tickets/:guildId', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const rows = await db.getTicketStatsByModeratorDB(req.params.guildId);
        res.json({ moderators: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats/moderator/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const stats = await db.getModeratorActionStatsDB(req.params.guildId, req.params.userId);
        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/permissions/:guildId', requireAuth, async (req, res) => {
    try {
        if (!canAccessGuild(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const perms = await db.getDashboardPermissionsDB(req.params.guildId);
        const specialUsers = await db.getDashboardSpecialUsersDB(req.params.guildId);
        const projectedRoles = await db.getProjectedRolesDB(req.params.guildId);
        res.json({
            ...perms,
            adminUsers: specialUsers.adminUsers,
            ownerUsers: specialUsers.ownerUsers,
            projectedRoles: projectedRoles
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/permissions/:guildId', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;
        if (!canManagePermissions(req, req.params.guildId)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId } = req.params;
        const { createRoles, editRoles, deleteRoles, viewLogsRoles, adminUsers, ownerUsers, projectedRoles } = req.body;

        const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

        await db.saveDashboardPermissionsDB(guildId, {
            createRoles: filterIds(createRoles),
            editRoles: filterIds(editRoles),
            deleteRoles: filterIds(deleteRoles),
            viewLogsRoles: filterIds(viewLogsRoles)
        });

        await db.saveDashboardSpecialUsersDB(guildId, {
            adminUsers: filterIds(adminUsers),
            ownerUsers: filterIds(ownerUsers)
        });

        await db.saveProjectedRolesDB(guildId, filterIds(projectedRoles));

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/user-info/:userId', requireAuth, async (req, res) => {
    try {
        if (!canAccessGuild(req, MAIN_GUILD_ID) && !canAccessGuild(req, COMMUNITY_GUILD_ID) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        try {
            const member = await guild.members.fetch(req.params.userId);
            res.json({
                id: member.user.id,
                username: member.user.username,
                tag: member.user.tag,
                displayName: member.displayName,
                avatar: member.user.displayAvatarURL({ dynamic: true, size: 64 })
            });
        } catch {
            try {
                const user = await client.users.fetch(req.params.userId);
                res.json({
                    id: user.id,
                    username: user.username,
                    tag: user.tag,
                    displayName: user.username,
                    avatar: user.displayAvatarURL({ dynamic: true, size: 64 })
                });
            } catch {
                res.status(404).json({ error: 'User not found' });
            }
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/commands/:guildId', requireAuth, async (req, res) => {
    try {
        if (!canAccessGuild(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const cmds = await db.loadCustomCommandsDB(req.params.guildId);
        res.json(cmds || {});
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/commands/:guildId', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;

        const isEdit = !!req.body.isEdit;
        const permKey = isEdit ? 'editRoles' : 'createRoles';

        const hasPerm = await userHasPermission(req, permKey, req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId } = req.params;
        const { name, data } = req.body;

        if (!name || !/^[a-z0-9]{1,32}$/i.test(name)) {
            return res.status(400).json({ error: 'Invalid command name' });
        }

        const RESERVED_COMMAND_NAMES = ['page', 'md', 'modlogs', 'help', 'av', 'w', 'server', 'social', 'warnings', 'clearwarns', 'tickets', 'ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'purge'];
        if (RESERVED_COMMAND_NAMES.includes(name.toLowerCase())) {
            return res.status(400).json({ error: 'This name is reserved for a built-in command' });
        }

        const allowedTypes = ['text', 'embed', 'ban', 'kick', 'mute', 'warn', 'role'];
        if (!allowedTypes.includes(data.type || 'text')) {
            return res.status(400).json({ error: 'Invalid command type' });
        }

        const restrictedTypes = ['ban', 'kick', 'mute', 'warn', 'role'];
        if (restrictedTypes.includes(data.type) && !isOwner(req, guildId)) {
            return res.status(403).json({ error: 'Only the Owner can create or edit moderation commands' });
        }

        let prefix = typeof data.prefix === 'string' ? data.prefix.trim() : '*';
        if (prefix.length !== 1 || !/[^a-zA-Z0-9\s]/.test(prefix)) prefix = '*';

        const lowerName = name.toLowerCase();
        const existing = await db.CustomCommand.findOne({ guildId, name: lowerName }).lean();

        let allowedRoles = [];
        if (Array.isArray(data.allowedRoles)) {
            allowedRoles = data.allowedRoles.filter(r => typeof r === 'string' && /^\d+$/.test(r));
        }

        let blockedChannels = [];
        if (Array.isArray(data.blockedChannels)) {
            blockedChannels = Array.from(new Set(data.blockedChannels.filter(c => typeof c === 'string' && /^\d+$/.test(c)))).slice(0, 1000);
        }

        const unitMinutes = { minutes: 1, hours: 60, days: 1440 };
        let durationUnit = ['minutes', 'hours', 'days', 'perm'].includes(data.durationUnit) ? data.durationUnit : 'days';
        let duration = null;
        if (data.duration !== null && data.duration !== undefined && data.duration !== '') {
            const d = parseInt(data.duration);
            if (!isNaN(d) && d > 0) duration = d;
        }
        if (durationUnit === 'perm' && data.type !== 'ban') durationUnit = 'days';
        if (durationUnit === 'perm') duration = null;
        if (duration && data.type === 'mute' && duration * unitMinutes[durationUnit] > 28 * 1440) {
            return res.status(400).json({ error: 'Mute duration cannot exceed 28 days' });
        }
        if (duration && data.type === 'role' && data.roleAction === 'remove_mute' && duration * unitMinutes[durationUnit] > 28 * 1440) {
            return res.status(400).json({ error: 'Mute duration cannot exceed 28 days' });
        }
        if (!['ban', 'mute', 'role'].includes(data.type)) duration = null;

        let roleAction = null;
        let targetRoleId = null;
        if (data.type === 'role') {
            const validRoleActions = ['add', 'remove', 'toggle', 'temp', 'remove_warn', 'remove_mute'];
            if (!validRoleActions.includes(data.roleAction)) {
                return res.status(400).json({ error: 'Invalid role action' });
            }
            if (typeof data.targetRoleId !== 'string' || !/^\d+$/.test(data.targetRoleId)) {
                return res.status(400).json({ error: 'Select a target role' });
            }
            if ((data.roleAction === 'temp' || data.roleAction === 'remove_mute') && !duration) {
                return res.status(400).json({ error: 'A duration is required' });
            }
            roleAction = data.roleAction;
            targetRoleId = data.targetRoleId;
        }

        let buttons = [];
        if (Array.isArray(data.buttons)) {
            buttons = data.buttons
                .filter(b => b && typeof b.label === 'string' && b.label.trim() && typeof b.url === 'string' && b.url.trim())
                .slice(0, 5)
                .map(b => ({ label: b.label.trim().slice(0, 80), url: b.url.trim() }));
        }

        let extraEmbeds = [];
        if (Array.isArray(data.extraEmbeds)) {
            extraEmbeds = data.extraEmbeds.slice(0, 9).map(e => ({
                title: typeof e.title === 'string' ? e.title : '',
                response: typeof e.response === 'string' ? e.response : '',
                color: typeof e.color === 'number' ? e.color : 0x7289DA,
                thumbnail: e.thumbnail || null,
                image: e.image || null
            }));
        }

        await db.saveCustomCommandDB(guildId, lowerName, {
            prefix: prefix,
            type: data.type || 'text',
            title: data.title || '',
            response: data.response || '',
            color: typeof data.color === 'number' ? data.color : 0xE67E22,
            deleteCommand: data.deleteCommand !== false,
            enabled: data.enabled !== false,
            blockedChannels: blockedChannels,
            durationUnit: durationUnit,
            roleAction: roleAction,
            targetRoleId: targetRoleId,
            thumbnail: data.thumbnail || null,
            image: data.image || null,
            buttons: buttons,
            extraEmbeds: extraEmbeds,
            allowedRoles: allowedRoles,
            duration: duration,
            isBase: existing?.isBase || false,
            createdAt: existing?.createdAt || new Date(),
            updatedAt: new Date()
        });

        const cmd = await db.CustomCommand.findOne({ guildId, name: lowerName }).lean();
        res.json({ success: true, command: cmd });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/commands/:guildId/:name', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;

        const hasPerm = await userHasPermission(req, 'deleteRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { guildId, name } = req.params;

        const command = await db.CustomCommand.findOne({ guildId, name: name.toLowerCase() }).lean();
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        const deleted = await db.deleteCustomCommandDB(guildId, name);
        if (deleted) {
            return res.json({ success: true });
        }
        res.status(404).json({ error: 'Command not found' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/members/:guildId', requireAuth, async (req, res) => {
    try {
        if (!canAccessGuild(req, req.params.guildId) && !isDashboardAdmin(req)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        let members = guild.members.cache;
        if (members.size <= 1) {
            try {
                members = await guild.members.fetch();
            } catch (fetchErr) {
                console.error('Fetch members failed:', fetchErr.message);
            }
        }

        const list = members
            .filter(m => !m.user.bot)
            .map(m => ({
                id: m.user.id,
                username: m.user.username,
                displayName: m.displayName,
                tag: m.user.tag,
                avatar: m.user.displayAvatarURL({ dynamic: true, size: 64 }),
                joinedAt: m.joinedAt,
                roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name)
            }))
            .slice(0, 200);

        res.json(list);
    } catch (e) {
        console.error('Members error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/modlogs/:guildId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const logs = await db.getModLogsByGuild(req.params.guildId, 50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/modlogs/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const logs = await db.getModLogsByTarget(req.params.guildId, req.params.userId, 50);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/bans/:guildId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db, client } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        const liveBans = await guild.bans.fetch();
        const logs = await db.getBanLogsDB(req.params.guildId, 500);
        const blacklistEntries = await db.getAllBlacklistDB();
        const blacklistedIds = new Set(blacklistEntries.map(e => e.userId));

        const logsByTarget = {};
        for (const log of logs) {
            if (!logsByTarget[log.targetId]) logsByTarget[log.targetId] = log;
        }

        let auditByTarget = {};
        try {
            const auditLogs = await guild.fetchAuditLogs({ type: 22, limit: 100 });
            for (const entry of auditLogs.entries.values()) {
                if (!auditByTarget[entry.targetId]) {
                    auditByTarget[entry.targetId] = {
                        moderatorTag: entry.executor ? entry.executor.tag : null,
                        reason: entry.reason || null,
                        date: entry.createdAt
                    };
                }
            }
        } catch (e) {}

        const result = liveBans.filter(ban => !blacklistedIds.has(ban.user.id)).map(ban => {
            const log = logsByTarget[ban.user.id];
            const audit = auditByTarget[ban.user.id];
            return {
                targetId: ban.user.id,
                targetTag: ban.user.tag,
                avatarURL: ban.user.displayAvatarURL({ size: 64 }),
                moderatorTag: (log && log.moderatorTag) || (audit && audit.moderatorTag) || 'Unknown',
                reason: (log && log.reason) || (audit && audit.reason) || ban.reason || 'No reason provided',
                date: (log && log.date) || (audit && audit.date) || null
            };
        });

        result.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(b.date) - new Date(a.date);
        });

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/blacklist', requireAuth, async (req, res) => {
    try {
        const guildId = req.query.guildId || MAIN_GUILD_ID;
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const entries = await db.getAllBlacklistDB();
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(entries);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function isDashboardGuildId(guildId) {
    return [MAIN_GUILD_ID, COMMUNITY_GUILD_ID, MASTERCLASS_GUILD_ID].filter(Boolean).includes(guildId);
}

function sessionActor(req) {
    return {
        id: req.session.user.id,
        name: req.session.user.username || req.session.user.id
    };
}

app.post('/api/blacklist-action', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { action, userId, reason, guildId } = req.body;
        if (!action || !userId || !guildId) return res.status(400).json({ error: 'Missing parameters' });

        if (!isOwner(req, guildId)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client, saveModLog, blacklist } = global.PredCord;
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        if (action === 'change_reason') {
            if (!reason || typeof reason !== 'string') return res.status(400).json({ error: 'Missing reason' });
            const result = await blacklist.changeReason({ userId, reason: reason.trim().slice(0, 1000) });
            if (!result.ok) return res.status(404).json({ error: 'User not blacklisted' });
            return res.json({ success: true });
        }

        if (action === 'unblacklist') {
            const text = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 1000) : 'Removed via dashboard';
            const result = await blacklist.unblacklistUser({
                userId,
                reason: text,
                actor: sessionActor(req),
                fallbackGuild: guild
            });
            if (!result.ok) return res.status(404).json({ error: 'User not blacklisted' });
            await saveModLog(guild, 'UNBLACKLIST', { id: userId, tag: result.entry.userName || userId }, client.user, text, null);
            return res.json({ success: true, errors: result.errors, unbanned: result.unbanned });
        }

        return res.status(400).json({ error: 'Invalid action' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/blacklist/settings', requireAuth, async (req, res) => {
    try {
        const guildId = req.query.guildId;
        if (!guildId || !isDashboardGuildId(guildId)) return res.status(404).json({ error: 'Not available for this server' });
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', guildId);
        if (!hasPerm) return res.status(403).json({ error: 'Access Denied' });

        const { client, db } = global.PredCord;
        const settings = await db.getBlacklistSettingsDB();
        const guilds = [...client.guilds.cache.values()]
            .map(g => ({ id: g.id, name: g.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        let logChannelName = null;
        if (settings.logChannelId) {
            const ch = client.channels.cache.get(settings.logChannelId);
            if (ch) logChannelName = ch.name;
        }

        res.json({
            logChannelId: settings.logChannelId || null,
            logGuildId: settings.logGuildId || null,
            logChannelName,
            canEdit: isOwner(req, guildId),
            banGuildIds: settings.banGuildIds || [],
            commandRoles: settings.commandRoles || {},
            guilds,
            lastSweepAt: settings.lastSweepAt || null,
            lastSweepResult: settings.lastSweepResult || null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/blacklist/settings', requireAuth, writeLimiter, async (req, res) => {
    try {
        const body = req.body || {};
        const guildId = body.guildId;
        if (!guildId || !isDashboardGuildId(guildId)) return res.status(404).json({ error: 'Not available for this server' });
        if (!isOwner(req, guildId)) return res.status(403).json({ error: 'Access Denied' });

        const { client, db, blacklist } = global.PredCord;
        const update = {};

        if (body.logChannelId !== undefined) {
            if (body.logChannelId === null || body.logChannelId === '') {
                update.logChannelId = null;
                update.logGuildId = null;
            } else {
                const channel = client.channels.cache.get(String(body.logChannelId));
                if (!channel || !channel.guild || !isDashboardGuildId(channel.guild.id) || channel.type !== ChannelType.GuildText) {
                    return res.status(400).json({ error: 'Invalid channel' });
                }
                update.logChannelId = channel.id;
                update.logGuildId = channel.guild.id;
            }
        }

        if (body.banGuildIds !== undefined) {
            if (!Array.isArray(body.banGuildIds)) return res.status(400).json({ error: 'Invalid servers' });
            const valid = [...new Set(body.banGuildIds.map(String))].filter(id => client.guilds.cache.has(id));
            update.banGuildIds = valid;
        }

        if (body.commandRoles !== undefined) {
            if (!body.commandRoles || typeof body.commandRoles !== 'object' || Array.isArray(body.commandRoles)) {
                return res.status(400).json({ error: 'Invalid command roles' });
            }
            const cleanIds = (arr) => Array.isArray(arr) ? [...new Set(arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)))] : [];
            const current = await db.getBlacklistSettingsDB();
            const commandRoles = { ...(current.commandRoles || {}) };
            for (const gid of Object.keys(body.commandRoles)) {
                if (!isDashboardGuildId(gid)) continue;
                const entry = body.commandRoles[gid] || {};
                commandRoles[gid] = { manage: cleanIds(entry.manage), view: cleanIds(entry.view), protected: cleanIds(entry.protected) };
            }
            update.commandRoles = commandRoles;
        }

        await db.saveBlacklistSettingsDB(update);

        await db.saveDashboardLogDB(guildId, {
            type: 'config',
            action: 'blacklist_settings_updated',
            userId: req.session.user.id,
            userTag: req.session.user.username || req.session.user.id,
            reason: 'Blacklist settings updated'
        });

        if (update.banGuildIds) blacklist.runSweep();

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dashboard-logs/:guildId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const logs = await db.getDashboardLogsDB(req.params.guildId, 200);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/warnings/:guildId/:userId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { db } = global.PredCord;
        const userWarnings = await db.getUserWarningsDB(req.params.guildId, req.params.userId);
        res.json(userWarnings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/moderation/:guildId', requireAuth, writeLimiter, async (req, res) => {
    try {
        if (!isOwner(req, req.params.guildId)) {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const { client, saveModLog, addWarning, db } = global.PredCord;
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Server not found' });

        const { action, userId, reason, duration } = req.body;
        if (!action || !userId) return res.status(400).json({ error: 'Missing parameters' });

        let member;
        try {
            member = await guild.members.fetch(userId);
        } catch {
            if (action !== 'unban' && action !== 'change_reason') {
                return res.status(404).json({ error: 'User not found in server' });
            }
        }

        const moderator = client.user;
        const cleanReason = reason || 'Action from dashboard';
        let actionLabel = '';
        let durationText = null;

        if (action === 'warn') {
            if (!member) return res.status(404).json({ error: 'User not found' });
            await addWarning(guild, member.user, moderator, cleanReason);
            actionLabel = 'User warned';
        } else if (action === 'mute') {
            if (!member) return res.status(404).json({ error: 'User not found' });
            let days = parseInt(duration);
            if (isNaN(days) || days < 1) days = 28;
            if (days > 28) days = 28;
            if (!member.moderatable) return res.status(400).json({ error: 'Cannot mute this user' });
            await member.timeout(days * 24 * 60 * 60 * 1000, cleanReason);
            actionLabel = 'User muted';
            durationText = `${days} day${days === 1 ? '' : 's'}`;
        } else if (action === 'kick') {
            if (!member) return res.status(404).json({ error: 'User not found' });
            if (!member.kickable) return res.status(400).json({ error: 'Cannot kick this user' });
            await member.kick(cleanReason);
            actionLabel = 'User kicked';
        } else if (action === 'ban') {
            if (!member) return res.status(404).json({ error: 'User not found' });
            if (!member.bannable) return res.status(400).json({ error: 'Cannot ban this user' });
            await member.ban({ reason: cleanReason });
            actionLabel = 'User banned';
        } else if (action === 'unban') {
            try {
                const bans = await guild.bans.fetch();
                const bannedUser = bans.find(b => b.user.id === userId);
                if (!bannedUser) return res.status(404).json({ error: 'User not found in bans' });
                await guild.members.unban(userId, cleanReason);
                await db.removePendingBan(guild.id, userId);
                actionLabel = 'User unbanned';
                await saveModLog(guild, actionLabel, { id: userId, tag: bannedUser.user.tag }, moderator, cleanReason, null);
                return res.json({ success: true, username: bannedUser.user.tag });
            } catch (err) {
                return res.status(400).json({ error: 'Error during unban: ' + err.message });
            }
        } else if (action === 'unmute') {
            if (!member) return res.status(404).json({ error: 'User not found' });
            if (!member.moderatable) return res.status(400).json({ error: 'Cannot unmute this user' });
            await member.timeout(null, cleanReason);
            actionLabel = 'User unmuted';
        } else if (action === 'change_reason') {
            if (!reason) return res.status(400).json({ error: 'Missing reason' });
            await db.updateBanReasonDB(guild.id, userId, reason);
            return res.json({ success: true });
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        await saveModLog(guild, actionLabel, member.user, moderator, cleanReason, durationText);

        res.json({ success: true, username: member.user.tag });
    } catch (e) {
        console.error('Moderation error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/transcripts/:guildId', requireAuth, async (req, res) => {
    try {
        const hasPerm = await userHasPermission(req, 'viewLogsRoles', req.params.guildId);
        if (!hasPerm) {
            return res.status(403).json({ error: 'Access Denied' });
        }
        const { db } = global.PredCord;
        const transcripts = await db.getTranscriptsByGuildDB(req.params.guildId, 100);
        res.json(transcripts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/transcripts/:guildId/:transcriptId', requireAuth, async (req, res) => {
    try {
        const { db } = global.PredCord;
        const transcript = await db.getTranscriptDB(req.params.guildId, req.params.transcriptId);
        if (!transcript) {
            return res.status(404).json({ error: 'Transcript not found' });
        }
        res.json(transcript);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/dashboard/transcript/:transcriptId', requireAuth, async (req, res) => {
    res.sendFile(path.join(DASHBOARD_DIR, 'transcript.html'));
});

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'index.html'));
});

app.get('/masterclass', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'masterclass.html'));
});

app.get('/videos', async (req, res) => {
    if (!req.session.siteUser) return res.redirect('/');
    try {
        const allowed = await canUserViewVideosPage(req.session.siteUser.id);
        if (!allowed) return res.redirect('/');
    } catch (e) {
        return res.redirect('/');
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'videos.html'));
});

app.get('/community', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'community.html'));
});

app.get('/ticket/:ticketNumber', (req, res) => {
    if (!req.session.siteUser) {
        return res.redirect('/site-auth/discord?next=' + encodeURIComponent('/ticket/' + String(req.params.ticketNumber).replace(/[^0-9]/g, '')));
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'ticket.html'));
});

app.get('/hexora', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'hexora.html'));
});

const HEXORA_TEAM_IDS = ['1346238732495355944', '825654941238034462', '887758994683338772', '1297667554487042130'];
const hexoraTeamGood = {};
let hexoraTeamCache = { at: 0, data: null };
let hexoraTeamInflight = null;

function refreshHexoraTeam() {
    if (hexoraTeamInflight) return hexoraTeamInflight;
    hexoraTeamInflight = (async () => {
        const client = global.PredCord && global.PredCord.client;
        if (client && client.isReady()) {
            await Promise.all(HEXORA_TEAM_IDS.map(async (id) => {
                try {
                    const user = await client.users.fetch(id, { force: true });
                    hexoraTeamGood[id] = { id, username: user.username, avatar: user.displayAvatarURL({ extension: 'png', size: 128 }) };
                } catch {}
            }));
        }
        const data = HEXORA_TEAM_IDS.map(id => hexoraTeamGood[id] || { id, username: null, avatar: null });
        if (data.some(u => u.username)) hexoraTeamCache = { at: Date.now(), data };
        return data;
    })().finally(() => { hexoraTeamInflight = null; });
    return hexoraTeamInflight;
}

setTimeout(() => { refreshHexoraTeam().catch(() => {}); }, 8000);
setTimeout(() => { refreshHexoraTeam().catch(() => {}); }, 30000);
setInterval(() => { refreshHexoraTeam().catch(() => {}); }, 10 * 60 * 1000);

app.get('/api/site/hexora-team', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const fresh = hexoraTeamCache.data && Date.now() - hexoraTeamCache.at < 10 * 60 * 1000;
    if (fresh) return res.json(hexoraTeamCache.data);
    if (hexoraTeamCache.data) {
        refreshHexoraTeam().catch(() => {});
        return res.json(hexoraTeamCache.data);
    }
    try {
        const data = await Promise.race([refreshHexoraTeam(), new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
        res.json(data || HEXORA_TEAM_IDS.map(id => ({ id, username: null, avatar: null })));
    } catch {
        res.json(HEXORA_TEAM_IDS.map(id => ({ id, username: null, avatar: null })));
    }
});

app.get('/terms', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'terms.html'));
});

app.get('/privacy', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(SITE_DIR, 'privacy.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
});

waitForBot().then(() => {
    cleanupExpiredMcTickets();
    setInterval(cleanupExpiredMcTickets, 10 * 60 * 1000);
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Dashboard running on http://0.0.0.0:${PORT}`);
    });
}).catch((err) => {
    console.error('Startup error:', err.message);
    process.exit(1);
});
