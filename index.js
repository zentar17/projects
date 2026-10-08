const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, Events, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, RadioGroupBuilder, RadioGroupOptionBuilder, UserSelectMenuBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const botClients = require('./bot-clients');
const createRoleSync = require('./role-sync');
const createDropmap = require('./dropmap');
require('dotenv').config();

const CRASH_LOG_FILE = './crash_log.json';
const MAX_CRASH_LOGS = 100;
const LOGS_PER_PAGE = 5;
const NATIVE_PREFIX = '*';
const ticketClaims = new Map();
const COMMAND_COOLDOWN_SECONDS = 5;

function logCrash(type, error, context = {}) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            type,
            message: error?.message || String(error),
            stack: error?.stack || null,
            context,
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
        let logs = [];
        if (fs.existsSync(CRASH_LOG_FILE)) {
            try {
                logs = JSON.parse(fs.readFileSync(CRASH_LOG_FILE, 'utf8'));
                if (!Array.isArray(logs)) logs = [];
            } catch { logs = []; }
        }
        logs.push(entry);
        if (logs.length > MAX_CRASH_LOGS) logs = logs.slice(-MAX_CRASH_LOGS);
        fs.writeFileSync(CRASH_LOG_FILE, JSON.stringify(logs, null, 2));
        console.error(`[CRASH ${type}]`, entry.message);
        if (entry.stack) console.error(entry.stack.split('\n').slice(0, 5).join('\n'));
    } catch (e) {
        console.error('[CRASH LOGGER FAILED]', e.message);
    }
}

process.on('unhandledRejection', (reason) => logCrash('UNHANDLED_REJECTION', reason));
process.on('uncaughtException', (error) => logCrash('UNCAUGHT_EXCEPTION', error));

setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = mem.heapUsed / 1024 / 1024;
    if (heapMB > 1500) {
        logCrash('HIGH_MEMORY', new Error(`Heap usage: ${heapMB.toFixed(2)} MB`));
    }
}, 60000);

console.log('[ANTI-CRASH] Protection system activated');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ]
});

const roleSync = createRoleSync({ client, db, botClients, logCrash });

client.on('error', (error) => logCrash('CLIENT_ERROR', error));
client.on('shardError', (error) => logCrash('SHARD_ERROR', error));

const TRANSCRIPTS_DIR = './transcripts/';

if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

const THUMBNAIL_URL = "https://media.discordapp.net/attachments/1365770639398408303/1494756290935656498/image.png";
const FOOTER_IMAGE_URL = "https://cdn.discordapp.com/attachments/1400266716763918519/1511055836448034958/CB02C8D3-57C6-4DDC-B1DC-F1ECD3844516.png";

const COLORS = {
    SUCCESS: 0xE67E22,
    ERROR: 0xE67E22,
    WARNING: 0xE67E22,
    INFO: 0xE67E22,
    MODERATION: 0xE67E22,
    TICKET: 0xE67E22,
    REPORT: 0xE67E22
};

const BLACK = 0x6B6E73;
const PROJECTED_ERROR = 0xED4245;
const RED = 0xED4245;
const GOLD = 0xFFD700;
const GREEN = 0x57F287;

const dropmap = createDropmap({ client, db, botClients, getGuildConfig, logCrash, thumbnailUrl: THUMBNAIL_URL });

const SOCIAL_LINKS = {
    twitch: "https://www.twitch.tv/predagefn",
    youtube: "https://www.youtube.com/@predagefn",
    tiktok: "https://www.tiktok.com/@predagefn",
    twitter: "https://x.com/Predage1",
    instagram: "https://www.instagram.com/predagefn/",
    discord: "https://discord.gg/UW7SsywQp6"
};

const EMOJIS = {
    twitch:    '<:twitch:1549474965793935571>',
    discord:   '<:discord:1549474921816531045>',
    twitter:   '<:twitter:1549474838219849798>',
    tiktok:    '<:tiktok:1549468832194887772>',
    youtube:   '<:youtube:1549468804214562907>',
    instagram: '<:insta:1549468767916916806>'
};

function applyPositionalArgs(text, args) {
    if (!text) return '';
    return text.replace(/\$(\d+)/g, (match, num) => {
        const idx = parseInt(num, 10) - 1;
        if (idx >= 0 && idx < args.length) {
            return args[idx];
        }
        return match;
    });
}

function applyHammertime(text) {
    if (!text) return '';
    return text.replace(/{hammertime([+-]\d+)}/g, (match, offset) => {
        const minutes = parseInt(offset, 10);
        const target = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
        return `<t:${target}:t>`;
    });
}

const CMD_UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
const CMD_UNIT_WORD = { minutes: 'minute', hours: 'hour', days: 'day' };

function getCmdDurationMs(cmdData) {
    if (!cmdData || cmdData.durationUnit === 'perm') return null;
    const n = parseInt(cmdData.duration, 10);
    if (isNaN(n) || n < 1) return null;
    return n * (CMD_UNIT_MS[cmdData.durationUnit] || CMD_UNIT_MS.days);
}

function formatCmdDuration(cmdData) {
    const n = parseInt(cmdData.duration, 10);
    const unit = CMD_UNIT_WORD[cmdData.durationUnit] || 'day';
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function isCommandBlockedInChannel(cmdData, channel) {
    const blocked = cmdData && cmdData.blockedChannels;
    if (!Array.isArray(blocked) || !blocked.length || !channel) return false;
    if (blocked.includes(channel.id)) return true;
    if (channel.parentId && blocked.includes(channel.parentId)) return true;
    if (typeof channel.isThread === 'function' && channel.isThread() && channel.parent && channel.parent.parentId && blocked.includes(channel.parent.parentId)) return true;
    return false;
}

function formatCmdDate() {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function substituteAll(text, message, mdTarget, args) {
    if (!text) return '';
    let result = text;
    result = result.replace(/{user}/g, message.author.toString());
    result = result.replace(/{username}/g, message.author.username);
    result = result.replace(/{userid}/g, message.author.id);
    result = result.replace(/{target}/g, mdTarget ? mdTarget.toString() : message.author.toString());
    result = result.replace(/{channel}/g, message.channel.toString());
    result = result.replace(/{date}/g, formatCmdDate());
    result = result.replace(/{server}/g, message.guild.name);
    result = result.replace(/{membercount}/g, message.guild.memberCount);
    result = result.replace(/{args}/g, args.join(' '));
    result = result.replace(/{md}/g, await formatModerationHistory(mdTarget.id, message.guild.id, mdTarget.username, 1));
    result = applyPositionalArgs(result, args);
    result = applyHammertime(result);
    return result;
}

async function getGuildConfig(guildId) {
    const config = await db.getGuildConfigDB(guildId);
    return config;
}

function getTicketStaffRoleIds(config) {
    const ids = new Set();
    if (config.staffRoleId) ids.add(config.staffRoleId);
    if (Array.isArray(config.supportRoleIds)) config.supportRoleIds.forEach(id => ids.add(id));
    return Array.from(ids);
}

function getTicketAdminRoleIds(config) {
    const ids = new Set();
    if (config.adminRoleId) ids.add(config.adminRoleId);
    if (Array.isArray(config.adminRoleIds)) config.adminRoleIds.forEach(id => ids.add(id));
    return Array.from(ids);
}

function memberHasAnyRole(member, roleIds) {
    if (!member || !Array.isArray(roleIds)) return false;
    return roleIds.some(roleId => member.roles?.cache?.has(roleId));
}

function buildTicketRoleOverwrites(guild, roleIds, allowFlags) {
    const overwrites = [];
    for (const roleId of roleIds) {
        if (guild.roles.cache.has(roleId)) {
            overwrites.push({ id: roleId, allow: allowFlags });
        }
    }
    return overwrites;
}

async function isAdminSafe(member) {
    try {
        if (!member) return false;
        if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.adminRoleId && member.roles?.cache?.has(config.adminRoleId)) return true;
        if (Array.isArray(config.adminRoleIds) && config.adminRoleIds.some(roleId => member.roles?.cache?.has(roleId))) return true;
        return false;
    } catch { return false; }
}

async function isModeratorSafe(member) {
    try {
        if (!member) return false;
        if (await isAdminSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.modRoleId && member.roles?.cache?.has(config.modRoleId)) return true;
        if (Array.isArray(config.modRoleIds) && config.modRoleIds.some(roleId => member.roles?.cache?.has(roleId))) return true;
        if (Array.isArray(config.trialModRoleIds) && config.trialModRoleIds.some(roleId => member.roles?.cache?.has(roleId))) return true;
        if (Array.isArray(config.headModRoleIds) && config.headModRoleIds.some(roleId => member.roles?.cache?.has(roleId))) return true;
        return false;
    } catch { return false; }
}

async function isStaffSafe(member) {
    try {
        if (!member) return false;
        if (await isModeratorSafe(member)) return true;
        const guildId = member.guild?.id;
        if (!guildId) return false;
        const config = await getGuildConfig(guildId);
        if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) return true;
        if (Array.isArray(config.supportRoleIds) && config.supportRoleIds.some(roleId => member.roles?.cache?.has(roleId))) return true;
        return false;
    } catch { return false; }
}

async function hasModPerms(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member));
}

async function hasStaffPermission(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member)) || (await isStaffSafe(member));
}

async function canUseBaseCommands(member) {
    return (await isAdminSafe(member)) || (await isModeratorSafe(member));
}

async function hasProjectedRole(member, guildId) {
    if (!member) return false;
    try {
        const projected = await db.getProjectedRolesDB(guildId);
        if (!projected || projected.length === 0) return false;
        return projected.some(roleId => member.roles?.cache?.has(roleId));
    } catch {
        return false;
    }
}

async function projectedRoleBlock(message, targetMember) {
    if (!targetMember) return false;
    if (await hasProjectedRole(targetMember, message.guild.id)) {
        const embed = new EmbedBuilder()
            .setDescription(`I cannot moderate **${targetMember.user.username}** (${targetMember.user.id}) because they have a **Projected Role**.`)
            .setColor(PROJECTED_ERROR);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return true;
    }
    return false;
}

async function getUserFromInput(guild, input) {
    if (!input) return null;
    let userId = null;
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        userId = mentionMatch[1];
    } else if (/^\d+$/.test(input)) {
        userId = input;
    }
    if (!userId) return null;
    try {
        const member = await guild.members.fetch(userId);
        return { user: member.user, member: member };
    } catch {
        try {
            const user = await client.users.fetch(userId);
            return { user: user, member: null };
        } catch {
            return { user: { id: userId, tag: `Unknown User (${userId})` }, member: null };
        }
    }
}

function checkCustomCommandPermission(cmdData, member) {
    if (Array.isArray(cmdData.allowedRoles)) {
        if (cmdData.allowedRoles.length === 0) return false;
        return cmdData.allowedRoles.some(roleId => member.roles?.cache?.has(roleId));
    }
    return true;
}

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

function parseMuteDuration(token) {
    const match = /^(\d+)\s*(m|min|h|d|w)?$/i.exec(String(token || '').trim());
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = (match[2] || 'm').toLowerCase();
    const factor = unit === 'h' ? 60 : unit === 'd' ? 1440 : unit === 'w' ? 10080 : 1;
    const minutes = value * factor;
    if (!value || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) return { invalid: true };
    const names = { m: 'minute', min: 'minute', h: 'hour', d: 'day', w: 'week' };
    const name = names[unit];
    return { minutes, ms: minutes * 60 * 1000, text: `${value} ${name}${value === 1 ? '' : 's'}` };
}

function extractMuteDuration(args) {
    if (args.length > 1) {
        const last = parseMuteDuration(args[args.length - 1]);
        if (last) return { duration: last, rest: args.slice(1, -1) };
        const second = parseMuteDuration(args[1]);
        if (second) return { duration: second, rest: args.slice(2) };
    }
    return { duration: null, rest: args.slice(1) };
}

async function isModerationDmEnabled(guildId) {
    if (!guildId) return true;
    const config = await getGuildConfig(guildId);
    if (typeof config.moderationDmEnabled === 'boolean') return config.moderationDmEnabled;
    return guildId === process.env.MAIN_GUILD_ID;
}

async function sendActionDM(user, action, reason, moderator, duration = null) {
    try {
        if (!(await isModerationDmEnabled(moderator?.guild?.id))) return;

        const actionText = {
            'warned': 'warned',
            'banned': 'banned',
            'kicked': 'kicked',
            'muted': 'muted',
            'unbanned': 'unbanned',
            'unmuted': 'unmuted'
        };
        const label = actionText[action] || action;
        let description;
        let embedColor = COLORS.WARNING;

        if (action === 'banned') {
            description = `**You have been ${label}** in ${moderator?.guild?.name || 'PredCord'} for **${reason || 'no reason provided'}**`;
            embedColor = 0xE74C3C;
        } else if (action === 'unbanned' || action === 'unmuted') {
            description = `**You have been ${label} in ${moderator?.guild?.name || 'the server'}**`;
        } else {
            const where = moderator?.guild?.name ? ` in ${moderator.guild.name}` : '';
            const forHow = action === 'muted' && duration ? ` for ${duration}` : '';
            description = `**You have been ${label}${where}${forHow}** for **${reason || 'no reason provided'}**`;
        }

        const embed = new EmbedBuilder()
            .setDescription(description)
            .setColor(embedColor);

        const payload = { embeds: [embed] };

        if (action === 'banned' || action === 'muted') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(action === 'muted' ? 'Appeal your mute' : 'Appeal your ban')
                    .setStyle(ButtonStyle.Link)
                    .setURL('https://projects-1od2.onrender.com/community#ban-appeal')
            );
            payload.components = [row];
        }

        await user.send(payload).catch(err => console.log(`DM failed: ${user?.tag || user?.id} (${err.message})`));
    } catch (error) {
        logCrash('DM_ERROR', error, { userId: user?.id, action });
    }
}

async function sendUnbanDM(user, guild) {
    try {
        if (guild?.id && guild.id !== process.env.MAIN_GUILD_ID) return;

        const embed = new EmbedBuilder()
            .setDescription('Your ban has expired. You can join back now https://discord.gg/nF4Js5X585')
            .setColor(COLORS.SUCCESS);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Join Back')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/nF4Js5X585')
        );

        await user.send({ embeds: [embed], components: [row] }).catch(err => console.log(`DM failed: ${user?.tag || user?.id} (${err.message})`));
    } catch (error) {
        logCrash('DM_ERROR', error, { userId: user?.id, action: 'unbanned' });
    }
}

