const { PermissionsBitField } = require('discord.js');

const SYNC_REASON = 'Role Sync';
const FULL_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const CHANGE_DELAY_MS = 350;

function createRoleSync({ client, db, botClients, logCrash }) {
    let rules = [];
    let fullSyncRunning = false;
    let fullSyncQueued = false;
    let fullSyncTimer = null;
    let intervalStarted = false;
    const userQueues = new Map();

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function report(type, error, context) {
        if (typeof logCrash === 'function') logCrash(type, error, context || {});
        else console.error(`[ROLE SYNC] ${type}:`, error && error.message ? error.message : error);
    }

    async function refresh() {
        const all = await db.listRoleSyncRulesDB();
        rules = all.filter((r) => r.sourceRoleId && r.targetRoleId && r.sourceGuildId !== r.targetGuildId);
        return rules;
    }

    function roleGuild(guildId) {
        const rolesClient = botClients.getRolesClient(client);
        return (rolesClient && rolesClient.guilds.cache.get(guildId)) || client.guilds.cache.get(guildId) || null;
    }

    async function fetchAllMembers(guild) {
        if (guild.members.cache.size >= guild.memberCount) return guild.members.cache;
        return guild.members.fetch().catch(() => null);
    }

    async function getMember(guild, userId) {
        if (!guild) return null;
        return guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    }

    async function hasSourceRole(rule, userId) {
        const guild = client.guilds.cache.get(rule.sourceGuildId);
        const member = await getMember(guild, userId);
        return !!(member && member.roles.cache.has(rule.sourceRoleId));
    }

    async function shouldHaveTarget(targetGuildId, targetRoleId, userId) {
        const related = rules.filter((r) => r.targetGuildId === targetGuildId && r.targetRoleId === targetRoleId);
        for (const rule of related) {
            if (await hasSourceRole(rule, userId)) return true;
        }
        return false;
    }

    function distinctTargets(subset) {
        const map = new Map();
        for (const r of subset) map.set(`${r.targetGuildId}:${r.targetRoleId}`, { guildId: r.targetGuildId, roleId: r.targetRoleId });
        return [...map.values()];
    }

    async function applyTarget(targetGuildId, targetRoleId, userId) {
        const guild = roleGuild(targetGuildId);
        if (!guild || !guild.roles.cache.has(targetRoleId)) return;
        const member = await getMember(guild, userId);
        if (!member || member.user.bot) return;
        const want = await shouldHaveTarget(targetGuildId, targetRoleId, userId);
        const has = member.roles.cache.has(targetRoleId);
        if (want === has) return;
        try {
            if (want) await member.roles.add(targetRoleId, SYNC_REASON);
            else await member.roles.remove(targetRoleId, SYNC_REASON);
        } catch (err) {
            report('ROLE_SYNC_APPLY', err, { targetGuildId, targetRoleId, userId, want });
        }
    }

    function runForUser(userId, subset) {
        if (!subset || !subset.length) return Promise.resolve();
        const previous = userQueues.get(userId) || Promise.resolve();
        const next = previous.then(async () => {
            for (const target of distinctTargets(subset)) {
                await applyTarget(target.guildId, target.roleId, userId);
            }
        }).catch((err) => report('ROLE_SYNC_USER', err, { userId })).finally(() => {
            if (userQueues.get(userId) === next) userQueues.delete(userId);
        });
        userQueues.set(userId, next);
        return next;
    }

    async function syncTarget(target) {
        const guild = roleGuild(target.guildId);
        if (!guild || !guild.roles.cache.has(target.roleId)) return;

        const sourceRules = rules.filter((r) => r.targetGuildId === target.guildId && r.targetRoleId === target.roleId);
        const holders = [];
        for (const rule of sourceRules) {
            const sourceGuild = client.guilds.cache.get(rule.sourceGuildId);
            if (!sourceGuild || !sourceGuild.roles.cache.has(rule.sourceRoleId)) return;
            const sourceMembers = await fetchAllMembers(sourceGuild);
            if (!sourceMembers) return;
            holders.push(new Set(sourceMembers.filter((m) => m.roles.cache.has(rule.sourceRoleId)).map((m) => m.id)));
        }

        const members = await fetchAllMembers(guild);
        if (!members) return;

        for (const member of members.values()) {
            if (member.user.bot) continue;
            const want = holders.some((set) => set.has(member.id));
            const has = member.roles.cache.has(target.roleId);
            if (want === has) continue;
            try {
                if (want) await member.roles.add(target.roleId, SYNC_REASON);
                else await member.roles.remove(target.roleId, SYNC_REASON);
            } catch (err) {
                report('ROLE_SYNC_FULL', err, { targetGuildId: target.guildId, targetRoleId: target.roleId, userId: member.id });
            }
            await delay(CHANGE_DELAY_MS);
        }
    }

    async function fullSync() {
        if (fullSyncRunning) {
            fullSyncQueued = true;
            return;
        }
        fullSyncRunning = true;
        try {
            for (const target of distinctTargets(rules)) {
                await syncTarget(target);
            }
        } catch (err) {
            report('ROLE_SYNC_FULL_RUN', err, {});
        } finally {
            fullSyncRunning = false;
            if (fullSyncQueued) {
                fullSyncQueued = false;
                scheduleFullSync(2000);
            }
        }
    }

    function scheduleFullSync(delayMs) {
        clearTimeout(fullSyncTimer);
        fullSyncTimer = setTimeout(() => { fullSync(); }, typeof delayMs === 'number' ? delayMs : 5000);
    }

    async function start() {
        await refresh();
        scheduleFullSync(30000);
        if (!intervalStarted) {
            intervalStarted = true;
            setInterval(() => { fullSync(); }, FULL_SYNC_INTERVAL_MS);
        }
    }

    function onMemberUpdate(oldMember, newMember) {
        if (!rules.length || !newMember || !newMember.guild) return;
        const relevant = rules.filter((r) => r.sourceGuildId === newMember.guild.id);
        if (!relevant.length) return;
        let subset = relevant;
        if (oldMember && !oldMember.partial && oldMember.roles && oldMember.roles.cache) {
            const changed = new Set();
            oldMember.roles.cache.forEach((_, id) => { if (!newMember.roles.cache.has(id)) changed.add(id); });
            newMember.roles.cache.forEach((_, id) => { if (!oldMember.roles.cache.has(id)) changed.add(id); });
            subset = relevant.filter((r) => changed.has(r.sourceRoleId));
        }
        runForUser(newMember.id, subset);
    }

    function onMemberAdd(member) {
        if (!rules.length || !member || !member.guild) return;
        const guildId = member.guild.id;
        runForUser(member.id, rules.filter((r) => r.targetGuildId === guildId || r.sourceGuildId === guildId));
    }

    function onMemberRemove(member) {
        if (!rules.length || !member || !member.guild) return;
        runForUser(member.id, rules.filter((r) => r.sourceGuildId === member.guild.id));
    }

    function diagnose(rule) {
        if (!rule.sourceRoleId || !rule.targetRoleId) return 'Select both roles to activate this rule.';
        if (rule.sourceGuildId === rule.targetGuildId) return 'Source and target server must be different.';
        const sourceGuild = client.guilds.cache.get(rule.sourceGuildId);
        if (!sourceGuild) return 'The bot is not in the source server.';
        if (!sourceGuild.roles.cache.has(rule.sourceRoleId)) return 'The source role no longer exists.';
        const targetGuild = roleGuild(rule.targetGuildId);
        if (!targetGuild) return 'The bot is not in the target server.';
        const targetRole = targetGuild.roles.cache.get(rule.targetRoleId);
        if (!targetRole) return 'The target role no longer exists.';
        if (targetRole.managed) return 'The target role is managed by an integration and cannot be assigned.';
        const me = targetGuild.members.me;
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return 'The bot is missing the Manage Roles permission in the target server.';
        if (me.roles.highest.position <= targetRole.position) return 'Move the bot role above the target role in the target server.';
        return null;
    }

    return {
        refresh,
        start,
        fullSync,
        scheduleFullSync,
        diagnose,
        onMemberUpdate,
        onMemberAdd,
        onMemberRemove,
        getRules: () => rules
    };
}

module.exports = createRoleSync;
