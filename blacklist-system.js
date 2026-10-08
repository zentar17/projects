const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const SWEEP_INTERVAL_MS = 2 * 60 * 60 * 1000;
const SWEEP_FIRST_DELAY_MS = 90 * 1000;
const BAN_REASON = 'Blacklisted';
const GREY = 0x6B6E73;
const RED = 0xED4245;
const NO_REASON = 'No reason provided';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBlacklistDate(value) {
    const d = value ? new Date(value) : new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Rome',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
    return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

function createBlacklistSystem({ client, db, logCrash }) {
    const log = typeof logCrash === 'function' ? logCrash : () => {};

    let running = false;
    let currentSweep = null;
    let abortRequested = false;
    let pendingRestart = false;
    let locks = 0;
    let timer = null;
    let firstTimer = null;

    async function getSettings() {
        return db.getBlacklistSettingsDB();
    }

    async function getTargetGuilds(fallbackGuild) {
        const settings = await getSettings();
        const guilds = [];
        for (const id of settings.banGuildIds || []) {
            const g = client.guilds.cache.get(id);
            if (g) guilds.push(g);
        }
        if (guilds.length === 0 && fallbackGuild) guilds.push(fallbackGuild);
        return guilds;
    }

    function blacklistEmbed(entry) {
        return new EmbedBuilder()
            .setTitle('Blacklist Log')
            .setColor(GREY)
            .setDescription(
                `**User:** ${entry.userName || 'Unknown'}\n` +
                `**User ID:** ${entry.userId}\n` +
                `**Blacklisted By:** ${entry.bannedBy || 'Unknown'}\n` +
                `**Blacklist Reason:** ${entry.reason || NO_REASON}\n` +
                `**Blacklist Date:** ${formatBlacklistDate(entry.date)}`
            );
    }

    function unblacklistEmbed(entry) {
        return new EmbedBuilder()
            .setTitle('Unblacklist Log')
            .setColor(RED)
            .setDescription(
                `**User:** ${entry.userName || 'Unknown'}\n` +
                `**User ID:** ${entry.userId}\n` +
                `**Unblacklisted By:** ${entry.unblacklistedBy || 'Unknown'}\n` +
                `**Was Blacklisted By:** ${entry.bannedBy || 'Unknown'}\n` +
                `**Unblacklist Reason:** ${entry.unblacklistReason || NO_REASON}\n` +
                `**Blacklist Reason:** ${entry.reason || NO_REASON}`
            );
    }

    function infoEmbed(entry) {
        const base = entry.isUnblacklisted ? unblacklistEmbed(entry) : blacklistEmbed(entry);
        const serverNames = (entry.bannedServers || []).map(id => {
            const g = client.guilds.cache.get(id);
            return g ? g.name : id;
        });
        let description = base.data.description;
        if (entry.isUnblacklisted) {
            description += `\n**Blacklist Date:** ${formatBlacklistDate(entry.date)}\n**Unblacklist Date:** ${formatBlacklistDate(entry.unblacklistedAt)}`;
        }
        description += `\n**Status:** ${entry.isUnblacklisted ? 'Unblacklisted' : 'Blacklisted'}`;
        description += `\n**Banned In:** ${serverNames.length ? serverNames.join(', ') : 'None'}`;
        if (!entry.isUnblacklisted && entry.errors && entry.errors.length) {
            description += `\n**Errors:** ${entry.errors.join(' | ')}`;
        }
        return base.setDescription(description.slice(0, 4000));
    }

    async function sendLog(embed) {
        try {
            const settings = await getSettings();
            if (!settings.logChannelId) return false;
            const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
            if (!channel || !channel.send) return false;
            await channel.send({ embeds: [embed] });
            return true;
        } catch (e) {
            log('BLACKLIST_LOG_SEND', e);
            return false;
        }
    }

    async function getMemberAccess(member, isAdmin) {
        if (isAdmin) return { manage: true, view: true };
        if (!member || !member.guild) return { manage: false, view: false };
        const settings = await getSettings();
        const cfg = (settings.commandRoles || {})[member.guild.id] || {};
        const has = (ids) => Array.isArray(ids) && ids.some(r => member.roles.cache.has(r));
        const manage = has(cfg.manage);
        return { manage, view: manage || has(cfg.view) };
    }

    async function findProtectedRole(userId) {
        const settings = await getSettings();
        const cfgs = settings.commandRoles || {};
        for (const gid of Object.keys(cfgs)) {
            const ids = (cfgs[gid] && cfgs[gid].protected) || [];
            if (!ids.length) continue;
            const guild = client.guilds.cache.get(gid);
            if (!guild) continue;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) continue;
            const roleId = ids.find(r => member.roles.cache.has(r));
            if (roleId) {
                const role = guild.roles.cache.get(roleId);
                return { roleName: role ? role.name : roleId, guildName: guild.name };
            }
        }
        return null;
    }

    function hasBanPerms(guild) {
        const me = guild.members.me;
        return !!(me && me.permissions.has(PermissionsBitField.Flags.BanMembers));
    }

    async function banInGuild(guild, userId) {
        if (!hasBanPerms(guild)) return { ok: false, error: `${guild.name} - Missing Ban Members permission` };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            const me = guild.members.me;
            if (!me || me.roles.highest.position <= member.roles.highest.position) {
                return { ok: false, error: `${guild.name} - Bot role is not higher than target` };
            }
        }
        try {
            await guild.bans.create(userId, { reason: BAN_REASON, deleteMessageSeconds: 86400 });
            return { ok: true };
        } catch (error) {
            if (error.code === 10026) return { ok: true };
            if (error.code === 50013) return { ok: false, error: `${guild.name} - Missing Permissions` };
            return { ok: false, error: `${guild.name} - ${error.message}` };
        }
    }

    async function unbanInGuild(guild, userId, reason) {
        try {
            await guild.bans.remove(userId, (reason || 'Unblacklisted').slice(0, 400));
            return { ok: true };
        } catch (error) {
            if (error.code === 10026) return { ok: true, wasNotBanned: true };
            return { ok: false, error: `${guild.name} - ${error.message}` };
        }
    }

    async function fetchAllBannedIds(guild) {
        const ids = new Set();
        let after;
        for (let i = 0; i < 1000; i++) {
            const batch = await guild.bans.fetch({ limit: 1000, after, cache: false });
            if (!batch || batch.size === 0) break;
            let maxId = after ? BigInt(after) : 0n;
            batch.forEach(ban => {
                ids.add(ban.user.id);
                const n = BigInt(ban.user.id);
                if (n > maxId) maxId = n;
            });
            if (batch.size < 1000) break;
            after = maxId.toString();
        }
        return ids;
    }

    async function withChange(fn) {
        locks++;
        abortRequested = true;
        try {
            if (currentSweep) await currentSweep.catch(() => {});
            return await fn();
        } finally {
            locks--;
            if (locks === 0) {
                abortRequested = false;
                if (pendingRestart) runSweep();
            }
        }
    }

    async function blacklistUser({ user, reason, actor, fallbackGuild }) {
        return withChange(async () => {
            const existing = await db.getActiveBlacklistEntryDB(user.id);
            if (existing) return { ok: false, code: 'already', entry: existing };

            const protectedHit = await findProtectedRole(user.id);
            if (protectedHit) return { ok: false, code: 'protected', roleName: protectedHit.roleName, guildName: protectedHit.guildName };

            const guilds = await getTargetGuilds(fallbackGuild);
            const bannedServers = [];
            const errors = [];
            for (let i = 0; i < guilds.length; i++) {
                const res = await banInGuild(guilds[i], user.id);
                if (res.ok) bannedServers.push(guilds[i].id);
                else errors.push(res.error);
                if (i < guilds.length - 1) await delay(500);
            }

            if (bannedServers.length === 0) {
                return { ok: false, code: 'no_servers', errors };
            }

            const entry = await db.addBlacklistEntryDB({
                userId: user.id,
                userName: user.username || user.tag || user.id,
                reason: reason || NO_REASON,
                bannedBy: actor.name,
                bannedById: actor.id,
                date: new Date(),
                bannedServers,
                errors
            });

            await sendLog(blacklistEmbed(entry));
            return { ok: true, entry, errors };
        });
    }

    async function unblacklistUser({ userId, reason, actor, fallbackGuild }) {
        return withChange(async () => {
            const existing = await db.getActiveBlacklistEntryDB(userId);
            if (!existing) return { ok: false, code: 'not_blacklisted' };

            const guilds = await getTargetGuilds(fallbackGuild);
            const ids = new Set([...(existing.bannedServers || []), ...guilds.map(g => g.id)]);
            const errors = [];
            let unbanned = 0;
            const list = [...ids].map(id => client.guilds.cache.get(id)).filter(Boolean);
            for (let i = 0; i < list.length; i++) {
                const res = await unbanInGuild(list[i], userId, 'Unblacklisted');
                if (!res.ok) errors.push(res.error);
                else if (!res.wasNotBanned) unbanned++;
                if (i < list.length - 1) await delay(500);
            }

            const entry = await db.unblacklistEntryDB(userId, {
                reason: reason || NO_REASON,
                by: actor.name,
                byId: actor.id
            });
            if (!entry) return { ok: false, code: 'not_blacklisted' };

            await sendLog(unblacklistEmbed(entry));
            return { ok: true, entry, errors, unbanned };
        });
    }

    async function changeReason({ userId, reason }) {
        return withChange(async () => {
            const entry = await db.updateBlacklistReasonDB(userId, reason);
            if (!entry) return { ok: false, code: 'not_blacklisted' };
            return { ok: true, entry };
        });
    }

    async function sweepOnce() {
        const settings = await getSettings();
        const guilds = [];
        for (const id of settings.banGuildIds || []) {
            const g = client.guilds.cache.get(id);
            if (g) guilds.push(g);
        }
        if (guilds.length === 0) return { skipped: true };

        const entries = await db.getAllBlacklistDB();
        const state = new Map();
        for (const e of entries) {
            state.set(e.userId, { entry: e, servers: new Set(e.bannedServers || []), errors: [] });
        }

        const summary = { users: entries.length, servers: guilds.length, banned: 0, alreadyBanned: 0, failed: 0 };

        for (const guild of guilds) {
            if (abortRequested) return { aborted: true };
            let bannedIds;
            try {
                bannedIds = await fetchAllBannedIds(guild);
            } catch (e) {
                for (const s of state.values()) s.errors.push(`${guild.name} - ${e.message}`);
                summary.failed += entries.length;
                continue;
            }
            if (abortRequested) return { aborted: true };

            for (const s of state.values()) {
                if (abortRequested) return { aborted: true };
                const userId = s.entry.userId;
                if (bannedIds.has(userId)) {
                    s.servers.add(guild.id);
                    summary.alreadyBanned++;
                    continue;
                }
                const res = await banInGuild(guild, userId);
                if (res.ok) {
                    s.servers.add(guild.id);
                    summary.banned++;
                    await delay(1000);
                } else {
                    s.servers.delete(guild.id);
                    s.errors.push(res.error);
                    summary.failed++;
                }
            }
        }

        if (abortRequested) return { aborted: true };

        for (const s of state.values()) {
            const servers = [...s.servers];
            const before = [...(s.entry.bannedServers || [])].sort().join(',');
            const beforeErr = (s.entry.errors || []).join('|');
            if (before !== servers.slice().sort().join(',') || beforeErr !== s.errors.join('|')) {
                await db.setBlacklistEntryResultDB(s.entry.userId, servers, s.errors);
            }
        }

        await db.saveBlacklistSweepResultDB(summary);
        return { done: true, summary };
    }

    function runSweep() {
        if (running || locks > 0) {
            pendingRestart = true;
            return currentSweep;
        }
        running = true;
        currentSweep = (async () => {
            try {
                do {
                    pendingRestart = false;
                    let res;
                    try {
                        res = await sweepOnce();
                    } catch (e) {
                        log('BLACKLIST_SWEEP', e);
                        res = { error: true };
                    }
                    if (res && res.aborted) pendingRestart = true;
                } while (pendingRestart && locks === 0);
            } finally {
                running = false;
                currentSweep = null;
            }
        })();
        return currentSweep;
    }

    function start() {
        if (timer) return;
        firstTimer = setTimeout(() => { runSweep(); }, SWEEP_FIRST_DELAY_MS);
        timer = setInterval(() => { runSweep(); }, SWEEP_INTERVAL_MS);
    }

    function stop() {
        if (timer) clearInterval(timer);
        if (firstTimer) clearTimeout(firstTimer);
        timer = null;
        firstTimer = null;
    }

    return {
        BAN_REASON,
        getTargetGuilds,
        getMemberAccess,
        blacklistUser,
        unblacklistUser,
        changeReason,
        blacklistEmbed,
        unblacklistEmbed,
        infoEmbed,
        sendLog,
        formatBlacklistDate,
        runSweep,
        isSweeping: () => running,
        start,
        stop
    };
}

module.exports = { createBlacklistSystem, formatBlacklistDate };