async function addWarning(guild, user, moderator, reason) {
    const warning = await db.addWarningDB({
        guildId: guild.id,
        userId: user.id,
        userTag: user.tag,
        moderatorId: moderator.id,
        moderatorTag: moderator.tag,
        reason: reason || 'No reason provided',
        date: new Date(),
        active: true
    });

    const allWarnings = await db.getUserWarningsDB(guild.id, user.id);
    const warningCount = allWarnings.length;

    const member = guild.members.cache.get(user.id);
    if (member) {
        if (warningCount >= 10) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-ban for ${user.tag} (projected role)`);
            } else {
                await sendActionDM(user, 'banned', '10 warnings accumulated', { tag: 'Auto-Mod', guild: guild });
                await member.ban({ reason: 'Auto-ban: 10 warnings' }).catch(() => {});
                await saveModLog(guild, 'User banned (auto)', user, client.user, '10 warnings accumulated', null);
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_banned_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '10 warnings accumulated',
                    details: 'Auto-ban triggered after 10 warnings'
                });
            }
        } else if (warningCount >= 5) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-kick for ${user.tag} (projected role)`);
            } else {
                await sendActionDM(user, 'kicked', '5 warnings accumulated', { tag: 'Auto-Mod', guild: guild });
                await member.kick('Auto-kick: 5 warnings').catch(() => {});
                await saveModLog(guild, 'User kicked (auto)', user, client.user, '5 warnings accumulated', null);
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_kicked_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '5 warnings accumulated',
                    details: 'Auto-kick triggered after 5 warnings'
                });
            }
        } else if (warningCount >= 3) {
            if (await hasProjectedRole(member, guild.id)) {
                console.log(`[PROJECTED] Skipped auto-mute for ${user.tag} (projected role)`);
            } else {
                await member.timeout(28 * 24 * 60 * 60 * 1000, 'Auto-mute: 3 warnings').catch(() => {});
                await sendActionDM(user, 'muted', '3 warnings accumulated', { tag: 'Auto-Mod', guild: guild }, '28 days');
                await saveModLog(guild, 'User muted (auto)', user, client.user, '3 warnings accumulated', '28 days');
                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_muted_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: user.id,
                    targetTag: user.tag,
                    reason: '3 warnings accumulated',
                    details: 'Auto-mute triggered after 3 warnings (28 days)'
                });
            }
        }
    }
    return warning.warningId;
}

async function removeWarning(guild, user, moderator, warningId) {
    return await db.removeWarningDB(guild.id, user.id, warningId);
}

async function clearWarnings(guild, user, moderator) {
    return await db.clearWarningsDB(guild.id, user.id);
}

async function getUserWarnings(userId, guildId) {
    if (!guildId) return [];
    return await db.getUserWarningsDB(guildId, userId);
}

async function saveModLog(guild, action, target, moderator, reason, duration = null) {
    try {
        const log = await db.createModLog({
            guildId: guild.id,
            guildName: guild.name,
            action: action,
            targetId: target.id,
            targetTag: target.tag,
            moderatorId: moderator.id,
            moderatorTag: moderator.tag,
            reason: reason || 'No reason provided',
            duration,
            date: new Date(),
            active: true
        });

        const config = await getGuildConfig(guild.id);
        const logChannel = botClients.getLogsClient(client).channels.cache.get(config.modLogChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(action)
                .setColor(COLORS.MODERATION)
                .setThumbnail(THUMBNAIL_URL);
            if (action === 'Messages purged') {
                logEmbed.addFields(
                    { name: 'Moderator', value: `${moderator.toString()}`, inline: true },
                    { name: 'Channel', value: `<#${target.id}>`, inline: true },
                    { name: 'Messages deleted', value: reason || 'Unknown', inline: true },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true }
                );
            } else {
                logEmbed.addFields(
                    { name: 'User', value: `<@${target.id}>`, inline: true },
                    { name: 'Moderator', value: `${moderator.toString()}`, inline: true },
                    { name: 'Reason', value: reason || 'No reason provided', inline: false },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true },
                    { name: 'Case ID', value: `#${log.caseId}`, inline: true }
                );
            }
            if (duration) logEmbed.addFields({ name: 'Duration', value: duration, inline: true });
            await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
        return log;
    } catch (error) {
        logCrash('MODLOG_ERROR', error, { action });
        return null;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBlacklistTargetGuilds(currentGuild) {
    const currentConfig = await getGuildConfig(currentGuild.id);
    if (!currentConfig.blacklistSyncEnabled) return [currentGuild];

    const syncedIds = await db.getBlacklistSyncGuildIdsDB();
    const guilds = [];
    for (const guildId of syncedIds) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guilds.push(guild);
    }
    if (!guilds.some(g => g.id === currentGuild.id)) guilds.push(currentGuild);
    return guilds;
}

async function checkBanPermissions(guild) {
    try {
        const botMember = guild.members.me;
        if (!botMember) return false;
        return botMember.permissions.has(PermissionsBitField.Flags.BanMembers);
    } catch {
        return false;
    }
}

async function checkRoleHierarchy(guild, userId) {
    try {
        const botMember = guild.members.me;
        if (!botMember) return false;
        const targetMember = await guild.members.fetch(userId).catch(() => null);
        if (!targetMember) return true;
        return botMember.roles.highest.position > targetMember.roles.highest.position;
    } catch {
        return false;
    }
}

async function banFromAllGuilds(currentGuild, userId, reason) {
    const results = [];
    const errors = [];
    const bannedGuildIds = [];
    const targetGuilds = await getBlacklistTargetGuilds(currentGuild);

    for (const guild of targetGuilds) {
        const hasPerms = await checkBanPermissions(guild);
        if (!hasPerms) {
            errors.push(`${guild.name} - Missing Ban Members permission`);
            continue;
        }
        const hasHigherRole = await checkRoleHierarchy(guild, userId);
        if (!hasHigherRole) {
            errors.push(`${guild.name} - Bot role is not higher than target`);
            continue;
        }
        try {
            await guild.bans.create(userId, { reason: `Blacklist: ${reason}`, deleteMessageSeconds: 86400 });
            results.push(`${guild.name} - banned`);
            bannedGuildIds.push(guild.id);
            if (targetGuilds.length > 1) await delay(1000);
        } catch (error) {
            if (error.code === 10026) {
                results.push(`${guild.name} - already banned`);
                bannedGuildIds.push(guild.id);
            } else if (error.code === 50013) {
                errors.push(`${guild.name} - Missing Permissions`);
            } else {
                errors.push(`${guild.name} - ${error.message}`);
            }
        }
    }

    return { results, errors, bannedGuildIds };
}

async function unbanFromAllGuilds(currentGuild, userId, existingServerIds) {
    const results = [];
    const errors = [];
    const targetGuilds = await getBlacklistTargetGuilds(currentGuild);
    const guildIds = new Set([...(existingServerIds || []), ...targetGuilds.map(g => g.id)]);

    for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        try {
            await guild.bans.remove(userId, 'Unblacklisted');
            results.push(`${guild.name} - unbanned`);
            if (guildIds.size > 1) await delay(1000);
        } catch (error) {
            if (error.code === 10026) {
                results.push(`${guild.name} - was not banned`);
            } else {
                errors.push(`${guild.name} - ${error.message}`);
            }
        }
    }

    return { results, errors };
}

async function formatModerationHistory(userId, guildId, username, page = 1) {
    const totalLogs = await db.ModLog.countDocuments({ guildId, targetId: userId });

    if (totalLogs === 0) {
        return `**${username}** has no modlogs.`;
    }

    const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const skip = (safePage - 1) * LOGS_PER_PAGE;

    const logs = await db.ModLog
        .find({ guildId, targetId: userId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(LOGS_PER_PAGE)
        .lean();

    const typeLabel = (action) => {
        const a = (action || '').toLowerCase();
        if (a.includes('unban')) return 'Unban';
        if (a.includes('ban')) return 'Ban';
        if (a.includes('kick')) return 'Kick';
        if (a.includes('unmute')) return 'Unmute';
        if (a.includes('mute')) return 'Mute';
        if (a.includes('warn')) return 'Warn';
        if (a.includes('purge')) return 'Purge';
        return action;
    };

    let output = `**Modlogs for ${username}**\n`;

    for (const log of logs) {
        const tipo = typeLabel(log.action);
        const durata = log.duration ? ` (${log.duration})` : '';
        const timestamp = Math.floor(new Date(log.date).getTime() / 1000);

        output += `\n**Case ${log.caseId}**\n`;
        output += `**Type**: ${tipo}${durata}\n`;
        output += `**Moderator**: ${log.moderatorTag} (${log.moderatorId})\n`;
        output += `**Reason**: ${log.reason} - <t:${timestamp}:f>\n`;
    }

    output += `\nPage ${safePage}/${totalPages} | Total Logs: ${totalLogs} | ${userId}`;

    return output;
}

async function formatGuildModerationHistory(guildId, page = 1) {
    const totalLogs = await db.ModLog.countDocuments({ guildId });

    if (totalLogs === 0) {
        return 'No modlogs recorded for this server.';
    }

    const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const skip = (safePage - 1) * LOGS_PER_PAGE;

    const logs = await db.ModLog
        .find({ guildId })
        .sort({ date: -1 })
        .skip(skip)
        .limit(LOGS_PER_PAGE)
        .lean();

    const typeLabel = (action) => {
        const a = (action || '').toLowerCase();
        if (a.includes('unban')) return 'Unban';
        if (a.includes('ban')) return 'Ban';
        if (a.includes('kick')) return 'Kick';
        if (a.includes('unmute')) return 'Unmute';
        if (a.includes('mute')) return 'Mute';
        if (a.includes('warn')) return 'Warn';
        if (a.includes('purge')) return 'Purge';
        return action;
    };

    let output = `**Server Modlogs**\n`;

    for (const log of logs) {
        const tipo = typeLabel(log.action);
        const durata = log.duration ? ` (${log.duration})` : '';
        const timestamp = Math.floor(new Date(log.date).getTime() / 1000);

        output += `\n**Case ${log.caseId}**\n`;
        output += `**Type**: ${tipo}${durata}\n`;
        output += `**Target**: ${log.targetTag} (${log.targetId})\n`;
        output += `**Moderator**: ${log.moderatorTag} (${log.moderatorId})\n`;
        output += `**Reason**: ${log.reason} - <t:${timestamp}:f>\n`;
    }

    output += `\nPage ${safePage}/${totalPages} | Total Logs: ${totalLogs}`;

    return output;
}

function formatFullDate(date) {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:F>`;
}

function isValidUrl(string) {
    if (!string || typeof string !== 'string') return false;
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function sendJoinLog(member) {
    try {
        const config = await getGuildConfig(member.guild.id);
        const channel = botClients.getLogsClient(client).channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;
        const createdTs = Math.floor(member.user.createdAt.getTime() / 1000);
        const embed = new EmbedBuilder()
            .setTitle('New Member Joined')
            .setColor(0x2ECC71)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'Username', value: member.user.username, inline: true },
                { name: 'Account Created', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: false }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('JOIN_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendLeaveLog(member) {
    try {
        const config = await getGuildConfig(member.guild.id);
        const channel = botClients.getLogsClient(client).channels.cache.get(config.joinLeaveLogChannelId);
        if (!channel) return;

        let banned = false;
        try {
            await botClients.getRolesClient(client).guilds.cache.get(member.guild.id).bans.fetch(member.id);
            banned = true;
        } catch (e) {}

        const createdTs = Math.floor(member.user.createdAt.getTime() / 1000);
        const roles = member.roles?.cache
            ? member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.toString()).join(' ') || 'None'
            : 'None';

        const embed = new EmbedBuilder()
            .setTitle(banned ? 'New Member Left (Banned)' : 'New Member Left')
            .setColor(0xE74C3C)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User', value: member.user.toString(), inline: true },
                { name: 'User ID', value: member.user.id, inline: true },
                { name: 'Username', value: member.user.username, inline: true },
                { name: 'Account Created', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
                { name: 'Member Count', value: `${member.guild.memberCount}`, inline: false },
                { name: 'Users Roles', value: roles, inline: false }
            );
        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        logCrash('LEAVE_LOG_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendWelcomeDM(member) {
    try {
        if (member?.guild?.id && member.guild.id !== process.env.MAIN_GUILD_ID) return;
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('WELCOME TO PRED CORD')
            .setDescription(`Hi ${member.user.toString()}! Welcome to the official Predcord server!`)
            .setColor(COLORS.SUCCESS)
            .setThumbnail(THUMBNAIL_URL)
            .setImage(FOOTER_IMAGE_URL)
            .addFields(
                { name: 'RULES', value: 'Read the rules in the rules channel to avoid sanctions.', inline: false },
                { name: 'TICKETS', value: 'Need help? Open a ticket in the support section.', inline: false },
                { name: 'FOLLOW US ON SOCIAL', value: `${EMOJIS.twitch} [Twitch](${SOCIAL_LINKS.twitch})\n${EMOJIS.youtube} [YouTube](${SOCIAL_LINKS.youtube})\n${EMOJIS.tiktok} [TikTok](${SOCIAL_LINKS.tiktok})\n${EMOJIS.twitter} [Twitter/X](${SOCIAL_LINKS.twitter})\n${EMOJIS.instagram} [Instagram](${SOCIAL_LINKS.instagram})\n${EMOJIS.discord} [Discord Community](${SOCIAL_LINKS.discord})`, inline: false }
            );
        await member.send({ embeds: [welcomeEmbed] }).catch(() => console.log(`DM failed: ${member.user.tag}`));
    } catch (error) {
        logCrash('WELCOME_DM_ERROR', error, { userId: member?.user?.id });
    }
}

async function sendSocialEmbed(channel) {
    try {
        const socialEmbed = new EmbedBuilder()
            .setTitle('FOLLOW US ON SOCIAL')
            .setDescription('Join the community and follow us on all official channels to never miss anything!')
            .setColor(COLORS.INFO)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: `${EMOJIS.twitch} Twitch`, value: `[PredageFN](${SOCIAL_LINKS.twitch})`, inline: true },
                { name: `${EMOJIS.youtube} YouTube`, value: `[PredageFN](${SOCIAL_LINKS.youtube})`, inline: true },
                { name: `${EMOJIS.tiktok} TikTok`, value: `[PredageFN](${SOCIAL_LINKS.tiktok})`, inline: true },
                { name: `${EMOJIS.twitter} Twitter/X`, value: `[Predage1](${SOCIAL_LINKS.twitter})`, inline: true },
                { name: `${EMOJIS.instagram} Instagram`, value: `[PredageFN](${SOCIAL_LINKS.instagram})`, inline: true },
                { name: `${EMOJIS.discord} Discord Community`, value: `[Predage Community](${SOCIAL_LINKS.discord})`, inline: true }
            );
        await channel.send({ embeds: [socialEmbed] });
    } catch (error) {
        logCrash('SOCIAL_EMBED_ERROR', error);
    }
}

async function generateTicketTranscript(channel, closer, ticketMeta = {}) {
    try {
        const MAX_TRANSCRIPT_MESSAGES = 1000;
        const allMessages = [];
        let beforeId = null;
        while (allMessages.length < MAX_TRANSCRIPT_MESSAGES) {
            const batch = await channel.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) });
            if (batch.size === 0) break;
            allMessages.push(...batch.values());
            beforeId = batch.last().id;
            if (batch.size < 100) break;
        }
        const sorted = allMessages.slice(0, MAX_TRANSCRIPT_MESSAGES).reverse();

        const messagesData = sorted.map(msg => ({
            authorId: msg.author.id,
            authorTag: msg.author.tag,
            authorUsername: msg.author.username,
            authorAvatar: msg.author.displayAvatarURL({ dynamic: true, size: 64 }),
            bot: msg.author.bot,
            content: msg.content || '',
            attachments: msg.attachments.map(a => ({
                url: a.url,
                name: a.name,
                contentType: a.contentType
            })),
            embeds: msg.embeds.map(e => ({
                title: e.title || null,
                description: e.description || null,
                color: e.color || null,
                image: e.image?.url || null,
                thumbnail: e.thumbnail?.url || null,
                fields: (e.fields || []).map(f => ({ name: f.name, value: f.value, inline: f.inline }))
            })),
            timestamp: msg.createdAt
        }));

        const transcriptDoc = await db.saveTranscriptDB({
            guildId: channel.guild.id,
            channelId: channel.id,
            channelName: channel.name,
            ticketType: ticketMeta.ticketType || 'support',
            ticketOwnerId: ticketMeta.ticketOwnerId || null,
            ticketOwnerTag: ticketMeta.ticketOwnerTag || null,
            createdBy: ticketMeta.createdBy || null,
            createdByTag: ticketMeta.createdByTag || null,
            claimedBy: ticketMeta.claimedBy || null,
            claimedByTag: ticketMeta.claimedByTag || null,
            closedBy: closer.id,
            closedByTag: closer.tag,
            messages: messagesData,
            createdAt: channel.createdAt || new Date(),
            closedAt: new Date()
        });

        if (!transcriptDoc) {
            console.error('[TRANSCRIPT] Failed to save transcript to DB');
            return null;
        }

        const config = await getGuildConfig(channel.guild.id);
        const logChannelId = config.transcriptsChannelId || config.ticketLogChannelId;
        const logChannel = logChannelId ? botClients.getLogsClient(client).channels.cache.get(logChannelId) : null;

        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Ticket Log')
                .setColor(BLACK)
                .setThumbnail(THUMBNAIL_URL)
                .addFields(
                    { name: 'Created By', value: transcriptDoc.createdBy ? `<@${transcriptDoc.createdBy}>` : 'Unknown', inline: true },
                    { name: 'Claimed By', value: transcriptDoc.claimedBy ? `<@${transcriptDoc.claimedBy}>` : 'Not claimed', inline: true },
                    { name: 'Closed By', value: closer ? `<@${closer.id}>` : 'Unknown', inline: true },
                    { name: 'Ticket', value: `#${channel.name}`, inline: true },
                    { name: 'Date', value: formatFullDate(new Date()), inline: true }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Transcript')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`${process.env.DASHBOARD_URL || 'https://predcord-dashboard.onrender.com'}/dashboard/transcript/${transcriptDoc._id}`)
            );

            await logChannel.send({ embeds: [embed], components: [row] }).catch(err => {
                console.error('[TICKET-LOG] send error:', err.message);
            });
        } else {
            console.warn('[TICKET-LOG] No transcript channel configured for guild', channel.guild.id);
        }

        console.log(`[TRANSCRIPT] Saved transcript ${transcriptDoc._id} for ${channel.name}`);
        return transcriptDoc._id.toString();
    } catch (error) {
        logCrash('TRANSCRIPT_ERROR', error, { channel: channel?.name });
        return null;
    }
}

