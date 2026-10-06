require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = process.argv[2] || './porc-data';
const COMMUNITY_GUILD_ID = process.env.COMMUNITY_GUILD_ID;

function readJson(file) {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function migrateBlacklist() {
    const data = readJson('blacklist.json');
    if (!data) return { count: 0 };
    let count = 0;
    for (const [userId, entry] of Object.entries(data)) {
        await db.addBlacklistEntryDB({
            userId,
            userTag: entry.userTag || null,
            reason: entry.reason || null,
            modId: entry.modId || null,
            modTag: entry.modTag || null,
            date: entry.date ? new Date(entry.date) : new Date(),
            servers: entry.servers || []
        });
        count++;
    }
    return { count };
}

async function migrateTicketBlock() {
    const data = readJson('ticket_block.json');
    if (!data) return { count: 0 };
    let count = 0;
    for (const entry of Object.values(data)) {
        await db.addTicketBlockDB({
            guildId: entry.guildId,
            userId: entry.userId,
            userTag: entry.userTag || null,
            moderatorId: entry.moderatorId || null,
            moderatorTag: entry.moderatorTag || null,
            reason: entry.reason || null,
            blockedAt: entry.blockedAt ? new Date(entry.blockedAt) : new Date(),
            expiresAt: new Date(entry.expiresAt)
        });
        count++;
    }
    return { count };
}

async function migrateTempRoles() {
    const data = readJson('temproles.json');
    if (!data) return { count: 0 };
    let count = 0;
    for (const entry of Object.values(data)) {
        await db.addTempRoleDB({
            guildId: entry.guildId,
            userId: entry.userId,
            roleId: entry.roleId,
            expiresAt: new Date(entry.expiresAt),
            assignedBy: entry.assignedBy || null,
            assignedByTag: entry.assignedByTag || null,
            reason: entry.reason || null,
            assignedAt: entry.assignedAt ? new Date(entry.assignedAt) : new Date(),
            type: entry.type || null
        });
        count++;
    }
    return { count };
}

async function migrateDropmapImages() {
    const data = readJson('dropmap_images.json');
    if (!data) return { count: 0 };
    let count = 0;
    for (const [areaName, entry] of Object.entries(data)) {
        await db.saveDropmapImageDB({
            guildId: COMMUNITY_GUILD_ID,
            areaName,
            imageUrl: entry.imageUrl || null,
            isMiniarea: !!entry.isMiniarea,
            subAreas: entry.subAreas || {}
        });
        count++;
    }
    return { count };
}

async function migrateDropmapLogs() {
    const data = readJson('dropmap_logs.json');
    if (!data) return { count: 0 };
    let count = 0;
    let skipped = 0;
    for (const entry of data) {
        const dateObj = new Date(entry.timestamp);
        const exists = await db.DropmapLog.findOne({
            guildId: entry.guildId,
            requesterId: entry.requesterId,
            targetId: entry.targetId,
            areaName: entry.areaName,
            date: dateObj
        }).lean();
        if (exists) { skipped++; continue; }
        await db.addDropmapLogDB({
            guildId: entry.guildId,
            guildName: entry.guildName || null,
            requesterId: entry.requesterId,
            requesterTag: entry.requesterTag || null,
            targetId: entry.targetId,
            targetTag: entry.targetTag || null,
            areaName: entry.areaName,
            subAreaName: entry.subAreaName || null,
            imageUrl: entry.imageUrl || null,
            success: entry.success !== false,
            date: dateObj
        });
        count++;
    }
    return { count, skipped };
}

async function migrateModInviteLogs() {
    const data = readJson('mod_invite_logs.json');
    if (!data) return { count: 0 };
    let count = 0;
    let skipped = 0;
    for (const entry of data) {
        const dateObj = new Date(entry.timestamp);
        const exists = await db.ModInviteLog.findOne({
            guildId: entry.guildId,
            moderatorId: entry.moderatorId,
            targetId: entry.targetId,
            date: dateObj
        }).lean();
        if (exists) { skipped++; continue; }
        await db.addModInviteLogDB({
            guildId: entry.guildId,
            guildName: entry.guildName || null,
            moderatorId: entry.moderatorId,
            moderatorTag: entry.moderatorTag || null,
            targetId: entry.targetId,
            targetTag: entry.targetTag || null,
            inviteUrl: entry.inviteUrl || null,
            date: dateObj
        });
        count++;
    }
    return { count, skipped };
}

async function migrateInvites() {
    const data = readJson('invites.json');
    if (!data) return { count: 0 };
    let count = 0;
    for (const entry of Object.values(data)) {
        await db.addInviteTrackingDB({
            guildId: entry.guildId || COMMUNITY_GUILD_ID,
            userId: entry.userId,
            userTag: entry.userTag || null,
            inviteCode: entry.inviteCode || null,
            triggerRoleId: entry.triggerRoleId || null,
            used: entry.used !== false,
            date: entry.date ? new Date(entry.date) : new Date()
        });
        count++;
    }
    return { count };
}

async function migrateJoinsLeaves() {
    const data = readJson('joins_leaves.json');
    if (!data) return { count: 0 };
    let count = 0;
    let skipped = 0;
    for (const type of ['joins', 'leaves']) {
        const list = data[type] || [];
        const evType = type === 'joins' ? 'join' : 'leave';
        for (const entry of list) {
            const result = await db.addJoinLeaveEventDB({
                guildId: COMMUNITY_GUILD_ID,
                userId: entry.userId,
                tag: entry.tag || null,
                type: evType,
                date: new Date(entry.timestamp)
            });
            if (result) count++; else skipped++;
        }
    }
    return { count, skipped };
}

async function migrateWarnings() {
    const data = readJson('warns.json');
    if (!data) return { count: 0 };
    let count = 0;
    let skipped = 0;
    const maxWarningId = {};
    for (const [userId, entries] of Object.entries(data)) {
        for (const entry of entries) {
            const existing = await db.Warning.findOne({ guildId: COMMUNITY_GUILD_ID, userId, warningId: entry.id }).lean();
            if (existing) { skipped++; continue; }
            await db.Warning.create({
                guildId: COMMUNITY_GUILD_ID,
                userId,
                userTag: null,
                warningId: entry.id,
                moderatorId: null,
                moderatorTag: entry.moderator || null,
                reason: entry.reason || null,
                date: new Date(entry.date),
                active: true
            });
            count++;
            maxWarningId[userId] = Math.max(maxWarningId[userId] || 0, entry.id);
        }
    }
    for (const [userId, maxId] of Object.entries(maxWarningId)) {
        await db.Counter.findOneAndUpdate(
            { key: `warning_${COMMUNITY_GUILD_ID}_${userId}` },
            { $max: { seq: maxId } },
            { upsert: true }
        );
    }
    return { count, skipped };
}

async function getMaxCaseId(guildId) {
    const last = await db.ModLog.findOne({ guildId }).sort({ caseId: -1 }).lean();
    return last ? last.caseId : 0;
}

async function migrateModLogs() {
    const data = readJson('modlogs.json');
    if (!data) return { count: 0 };
    const allEntries = [];
    for (const entries of Object.values(data)) {
        for (const entry of entries) allEntries.push(entry);
    }
    allEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    let count = 0;
    let skipped = 0;
    const maxCaseId = {};

    for (const entry of allEntries) {
        const guildId = entry.guildId;
        if (!guildId) { skipped++; continue; }
        const dateObj = new Date(entry.date);

        const existing = await db.ModLog.findOne({
            guildId,
            targetId: entry.targetId,
            action: entry.action,
            moderatorId: entry.moderatorId,
            date: dateObj
        }).lean();
        if (existing) { skipped++; continue; }

        if (!(guildId in maxCaseId)) {
            maxCaseId[guildId] = await getMaxCaseId(guildId);
        }
        maxCaseId[guildId] += 1;

        await db.ModLog.create({
            guildId,
            guildName: entry.guildName || null,
            caseId: maxCaseId[guildId],
            action: entry.action,
            targetId: entry.targetId,
            targetTag: entry.targetTag || null,
            moderatorId: entry.moderatorId,
            moderatorTag: entry.moderatorTag || null,
            reason: entry.reason || null,
            duration: entry.duration || null,
            date: dateObj,
            active: true
        });
        count++;
    }

    for (const [guildId, maxId] of Object.entries(maxCaseId)) {
        await db.Counter.findOneAndUpdate(
            { key: `modlog_${guildId}` },
            { $max: { seq: maxId } },
            { upsert: true }
        );
    }

    return { count, skipped };
}

async function main() {
    if (!COMMUNITY_GUILD_ID) {
        console.error('COMMUNITY_GUILD_ID non configurato in .env, interrompo.');
        process.exit(1);
    }

    const connected = await db.connectDB();
    if (!connected) {
        console.error('Impossibile connettersi a MongoDB.');
        process.exit(1);
    }

    console.log('Migrazione dati da:', path.resolve(DATA_DIR));

    const results = {};
    results.blacklist = await migrateBlacklist();
    results.ticketBlock = await migrateTicketBlock();
    results.tempRoles = await migrateTempRoles();
    results.dropmapImages = await migrateDropmapImages();
    results.dropmapLogs = await migrateDropmapLogs();
    results.modInviteLogs = await migrateModInviteLogs();
    results.invites = await migrateInvites();
    results.joinsLeaves = await migrateJoinsLeaves();
    results.warnings = await migrateWarnings();
    results.modLogs = await migrateModLogs();

    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});