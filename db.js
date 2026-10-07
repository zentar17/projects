const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
    if (connected) return true;
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('[DB] MONGODB_URI missing in .env!');
        return false;
    }
    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 15000,
            heartbeatFrequencyMS: 10000,
            maxPoolSize: 10,
            retryWrites: true
        });
        connected = true;
        console.log('[DB] Connected to MongoDB');
        return true;
    } catch (err) {
        console.error('[DB] MongoDB connection error:', err.message);
        return false;
    }
}

mongoose.connection.on('disconnected', () => {
    connected = false;
    console.error('[DB] Disconnected');
});

mongoose.connection.on('reconnected', () => {
    connected = true;
    console.log('[DB] Reconnected');
});

mongoose.connection.on('error', (err) => {
    console.error('[DB] Connection error:', err.message);
});

const ModLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    guildName: String,
    caseId: { type: Number, required: true },
    action: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    targetTag: String,
    moderatorId: { type: String, required: true, index: true },
    moderatorTag: String,
    reason: String,
    duration: { type: String, default: null },
    date: { type: Date, default: Date.now, index: true },
    active: { type: Boolean, default: true }
}, { timestamps: true });

ModLogSchema.index({ guildId: 1, targetId: 1, date: -1 });
ModLogSchema.index({ guildId: 1, moderatorId: 1, date: -1 });
ModLogSchema.index({ guildId: 1, action: 1, date: -1 });

const WarningSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: String,
    warningId: { type: Number, required: true },
    moderatorId: { type: String, default: null },
    moderatorTag: String,
    reason: String,
    date: { type: Date, default: Date.now },
    active: { type: Boolean, default: true }
}, { timestamps: true });

WarningSchema.index({ guildId: 1, userId: 1, active: 1 });

const GuildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    joinLeaveLogChannelId: { type: String, default: null },
    modLogChannelId: { type: String, default: null },
    transcriptsChannelId: { type: String, default: null },
    staffRoleId: { type: String, default: null },
    modRoleId: { type: String, default: null },
    adminRoleId: { type: String, default: null },
    supportCategoryId: { type: String, default: null },
    reportCategoryId: { type: String, default: null },
    staffApplicationChannelId: { type: String, default: null },
    banAppealChannelId: { type: String, default: null },
    messageLogChannelId: { type: String, default: null },
    inviteLogChannelId: { type: String, default: null },
    roleLogChannelId: { type: String, default: null },
    dropmapLogChannelId: { type: String, default: null },
    modInviteLogChannelId: { type: String, default: null },
    ticketLogChannelId: { type: String, default: null },
    antiAltWarningChannelId: { type: String, default: null },
    autoroleId: { type: String, default: null },
    generalCategoryId: { type: String, default: null },
    dropmapCategoryId: { type: String, default: null },
    unbanCategoryId: { type: String, default: null },
    masterclassCategoryId: { type: String, default: null },
    inviteTriggerRoleId1: { type: String, default: null },
    inviteTriggerRoleId2: { type: String, default: null },
    targetInviteGuildId: { type: String, default: null },
    modTargetInviteGuildId: { type: String, default: null },
    adminRoleIds: { type: [String], default: [] },
    modRoleIds: { type: [String], default: [] },
    trialModRoleIds: { type: [String], default: [] },
    headModRoleIds: { type: [String], default: [] },
    supportRoleIds: { type: [String], default: [] },
    blacklistSyncEnabled: { type: Boolean, default: false },
    dashboardPermissions: {
        createRoles: { type: [String], default: [] },
        editRoles: { type: [String], default: [] },
        deleteRoles: { type: [String], default: [] },
        viewLogsRoles: { type: [String], default: [] }
    },
    dashboardSpecialUsers: {
        adminUsers: { type: [String], default: [] },
        ownerUsers: { type: [String], default: [] }
    },
    projectedRoles: { type: [String], default: [] },
    videoAccessRoleIds: { type: [String], default: [] }
}, { timestamps: true });

const CustomCommandSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    prefix: { type: String, default: '*' },
    type: { type: String, default: 'text' },
    title: { type: String, default: '' },
    response: { type: String, default: '' },
    color: { type: Number, default: 0xE67E22 },
    permission: { type: String, default: 'everyone' },
    deleteCommand: { type: Boolean, default: true },
    thumbnail: { type: String, default: null },
    image: { type: String, default: null },
    buttons: {
        type: [{
            label: { type: String, default: '' },
            url: { type: String, default: '' }
        }],
        default: []
    },
    extraEmbeds: {
        type: [{
            title: { type: String, default: '' },
            response: { type: String, default: '' },
            color: { type: Number, default: 0x7289DA },
            thumbnail: { type: String, default: null },
            image: { type: String, default: null }
        }],
        default: []
    },
    allowedRoles: { type: [String], default: [] },
    duration: { type: Number, default: null },
    isBase: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

CustomCommandSchema.index({ guildId: 1, name: 1 }, { unique: true });

const PendingBanSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: String,
    moderatorId: String,
    moderatorTag: String,
    reason: String,
    banDate: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

PendingBanSchema.index({ expiresAt: 1 });

const CommandCooldownSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

CommandCooldownSchema.index({ userId: 1, guildId: 1, action: 1 }, { unique: true });
CommandCooldownSchema.index({ expiresAt: 1 });

const DashboardLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    userId: { type: String, default: null, index: true },
    userTag: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    targetTag: { type: String, default: null },
    moderatorId: { type: String, default: null, index: true },
    moderatorTag: { type: String, default: null },
    reason: { type: String, default: null },
    details: { type: String, default: null },
    channelId: { type: String, default: null },
    transcriptId: { type: String, default: null },
    extra: { type: mongoose.Schema.Types.Mixed, default: null },
    date: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

DashboardLogSchema.index({ guildId: 1, date: -1 });
DashboardLogSchema.index({ guildId: 1, type: 1, date: -1 });

const TranscriptSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    channelName: { type: String, required: true },
    ticketType: { type: String, default: 'support' },
    ticketOwnerId: { type: String, default: null },
    ticketOwnerTag: { type: String, default: null },
    createdBy: { type: String, default: null },
    createdByTag: { type: String, default: null },
    claimedBy: { type: String, default: null },
    claimedByTag: { type: String, default: null },
    closedBy: { type: String, default: null },
    closedByTag: { type: String, default: null },
    messages: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

TranscriptSchema.index({ guildId: 1, closedAt: -1 });

const VideoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    fileId: { type: mongoose.Schema.Types.ObjectId, required: false },
    contentType: { type: String, default: 'video/mp4' },
    fileSize: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: '' },
    requiredRoleIds: { type: [String], default: [] },
    uploadedBy: { type: String, required: true },
    uploadedByTag: { type: String, default: '' },
    hlsReady: { type: Boolean, default: false },
    hlsSegments: {
        type: [{
            index: { type: Number, required: true },
            fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
            duration: { type: Number, required: true }
        }],
        default: []
    }
}, { timestamps: true });

VideoSchema.index({ createdAt: -1 });

const MasterclassSettingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, default: 'global' },
    viewUserIds: { type: [String], default: [] },
    uploadUserIds: { type: [String], default: [] },
    manageUserIds: { type: [String], default: [] },
    ticketStaffUserIds: { type: [String], default: [] },
    ticketNotifyChannelId: { type: String, default: '' }
}, { timestamps: true });

const McTicketMessageSchema = new mongoose.Schema({
    authorId: String,
    authorName: String,
    authorAvatar: String,
    isStaff: { type: Boolean, default: false },
    system: { type: Boolean, default: false },
    content: String,
    imageId: { type: String, default: null },
    imageIds: { type: [String], default: [] },
    date: { type: Date, default: Date.now }
});

const McTicketImageSchema = new mongoose.Schema({
    ticketNumber: { type: Number, required: true, index: true },
    uploaderId: String,
    contentType: { type: String, required: true },
    size: Number,
    data: { type: Buffer, required: true }
}, { timestamps: true });

const McTicketSchema = new mongoose.Schema({
    ticketNumber: { type: Number, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: String,
    userAvatar: String,
    email: { type: String, required: true },
    planKey: String,
    plan: String,
    price: { type: String, default: null },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    messages: { type: [McTicketMessageSchema], default: [] },
    closedAt: { type: Date, default: null },
    closedById: { type: String, default: null },
    closedByName: { type: String, default: null },
    claimedById: { type: String, default: null },
    claimedByName: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

McTicketSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

const McTicketTranscriptSchema = new mongoose.Schema({
    ticketNumber: { type: Number, required: true, unique: true, index: true },
    userId: { type: String, index: true },
    userName: String,
    userAvatar: String,
    email: String,
    planKey: String,
    plan: String,
    price: { type: String, default: null },
    claimedById: { type: String, default: null },
    claimedByName: { type: String, default: null },
    closedById: { type: String, default: null },
    closedByName: { type: String, default: null },
    openedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null, index: true },
    deletedAt: { type: Date, default: null },
    messages: { type: Array, default: [] }
}, { timestamps: true });

const VideoWatchSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    videoId: { type: String, required: true, index: true },
    progress: { type: Number, default: 0 },
    positionSeconds: { type: Number, default: 0 },
    completed: { type: Boolean, default: false }
}, { timestamps: true });

VideoWatchSchema.index({ userId: 1, videoId: 1 }, { unique: true });

const BlacklistEntrySchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    userTag: String,
    reason: String,
    modId: String,
    modTag: String,
    date: { type: Date, default: Date.now },
    servers: { type: [String], default: [] },
    lastErrors: { type: [String], default: [] }
}, { timestamps: true });

const TicketBlockSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: String,
    moderatorId: String,
    moderatorTag: String,
    reason: String,
    blockedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });

TicketBlockSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const TempRoleSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    roleId: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    assignedBy: String,
    assignedByTag: String,
    reason: String,
    assignedAt: { type: Date, default: Date.now },
    type: { type: String, default: null }
}, { timestamps: true });

TempRoleSchema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });

const DropmapImageSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    areaName: { type: String, required: true },
    imageUrl: { type: String, default: null },
    isMiniarea: { type: Boolean, default: false },
    subAreas: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

DropmapImageSchema.index({ guildId: 1, areaName: 1 }, { unique: true });

const DropmapCodeSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    number: { type: Number, required: true },
    areaName: { type: String, required: true },
    subAreaName: { type: String, default: null }
}, { timestamps: true });

DropmapCodeSchema.index({ guildId: 1, type: 1, number: 1 }, { unique: true });
DropmapCodeSchema.index({ guildId: 1, areaName: 1, subAreaName: 1 }, { unique: true });

const DropmapFileSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    uploaderId: String,
    contentType: { type: String, required: true },
    size: Number,
    data: { type: Buffer, required: true }
}, { timestamps: true });

const DropmapLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    guildName: String,
    requesterId: String,
    requesterTag: String,
    targetId: String,
    targetTag: String,
    areaName: String,
    subAreaName: { type: String, default: null },
    imageUrl: String,
    success: { type: Boolean, default: true },
    date: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

const ModInviteLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    guildName: String,
    moderatorId: String,
    moderatorTag: String,
    targetId: String,
    targetTag: String,
    inviteUrl: String,
    date: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

const InviteTrackingSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    userTag: String,
    inviteCode: String,
    triggerRoleId: { type: String, default: null },
    used: { type: Boolean, default: true },
    date: { type: Date, default: Date.now }
}, { timestamps: true });

InviteTrackingSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const JoinLeaveEventSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    tag: String,
    type: { type: String, enum: ['join', 'leave'], required: true, index: true },
    date: { type: Date, required: true, index: true }
}, { timestamps: true });