async function canUsePageCommand(member, guildId) {
    try {
        const mdCmd = await db.CustomCommand.findOne({ guildId, name: 'md' }).lean();
        if (!mdCmd) {
            return (await isAdminSafe(member)) || (await isModeratorSafe(member));
        }
        if (Array.isArray(mdCmd.allowedRoles)) {
            if (mdCmd.allowedRoles.length === 0) return false;
            return mdCmd.allowedRoles.some(roleId => member.roles?.cache?.has(roleId));
        }
        const perm = mdCmd.permission || 'everyone';
        if (perm === 'admin') return await isAdminSafe(member);
        if (perm === 'mod') return await hasModPerms(member);
        if (perm === 'staff') return await isStaffSafe(member);
        return true;
    } catch {
        return (await isAdminSafe(member)) || (await isModeratorSafe(member));
    }
}

async function sendSupportPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('Support Tickets')
        .setDescription(
            'Need help or want to report a player? Our support team is here to assist you. ' +
            'Click one of the buttons below to create a ticket.'
        )
        .setColor('#5865F2');

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('support_ticket')
                .setLabel('Support')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('report_player')
                .setLabel('Report Player')
                .setStyle(ButtonStyle.Primary)
        );

    await channel.send({
        embeds: [embed],
        components: [buttons]
    });
}

const COMMUNITY_TICKET_TYPES = {
    general: { label: 'General Support', description: 'Per domande generiche o problemi con il server', categoryKey: 'generalCategoryId' },
    dropmap: { label: 'Dropmap Request', description: 'Per richiedere una dropmap (una ogni 30 giorni)', categoryKey: 'dropmapCategoryId' },
    unban: { label: 'Unban Request', description: 'Per fare richiesta di sblocco dal ban', categoryKey: 'unbanCategoryId' },
    masterclass: { label: 'Masterclass Support', description: 'Per richiedere un invito al server masterclass', categoryKey: 'masterclassCategoryId' }
};

function ticketTypeFromChannelName(name) {
    if (!name) return 'support';
    if (name.startsWith('report-')) return 'report';
    if (name.startsWith('general-')) return 'general';
    if (name.startsWith('dropmap-')) return 'dropmap';
    if (name.startsWith('unban-')) return 'unban';
    if (name.startsWith('masterclass-')) return 'masterclass';
    return 'support';
}

async function sendCommunityTicketPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('Support Tickets')
        .setDescription(
            'Clicca il pulsante qui sotto per creare un ticket di supporto.\n\n' +
            'Tipi di ticket disponibili:\n' +
            '• General Support - Per domande generiche o problemi con il server\n' +
            '• Dropmap Request - Per richiedere una dropmap (una ogni 30 giorni)\n' +
            '• Unban Request - Per fare richiesta di sblocco dal ban\n' +
            '• Masterclass Support - Per richiedere un invito al server masterclass\n\n' +
            'Nota: Dopo aver cliccato, dovrai selezionare il tipo di ticket e poi potrai aggiungere una descrizione opzionale.'
        )
        .setColor(COLORS.TICKET)
        .setThumbnail(THUMBNAIL_URL);

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('open_community_ticket_modal')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary)
        );

    await channel.send({
        embeds: [embed],
        components: [buttons]
    });
}

client.once('clientReady', async () => {

    console.log(`Bot PredCord connected as ${client.user.tag}`);
    client.user.setPresence({ status: 'dnd' });

    const connected = await db.connectDB();
    if (!connected) {
        console.error('[DB] Cannot connect to MongoDB. Check MONGODB_URI in .env');
        process.exit(1);
    }

    console.log('[DB] Database ready');

    await botClients.startSecondaryBots();

    global.PredCord = {
        client,
        getLogsClient: () => botClients.getLogsClient(client),
        getRolesClient: () => botClients.getRolesClient(client),
        getGuildConfig,
        loadCustomCommands: async (guildId) => await db.loadCustomCommandsDB(guildId),
        saveCustomCommands: async (guildId, name, data) => await db.saveCustomCommandDB(guildId, name, data),
        deleteCustomCommand: async (guildId, name) => await db.deleteCustomCommandDB(guildId, name),
        isAdminSafe,
        isModeratorSafe,
        isStaffSafe,
        hasModPerms,
        COLORS,
        THUMBNAIL_URL,
        EmbedBuilder,
        getUserWarnings,
        addWarning,
        removeWarning,
        clearWarnings,
        saveModLog,
        formatModerationHistory,
        getProjectedRolesDB: async (guildId) => await db.getProjectedRolesDB(guildId),
        saveDashboardLogDB: async (guildId, data) => await db.saveDashboardLogDB(guildId, data),
        getBlacklistTargetGuilds,
        banFromAllGuilds,
        unbanFromAllGuilds,
        roleSync,
        dropmap,
        db
    };
    console.log('[DASHBOARD] global.PredCord API exposed');

    roleSync.start().catch((err) => logCrash('ROLE_SYNC_START', err));
    warmInviteTriggerMembers().catch((err) => logCrash('INVITE_TRIGGER_WARM', err));

    try {
        const communityCommands = [
            new SlashCommandBuilder()
                .setName('panel')
                .setDescription('Send the ticket panel in this channel')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
                .toJSON()
        ];

        const mainCommands = [
            new SlashCommandBuilder()
                .setName('panell')
                .setDescription('Send the ticket panel in this channel')
                .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
                .toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
            console.log('[SLASH] ✅ Global commands cleared');
        } catch (globalErr) {
            console.error('[SLASH] ❌ Global commands clear error', globalErr);
        }

        const perGuildCommands = [
            { gid: process.env.COMMUNITY_GUILD_ID, commands: communityCommands },
            { gid: process.env.MAIN_GUILD_ID, commands: mainCommands }
        ].filter(x => x.gid);

        for (const { gid, commands } of perGuildCommands) {
            try {
                console.log('[SLASH] Registering commands on guild', gid);
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, gid),
                    { body: commands }
                );
                console.log('[SLASH] ✅ Commands registered on guild (immediate):', gid);
            } catch (guildErr) {
                console.error('[SLASH] ❌ Registration error on guild', gid, guildErr);
            }
        }

        if (perGuildCommands.length === 0) {
            console.log('[SLASH] No guild IDs configured, skipping command registration.');
        }
    } catch (err) {
        console.error('[SLASH] ❌ Registration error:', err);
    }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
    try {
        roleSync.onMemberUpdate(oldMember, newMember);
    } catch (error) {
        logCrash('ROLE_SYNC_MEMBER_UPDATE', error, { userId: newMember?.id });
    }
    handleInviteTriggerRoles(oldMember, newMember).catch((error) => {
        logCrash('INVITE_TRIGGER', error, { userId: newMember?.id });
    });
});

const INVITE_TRIGGER_MAX_AGE_SECONDS = 24 * 60 * 60;
const inviteTriggerInFlight = new Set();

function findInviteChannel(guild) {
    const me = guild.members.me;
    if (!me) return null;
    const canInvite = (ch) => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)
        && ch.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite);
    if (canInvite(guild.rulesChannel)) return guild.rulesChannel;
    if (canInvite(guild.systemChannel)) return guild.systemChannel;
    return guild.channels.cache
        .filter(canInvite)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .first() || null;
}

async function handleInviteTriggerRoles(oldMember, newMember) {
    if (!newMember || !newMember.guild || newMember.user?.bot) return;
    const config = await getGuildConfig(newMember.guild.id);
    const triggers = [config.inviteTriggerRoleId1, config.inviteTriggerRoleId2].filter(Boolean);
    if (!triggers.length || !config.targetInviteGuildId) return;
    if (config.targetInviteGuildId === newMember.guild.id) return;

    const oldKnown = oldMember && !oldMember.partial && oldMember.roles && oldMember.roles.cache;
    const gained = triggers.find(roleId => newMember.roles.cache.has(roleId) && (!oldKnown || !oldMember.roles.cache.has(roleId)));
    if (!gained) return;

    await sendTriggerInvite(newMember, gained, config);
}

