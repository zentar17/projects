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
const os = require('os');
const mongoose = require('mongoose');
const multer = require('multer');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

const SUPER_OWNER_IDS = ['887758994683338772', '1297667554487042130', '1346238732495355944'];

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

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

async function resolveGuildAccess(discordUserId) {
    const { client, db } = global.PredCord;
    const result = {
        predcord: { access: false, role: null, roles: [] },
        community: { access: false, role: null, roles: [] }
    };

    if (SUPER_OWNER_IDS.includes(discordUserId)) {
        result.predcord = { access: true, role: 'owner', roles: [] };
        result.community = { access: true, role: 'owner', roles: [] };
        return result;
    }

    if (MAIN_GUILD_ID) {
        const guild = client.guilds.cache.get(MAIN_GUILD_ID);
        if (guild) {
            const member = await guild.members.fetch(discordUserId).catch(() => null);
            if (member) {
                const userRoles = member.roles.cache.map(r => r.id);
                result.predcord.roles = userRoles;

                const specialUsers = await db.getDashboardSpecialUsersDB(MAIN_GUILD_ID);
                if (specialUsers.ownerUsers.includes(discordUserId)) {
                    result.predcord.access = true;
                    result.predcord.role = 'owner';
                } else if (specialUsers.adminUsers.includes(discordUserId)) {
                    result.predcord.access = true;
                    result.predcord.role = 'admin';
                } else {
                    const permissions = await db.getDashboardPermissionsDB(MAIN_GUILD_ID);
                    const allAllowed = [
                        ...(permissions.createRoles || []),
                        ...(permissions.editRoles || []),
                        ...(permissions.deleteRoles || []),
                        ...(permissions.viewLogsRoles || [])
                    ];
                    const hasConfiguredRole = allAllowed.some(roleId => userRoles.includes(roleId));
                    const hasFixedRole = PREDCORD_ACCESS_ROLE_IDS.some(roleId => userRoles.includes(roleId));
                    if (hasConfiguredRole || hasFixedRole) {
                        result.predcord.access = true;
                        result.predcord.role = 'user';
                    }
                }
            }
        }
    }

    if (COMMUNITY_GUILD_ID) {
        const guild = client.guilds.cache.get(COMMUNITY_GUILD_ID);
        if (guild) {
            const member = await guild.members.fetch(discordUserId).catch(() => null);
            if (member) {
                const userRoles = member.roles.cache.map(r => r.id);
                result.community.roles = userRoles;

                const specialUsers = await db.getDashboardSpecialUsersDB(COMMUNITY_GUILD_ID);
                if (specialUsers.ownerUsers.includes(discordUserId)) {
                    result.community.access = true;
                    result.community.role = 'owner';
                } else if (specialUsers.adminUsers.includes(discordUserId)) {
                    result.community.access = true;
                    result.community.role = 'admin';
                } else {
                    const permissions = await db.getDashboardPermissionsDB(COMMUNITY_GUILD_ID);
                    const allAllowed = [
                        ...(permissions.createRoles || []),
                        ...(permissions.editRoles || []),
                        ...(permissions.deleteRoles || []),
                        ...(permissions.viewLogsRoles || [])
                    ];
                    const hasConfiguredRole = allAllowed.some(roleId => userRoles.includes(roleId));
                    const hasFixedRole = COMMUNITY_ACCESS_ROLE_IDS.some(roleId => userRoles.includes(roleId));
                    if (hasConfiguredRole || hasFixedRole) {
                        result.community.access = true;
                        result.community.role = 'user';
                    }
                }
            }
        }
    }

    return result;
}

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_REDIRECT_URI,
    scope: ['identify', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const access = await resolveGuildAccess(profile.id);

        if (!access.predcord.access && !access.community.access) {
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

async function userHasPermission(req, permKey, guildId) {
    const role = getUserRole(req);

    if (role === 'owner' || role === 'admin') {
        return true;
    }

    const targetGuildId = guildId || MAIN_GUILD_ID;

    if (targetGuildId === COMMUNITY_GUILD_ID) {
        const communityRole = req.user && req.user.community ? req.user.community.role : null;
        if (communityRole === 'owner' || communityRole === 'admin') return true;

        const permissions = await global.PredCord.db.getDashboardPermissionsDB(targetGuildId);
        const allowed = permissions[permKey] || [];
        if (allowed.length === 0) return false;
        const userRoles = (req.user && req.user.community && req.user.community.roles) || [];
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
    if (guildId === COMMUNITY_GUILD_ID && req.user && req.user.community && req.user.community.role === 'owner') return true;
    return false;
}

function canAccessGuild(req, guildId) {
    const role = getUserRole(req);
    if (role === 'owner' || role === 'admin') return true;
    if (!guildId) return false;
    if (guildId === MAIN_GUILD_ID) return !!(req.user && req.user.predcordAccess);
    if (guildId === COMMUNITY_GUILD_ID) return !!(req.user && req.user.community && req.user.community.access);
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
        const guildIds = [MAIN_GUILD_ID, COMMUNITY_GUILD_ID].filter(Boolean);
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

        await channel.send({ embeds: [embed] });
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

    let access = { predcord: true, community: true };
    if (isDiscordUser && role !== 'owner' && role !== 'admin') {
        access = {
            predcord: !!(req.user && req.user.predcordAccess),
            community: !!(req.user && req.user.community && req.user.community.access)
        };
    }

    const masterclass = await getMasterclassFlags(req);

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

        if (targetGuildId === COMMUNITY_GUILD_ID) {
            const communityRole = req.user && req.user.community ? req.user.community.role : null;

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
            const userRoles = (req.user && req.user.community && req.user.community.roles) || [];

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
    res.json({ predcord: MAIN_GUILD_ID || null, community: COMMUNITY_GUILD_ID || null });
});

app.get('/api/guilds', requireAuth, (req, res) => {
    try {
        const { client } = global.PredCord;
        const ids = [MAIN_GUILD_ID, COMMUNITY_GUILD_ID].filter(Boolean);
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

app.get('/api/roles/:guildId', requireAuth, (req, res) => {
    try {
        if (!canAccessGuild(req, req.params.guildId) && !isDashboardAdmin(req)) {
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
    if (role === 'owner') return { canUpload: true, canManage: true, canAccess: true };
    const userId = req.session.user && req.session.user.id;
    if (!userId) return { canUpload: false, canManage: false, canAccess: false };
    const settings = await global.PredCord.db.getMasterclassSettingsDB();
    const canUpload = (settings.uploadUserIds || []).includes(userId);
    const canManage = (settings.manageUserIds || []).includes(userId);
    return { canUpload, canManage, canAccess: canUpload || canManage };
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
            manageUserIds: settings.manageUserIds || []
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
            manageUserIds: req.body.manageUserIds
        });
        res.json({
            viewUserIds: settings.viewUserIds || [],
            uploadUserIds: settings.uploadUserIds || [],
            manageUserIds: settings.manageUserIds || []
        });
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
    const guildIds = [MAIN_GUILD_ID, COMMUNITY_GUILD_ID].filter(Boolean);
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
        res.json(config);
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
        let startTime = new Date(0);
        if (period === 'oggi') {
            startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'ieri') {
            startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
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
        if (period === 'ieri') endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const windowed = await db.getJoinLeaveStatsDB(guildId, startTime, endTime);
        const totals = await db.getJoinLeaveTotalsDB(guildId);

        const guild = client ? client.guilds.cache.get(guildId) : null;

        res.json({
            period,
            windowed,
            totals,
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

        const restrictedTypes = ['ban', 'kick', 'mute', 'warn'];
        if (restrictedTypes.includes(data.type) && !isOwner(req, guildId)) {
            return res.status(403).json({ error: 'Only the Owner can create or edit moderation commands' });
        }

        let prefix = typeof data.prefix === 'string' ? data.prefix.trim() : '*';
        if (prefix.length !== 1 || !/[^a-zA-Z0-9\s]/.test(prefix)) prefix = '*';

        const lowerName = name.toLowerCase();
        const existing = await db.CustomCommand.findOne({ guildId, name: lowerName }).lean();

        if (existing && existing.isBase && !isOwner(req, guildId)) {
            return res.status(403).json({ error: 'This command is Base and cannot be modified' });
        }

        let allowedRoles = [];
        if (Array.isArray(data.allowedRoles)) {
            allowedRoles = data.allowedRoles.filter(r => typeof r === 'string' && /^\d+$/.test(r));
        }

        let duration = null;
        if (data.duration !== null && data.duration !== undefined && data.duration !== '') {
            const d = parseInt(data.duration);
            if (!isNaN(d) && d > 0) duration = d;
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

app.post('/api/commands/:guildId/:name/setbase', requireAuth, writeLimiter, async (req, res) => {
    try {
        const { db } = global.PredCord;

        if (!isOwner(req, req.params.guildId)) {
            return res.status(403).json({ error: 'Only the Owner can manage Base commands' });
        }

        const { guildId, name } = req.params;
        const { isBase } = req.body;

        const command = await db.CustomCommand.findOne({ guildId, name: name.toLowerCase() }).lean();
        if (!command) {
            return res.status(404).json({ error: 'Command not found' });
        }

        if (isBase) {
            const currentCount = await db.getBaseCommandsCount(guildId);
            if (!command.isBase && currentCount >= MAX_BASE_COMMANDS) {
                return res.status(400).json({ error: `Maximum ${MAX_BASE_COMMANDS} Base commands reached` });
            }
        }

        await db.setIsBaseDB(guildId, name, !!isBase);
        res.json({ success: true, isBase: !!isBase });
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

        if (command.isBase) {
            return res.status(403).json({ error: 'This command is Base: remove the Base flag first to delete it' });
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

        const result = liveBans.map(ban => {
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
            if (action !== 'unban') {
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
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Dashboard running on http://0.0.0.0:${PORT}`);
    });
}).catch((err) => {
    console.error('Startup error:', err.message);
    process.exit(1);
});