JoinLeaveEventSchema.index({ guildId: 1, userId: 1, type: 1, date: 1 }, { unique: true });

const CounterSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', CounterSchema);

async function getNextSeq(key, seedFn) {
    const incremented = await Counter.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true }
    );
    if (incremented) return incremented.seq;

    let seed = 0;
    if (seedFn) {
        try { seed = await seedFn(); } catch { seed = 0; }
    }

    try {
        const created = await Counter.create({ key, seq: seed + 1 });
        return created.seq;
    } catch (e) {
        if (e.code !== 11000) throw e;
        const retried = await Counter.findOneAndUpdate(
            { key },
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        );
        return retried.seq;
    }
}

const ModLog = mongoose.model('ModLog', ModLogSchema);
const Warning = mongoose.model('Warning', WarningSchema);
const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);
const CustomCommand = mongoose.model('CustomCommand', CustomCommandSchema);
const PendingBan = mongoose.model('PendingBan', PendingBanSchema);
const CommandCooldown = mongoose.model('CommandCooldown', CommandCooldownSchema);
const DashboardLog = mongoose.model('DashboardLog', DashboardLogSchema);
const Transcript = mongoose.model('Transcript', TranscriptSchema);
const Video = mongoose.model('Video', VideoSchema);
const MasterclassSettings = mongoose.model('MasterclassSettings', MasterclassSettingsSchema);
const VideoWatch = mongoose.model('VideoWatch', VideoWatchSchema);
const McTicket = mongoose.model('McTicket', McTicketSchema);
const McTicketTranscript = mongoose.model('McTicketTranscript', McTicketTranscriptSchema);
const McTicketImage = mongoose.model('McTicketImage', McTicketImageSchema);
const BlacklistEntry = mongoose.model('BlacklistEntry', BlacklistEntrySchema);
const TicketBlock = mongoose.model('TicketBlock', TicketBlockSchema);
const TempRole = mongoose.model('TempRole', TempRoleSchema);
const DropmapImage = mongoose.model('DropmapImage', DropmapImageSchema);
const DropmapLog = mongoose.model('DropmapLog', DropmapLogSchema);
const DropmapCode = mongoose.model('DropmapCode', DropmapCodeSchema);
const DropmapFile = mongoose.model('DropmapFile', DropmapFileSchema);
const ModInviteLog = mongoose.model('ModInviteLog', ModInviteLogSchema);
const InviteTracking = mongoose.model('InviteTracking', InviteTrackingSchema);
const JoinLeaveEvent = mongoose.model('JoinLeaveEvent', JoinLeaveEventSchema);

const RoleSyncRuleSchema = new mongoose.Schema({
    sourceGuildId: { type: String, required: true, index: true },
    sourceRoleId: { type: String, default: null },
    targetGuildId: { type: String, required: true, index: true },
    targetRoleId: { type: String, default: null },
    createdById: { type: String, default: null }
}, { timestamps: true });

const RoleSyncRule = mongoose.model('RoleSyncRule', RoleSyncRuleSchema);

async function listRoleSyncRulesDB() {
    return RoleSyncRule.find({}).sort({ createdAt: 1 }).lean();
}

async function createRoleSyncRuleDB(data) {
    const doc = await RoleSyncRule.create(data);
    return doc.toObject();
}

async function updateRoleSyncRuleDB(ruleId, data) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) return null;
    return RoleSyncRule.findByIdAndUpdate(ruleId, { $set: data }, { new: true }).lean();
}

async function deleteRoleSyncRuleDB(ruleId) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) return false;
    const res = await RoleSyncRule.deleteOne({ _id: ruleId });
    return res.deletedCount > 0;
}

async function getRoleSyncRuleDB(ruleId) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) return null;
    return RoleSyncRule.findById(ruleId).lean();
}

async function createModLog(data) {
    const caseId = await getNextSeq(`modlog_${data.guildId}`, async () => {
        const last = await ModLog.findOne({ guildId: data.guildId }).sort({ caseId: -1 }).lean();
        return last ? last.caseId : 0;
    });
    const doc = await ModLog.create({ ...data, caseId });
    return doc.toObject();
}

async function getModLogsByTarget(guildId, targetId, limit = 10) {
    return ModLog.find({ guildId, targetId }).sort({ date: -1 }).limit(limit).lean();
}

async function getModLogsByGuild(guildId, limit = 50) {
    return ModLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function getModLogsByModerator(guildId, moderatorId, limit = 50) {
    return ModLog.find({ guildId, moderatorId }).sort({ date: -1 }).limit(limit).lean();
}

async function addWarningDB(data) {
    const warningId = await getNextSeq(`warning_${data.guildId}_${data.userId}`, async () => {
        const last = await Warning.findOne({ guildId: data.guildId, userId: data.userId }).sort({ warningId: -1 }).lean();
        return last ? last.warningId : 0;
    });
    const doc = await Warning.create({ ...data, warningId });
    return doc.toObject();
}

async function getUserWarningsDB(guildId, userId) {
    return Warning.find({ guildId, userId, active: true }).sort({ warningId: 1 }).lean();
}

async function removeWarningDB(guildId, userId, warningId) {
    const result = await Warning.findOneAndDelete({ guildId, userId, warningId: parseInt(warningId) });
    return !!result;
}

async function clearWarningsDB(guildId, userId) {
    const result = await Warning.deleteMany({ guildId, userId });
    return result.deletedCount > 0;
}

async function getGuildConfigDB(guildId) {
    const config = await GuildConfig.findOneAndUpdate(
        { guildId },
        { $setOnInsert: { guildId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return config;
}

async function saveGuildConfigDB(guildId, key, value) {
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { [key]: value } },
        { upsert: true, new: true }
    );
}

async function getDashboardPermissionsDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    const perms = config.dashboardPermissions || {};
    return {
        createRoles: perms.createRoles || [],
        editRoles: perms.editRoles || [],
        deleteRoles: perms.deleteRoles || [],
        viewLogsRoles: perms.viewLogsRoles || []
    };
}

async function saveDashboardPermissionsDB(guildId, perms) {
    await GuildConfig.findOneAndUpdate(
        { guildId },
        {
            $set: {
                dashboardPermissions: {
                    createRoles: Array.isArray(perms.createRoles) ? perms.createRoles : [],
                    editRoles: Array.isArray(perms.editRoles) ? perms.editRoles : [],
                    deleteRoles: Array.isArray(perms.deleteRoles) ? perms.deleteRoles : [],
                    viewLogsRoles: Array.isArray(perms.viewLogsRoles) ? perms.viewLogsRoles : []
                }
            }
        },
        { upsert: true, new: true }
    );
}

async function getDashboardSpecialUsersDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    const users = config.dashboardSpecialUsers || {};
    return {
        adminUsers: users.adminUsers || [],
        ownerUsers: users.ownerUsers || []
    };
}