async function sendTriggerInvite(member, triggerRoleId, config) {
    const key = `${member.guild.id}:${member.id}`;
    if (inviteTriggerInFlight.has(key)) return;
    inviteTriggerInFlight.add(key);
    try {
        const targetGuild = client.guilds.cache.get(config.targetInviteGuildId);
        if (!targetGuild) {
            logCrash('INVITE_TRIGGER', new Error('Target server not found or bot not in it'), { targetGuildId: config.targetInviteGuildId });
            return;
        }

        const alreadyIn = await targetGuild.members.fetch(member.id).catch(() => null);
        if (alreadyIn) return;

        const previous = await db.getInviteTrackingDB(member.guild.id, member.id);
        if (previous && previous.date && Date.now() - new Date(previous.date).getTime() < INVITE_TRIGGER_MAX_AGE_SECONDS * 1000) return;

        const channel = findInviteChannel(targetGuild);
        if (!channel) {
            logCrash('INVITE_TRIGGER', new Error('No channel where the bot can create invites'), { targetGuildId: targetGuild.id });
            return;
        }

        const role = member.guild.roles.cache.get(triggerRoleId);
        const roleName = role ? role.name : 'Role';
        const invite = await channel.createInvite({
            maxAge: INVITE_TRIGGER_MAX_AGE_SECONDS,
            maxUses: 1,
            unique: true,
            reason: `Personal invite for ${member.user.tag} (${roleName})`
        });
        const expiresAt = Math.floor(Date.now() / 1000) + INVITE_TRIGGER_MAX_AGE_SECONDS;

        const embed = new EmbedBuilder()
            .setTitle('Your Exclusive Invite')
            .setDescription(`You received the **${roleName}** role in **${member.guild.name}**.\nHere is your personal invite to **${targetGuild.name}**:`)
            .addFields(
                { name: 'Invite', value: invite.url, inline: false },
                { name: 'Expires', value: `<t:${expiresAt}:R>`, inline: true },
                { name: 'Uses', value: '1 (single use)', inline: true },
                { name: 'Important', value: 'This invite is personal and works only once. Do not share it with anyone.', inline: false }
            )
            .setColor(BLACK)
            .setThumbnail(THUMBNAIL_URL);

        const dmSent = await member.send({ embeds: [embed] }).then(() => true).catch(() => false);
        if (!dmSent) await invite.delete('Could not DM the user').catch(() => {});

        if (dmSent) {
            await db.addInviteTrackingDB({
                guildId: member.guild.id,
                userId: member.id,
                userTag: member.user.tag,
                inviteCode: invite.code,
                triggerRoleId,
                used: true,
                date: new Date()
            });
        }

        if (config.inviteLogChannelId) {
            const logChannel = botClients.getLogsClient(client).channels.cache.get(config.inviteLogChannelId)
                || client.channels.cache.get(config.inviteLogChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle(dmSent ? 'Invite Sent' : 'Invite Not Sent')
                    .setDescription(dmSent ? `A personal invite was sent to <@${member.id}>.` : `<@${member.id}> has DMs closed, the invite was deleted.`)
                    .addFields(
                        { name: 'User', value: `<@${member.id}>`, inline: true },
                        { name: 'Role', value: `<@&${triggerRoleId}>`, inline: true },
                        { name: 'Target server', value: targetGuild.name, inline: true },
                        { name: 'Expires', value: dmSent ? `<t:${expiresAt}:R>` : '-', inline: true }
                    )
                    .setColor(BLACK)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }
    } finally {
        inviteTriggerInFlight.delete(key);
    }
}

async function warmInviteTriggerMembers() {
    for (const guild of client.guilds.cache.values()) {
        try {
            const config = await getGuildConfig(guild.id);
            if (!config.targetInviteGuildId || (!config.inviteTriggerRoleId1 && !config.inviteTriggerRoleId2)) continue;
            await guild.members.fetch();
        } catch (error) {
            logCrash('INVITE_TRIGGER_WARM', error, { guildId: guild.id });
        }
    }
}

client.on('guildMemberAdd', async (member) => {
    try {
        roleSync.onMemberAdd(member);
    } catch (error) {
        logCrash('ROLE_SYNC_MEMBER_ADD', error, { userId: member?.id });
    }

    try {
        await sendJoinLog(member);
    } catch (error) {
        logCrash('GUILD_MEMBER_ADD', error, { userId: member?.user?.id });
    }

    try {
        const config = await getGuildConfig(member.guild.id);
        if (config.autoroleId) {
            const rolesClient = botClients.getRolesClient(client);
            const rolesGuild = rolesClient.guilds.cache.get(member.guild.id);
            const rolesMember = rolesGuild ? await rolesGuild.members.fetch(member.id).catch(() => null) : null;
            const targetMember = rolesMember || member;
            if (!targetMember.roles.cache.has(config.autoroleId)) {
                await targetMember.roles.add(config.autoroleId).catch((err) => {
                    logCrash('AUTOROLE_ASSIGN', err, { guildId: member.guild.id, userId: member.id, roleId: config.autoroleId });
                });
            }
        }
    } catch (error) {
        logCrash('AUTOROLE', error, { userId: member?.user?.id });
    }
});

client.on('guildMemberRemove', async (member) => {
    try {
        roleSync.onMemberRemove(member);
    } catch (error) {
        logCrash('ROLE_SYNC_MEMBER_REMOVE', error, { userId: member?.id });
    }

    try {
        await sendLeaveLog(member);
    } catch (error) {
        logCrash('GUILD_MEMBER_REMOVE', error, { userId: member?.user?.id });
    }
});

client.on('channelDelete', (channel) => {
    ticketClaims.delete(channel.id);
});

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content) return;

        const firstChar = message.content.charAt(0);

        if (/^[a-zA-Z0-9]/.test(firstChar)) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const customCmds = await db.loadCustomCommandsDB(message.guild.id);

        if (customCmds && customCmds[command]) {
            const cmdData = customCmds[command];
            const cmdPrefix = cmdData.prefix || '*';

            if (cmdPrefix === firstChar) {
                if (cmdData.enabled === false) return;
                if (isCommandBlockedInChannel(cmdData, message.channel)) return;
                const hasPermission = checkCustomCommandPermission(cmdData, message.member);
                if (hasPermission) {
                    const cooldown = await db.getCommandCooldownDB(message.author.id, message.guild.id, `custom_${command}`);
                    if (cooldown) {
                        const remaining = Math.ceil((new Date(cooldown.expiresAt).getTime() - Date.now()) / 1000);
                        const embed = new EmbedBuilder()
                            .setDescription(`Wait **${remaining}s** before using this command again.`)
                            .setColor(COLORS.WARNING);
                        const msg = await message.channel.send({ embeds: [embed] });
                        setTimeout(() => msg.delete().catch(() => {}), 3000);
                        await message.delete().catch(() => {});
                        return;
                    }
                    await db.setCommandCooldownDB(message.author.id, message.guild.id, `custom_${command}`, COMMAND_COOLDOWN_SECONDS);

                    await db.saveDashboardLogDB(message.guild.id, {
                        type: 'command',
                        action: 'custom_command_used',
                        userId: message.author.id,
                        userTag: message.author.tag,
                        details: `Command: ${cmdPrefix}${command}`,
                        channelId: message.channel.id
                    });

                    await handleCustomCommand(message, command, args, cmdData);
                    return;
                } else {
                    return;
                }
            }
        }

        if (firstChar === NATIVE_PREFIX || firstChar === '!') {
            const cooldown = await db.getCommandCooldownDB(message.author.id, message.guild.id, `native_${command}`);
            if (cooldown) {
                const remaining = Math.ceil((new Date(cooldown.expiresAt).getTime() - Date.now()) / 1000);
                const embed = new EmbedBuilder()
                    .setDescription(`Wait **${remaining}s** before using this command again.`)
                    .setColor(COLORS.WARNING);
                const msg = await message.channel.send({ embeds: [embed] });
                setTimeout(() => msg.delete().catch(() => {}), 3000);
                await message.delete().catch(() => {});
                return;
            }
            await db.setCommandCooldownDB(message.author.id, message.guild.id, `native_${command}`, COMMAND_COOLDOWN_SECONDS);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'command',
                action: 'native_command_used',
                userId: message.author.id,
                userTag: message.author.tag,
                details: `Command: ${firstChar}${command}`,
                channelId: message.channel.id
            });

            await handleNativeCommand(message, command, args);
            return;
        }

        if (firstChar === '-') {
            if (!(await isAdminSafe(message.member))) { await message.delete().catch(() => {}); return; }

            if (command === 'blacklist') {
                const input = args[0];
                if (!input || args.length < 2) {
                    const embed = new EmbedBuilder().setDescription('Usage: `-blacklist <@user/ID> <reason>` — the reason is mandatory.').setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                let userId;
                const mentionMatch = input.match(/^<@!?(\d+)>$/);
                if (mentionMatch) {
                    userId = mentionMatch[1];
                } else if (/^\d+$/.test(input)) {
                    userId = input;
                } else {
                    const embed = new EmbedBuilder().setDescription('Invalid user ID.').setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                if (userId === message.author.id) {
                    const embed = new EmbedBuilder().setDescription('You can\'t blacklist yourself.').setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                let user;
                try {
                    user = await client.users.fetch(userId);
                } catch {
                    const embed = new EmbedBuilder().setDescription(`I can't blacklist **${userId}** - this is not a valid user ID.`).setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                const existing = await db.getBlacklistEntryDB(user.id);
                if (existing) {
                    const embed = new EmbedBuilder().setDescription(`**${existing.userTag || user.tag}** is already blacklisted. Use \`-bll ${user.id}\` for more information.`).setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                const reason = args.slice(1).join(' ');

                try {
                    const banResult = await banFromAllGuilds(message.guild, user.id, reason);

                    if (banResult.bannedGuildIds.length === 0) {
                        const embed = new EmbedBuilder()
                            .setDescription(`I can't blacklist **${user.tag}** - no servers available to ban in.\n\n**Errors:**\n${banResult.errors.map(e => `• ${e}`).join('\n')}`)
                            .setColor(COLORS.ERROR);
                        await message.channel.send({ embeds: [embed] });
                        await message.delete().catch(() => {});
                        return;
                    }

                    await db.addBlacklistEntryDB({
                        userId: user.id,
                        userTag: user.tag,
                        reason,
                        modId: message.author.id,
                        modTag: message.author.tag,
                        date: new Date(),
                        servers: banResult.bannedGuildIds,
                        lastErrors: banResult.errors
                    });

                    await saveModLog(message.guild, 'BLACKLIST', { id: user.id, tag: user.tag }, message.author, reason);
                    await db.saveDashboardLogDB(message.guild.id, {
                        type: 'moderation',
                        action: 'user_blacklisted',
                        userId: message.author.id,
                        userTag: message.author.tag,
                        targetId: user.id,
                        targetTag: user.tag,
                        moderatorId: message.author.id,
                        moderatorTag: message.author.tag,
                        reason: reason,
                        channelId: message.channel.id
                    });

                    let description = `**${user.tag || user.username}** (${user.id}) has been blacklisted for the reason **${reason}**`;
                    if (banResult.bannedGuildIds.length > 1) description += `\n\nBanned in ${banResult.bannedGuildIds.length} servers.`;
                    if (banResult.errors.length > 0) description += `\n\n**Errors:**\n${banResult.errors.map(e => `• ${e}`).join('\n')}`;

                    const embed = new EmbedBuilder().setDescription(description).setColor(BLACK);
                    await message.channel.send({ embeds: [embed] });
                } catch (error) {
                    const embed = new EmbedBuilder().setDescription('Error during blacklist: ' + error.message).setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (command === 'unbl' || command === 'unblacklist') {
                const input = args[0];
                if (!input) {
                    const embed = new EmbedBuilder().setDescription('Usage: `-unbl <@user/ID>`').setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                let userId;
                const mentionMatch = input.match(/^<@!?(\d+)>$/);
                if (mentionMatch) {
                    userId = mentionMatch[1];
                } else if (/^\d+$/.test(input)) {
                    userId = input;
                } else {
                    const embed = new EmbedBuilder().setDescription('Invalid user ID.').setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                const entry = await db.getBlacklistEntryDB(userId);
                if (!entry) {
                    const embed = new EmbedBuilder().setDescription(`**${userId}** is not blacklisted.`).setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }

                try {
                    const unbanResult = await unbanFromAllGuilds(message.guild, userId, entry.servers);
                    await db.removeBlacklistEntryDB(userId);

                    const targetTag = entry.userTag || `Unknown User (${userId})`;
                    await saveModLog(message.guild, 'UNBLACKLIST', { id: userId, tag: targetTag }, message.author, 'Removed from blacklist');
                    await db.saveDashboardLogDB(message.guild.id, {
                        type: 'moderation',
                        action: 'user_unblacklisted',
                        userId: message.author.id,
                        userTag: message.author.tag,
                        targetId: userId,
                        targetTag: targetTag,
                        moderatorId: message.author.id,
                        moderatorTag: message.author.tag,
                        reason: 'Removed from blacklist',
                        channelId: message.channel.id
                    });

                    const unbannedCount = unbanResult.results.filter(r => r.includes('unbanned')).length;
                    let description = `**${targetTag}** has been removed from the blacklist${unbannedCount > 0 ? ` and unbanned in ${unbannedCount} server(s)` : ''}.`;
                    if (unbanResult.errors.length > 0) description += `\n\n**Errors:**\n${unbanResult.errors.map(e => `• ${e}`).join('\n')}`;

                    const embed = new EmbedBuilder().setDescription(description).setColor(BLACK);
                    await message.channel.send({ embeds: [embed] });
                } catch (error) {
                    const embed = new EmbedBuilder().setDescription('Error during unblacklist: ' + error.message).setColor(COLORS.ERROR);
                    await message.channel.send({ embeds: [embed] });
                }
                await message.delete().catch(() => {});
                return;
            }

            if (command === 'bll') {
                const input = args[0];
                if (input) {
                    const userId = input.replace(/[<@!>]/g, '');
                    if (/^\d+$/.test(userId)) {
                        const entry = await db.getBlacklistEntryDB(userId);
                        if (!entry) {
                            const embed = new EmbedBuilder().setDescription('User not blacklisted.').setColor(COLORS.ERROR);
                            await message.channel.send({ embeds: [embed] });
                            await message.delete().catch(() => {});
                            return;
                        }
                        const embed = new EmbedBuilder()
                            .setTitle('Blacklist Log')
                            .setDescription(`**User**: ${entry.userTag || entry.userId} (${entry.userId})\n**Reason**: ${entry.reason || 'No reason provided'}\n**Blacklisted By**: ${entry.modTag || entry.modId || 'Unknown'}\n**Date**: ${formatFullDate(new Date(entry.date))}\n**Servers**: ${entry.servers?.length || 0}`)
                            .setColor(COLORS.INFO);
                        await message.channel.send({ embeds: [embed] });
                        await message.delete().catch(() => {});
                        return;
                    }
                }

                const entries = await db.getAllBlacklistDB();
                if (!entries.length) {
                    const embed = new EmbedBuilder().setDescription('The blacklist is empty.').setColor(COLORS.INFO);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                const lines = entries.slice(0, 25).map(e => `**${e.userTag || e.userId}** (${e.userId}) — ${e.reason || 'No reason provided'} — by ${e.modTag || e.modId || 'Unknown'}`);
                const embed = new EmbedBuilder()
                    .setTitle(`Blacklist (${entries.length})`)
                    .setDescription(lines.join('\n'))
                    .setColor(COLORS.INFO);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }

            await message.delete().catch(() => {});
            return;
        }

    } catch (error) {
        logCrash('MESSAGE_CREATE_HANDLER', error, { content: message?.content?.slice(0, 50) });
    }
});

async function handleNativeCommand(message, command, args) {
    if (command === 'map') {
        await dropmap.handleMapCommand(message);
        return;
    }

    if (command === 'setupdropmap') {
        await dropmap.handleSetupCommand(message, args);
        return;
    }

    if (command === 'page') {
        const canUse = await canUsePageCommand(message.member, message.guild.id);
        if (!canUse) { await message.delete().catch(() => {}); return; }

        const input = args[0];
        const pageArg = parseInt(args[1]);

        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*page {userid} {page}`').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (isNaN(pageArg) || pageArg < 1) {
            const embed = new EmbedBuilder().setDescription('Specify a valid page number (>= 1).').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let userId = null;
        const mentionMatch = input.match(/^<@!?(\d+)>$/);
        if (mentionMatch) userId = mentionMatch[1];
        else if (/^\d+$/.test(input)) userId = input;

        if (!userId) {
            const embed = new EmbedBuilder().setDescription('Invalid user ID. Use a mention or an ID.').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let username = `Unknown (${userId})`;
        try {
            const user = await client.users.fetch(userId);
            username = user.username;
        } catch {}

        const totalLogs = await db.ModLog.countDocuments({ guildId: message.guild.id, targetId: userId });
        if (totalLogs === 0) {
            const embed = new EmbedBuilder().setDescription(`**${username}** has no modlogs.`).setColor(COLORS.INFO);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        const totalPages = Math.max(1, Math.ceil(totalLogs / LOGS_PER_PAGE));
        if (pageArg > totalPages) {
            const embed = new EmbedBuilder().setDescription(`Invalid page. This user only has ${totalPages} pages.`).setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        const text = await formatModerationHistory(userId, message.guild.id, username, pageArg);
        const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'md') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }

        const input = args[0];
        const pageArg = args[1] ? parseInt(args[1]) : 1;

        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*md @user/ID [page]`').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        if (isNaN(pageArg) || pageArg < 1) {
            const embed = new EmbedBuilder().setDescription('Specify a valid page number (>= 1).').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let userId = null;
        const mentionMatch = input.match(/^<@!?(\d+)>$/);
        if (mentionMatch) userId = mentionMatch[1];
        else if (/^\d+$/.test(input)) userId = input;

        if (!userId) {
            const embed = new EmbedBuilder().setDescription('Invalid user ID. Use a mention or an ID.').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        let username = `Unknown (${userId})`;
        try {
            const user = await client.users.fetch(userId);
            username = user.username;
        } catch {}

        const text = await formatModerationHistory(userId, message.guild.id, username, pageArg);
        const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'modlogs') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }

        const pageArg = args[0] ? parseInt(args[0]) : 1;
        if (isNaN(pageArg) || pageArg < 1) {
            const embed = new EmbedBuilder().setDescription('Specify a valid page number (>= 1).').setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }

        const text = await formatGuildModerationHistory(message.guild.id, pageArg);
        const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'help') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle('PredCord Commands')
            .setDescription('Commands available based on your role:')
            .setColor(COLORS.INFO)
            .setThumbnail(THUMBNAIL_URL)
            .addFields(
                { name: 'Admin Only', value: '`/panel` - Send ticket panel', inline: false },
                { name: 'Mod & Admin', value: '`*av [user]` - Show avatar\n`*w [user]` - User info\n`*server` - Server info\n`*social` - Social links\n`*page {userid} {page}` - Paginate modlogs\n`*help` - This message', inline: false },
                { name: 'Warnings (Mod+)', value: '`*warnings @user/ID`\n`*clearwarns @user/ID`\n`*warn @user/ID [reason]`', inline: false },
                { name: 'Bans (Mod+)', value: '`*ban @user/ID [reason]`\n`*unban ID`\n`*kick @user/ID [reason]`\n`*mute @user/ID [minutes] [reason]`\n`*unmute @user/ID`', inline: false },
                { name: 'Modlogs (Staff+)', value: '`*md @user/ID [page]` - User modlogs\n`*modlogs [page]` - Server modlogs', inline: false }
            );
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'av') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        const user = message.mentions.users.first() || message.author;
        const embed = new EmbedBuilder()
            .setTitle(`${user.tag}'s Avatar`)
            .setImage(user.displayAvatarURL({ dynamic: true, size: 4096 }))
            .setColor(COLORS.INFO)
            .setThumbnail(THUMBNAIL_URL);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'w') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        let targetUser = message.mentions.users.first();
        const userId = args[0];
        if (!targetUser && userId && /^\d+$/.test(userId)) {
            try {
                const fetched = await message.guild.members.fetch(userId);
                targetUser = fetched.user;
            } catch { targetUser = null; }
        }
        const user = targetUser || message.author;
        let member = message.guild.members.cache.get(user.id);
        if (!member) member = await message.guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            const embed = new EmbedBuilder().setDescription('User not found on this server.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const roles = member.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'No roles';
        const embed = new EmbedBuilder()
            .setTitle(`Information about ${user.tag}`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setColor(COLORS.INFO)
            .addFields(
                { name: 'Member since', value: formatFullDate(member.joinedAt), inline: true },
                { name: 'Account created', value: formatFullDate(user.createdAt), inline: true },
                { name: 'ID', value: user.id, inline: true },
                { name: 'Roles', value: roles.substring(0, 1024), inline: false }
            );
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'server') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        const guild = message.guild;
        const embed = new EmbedBuilder()
            .setTitle(`Information about ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 1024 }))
            .setColor(COLORS.INFO)
            .addFields(
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Created on', value: formatFullDate(guild.createdAt), inline: true },
                { name: 'ID', value: guild.id, inline: true }
            );
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'social') {
        if (!(await canUseBaseCommands(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        await sendSocialEmbed(message.channel);
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'warnings') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const userWarnings = await getUserWarnings(user.id, message.guild.id);
        if (userWarnings.length === 0) {
            const embed = new EmbedBuilder().setDescription(`${user.toString()} has no warnings.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        } else {
            let warningsList = '';
            for (const warn of userWarnings) {
                const ts = Math.floor(new Date(warn.date).getTime() / 1000);
                warningsList += `**#${warn.warningId}** - ${warn.reason}\n*By ${warn.moderatorTag} - <t:${ts}:R>*\n\n`;
            }
            const embed = new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setDescription(warningsList).setColor(COLORS.WARNING).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'clearwarns') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        await clearWarnings(message.guild, user, message.author);
        const embed = new EmbedBuilder().setDescription(`All warnings cleared for ${user.toString()}`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'tickets') {
        if (!(await hasStaffPermission(message.member))) return;
        const embed = new EmbedBuilder().setTitle('Ticket Statistics').setDescription('Check the dashboard\'s Statistics tab for live ticket, join/leave and moderator stats.').setColor(COLORS.INFO).setThumbnail(THUMBNAIL_URL);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'ban') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        const reason = args.slice(1).join(' ') || 'No reason provided';

        try {
            if (member) {
                if (!member.bannable) {
                    const embed = new EmbedBuilder().setDescription('I cant moderate this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                await member.ban({ reason });
            } else {
                await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                await message.guild.bans.create(user.id, { reason });
            }

            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been banned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User banned', { id: user.id, tag: user.tag }, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_banned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during ban: ' + error.message).setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'unban') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const userId = args[0];
        if (!userId) {
            const embed = new EmbedBuilder().setDescription('You need to specify the user ID to unban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            const bans = await message.guild.bans.fetch();
            const bannedUser = bans.find(ban => ban.user.id === userId);
            if (!bannedUser) {
                const embed = new EmbedBuilder().setDescription('This user is not banned.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            await message.guild.members.unban(userId);
            await db.removePendingBan(message.guild.id, userId);
            await sendUnbanDM(bannedUser.user, message.guild);
            const embed = new EmbedBuilder()
                .setDescription(`**${bannedUser.user.username}** (${bannedUser.user.id}) has been unbanned for the reason **Unbanned**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User unbanned', { id: userId, tag: bannedUser.user.tag }, message.author, 'Unbanned');

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_unbanned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: userId,
                targetTag: bannedUser.user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: 'Unbanned',
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during unban.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'kick') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!member || !member.kickable) {
            const embed = new EmbedBuilder().setDescription('I cannot kick this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await sendActionDM(user, 'kicked', reason, { tag: message.author.tag, guild: message.guild });
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been kicked for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User kicked', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_kicked',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during kick.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'mute') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        const parsed = extractMuteDuration(args);
        if (!parsed.duration) {
            const embed = new EmbedBuilder().setDescription('Usage: `*mute @user reason duration`\n`10` = 10 minutes, `10h` = 10 hours, `10d` = 10 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        if (parsed.duration.invalid) {
            const embed = new EmbedBuilder().setDescription('The duration must be between 1 minute and 28 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const duration = parsed.duration;
        const reason = parsed.rest.join(' ') || 'No reason provided';
        if (!member || !member.moderatable) {
            const embed = new EmbedBuilder().setDescription('I cannot mute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await member.timeout(duration.ms, reason);
            const durationText = duration.text;
            await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, durationText);
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been muted for **${durationText}** for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User muted', user, message.author, reason, durationText);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_muted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: durationText,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during mute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'unmute') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('You need to mention a user or provide an ID.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!member || !member.moderatable) {
            const embed = new EmbedBuilder().setDescription('I cannot unmute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await member.timeout(null, reason);
            await sendActionDM(user, 'unmuted', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been unmuted for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User unmuted', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_unmuted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during unmute.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'warn') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*warn @user/ID reason`').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            await addWarning(message.guild, user, message.author, reason);
            await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been warned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User warned', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_warned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during warn.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
        }
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'purge') {
        if (!(await isStaffSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount < 1 || amount > 100) {
            const embed = new EmbedBuilder().setDescription('You need to specify a number between 1 and 100.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await message.delete().catch(() => {});
            const messages = await message.channel.messages.fetch({ limit: amount });
            const filtered = messages.filter(msg => Date.now() - msg.createdTimestamp < 1209600000);
            const deleted = await message.channel.bulkDelete(filtered, true);
            const embed = new EmbedBuilder().setTitle('Messages purged').setDescription(`Deleted ${deleted.size} messages.`).setColor(COLORS.SUCCESS).setThumbnail(THUMBNAIL_URL);
            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(() => {}), 3000);
            await saveModLog(message.guild, 'Messages purged', { id: 'channel', tag: `#${message.channel.name}` }, message.author, `${deleted.size} messages deleted`);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'messages_purged',
                userId: message.author.id,
                userTag: message.author.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: `${deleted.size} messages deleted`,
                channelId: message.channel.id
            });
        } catch (error) {
            const embed = new EmbedBuilder().setDescription('Error during purge. Cannot delete messages older than 14 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            const errorMsg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        }
        return;
    }

    if (command === 'serverinfo') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const guild = message.guild;
        const owner = await guild.fetchOwner().catch(() => null);
        const embed = new EmbedBuilder()
            .setTitle(guild.name)
            .setThumbnail(guild.iconURL({ size: 256 }) || null)
            .addFields(
                { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Boost tier', value: `${guild.premiumTier}`, inline: true }
            )
            .setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'roleinfo') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        const roleMatch = input ? input.match(/^<@&(\d+)>$/) : null;
        const roleId = roleMatch ? roleMatch[1] : input;
        const role = roleId ? message.guild.roles.cache.get(roleId) : null;
        if (!role) {
            const embed = new EmbedBuilder().setDescription('Usage: `*roleinfo @role`').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle(role.name)
            .addFields(
                { name: 'ID', value: role.id, inline: true },
                { name: 'Color', value: role.hexColor, inline: true },
                { name: 'Position', value: `${role.position}`, inline: true },
                { name: 'Members', value: `${role.members.size}`, inline: true },
                { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
                { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
                { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setColor(role.color || COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'channelinfo') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const mentioned = message.mentions.channels.first();
        const channel = mentioned || message.channel;
        const embed = new EmbedBuilder()
            .setTitle(`#${channel.name}`)
            .addFields(
                { name: 'ID', value: channel.id, inline: true },
                { name: 'Type', value: `${channel.type}`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setColor(COLORS.INFO);
        if ('nsfw' in channel) embed.addFields({ name: 'NSFW', value: channel.nsfw ? 'Yes' : 'No', inline: true });
        if ('rateLimitPerUser' in channel) embed.addFields({ name: 'Slowmode', value: `${channel.rateLimitPerUser || 0}s`, inline: true });
        if ('bitrate' in channel) embed.addFields({ name: 'Bitrate', value: `${channel.bitrate || 0}`, inline: true });
        if ('userLimit' in channel) embed.addFields({ name: 'User limit', value: `${channel.userLimit || 0}`, inline: true });
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'block') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*block @user/ID reason`').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const reason = args.slice(1).join(' ') || 'No reason provided';
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.addTicketBlockDB({
            guildId: message.guild.id,
            userId: result.user.id,
            userTag: result.user.tag,
            moderatorId: message.author.id,
            moderatorTag: message.author.tag,
            reason,
            blockedAt: new Date(),
            expiresAt
        });
        await saveModLog(message.guild, 'Ticket block', result.user, message.author, reason);
        await result.user.send({ embeds: [new EmbedBuilder().setDescription(`You have been blocked from creating tickets in **${message.guild.name}** for the reason: **${reason}**`).setColor(COLORS.MODERATION)] }).catch(() => {});
        const embed = new EmbedBuilder().setDescription(`**${result.user.tag}** has been blocked from creating tickets for 7 days.`).setColor(COLORS.SUCCESS);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'unblock') {
        if (!(await hasModPerms(message.member))) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription('Usage: `*unblock @user/ID`').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const removed = await db.removeTicketBlockDB(message.guild.id, result.user.id);
        if (!removed) {
            const embed = new EmbedBuilder().setDescription(`**${result.user.tag}** is not blocked.`).setColor(COLORS.ERROR);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        await saveModLog(message.guild, 'Ticket unblock', result.user, message.author, 'Unblocked');
        await result.user.send({ embeds: [new EmbedBuilder().setDescription(`You can create tickets again in **${message.guild.name}**.`).setColor(COLORS.SUCCESS)] }).catch(() => {});
        const embed = new EmbedBuilder().setDescription(`**${result.user.tag}** has been unblocked.`).setColor(COLORS.SUCCESS);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'tempo') {
        if (!(await hasModPerms(message.member)) && args[0]) { await message.delete().catch(() => {}); return; }
        const input = args[0];
        const result = input ? await getUserFromInput(message.guild, input) : { user: message.author };
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const roles = (await db.getTempRolesByGuildDB(message.guild.id)).filter(r => r.userId === result.user.id);
        if (roles.length === 0) {
            const embed = new EmbedBuilder().setDescription(`**${result.user.tag}** has no active temporary roles.`).setColor(COLORS.INFO);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const lines = roles.map(r => `<@&${r.roleId}> — expires <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:R> — assigned by ${r.assignedByTag || r.assignedBy || 'Unknown'}${r.reason ? ` (${r.reason})` : ''}`);
        const embed = new EmbedBuilder().setTitle(`Temporary roles for ${result.user.tag}`).setDescription(lines.join('\n')).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }

    if (command === 'tempolist') {
        if (!(await isAdminSafe(message.member))) { await message.delete().catch(() => {}); return; }
        const roles = (await db.getTempRolesByGuildDB(message.guild.id)).sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
        if (roles.length === 0) {
            const embed = new EmbedBuilder().setDescription('No active temporary roles in this server.').setColor(COLORS.INFO);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const lines = roles.slice(0, 30).map(r => `<@${r.userId}> — <@&${r.roleId}> — expires <t:${Math.floor(new Date(r.expiresAt).getTime() / 1000)}:R>`);
        const embed = new EmbedBuilder().setTitle('Active temporary roles').setDescription(lines.join('\n')).setColor(COLORS.INFO);
        await message.channel.send({ embeds: [embed] });
        await message.delete().catch(() => {});
        return;
    }
}

async function checkExpiredTempRolesAllGuilds() {
    try {
        const expired = await db.getExpiredTempRolesDB();
        const rolesClient = botClients.getRolesClient(client);
        for (const entry of expired) {
            let shouldRemoveRecord = false;
            try {
                const guild = rolesClient.guilds.cache.get(entry.guildId);
                if (!guild) {
                    shouldRemoveRecord = true;
                } else {
                    const member = await guild.members.fetch(entry.userId).catch(() => null);
                    if (!member) {
                        shouldRemoveRecord = true;
                    } else if (!member.roles.cache.has(entry.roleId)) {
                        shouldRemoveRecord = true;
                    } else {
                        await member.roles.remove(entry.roleId);
                        shouldRemoveRecord = true;
                    }
                }
            } catch (err) {
                logCrash('TEMP_ROLE_EXPIRY', err, { guildId: entry.guildId, userId: entry.userId });
                shouldRemoveRecord = false;
            }
            if (shouldRemoveRecord) {
                await db.removeTempRoleDB(entry.guildId, entry.userId, entry.roleId);
            }
        }
    } catch (err) {
        logCrash('TEMP_ROLE_EXPIRY_SWEEP', err, {});
    }
}

setInterval(checkExpiredTempRolesAllGuilds, 3600000);

async function handleRoleCommand(message, command, args, cmdData) {
    const prefix = cmdData.prefix || '*';
    const finish = async () => {
        if (cmdData.deleteCommand !== false) await message.delete().catch(() => {});
    };
    const fail = async (text) => {
        const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
        await message.channel.send({ embeds: [embed] });
        await finish();
    };

    const input = args[0];
    if (!input) return fail(`Usage: \`${prefix}${command} @user\``);

    const result = await getUserFromInput(message.guild, input);
    if (!result || !result.user) return fail('User not found.');
    const user = result.user;
    const member = result.member;
    if (!member) return fail('This user is not in the server.');
    if (await projectedRoleBlock(message, member)) return;

    const roleId = cmdData.targetRoleId;
    const role = roleId ? (message.guild.roles.cache.get(roleId) || await message.guild.roles.fetch(roleId).catch(() => null)) : null;
    if (!role) return fail('The target role no longer exists.');
    if (!role.editable) return fail('I cannot manage this role.');

    const action = cmdData.roleAction;
    const has = member.roles.cache.has(role.id);
    const warnVariant = action === 'remove_warn' || action === 'remove_mute';

    let reason = null;
    if (warnVariant) {
        reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason.replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);
    }

    const done = async (text, logAction, extra = null) => {
        const embed = new EmbedBuilder().setDescription(text).setColor(BLACK);
        await message.channel.send({ embeds: [embed] });
        await db.saveDashboardLogDB(message.guild.id, {
            type: 'moderation',
            action: logAction,
            userId: message.author.id,
            userTag: message.author.tag,
            targetId: user.id,
            targetTag: user.tag,
            moderatorId: message.author.id,
            moderatorTag: message.author.tag,
            reason: reason || undefined,
            details: `Custom command: ${prefix}${command} (${role.name})${extra ? ` ${extra}` : ''}`,
            channelId: message.channel.id
        }).catch(() => {});
        await finish();
    };

    const label = `**${user.username}** (${user.id})`;

    try {
        if (action === 'add') {
            if (has) return fail(`${label} already has **${role.name}**.`);
            await member.roles.add(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            return done(`Added **${role.name}** to ${label}`, 'role_added');
        }

        if (action === 'remove') {
            if (!has) return fail(`${label} does not have **${role.name}**.`);
            await member.roles.remove(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            await db.removePendingRoleRemoval(message.guild.id, user.id, role.id).catch(() => {});
            return done(`Removed **${role.name}** from ${label}`, 'role_removed');
        }

        if (action === 'toggle') {
            if (has) {
                await member.roles.remove(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
                await db.removePendingRoleRemoval(message.guild.id, user.id, role.id).catch(() => {});
                return done(`Removed **${role.name}** from ${label}`, 'role_removed');
            }
            await member.roles.add(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            return done(`Added **${role.name}** to ${label}`, 'role_added');
        }

        if (action === 'temp') {
            const ms = getCmdDurationMs(cmdData);
            if (!ms) return fail('This command has no valid duration.');
            if (!has) await member.roles.add(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            await db.upsertPendingRoleRemoval({
                guildId: message.guild.id,
                userId: user.id,
                roleId: role.id,
                moderatorId: message.author.id,
                expiresAt: new Date(Date.now() + ms)
            });
            const text = formatCmdDuration(cmdData);
            return done(`Added **${role.name}** to ${label} for **${text}**`, 'role_added', `(${text})`);
        }

        if (action === 'remove_warn') {
            if (has) await member.roles.remove(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            await db.removePendingRoleRemoval(message.guild.id, user.id, role.id).catch(() => {});
            await addWarning(message.guild, user, message.author, reason);
            await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
            await saveModLog(message.guild, 'User warned', user, message.author, reason);
            return done(`Removed **${role.name}** from ${label} and warned them for the reason **${reason}**`, 'role_removed');
        }

        if (action === 'remove_mute') {
            const maxMuteMs = 28 * 24 * 60 * 60 * 1000;
            const configured = getCmdDurationMs(cmdData);
            if (!configured) return fail('This command has no valid duration.');
            const ms = Math.min(configured, maxMuteMs);
            const text = configured > maxMuteMs ? '28 days' : formatCmdDuration(cmdData);
            if (!member.moderatable) return fail('I cannot mute this user.');
            if (has) await member.roles.remove(role, `Custom command ${prefix}${command} by ${message.author.tag}`);
            await db.removePendingRoleRemoval(message.guild.id, user.id, role.id).catch(() => {});
            await member.timeout(ms, reason);
            await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, text);
            await saveModLog(message.guild, 'User muted', user, message.author, reason, text);
            return done(`Removed **${role.name}** from ${label} and muted them for **${text}** for the reason **${reason}**`, 'role_removed', `(${text})`);
        }

        return fail('This command is not configured correctly.');
    } catch (err) {
        await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error while changing the role: ' + err.message).setColor(COLORS.ERROR)] }).catch(() => {});
        await finish();
    }
}

async function handleCustomCommand(message, command, args, cmdData) {
    const cmdType = cmdData.type || 'text';
    const cmdThumbnail = cmdData.thumbnail && isValidUrl(cmdData.thumbnail) ? cmdData.thumbnail : null;

    if (cmdType === 'role') {
        await handleRoleCommand(message, command, args, cmdData);
        return;
    }

    if (cmdType === 'ban') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);

        const banDurationMs = getCmdDurationMs(cmdData);
        const isTemporary = !!banDurationMs;
        const banDurationText = isTemporary ? formatCmdDuration(cmdData) : null;

        try {
            if (member) {
                if (!member.bannable) {
                    const embed = new EmbedBuilder().setDescription('I cannot ban this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                    await message.channel.send({ embeds: [embed] });
                    await message.delete().catch(() => {});
                    return;
                }
                await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                await member.ban({ reason });
            } else {
                await sendActionDM(user, 'banned', reason, { tag: message.author.tag, guild: message.guild });
                await message.guild.bans.create(user.id, { reason });
            }

            if (isTemporary) {
                const expiresAt = new Date(Date.now() + banDurationMs);
                await db.addPendingBan({
                    guildId: message.guild.id,
                    userId: user.id,
                    userTag: user.tag,
                    moderatorId: message.author.id,
                    moderatorTag: message.author.tag,
                    reason: reason,
                    banDate: new Date(),
                    expiresAt: expiresAt
                });
            }

            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been banned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User banned', { id: user.id, tag: user.tag }, message.author, reason, banDurationText);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_banned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}${isTemporary ? ` (${banDurationText})` : ''}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during ban: ' + err.message).setColor(COLORS.ERROR)] });
        }
        if (cmdData.deleteCommand !== false) await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'kick') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);
        if (!member || !member.kickable) {
            const embed = new EmbedBuilder().setDescription('I cannot kick this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await sendActionDM(user, 'kicked', reason, { tag: message.author.tag, guild: message.guild });
            await member.kick(reason);
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been kicked for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User kicked', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_kicked',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during kick.').setColor(COLORS.ERROR)] });
        }
        if (cmdData.deleteCommand !== false) await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'mute') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;

        const maxMuteMs = 28 * 24 * 60 * 60 * 1000;
        const configuredMuteMs = getCmdDurationMs(cmdData);
        let durationMs = configuredMuteMs || maxMuteMs;
        let durationText = configuredMuteMs ? formatCmdDuration(cmdData) : '28 days';
        if (durationMs > maxMuteMs) {
            durationMs = maxMuteMs;
            durationText = '28 days';
        }
        let reasonArgs = args.slice(1);
        if (args.length > 1) {
            const lastDuration = parseMuteDuration(args[args.length - 1]);
            if (lastDuration && lastDuration.invalid) {
                const embed = new EmbedBuilder().setDescription('The duration must be between 1 minute and 28 days.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
                await message.channel.send({ embeds: [embed] });
                await message.delete().catch(() => {});
                return;
            }
            if (lastDuration) {
                durationMs = lastDuration.ms;
                durationText = lastDuration.text;
                reasonArgs = args.slice(1, -1);
            }
        }

        let reason = reasonArgs.join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);

        if (!member || !member.moderatable) {
            const embed = new EmbedBuilder().setDescription('I cannot mute this user.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        try {
            await member.timeout(durationMs, reason);
            await sendActionDM(user, 'muted', reason, { tag: message.author.tag, guild: message.guild }, durationText);
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been muted for **${durationText}** for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User muted', user, message.author, reason, durationText);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_muted',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command} (${durationText})`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during mute.').setColor(COLORS.ERROR)] });
        }
        if (cmdData.deleteCommand !== false) await message.delete().catch(() => {});
        return;
    }

    if (cmdType === 'warn') {
        const input = args[0];
        if (!input) {
            const embed = new EmbedBuilder().setDescription(`Usage: \`${cmdData.prefix || '*'}${command} @user reason\``).setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const result = await getUserFromInput(message.guild, input);
        if (!result || !result.user) {
            const embed = new EmbedBuilder().setDescription('User not found.').setColor(COLORS.ERROR).setThumbnail(THUMBNAIL_URL);
            await message.channel.send({ embeds: [embed] });
            await message.delete().catch(() => {});
            return;
        }
        const user = result.user;
        const member = result.member;
        if (await projectedRoleBlock(message, member)) return;
        let reason = args.slice(1).join(' ');
        if (!reason) {
            reason = (cmdData.response || 'No reason provided')
                .replace(/{user}/g, user.toString())
                .replace(/{username}/g, user.username)
                .replace(/{server}/g, message.guild.name)
                .replace(/{membercount}/g, message.guild.memberCount)
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
            reason = applyPositionalArgs(reason, args);
        } else {
            reason = reason
                .replace(/{md}/g, await formatModerationHistory(user.id, message.guild.id, user.username, 1));
        }
        reason = applyHammertime(reason);
        try {
            await addWarning(message.guild, user, message.author, reason);
            await sendActionDM(user, 'warned', reason, { tag: message.author.tag, guild: message.guild });
            const embed = new EmbedBuilder()
                .setDescription(`**${user.username}** (${user.id}) has been warned for the reason **${reason}**`)
                .setColor(BLACK);
            await message.channel.send({ embeds: [embed] });
            await saveModLog(message.guild, 'User warned', user, message.author, reason);

            await db.saveDashboardLogDB(message.guild.id, {
                type: 'moderation',
                action: 'user_warned',
                userId: message.author.id,
                userTag: message.author.tag,
                targetId: user.id,
                targetTag: user.tag,
                moderatorId: message.author.id,
                moderatorTag: message.author.tag,
                reason: reason,
                details: `Custom command: ${cmdData.prefix || '*'}${command}`,
                channelId: message.channel.id
            });
        } catch (err) {
            await message.channel.send({ embeds: [new EmbedBuilder().setDescription('Error during warn.').setColor(COLORS.ERROR)] });
        }
        if (cmdData.deleteCommand !== false) await message.delete().catch(() => {});
        return;
    }

    const targetInput = args[0];
    let mdTarget = message.mentions.users.first();
    if (!mdTarget && targetInput && /^\d+$/.test(targetInput)) {
        try {
            const fetched = await message.guild.members.fetch(targetInput);
            mdTarget = fetched.user;
        } catch {
            try {
                mdTarget = await client.users.fetch(targetInput);
            } catch { mdTarget = null; }
        }
    }
    if (!mdTarget) mdTarget = message.author;

    const replyText = await substituteAll(cmdData.response || '', message, mdTarget, args);

    const cmdImage = cmdData.image && isValidUrl(cmdData.image) ? cmdData.image : null;

    let cmdComponents = [];
    if (Array.isArray(cmdData.buttons) && cmdData.buttons.length) {
        const row = new ActionRowBuilder();
        for (const btn of cmdData.buttons.slice(0, 5)) {
            if (!btn.label || !btn.url || !isValidUrl(btn.url)) continue;
            row.addComponents(
                new ButtonBuilder()
                    .setLabel(String(btn.label).slice(0, 80))
                    .setStyle(ButtonStyle.Link)
                    .setURL(btn.url)
            );
        }
        if (row.components.length) cmdComponents = [row];
    }

    if (cmdType === 'embed') {
        const cmdTitle = await substituteAll(cmdData.title || '', message, mdTarget, args);
        const embed = new EmbedBuilder()
            .setColor(typeof cmdData.color === 'number' ? cmdData.color : COLORS.INFO);
        if (replyText.trim()) embed.setDescription(replyText);
        if (cmdTitle) embed.setTitle(cmdTitle);
        if (cmdThumbnail) embed.setThumbnail(cmdThumbnail);
        if (cmdImage) embed.setImage(cmdImage);

        const embeds = [embed];

        if (Array.isArray(cmdData.extraEmbeds)) {
            for (const extra of cmdData.extraEmbeds.slice(0, 9)) {
                const extraText = await substituteAll(extra.response || '', message, mdTarget, args);
                const extraTitle = await substituteAll(extra.title || '', message, mdTarget, args);

                const extraEmbed = new EmbedBuilder()
                    .setColor(typeof extra.color === 'number' ? extra.color : COLORS.INFO);
                if (extraText.trim()) extraEmbed.setDescription(extraText);
                if (extraTitle) extraEmbed.setTitle(extraTitle);
                if (extra.thumbnail && isValidUrl(extra.thumbnail)) extraEmbed.setThumbnail(extra.thumbnail);
                if (extra.image && isValidUrl(extra.image)) extraEmbed.setImage(extra.image);
                embeds.push(extraEmbed);
            }
        }

        await message.channel.send({ embeds, components: cmdComponents }).catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    } else if (cmdImage) {
        const embed = new EmbedBuilder().setImage(cmdImage);
        if (replyText.trim()) embed.setDescription(replyText);
        await message.channel.send({ embeds: [embed], components: cmdComponents }).catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    } else {
        await message.channel.send({ content: replyText.trim() ? replyText : '​', components: cmdComponents }).catch(err => console.error('[CUSTOM-CMD] send failed:', err.message));
    }

    if (cmdData.deleteCommand) await message.delete().catch(() => {});
}

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'panel') {
                if (!(await isAdminSafe(interaction.member))) {
                    return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
                }

                await sendCommunityTicketPanel(interaction.channel);

                await interaction.reply({ content: 'Ticket Panel Sent', flags: 64 });
                return;
            }

            if (interaction.commandName === 'panell') {
                if (!(await isAdminSafe(interaction.member))) {
                    return interaction.reply({ content: 'You do not have permission to use this command.', flags: 64 });
                }

                await sendSupportPanel(interaction.channel);

                await interaction.reply({ content: 'Ticket Panel Sent', flags: 64 });
                return;
            }
            return;
        }

        if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId && interaction.customId.startsWith('dropmap_')) {
            if (await dropmap.handleInteraction(interaction)) return;
        }

        if (interaction.isButton() && interaction.customId === 'open_ticket_panel') {
            if (interaction.guild?.id === process.env.COMMUNITY_GUILD_ID) {
                await sendCommunityTicketPanel(interaction.channel);
            } else {
                await sendSupportPanel(interaction.channel);
            }
            await interaction.reply({ content: 'Ticket Panel Sent', flags: 64 });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'support_ticket') {
            const modal = new ModalBuilder()
                .setCustomId('support_modal')
                .setTitle('Support');

            const supportType = new RadioGroupBuilder()
                .setCustomId('support_type')
                .setRequired(true)
                .addOptions(
                    new RadioGroupOptionBuilder()
                        .setLabel('Modmail')
                        .setDescription('Contact Our staff')
                        .setValue('modmail'),
                    new RadioGroupOptionBuilder()
                        .setLabel('Application Issue')
                        .setDescription('Having an issue with your application')
                        .setValue('application_issue')
                );

            const supportMessage = new TextInputBuilder()
                .setCustomId('support_message')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Tell us how we can help...')
                .setRequired(true)
                .setMaxLength(1000);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('What type of support do you need?')
                    .setRadioGroupComponent(supportType),
                new LabelBuilder()
                    .setLabel('How can we help you?')
                    .setTextInputComponent(supportMessage)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'report_player') {
            const modal = new ModalBuilder()
                .setCustomId('report_player_modal')
                .setTitle('Report Player');

            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('reported_user')
                .setPlaceholder('Choose a player...')
                .setMinValues(1)
                .setMaxValues(1)
                .setRequired(true);

            const evidenceProof = new TextInputBuilder()
                .setCustomId('evidence_proof')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Paste a link to your evidence...')
                .setRequired(false)
                .setMaxLength(500);

            const moreInformation = new TextInputBuilder()
                .setCustomId('more_information')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Provide any additional information...')
                .setRequired(false)
                .setMaxLength(1000);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Choose Player')
                    .setDescription('Select the player you want to report.')
                    .setUserSelectMenuComponent(userSelect),
                new LabelBuilder()
                    .setLabel('Evidence Proof')
                    .setTextInputComponent(evidenceProof),
                new LabelBuilder()
                    .setLabel('Do you want add more information?')
                    .setTextInputComponent(moreInformation)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isButton() && interaction.customId === 'open_community_ticket_modal') {
            const modal = new ModalBuilder()
                .setCustomId('community_ticket_modal')
                .setTitle('Crea un nuovo ticket');

            const ticketType = new RadioGroupBuilder()
                .setCustomId('community_ticket_type')
                .setRequired(true)
                .addOptions(
                    ...Object.entries(COMMUNITY_TICKET_TYPES).map(([value, info]) =>
                        new RadioGroupOptionBuilder()
                            .setLabel(info.label)
                            .setDescription(info.description)
                            .setValue(value)
                    )
                );

            const description = new TextInputBuilder()
                .setCustomId('community_ticket_description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Descrivi il tuo problema o richiesta in dettaglio...')
                .setRequired(true)
                .setMaxLength(1000);

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Seleziona il tipo di ticket che vuoi aprire.')
                    .setRadioGroupComponent(ticketType),
                new LabelBuilder()
                    .setLabel('Descrizione')
                    .setTextInputComponent(description)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'community_ticket_modal') {
            const block = await db.getTicketBlockDB(interaction.guild.id, interaction.user.id);
            if (block && new Date(block.expiresAt) > new Date()) {
                return interaction.reply({
                    content: `You are blocked from creating tickets until <t:${Math.floor(new Date(block.expiresAt).getTime() / 1000)}:F>.`,
                    flags: 64
                });
            }

            const ticketTypeValue = interaction.fields.getRadioGroup('community_ticket_type', true);
            const description = interaction.fields.getTextInputValue('community_ticket_description');

            const typeInfo = COMMUNITY_TICKET_TYPES[ticketTypeValue];
            if (!typeInfo) {
                return interaction.reply({ content: 'Tipo di ticket non valido.', flags: 64 });
            }

            const config = await getGuildConfig(interaction.guild.id);

            const staffRoleIds = getTicketStaffRoleIds(config);
            const adminRoleIds = getTicketAdminRoleIds(config);

            if (staffRoleIds.length === 0) {
                return interaction.reply({
                    content: 'Ticket System is currently off, please contact an administrator.',
                    flags: 64
                });
            }

            const categoryId = config[typeInfo.categoryKey];
            if (!categoryId) {
                return interaction.reply({
                    content: `Category for ${typeInfo.label} is not configured.`,
                    flags: 64
                });
            }

            const category = interaction.guild.channels.cache.get(categoryId);
            if (!category) {
                return interaction.reply({
                    content: 'Ticket Category issue. Please contact an administrator.',
                    flags: 64
                });
            }

            const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `${ticketTypeValue}-${sanitizedUsername}`;

            const staffRolesInGuild = staffRoleIds.filter(id => interaction.guild.roles.cache.has(id));
            const adminRolesInGuild = adminRoleIds.filter(id => interaction.guild.roles.cache.has(id));

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, staffRolesInGuild, [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, adminRolesInGuild, [
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            let ticketChannel;
            try {
                ticketChannel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: permissionOverwrites
                });
            } catch (error) {
                try {
                    ticketChannel = await interaction.guild.channels.create({
                        name: `${ticketName}-${Math.floor(Math.random() * 9999)}`,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: permissionOverwrites
                    });
                } catch (err) {
                    logCrash('TICKET_CREATE_ERROR', err);
                    return interaction.reply({
                        content: 'Error while creating your ticket, please contact an administrator.',
                        flags: 64
                    });
                }
            }

            await ticketChannel.setTopic(interaction.user.id).catch(() => {});

            const embed = new EmbedBuilder()
                .setTitle(typeInfo.label)
                .setDescription(`Hey ${interaction.user.toString()}! Thank you for creating a ticket. A staff member will assist you shortly.`)
                .addFields(
                    { name: 'Ticket Type', value: typeInfo.label, inline: false },
                    { name: 'Description', value: description, inline: false }
                )
                .setColor(BLACK);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user.toString()}${staffRolesInGuild.map(id => ` <@&${id}>`).join('')}`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `Your ticket has been created - Ticket Channel: ${ticketChannel}`,
                flags: 64
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'ticket_created',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                details: `${typeInfo.label} ticket created in ${ticketChannel.name}`,
                channelId: ticketChannel.id,
                extra: { channelName: ticketChannel.name, ticketType: typeInfo.label }
            });
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'support_modal') {
            const block = await db.getTicketBlockDB(interaction.guild.id, interaction.user.id);
            if (block && new Date(block.expiresAt) > new Date()) {
                return interaction.reply({
                    content: `You are blocked from creating tickets until <t:${Math.floor(new Date(block.expiresAt).getTime() / 1000)}:F>.`,
                    flags: 64
                });
            }

            const supportType = interaction.fields.getRadioGroup('support_type', true);
            const message = interaction.fields.getTextInputValue('support_message');

            const config = await getGuildConfig(interaction.guild.id);

            const staffRoleIds = getTicketStaffRoleIds(config);
            const adminRoleIds = getTicketAdminRoleIds(config);

            if (!config.supportCategoryId || staffRoleIds.length === 0) {
                return interaction.reply({
                    content: 'Ticket System is currently off, please contact an administrator.',
                    flags: 64
                });
            }

            const category = interaction.guild.channels.cache.get(config.supportCategoryId);
            if (!category) {
                return interaction.reply({
                    content: 'Ticket Category issue. Please contact an administrator.',
                    flags: 64
                });
            }

            const typeName = supportType === 'modmail' ? 'Modmail' : 'Application Issue';

            const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `ticket-${sanitizedUsername}`;

            const staffRolesInGuild = staffRoleIds.filter(id => interaction.guild.roles.cache.has(id));
            const adminRolesInGuild = adminRoleIds.filter(id => interaction.guild.roles.cache.has(id));

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, staffRolesInGuild, [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, adminRolesInGuild, [
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            let ticketChannel;
            try {
                ticketChannel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: permissionOverwrites
                });
            } catch (error) {
                try {
                    ticketChannel = await interaction.guild.channels.create({
                        name: `${ticketName}-${Math.floor(Math.random() * 9999)}`,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: permissionOverwrites
                    });
                } catch (err) {
                    logCrash('TICKET_CREATE_ERROR', err);
                    return interaction.reply({
                        content: 'Error while creating your ticket, please contact an administrator.',
                        flags: 64
                    });
                }
            }

            await ticketChannel.setTopic(interaction.user.id).catch(() => {});

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username} support ticket`)
                .setDescription(`Hey ${interaction.user.toString()}! Thank you for creating a ticket. A staff member will assist you shortly.`)
                .addFields(
                    { name: 'Ticket Category', value: typeName, inline: false },
                    { name: 'Additional Information', value: message, inline: false }
                )
                .setColor(BLACK);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user.toString()}${staffRolesInGuild.map(id => ` <@&${id}>`).join('')}`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `Your ticket has been created - Ticket Channel: ${ticketChannel}`,
                flags: 64
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'ticket_created',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                details: `Support ticket (${typeName}) created in ${ticketChannel.name}`,
                channelId: ticketChannel.id,
                extra: { channelName: ticketChannel.name, ticketType: typeName }
            });
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === 'report_player_modal') {
            const reportBlock = await db.getTicketBlockDB(interaction.guild.id, interaction.user.id);
            if (reportBlock && new Date(reportBlock.expiresAt) > new Date()) {
                return interaction.reply({
                    content: `You are blocked from creating tickets until <t:${Math.floor(new Date(reportBlock.expiresAt).getTime() / 1000)}:F>.`,
                    flags: 64
                });
            }

            const selectedUsers = interaction.fields.getSelectedUsers('reported_user', true);
            const reportedUser = selectedUsers.first();

            if (!reportedUser || reportedUser.bot) {
                await interaction.reply({
                    content: 'Invalid user selected. You cant report a bot.',
                    flags: 64
                });
                return;
            }

            const evidence = interaction.fields.getTextInputValue('evidence_proof');
            const moreInformation = interaction.fields.getTextInputValue('more_information');

            const config = await getGuildConfig(interaction.guild.id);

            const staffRoleIds = getTicketStaffRoleIds(config);
            const adminRoleIds = getTicketAdminRoleIds(config);

            if (!config.supportCategoryId || staffRoleIds.length === 0) {
                return interaction.reply({
                    content: 'Ticket System is currently off, please contact an administrator.',
                    flags: 64
                });
            }

            const category = interaction.guild.channels.cache.get(config.supportCategoryId);
            if (!category) {
                return interaction.reply({
                    content: 'Ticket Category issue. Please contact an administrator.',
                    flags: 64
                });
            }

            const sanitizedUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
            const ticketName = `report-${sanitizedUsername}`;

            const staffRolesInGuild = staffRoleIds.filter(id => interaction.guild.roles.cache.has(id));
            const adminRolesInGuild = adminRoleIds.filter(id => interaction.guild.roles.cache.has(id));

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                }
            ];

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, staffRolesInGuild, [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            permissionOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, adminRolesInGuild, [
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));

            let ticketChannel;
            try {
                ticketChannel = await interaction.guild.channels.create({
                    name: ticketName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: permissionOverwrites
                });
            } catch (error) {
                try {
                    ticketChannel = await interaction.guild.channels.create({
                        name: `${ticketName}-${Math.floor(Math.random() * 9999)}`,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        permissionOverwrites: permissionOverwrites
                    });
                } catch (err) {
                    logCrash('TICKET_CREATE_ERROR', err);
                    return interaction.reply({
                        content: 'Error while creating your ticket, please contact an administrator.',
                        flags: 64
                    });
                }
            }

            await ticketChannel.setTopic(interaction.user.id).catch(() => {});

            const evidenceText = evidence ? evidence : 'No evidence provided';
            const moreInfoText = moreInformation ? moreInformation : 'None';

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username} report ticket`)
                .setDescription(`Hey ${interaction.user.toString()}! Thank you for creating a ticket. A staff member will assist you shortly.`)
                .addFields(
                    { name: 'Reported Player', value: `${reportedUser.tag} (${reportedUser.id})`, inline: false },
                    { name: 'Evidence Proof', value: evidenceText, inline: false },
                    { name: 'Additional Information', value: moreInfoText, inline: false }
                )
                .setColor(BLACK);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({
                content: `${interaction.user.toString()}${staffRolesInGuild.map(id => ` <@&${id}>`).join('')}`,
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: `Your ticket has been created - Ticket Channel: ${ticketChannel}`,
                flags: 64
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'report_created',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                targetId: reportedUser.id,
                targetTag: reportedUser.tag,
                details: `Report ticket created in ${ticketChannel.name}`,
                channelId: ticketChannel.id
            });
            return;
        }

        if (interaction.isButton() && interaction.customId === 'claim_ticket') {
            await interaction.deferUpdate();

            const config = await getGuildConfig(interaction.guild.id);
            const staffRoleIds = getTicketStaffRoleIds(config);
            const adminRoleIds = getTicketAdminRoleIds(config);
            const adminRolesInGuild = adminRoleIds.filter(id => interaction.guild.roles.cache.has(id));

            const isStaff = memberHasAnyRole(interaction.member, staffRoleIds);
            const isAdmin = memberHasAnyRole(interaction.member, adminRoleIds);

            if (!isStaff && !isAdmin) {
                return interaction.followUp({
                    content: 'Missing Permissions',
                    flags: 64
                });
            }

            const ticketOwnerId = interaction.channel.topic;
            if (!ticketOwnerId) {
                return interaction.followUp({ content: 'Error', flags: 64 });
            }

            const newOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: ticketOwnerId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.UseExternalEmojis,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.UseApplicationCommands,
                        PermissionsBitField.Flags.UseExternalStickers
                    ]
                }
            ];

            newOverwrites.push(...buildTicketRoleOverwrites(interaction.guild, adminRolesInGuild, [
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.UseApplicationCommands,
                PermissionsBitField.Flags.UseExternalStickers
            ]));


            await interaction.channel.permissionOverwrites.set(newOverwrites);

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 20 });
                const botMessage = messages.find(m =>
                    m.author.id === client.user.id &&
                    m.components.length > 0 &&
                    m.embeds.length > 0
                );
                if (botMessage) {
                    await botMessage.edit({ components: [] });
                }
            } catch (error) {
                console.error('[CLAIM] Error removing buttons:', error);
            }

            const embed = new EmbedBuilder()
                .setTitle('Ticket Claimed')
                .setDescription(`This ticket has been claimed by ${interaction.user.toString()}, he will assist you with your request.`)
                .setColor(GOLD);

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.channel.send({ embeds: [embed], components: [closeRow] });

            ticketClaims.set(interaction.channel.id, {
                claimedBy: interaction.user.id,
                claimedByTag: interaction.user.tag
            });

            await db.saveDashboardLogDB(interaction.guild.id, {
                type: 'ticket',
                action: 'ticket_claimed',
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                details: `Ticket ${interaction.channel.name} claimed`,
                channelId: interaction.channel.id,
                extra: { channelName: interaction.channel.name }
            });
            return;
        }

            if (interaction.isButton() && interaction.customId === 'close_ticket') {
                await interaction.deferUpdate();
            
                const config = await getGuildConfig(interaction.guild.id);
                const staffRoleIds = getTicketStaffRoleIds(config);
                const adminRoleIds = getTicketAdminRoleIds(config);

                const isStaff = memberHasAnyRole(interaction.member, staffRoleIds);
                const isAdmin = memberHasAnyRole(interaction.member, adminRoleIds);

                if (!isStaff && !isAdmin) {
                    return interaction.followUp({
                        content: '❌ Only staff members can close tickets.',
                        flags: 64
                    });
                }
            
                const embed = new EmbedBuilder()
                    .setTitle('Ticket Closed')
                    .setDescription('This ticket has been closed, the channel will be deleted in 5 seconds....')
                    .setColor(RED);
            
                try {
                    const noButtonsRow = new ActionRowBuilder();
                    await interaction.message.edit({ components: [noButtonsRow] });
                } catch (error) {}
            
                await interaction.channel.send({ embeds: [embed] });

                const ownerId = interaction.channel.topic || null;
                let ownerTag = null;
                if (ownerId) {
                    try {
                        const ownerUser = await client.users.fetch(ownerId);
                        ownerTag = ownerUser.tag;
                    } catch {}
                }
                const claimInfo = ticketClaims.get(interaction.channel.id) || {};

                const transcriptId = await generateTicketTranscript(interaction.channel, interaction.user, {
                    ticketType: ticketTypeFromChannelName(interaction.channel.name),
                    ticketOwnerId: ownerId,
                    ticketOwnerTag: ownerTag,
                    createdBy: ownerId,
                    createdByTag: ownerTag,
                    claimedBy: claimInfo.claimedBy || null,
                    claimedByTag: claimInfo.claimedByTag || null,
                    closedBy: interaction.user.id
                });
                ticketClaims.delete(interaction.channel.id);

                await db.saveDashboardLogDB(interaction.guild.id, {
                    type: 'ticket',
                    action: 'ticket_closed',
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    details: `Ticket ${interaction.channel.name} closed${transcriptId ? ` (transcript available)` : ''}`,
                    channelId: interaction.channel.id,
                    transcriptId: transcriptId || null,
                    extra: {
                        channelName: interaction.channel.name,
                        ticketOwnerTag: ownerTag,
                        claimedByTag: claimInfo.claimedByTag || null
                    }
                });
            
                setTimeout(async () => {
                    try {
                        if (interaction.channel && interaction.channel.deletable) {
                            await interaction.channel.delete();
                        }
                    } catch (error) {}
                }, 5000);
                return;
            }

        if (interaction.isButton() && interaction.customId.startsWith('appeal_accept_')) {
            if (!(await isStaffSafe(interaction.member))) {
                return interaction.reply({ content: 'You do not have permission to use this button.', flags: 64 });
            }

            const targetUserId = interaction.customId.replace('appeal_accept_', '');
            await interaction.deferUpdate();

            try {
                if (!interaction.guild?.id || interaction.guild.id === process.env.MAIN_GUILD_ID) {
                    const targetUser = await client.users.fetch(targetUserId);
                    const dmEmbed = new EmbedBuilder()
                        .setDescription('Your appeal has been accept, join back now https://discord.gg/UW7SsywQp6')
                        .setColor(GREEN);
                    await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
                }
            } catch {}

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(GREEN)
                .setFooter({ text: `Accepted by @${interaction.user.username}` });

            const oldRow = interaction.message.components[0];
            const newRow = new ActionRowBuilder().addComponents(
                oldRow.components.map(c => {
                    const btn = ButtonBuilder.from(c);
                    if (!c.customId.startsWith('appeal_modlogs_')) btn.setDisabled(true);
                    return btn;
                })
            );

            await interaction.message.edit({ embeds: [updatedEmbed], components: [newRow] });
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('appeal_deny_')) {
            if (!(await isStaffSafe(interaction.member))) {
                return interaction.reply({ content: 'You do not have permission to use this button.', flags: 64 });
            }

            const targetUserId = interaction.customId.replace('appeal_deny_', '');

            const reasonInput = new TextInputBuilder()
                .setCustomId('deny_reason')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Explain why this appeal is being rejected...')
                .setRequired(true)
                .setMaxLength(1000);

            const modal = new ModalBuilder()
                .setCustomId(`appeal_deny_modal_${targetUserId}`)
                .setTitle('Deny Appeal');

            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Reason')
                    .setTextInputComponent(reasonInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('appeal_deny_modal_')) {
            if (!(await isStaffSafe(interaction.member))) {
                return interaction.reply({ content: 'You do not have permission to do this.', flags: 64 });
            }

            const targetUserId = interaction.customId.replace('appeal_deny_modal_', '');
            const reason = interaction.fields.getTextInputValue('deny_reason');

            await interaction.deferUpdate();

            try {
                if (!interaction.guild?.id || interaction.guild.id === process.env.MAIN_GUILD_ID) {
                    const targetUser = await client.users.fetch(targetUserId);
                    const dmEmbed = new EmbedBuilder()
                        .setDescription(`Your appeal has been rejected, for: **${reason}**`)
                        .setColor(RED);
                    await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
                }
            } catch {}

            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(RED)
                .addFields({ name: 'Reason', value: reason.slice(0, 1024) })
                .setFooter({ text: `Rejected by @${interaction.user.username}` });

            const oldRow = interaction.message.components[0];
            const newRow = new ActionRowBuilder().addComponents(
                oldRow.components.map(c => {
                    const btn = ButtonBuilder.from(c);
                    if (!c.customId.startsWith('appeal_modlogs_')) btn.setDisabled(true);
                    return btn;
                })
            );

            await interaction.message.edit({ embeds: [updatedEmbed], components: [newRow] });
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('appeal_modlogs_')) {
            if (!(await isStaffSafe(interaction.member))) {
                return interaction.reply({ content: 'You do not have permission to use this button.', flags: 64 });
            }

            const targetUserId = interaction.customId.replace('appeal_modlogs_', '');
            await interaction.deferReply({ flags: 64 });

            let username = `Unknown (${targetUserId})`;
            try {
                const u = await client.users.fetch(targetUserId);
                username = u.username;
            } catch {}

            const text = await formatModerationHistory(targetUserId, interaction.guild.id, username, 1);
            const embed = new EmbedBuilder().setDescription(text).setColor(COLORS.INFO);
            await interaction.editReply({ embeds: [embed] });
            return;
        }
    } catch (error) {
        logCrash('INTERACTION_HANDLER', error, { customId: interaction?.customId });
        try {
            if (interaction?.isRepliable && interaction.isRepliable()) {
                const payload = { content: 'An error occurred. Please try again.', flags: 64 };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(payload).catch(() => {});
                } else {
                    await interaction.reply(payload).catch(() => {});
                }
            }
        } catch {}
    }
});

setInterval(async () => {
    try {
        const expired = await db.getExpiredBans();
        for (const ban of expired) {
            try {
                const guild = client.guilds.cache.get(ban.guildId);
                if (!guild) {
                    await db.removePendingBan(ban.guildId, ban.userId).catch(() => {});
                    continue;
                }
                await guild.members.unban(ban.userId, 'Temporary ban expired');
                await db.removePendingBan(ban.guildId, ban.userId).catch(() => {});
                await saveModLog(guild, 'User unbanned (auto)', { id: ban.userId, tag: ban.userTag }, client.user, 'Temporary ban expired');

                try {
                    const unbannedUser = await client.users.fetch(ban.userId);
                    await sendUnbanDM(unbannedUser, guild);
                } catch (dmErr) {
                    console.error(`[AUTO-UNBAN] DM fetch error on ${ban.userId}:`, dmErr.message);
                }

                await db.saveDashboardLogDB(guild.id, {
                    type: 'auto_mod',
                    action: 'user_unbanned_auto',
                    userId: client.user.id,
                    userTag: client.user.tag,
                    targetId: ban.userId,
                    targetTag: ban.userTag,
                    reason: 'Temporary ban expired',
                    details: 'Auto-unban after temporary ban expired'
                });

                console.log(`[AUTO-UNBAN] Unbanned ${ban.userTag} (${ban.userId}) from ${guild.name}`);
            } catch (err) {
                console.error(`[AUTO-UNBAN] Error on ${ban.userId}:`, err.message);
                if (err.code === 10026 || err.code === 10013) {
                    await db.removePendingBan(ban.guildId, ban.userId).catch(() => {});
                }
            }
        }
    } catch (error) {
        logCrash('AUTO_UNBAN_SCHEDULER', error);
    }
}, 60000);