async function saveDashboardSpecialUsersDB(guildId, users) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];

    await GuildConfig.findOneAndUpdate(
        { guildId },
        {
            $set: {
                dashboardSpecialUsers: {
                    adminUsers: filterIds(users.adminUsers),
                    ownerUsers: filterIds(users.ownerUsers)
                }
            }
        },
        { upsert: true, new: true }
    );
}

async function getProjectedRolesDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    return config.projectedRoles || [];
}

async function saveProjectedRolesDB(guildId, roles) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { projectedRoles: filterIds(roles) } },
        { upsert: true, new: true }
    );
}

async function getVideoAccessRolesDB(guildId) {
    const config = await getGuildConfigDB(guildId);
    return config.videoAccessRoleIds || [];
}

async function saveVideoAccessRolesDB(guildId, roles) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];
    await GuildConfig.findOneAndUpdate(
        { guildId },
        { $set: { videoAccessRoleIds: filterIds(roles) } },
        { upsert: true, new: true }
    );
}

async function loadCustomCommandsDB(guildId) {
    const docs = await CustomCommand.find({ guildId }).lean();
    const obj = {};
    for (const doc of docs) {
        obj[doc.name.toLowerCase()] = {
            name: doc.name,
            prefix: doc.prefix || '*',
            type: doc.type,
            title: doc.title,
            response: doc.response,
            color: doc.color,
            permission: doc.permission,
            deleteCommand: doc.deleteCommand,
            thumbnail: doc.thumbnail,
            image: doc.image,
            extraEmbeds: doc.extraEmbeds || [],
            allowedRoles: doc.allowedRoles || [],
            duration: doc.duration || null,
            isBase: doc.isBase || false,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }
    return obj;
}

async function saveCustomCommandDB(guildId, name, data) {
    await CustomCommand.findOneAndUpdate(
        { guildId, name: name.toLowerCase() },
        { $set: { ...data, name: name.toLowerCase(), guildId, updatedAt: new Date() } },
        { upsert: true, new: true }
    );
}

async function deleteCustomCommandDB(guildId, name) {
    const result = await CustomCommand.deleteOne({ guildId, name: name.toLowerCase() });
    return result.deletedCount > 0;
}

async function getBaseCommandsCount(guildId) {
    return await CustomCommand.countDocuments({ guildId, isBase: true });
}

async function setIsBaseDB(guildId, name, isBase) {
    const result = await CustomCommand.findOneAndUpdate(
        { guildId, name: name.toLowerCase() },
        { $set: { isBase: !!isBase, updatedAt: new Date() } },
        { new: true }
    );
    return result ? result.toObject() : null;
}

async function getCommandCooldownDB(userId, guildId, action) {
    const cd = await CommandCooldown.findOne({ userId, guildId, action }).lean();
    if (!cd) return null;
    if (new Date(cd.expiresAt).getTime() < Date.now()) {
        await CommandCooldown.deleteOne({ userId, guildId, action });
        return null;
    }
    return cd;
}

async function setCommandCooldownDB(userId, guildId, action, seconds) {
    const expiresAt = new Date(Date.now() + seconds * 1000);
    await CommandCooldown.findOneAndUpdate(
        { userId, guildId, action },
        { $set: { expiresAt } },
        { upsert: true, new: true }
    );
}

async function addPendingBan(data) {
    return await PendingBan.create(data);
}

async function getExpiredBans() {
    return await PendingBan.find({ expiresAt: { $lte: new Date() } }).lean();
}

async function removePendingBan(guildId, userId) {
    return await PendingBan.deleteOne({ guildId, userId });
}

async function getPendingBan(guildId, userId) {
    return await PendingBan.findOne({ guildId, userId }).lean();
}

async function saveDashboardLogDB(guildId, data) {
    try {
        const doc = await DashboardLog.create({
            guildId,
            type: data.type || 'generic',
            action: data.action || 'unknown',
            userId: data.userId || null,
            userTag: data.userTag || null,
            targetId: data.targetId || null,
            targetTag: data.targetTag || null,
            moderatorId: data.moderatorId || null,
            moderatorTag: data.moderatorTag || null,
            reason: data.reason || null,
            details: data.details || null,
            channelId: data.channelId || null,
            transcriptId: data.transcriptId || null,
            extra: data.extra || null,
            date: new Date()
        });
        return doc.toObject();
    } catch (err) {
        console.error('[DB] saveDashboardLogDB error:', err.message);
        return null;
    }
}

async function getDashboardLogsDB(guildId, limit = 200) {
    return DashboardLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function getBanLogsDB(guildId, limit = 200) {
    return DashboardLog.find({ guildId, action: { $in: ['user_banned', 'user_banned_auto'] } }).sort({ date: -1 }).limit(limit).lean();
}

async function updateBanReasonDB(guildId, userId, newReason) {
    await DashboardLog.findOneAndUpdate(
        { guildId, targetId: userId, action: { $in: ['user_banned', 'user_banned_auto'] } },
        { $set: { reason: newReason } },
        { sort: { date: -1 } }
    );
    await ModLog.findOneAndUpdate(
        { guildId, targetId: userId, action: { $regex: /ban/i } },
        { $set: { reason: newReason } },
        { sort: { date: -1 } }
    );
}

async function saveTranscriptDB(data) {
    try {
        const doc = await Transcript.create({
            guildId: data.guildId,
            channelId: data.channelId,
            channelName: data.channelName,
            ticketType: data.ticketType || 'support',
            ticketOwnerId: data.ticketOwnerId || null,
            ticketOwnerTag: data.ticketOwnerTag || null,
            createdBy: data.createdBy || null,
            createdByTag: data.createdByTag || null,
            claimedBy: data.claimedBy || null,
            claimedByTag: data.claimedByTag || null,
            closedBy: data.closedBy || null,
            closedByTag: data.closedByTag || null,
            messages: data.messages || [],
            createdAt: data.createdAt || new Date(),
            closedAt: data.closedAt || new Date()
        });
        return doc.toObject();
    } catch (err) {
        console.error('[DB] saveTranscriptDB error:', err.message);
        return null;
    }
}

async function getTranscriptDB(guildId, transcriptId) {
    return Transcript.findOne({ _id: transcriptId, guildId }).lean();
}

async function getTranscriptsByGuildDB(guildId, limit = 100) {
    return Transcript.find({ guildId }).sort({ closedAt: -1 }).limit(limit).lean();
}

async function deleteTranscriptDB(guildId, transcriptId) {
    const res = await Transcript.deleteOne({ _id: transcriptId, guildId });
    return res.deletedCount > 0;
}

async function createVideoDB(data) {
    const video = await Video.create(data);
    return video.toObject();
}

async function listVideosDB() {
    return Video.find({}).sort({ createdAt: -1 }).lean();
}

async function getVideoDB(videoId) {
    return Video.findById(videoId).lean().catch(() => null);
}

async function getVideoHlsMetaDB(videoId) {
    return Video.findById(videoId).select('hlsReady hlsSegments').lean().catch(() => null);
}

async function getVideoByFileId(fileId) {
    return Video.findOne({ fileId }).lean().catch(() => null);
}

async function updateVideoDB(videoId, data) {
    return Video.findByIdAndUpdate(videoId, { $set: data }, { new: true }).lean();
}

async function deleteVideoDB(videoId) {
    await Video.findByIdAndDelete(videoId);
}

async function getMasterclassSettingsDB() {
    const settings = await MasterclassSettings.findOneAndUpdate(
        { key: 'global' },
        { $setOnInsert: { key: 'global' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return settings;
}

async function saveMasterclassSettingsDB(data) {
    const filterIds = (arr) => Array.isArray(arr) ? arr.filter(r => typeof r === 'string' && /^\d+$/.test(r)) : [];
    const settings = await MasterclassSettings.findOneAndUpdate(
        { key: 'global' },
        {
            $set: {
                viewUserIds: filterIds(data.viewUserIds),
                uploadUserIds: filterIds(data.uploadUserIds),
                manageUserIds: filterIds(data.manageUserIds),
                ticketStaffUserIds: filterIds(data.ticketStaffUserIds),
                ticketNotifyChannelId: (typeof data.ticketNotifyChannelId === 'string' && /^\d+$/.test(data.ticketNotifyChannelId.trim())) ? data.ticketNotifyChannelId.trim() : ''
            }
        },
        { upsert: true, new: true }
    ).lean();
    return settings;
}

async function createMcTicketDB(data) {
    const ticketNumber = await getNextSeq('mc_ticket', async () => {
        const last = await McTicket.findOne({}).sort({ ticketNumber: -1 }).lean();
        return last ? last.ticketNumber : 0;
    });
    const doc = await McTicket.create({ ...data, ticketNumber, lastMessageAt: new Date() });
    return doc.toObject();
}

async function getMcTicketDB(ticketNumber) {
    return McTicket.findOne({ ticketNumber }).lean();
}

async function findOpenMcTicketDB(userId) {
    return McTicket.findOne({ userId, status: 'open' }).lean();
}

async function listMcTicketsDB(status) {
    const filter = (status === 'open' || status === 'closed') ? { status } : {};
    return McTicket.find(filter).select({ messages: { $slice: -1 } }).sort({ lastMessageAt: -1 }).limit(500).lean();
}

async function listUserMcTicketsDB(userId) {
    return McTicket.find({ userId }).select({ messages: 0 }).sort({ lastMessageAt: -1 }).limit(50).lean();
}

async function addMcTicketMessageDB(ticketNumber, message) {
    const doc = await McTicket.findOneAndUpdate(
        { ticketNumber },
        { $push: { messages: { ...message, date: new Date() } }, $set: { lastMessageAt: new Date() } },
        { new: true, projection: { messages: { $slice: -1 } } }
    ).lean();
    return doc && doc.messages && doc.messages[0] ? doc.messages[0] : null;
}

async function setMcTicketStatusDB(ticketNumber, status, by) {
    const update = status === 'closed'
        ? { status: 'closed', closedAt: new Date(), closedById: by ? by.id : null, closedByName: by ? by.name : null }
        : { status: 'open', closedAt: null, closedById: null, closedByName: null };
    return McTicket.findOneAndUpdate({ ticketNumber }, { $set: update }, { new: true, projection: { messages: 0 } }).lean();
}

async function claimMcTicketDB(ticketNumber, by, expectedClaimerId) {
    const filter = { ticketNumber };
    if (expectedClaimerId !== undefined) filter.claimedById = expectedClaimerId;
    const update = by
        ? { claimedById: by.id, claimedByName: by.name, claimedAt: new Date() }
        : { claimedById: null, claimedByName: null, claimedAt: null };
    return McTicket.findOneAndUpdate(filter, { $set: update }, { new: true, projection: { messages: 0 } }).lean();
}

async function saveMcTicketTranscriptDB(ticket, deletedAt) {
    const data = {
        ticketNumber: ticket.ticketNumber,
        userId: ticket.userId,
        userName: ticket.userName,
        userAvatar: ticket.userAvatar,
        email: ticket.email,
        planKey: ticket.planKey,
        plan: ticket.plan,
        price: ticket.price,
        claimedById: ticket.claimedById || null,
        claimedByName: ticket.claimedByName || null,
        closedById: ticket.closedById || null,
        closedByName: ticket.closedByName || null,
        openedAt: ticket.createdAt || null,
        closedAt: ticket.closedAt || new Date(),
        messages: (ticket.messages || []).map(m => ({
            _id: m._id,
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
    if (deletedAt) data.deletedAt = deletedAt;
    return McTicketTranscript.findOneAndUpdate(
        { ticketNumber: ticket.ticketNumber },
        { $set: data },
        { upsert: true, new: true }
    ).lean();
}

async function createMcTicketImageDB(data) {
    const doc = await McTicketImage.create(data);
    return String(doc._id);
}

async function getMcTicketImageDB(imageId) {
    if (!mongoose.Types.ObjectId.isValid(imageId)) return null;
    return McTicketImage.findById(imageId).lean();
}

async function getMcTicketTranscriptDB(ticketNumber) {
    return McTicketTranscript.findOne({ ticketNumber }).lean();
}

async function listMcTicketTranscriptsDB() {
    return McTicketTranscript.find({}).select({ messages: { $slice: -1 } }).sort({ closedAt: -1 }).limit(500).lean();
}

async function deleteExpiredMcTicketsDB(cutoff) {
    const expired = await McTicket.find({ status: 'closed', closedAt: { $ne: null, $lte: cutoff } }).lean();
    const deleted = [];
    for (const ticket of expired) {
        const saved = await saveMcTicketTranscriptDB(ticket, new Date());
        if (!saved) continue;
        await McTicket.deleteOne({ _id: ticket._id, status: 'closed' });
        deleted.push(ticket);
    }
    return deleted;
}

async function markVideoWatchedDB(userId, videoId) {
    await VideoWatch.findOneAndUpdate(
        { userId, videoId },
        { $setOnInsert: { userId, videoId }, $set: { progress: 1, completed: true } },
        { upsert: true }
    );
}

async function saveVideoProgressDB(userId, videoId, progress, positionSeconds) {
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
    const posRaw = Math.max(0, Number(positionSeconds) || 0);
    const existing = await VideoWatch.findOne({ userId, videoId }).lean();
    const nextProgress = Math.max(existing ? existing.progress || 0 : 0, clamped);
    const nextPosition = Math.max(existing ? existing.positionSeconds || 0 : 0, posRaw);
    const completed = (existing && existing.completed) || nextProgress >= 0.95;
    await VideoWatch.findOneAndUpdate(
        { userId, videoId },
        { $setOnInsert: { userId, videoId }, $set: { progress: completed ? 1 : nextProgress, positionSeconds: nextPosition, completed } },
        { upsert: true }
    );
    return { progress: completed ? 1 : nextProgress, positionSeconds: nextPosition, completed };
}

async function getVideoProgressMapDB(userId) {
    const docs = await VideoWatch.find({ userId }).select('videoId progress positionSeconds completed').lean();
    const map = {};
    docs.forEach((d) => { map[d.videoId] = { progress: d.progress || 0, positionSeconds: d.positionSeconds || 0, completed: !!d.completed }; });
    return map;
}

async function getWatchedVideoIdsDB(userId) {
    const docs = await VideoWatch.find({ userId, completed: true }).select('videoId').lean();
    return docs.map(d => d.videoId);
}

let videoBucket = null;
function getVideoBucket() {
    if (!videoBucket) {
        videoBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'videos' });
    }
    return videoBucket;
}

async function getVideoFileMeta(fileId) {
    return mongoose.connection.db.collection('videos.files').findOne({ _id: fileId });
}

async function deleteVideoFile(fileId) {
    try {
        await getVideoBucket().delete(fileId);
    } catch (e) {
        console.error('[DB] deleteVideoFile error:', e.message);
    }
}

async function saveHlsSegmentsDB(videoId, segments) {
    return Video.findByIdAndUpdate(
        videoId,
        { $set: { hlsSegments: segments, hlsReady: true }, $unset: { fileId: 1 } },
        { new: true }
    ).lean();
}

async function addBlacklistEntryDB(data) {
    return BlacklistEntry.findOneAndUpdate(
        { userId: data.userId },
        { $set: data },
        { new: true, upsert: true }
    ).lean();
}

async function removeBlacklistEntryDB(userId) {
    const result = await BlacklistEntry.findOneAndDelete({ userId });
    return !!result;
}

async function getBlacklistEntryDB(userId) {
    return BlacklistEntry.findOne({ userId }).lean();
}

async function getAllBlacklistDB() {
    return BlacklistEntry.find({}).lean();
}

async function getBlacklistSyncGuildIdsDB() {
    const configs = await GuildConfig.find({ blacklistSyncEnabled: true }).select('guildId').lean();
    return configs.map(c => c.guildId);
}

async function updateBlacklistReasonDB(userId, newReason) {
    return BlacklistEntry.findOneAndUpdate({ userId }, { $set: { reason: newReason } }, { new: true }).lean();
}

async function addTicketBlockDB(data) {
    return TicketBlock.findOneAndUpdate(
        { guildId: data.guildId, userId: data.userId },
        { $set: data },
        { new: true, upsert: true }
    ).lean();
}

async function removeTicketBlockDB(guildId, userId) {
    const result = await TicketBlock.findOneAndDelete({ guildId, userId });
    return !!result;
}

async function getTicketBlockDB(guildId, userId) {
    return TicketBlock.findOne({ guildId, userId }).lean();
}

async function getExpiredTicketBlocksDB() {
    return TicketBlock.find({ expiresAt: { $lte: new Date() } }).lean();
}

async function addTempRoleDB(data) {
    return TempRole.findOneAndUpdate(
        { guildId: data.guildId, userId: data.userId, roleId: data.roleId },
        { $set: data },
        { new: true, upsert: true }
    ).lean();
}

async function removeTempRoleDB(guildId, userId, roleId) {
    const result = await TempRole.findOneAndDelete({ guildId, userId, roleId });
    return !!result;
}

async function getExpiredTempRolesDB() {
    return TempRole.find({ expiresAt: { $lte: new Date() } }).lean();
}

async function getTempRolesByGuildDB(guildId) {
    return TempRole.find({ guildId }).lean();
}

async function saveDropmapImageDB(data) {
    return DropmapImage.findOneAndUpdate(
        { guildId: data.guildId, areaName: data.areaName },
        { $set: data },
        { new: true, upsert: true }
    ).lean();
}

async function deleteDropmapImageDB(guildId, areaName) {
    const result = await DropmapImage.findOneAndDelete({ guildId, areaName });
    return !!result;
}

async function getDropmapImagesDB(guildId) {
    return DropmapImage.find({ guildId }).lean();
}

async function getDropmapImageDB(guildId, areaName) {
    return DropmapImage.findOne({ guildId, areaName }).lean();
}

async function renameDropmapAreaDB(guildId, oldName, newName) {
    const updated = await DropmapImage.findOneAndUpdate(
        { guildId, areaName: oldName },
        { $set: { areaName: newName } },
        { new: true }
    ).lean();
    if (updated) await DropmapCode.updateMany({ guildId, areaName: oldName }, { $set: { areaName: newName } });
    return updated;
}

async function setDropmapSubAreasDB(guildId, areaName, subAreas) {
    return DropmapImage.findOneAndUpdate(
        { guildId, areaName },
        { $set: { subAreas } },
        { new: true }
    ).lean();
}

async function listDropmapCodesDB(guildId) {
    return DropmapCode.find({ guildId }).lean();
}

async function getDropmapCodeDB(guildId, type, number) {
    return DropmapCode.findOne({ guildId, type, number }).lean();
}

async function getDropmapCodeForItemDB(guildId, areaName, subAreaName) {
    return DropmapCode.findOne({ guildId, areaName, subAreaName: subAreaName || null }).lean();
}

async function setDropmapCodeDB(guildId, areaName, subAreaName, type, number) {
    const sub = subAreaName || null;
    await DropmapCode.deleteOne({ guildId, areaName, subAreaName: sub });
    if (!type) return null;
    const doc = await DropmapCode.create({ guildId, areaName, subAreaName: sub, type, number });
    return doc.toObject();
}

async function deleteDropmapCodesDB(guildId, areaName, subAreaName) {
    const filter = { guildId, areaName };
    if (subAreaName !== undefined) filter.subAreaName = subAreaName || null;
    await DropmapCode.deleteMany(filter);
}

async function renameDropmapSubAreaCodeDB(guildId, areaName, oldSub, newSub) {
    await DropmapCode.updateOne({ guildId, areaName, subAreaName: oldSub }, { $set: { subAreaName: newSub } });
}

async function createDropmapFileDB(data) {
    const doc = await DropmapFile.create(data);
    return String(doc._id);
}

async function getDropmapFileDB(fileId) {
    if (!mongoose.Types.ObjectId.isValid(fileId)) return null;
    return DropmapFile.findById(fileId).lean();
}

async function deleteDropmapFileDB(fileId) {
    if (!mongoose.Types.ObjectId.isValid(fileId)) return false;
    const result = await DropmapFile.findByIdAndDelete(fileId);
    return !!result;
}

async function addDropmapLogDB(data) {
    const doc = await DropmapLog.create(data);
    return doc.toObject();
}

async function getDropmapLogsDB(guildId, limit = 200) {
    return DropmapLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function addModInviteLogDB(data) {
    const doc = await ModInviteLog.create(data);
    return doc.toObject();
}

async function getModInviteLogsDB(guildId, limit = 200) {
    return ModInviteLog.find({ guildId }).sort({ date: -1 }).limit(limit).lean();
}

async function addInviteTrackingDB(data) {
    return InviteTracking.findOneAndUpdate(
        { guildId: data.guildId, userId: data.userId },
        { $set: data },
        { new: true, upsert: true }
    ).lean();
}

async function getInviteTrackingDB(guildId, userId) {
    return InviteTracking.findOne({ guildId, userId }).lean();
}

async function addJoinLeaveEventDB(data) {
    try {
        const doc = await JoinLeaveEvent.create(data);
        return doc.toObject();
    } catch (e) {
        if (e.code === 11000) return null;
        throw e;
    }
}

async function getJoinLeaveStatsDB(guildId, startTime, endTime) {
    const joins = await JoinLeaveEvent.countDocuments({ guildId, type: 'join', date: { $gte: startTime, $lte: endTime } });
    const leaves = await JoinLeaveEvent.countDocuments({ guildId, type: 'leave', date: { $gte: startTime, $lte: endTime } });
    return { joins, leaves };
}

async function getJoinLeaveTotalsDB(guildId) {
    const joins = await JoinLeaveEvent.countDocuments({ guildId, type: 'join' });
    const leaves = await JoinLeaveEvent.countDocuments({ guildId, type: 'leave' });
    return { joins, leaves };
}

async function getJoinLeaveSeriesDB(guildId, startTime, endTime) {
    const rows = await JoinLeaveEvent.aggregate([
        { $match: { guildId, date: { $gte: startTime, $lte: endTime } } },
        {
            $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, type: '$type' },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.day': 1 } }
    ]);

    const byDay = {};
    for (const row of rows) {
        const day = row._id.day;
        if (!byDay[day]) byDay[day] = { day, joins: 0, leaves: 0 };
        if (row._id.type === 'join') byDay[day].joins = row.count;
        else if (row._id.type === 'leave') byDay[day].leaves = row.count;
    }

    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
}

async function getTicketStatsByModeratorDB(guildId, sinceDate) {
    const match = { guildId };
    if (sinceDate) match.closedAt = { $gte: sinceDate };
    const rows = await Transcript.aggregate([
        { $match: match },
        { $match: { closedBy: { $ne: null } } },
        { $group: { _id: { id: '$closedBy', tag: '$closedByTag' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]);
    return rows.map(r => ({ moderatorId: r._id.id, moderatorTag: r._id.tag, count: r.count }));
}

async function getModeratorActionStatsDB(guildId, moderatorId) {
    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const actionGroups = {
        mute: ['User muted', 'MUTE', 'TIMEOUT'],
        ban: ['User banned', 'BAN'],
        kick: ['User kicked', 'KICK'],
        warn: ['User warned', 'WARN']
    };
    const result = {};
    for (const [label, actions] of Object.entries(actionGroups)) {
        const base = { guildId, moderatorId, action: { $in: actions } };
        const [d7, d30, all] = await Promise.all([
            ModLog.countDocuments({ ...base, date: { $gte: day7 } }),
            ModLog.countDocuments({ ...base, date: { $gte: day30 } }),
            ModLog.countDocuments(base)
        ]);
        result[label] = { day7, day30, all };
    }
    return result;
}

module.exports = {
    connectDB,
    Counter,
    getNextSeq,
    ModLog,
    Warning,
    GuildConfig,
    CustomCommand,
    PendingBan,
    CommandCooldown,
    DashboardLog,
    createModLog,
    getModLogsByTarget,
    getModLogsByGuild,
    getModLogsByModerator,
    addWarningDB,
    getUserWarningsDB,
    removeWarningDB,
    clearWarningsDB,
    getGuildConfigDB,
    saveGuildConfigDB,
    getDashboardPermissionsDB,
    saveDashboardPermissionsDB,
    getDashboardSpecialUsersDB,
    saveDashboardSpecialUsersDB,
    getProjectedRolesDB,
    saveProjectedRolesDB,
    loadCustomCommandsDB,
    saveCustomCommandDB,
    deleteCustomCommandDB,
    getBaseCommandsCount,
    setIsBaseDB,
    getCommandCooldownDB,
    setCommandCooldownDB,
    addPendingBan,
    getExpiredBans,
    removePendingBan,
    getPendingBan,
    saveDashboardLogDB,
    getDashboardLogsDB,
    getBanLogsDB,
    updateBanReasonDB,
    Transcript,
    saveTranscriptDB,
    getTranscriptDB,
    getTranscriptsByGuildDB,
    deleteTranscriptDB,
    Video,
    createVideoDB,
    listVideosDB,
    getVideoDB,
    getVideoHlsMetaDB,
    getVideoByFileId,
    updateVideoDB,
    deleteVideoDB,
    getVideoBucket,
    getVideoFileMeta,
    deleteVideoFile,
    saveHlsSegmentsDB,
    getVideoAccessRolesDB,
    saveVideoAccessRolesDB,
    MasterclassSettings,
    getMasterclassSettingsDB,
    saveMasterclassSettingsDB,
    VideoWatch,
    McTicket,
    createMcTicketDB,
    getMcTicketDB,
    findOpenMcTicketDB,
    listMcTicketsDB,
    listUserMcTicketsDB,
    addMcTicketMessageDB,
    setMcTicketStatusDB,
    McTicketTranscript,
    McTicketImage,
    createMcTicketImageDB,
    getMcTicketImageDB,
    claimMcTicketDB,
    saveMcTicketTranscriptDB,
    getMcTicketTranscriptDB,
    listMcTicketTranscriptsDB,
    deleteExpiredMcTicketsDB,
    markVideoWatchedDB,
    saveVideoProgressDB,
    getVideoProgressMapDB,
    getWatchedVideoIdsDB,
    BlacklistEntry,
    addBlacklistEntryDB,
    removeBlacklistEntryDB,
    getBlacklistEntryDB,
    getAllBlacklistDB,
    getBlacklistSyncGuildIdsDB,
    updateBlacklistReasonDB,
    TicketBlock,
    addTicketBlockDB,
    removeTicketBlockDB,
    getTicketBlockDB,
    getExpiredTicketBlocksDB,
    TempRole,
    addTempRoleDB,
    removeTempRoleDB,
    getExpiredTempRolesDB,
    getTempRolesByGuildDB,
    DropmapImage,
    saveDropmapImageDB,
    deleteDropmapImageDB,
    getDropmapImagesDB,
    DropmapLog,
    addDropmapLogDB,
    getDropmapLogsDB,
    DropmapCode,
    DropmapFile,
    getDropmapImageDB,
    renameDropmapAreaDB,
    setDropmapSubAreasDB,
    listDropmapCodesDB,
    getDropmapCodeDB,
    getDropmapCodeForItemDB,
    setDropmapCodeDB,
    deleteDropmapCodesDB,
    renameDropmapSubAreaCodeDB,
    createDropmapFileDB,
    getDropmapFileDB,
    deleteDropmapFileDB,
    ModInviteLog,
    addModInviteLogDB,
    getModInviteLogsDB,
    InviteTracking,
    addInviteTrackingDB,
    getInviteTrackingDB,
    JoinLeaveEvent,
    addJoinLeaveEventDB,
    getJoinLeaveStatsDB,
    getJoinLeaveTotalsDB,
    getJoinLeaveSeriesDB,
    getTicketStatsByModeratorDB,
    getModeratorActionStatsDB,
    RoleSyncRule,
    listRoleSyncRulesDB,
    createRoleSyncRuleDB,
    updateRoleSyncRuleDB,
    deleteRoleSyncRuleDB,
    getRoleSyncRuleDB,
};