setInterval(async () => {
    try {
        const expired = await db.getExpiredRoleRemovals();
        for (const item of expired) {
            try {
                const guild = client.guilds.cache.get(item.guildId);
                if (!guild) {
                    await db.removePendingRoleRemoval(item.guildId, item.userId, item.roleId).catch(() => {});
                    continue;
                }
                const member = await guild.members.fetch(item.userId);
                if (member.roles.cache.has(item.roleId)) {
                    await member.roles.remove(item.roleId, 'Temporary role expired');
                }
                await db.removePendingRoleRemoval(item.guildId, item.userId, item.roleId).catch(() => {});
            } catch (err) {
                if (err.code === 10007 || err.code === 10011 || err.code === 50013) {
                    await db.removePendingRoleRemoval(item.guildId, item.userId, item.roleId).catch(() => {});
                } else {
                    console.error(`[TEMP-ROLE] Error on ${item.userId}:`, err.message);
                }
            }
        }
    } catch (error) {
        logCrash('TEMP_ROLE_SCHEDULER', error);
    }
}, 60000);

process.on('SIGINT', () => { process.exit(); });
process.on('SIGTERM', () => { process.exit(); });

if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN missing in .env file!');
    process.exit(1);
}

async function loginWithRetry(retries = 5, delay = 10000) {
    for (let i = 1; i <= retries; i++) {
        try {
            await client.login(process.env.DISCORD_TOKEN);
            return;
        } catch (error) {
            logCrash('LOGIN_ERROR', error, { attempt: i, retries });
            if (i === retries) {
                console.error('Login failed after all retries');
                process.exit(1);
            }
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

loginWithRetry();
