const { Client, GatewayIntentBits } = require('discord.js');

const clientLogs = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

const clientRoles = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ]
});

let logsReady = false;
let rolesReady = false;

clientLogs.on('error', (error) => console.error('[LOGS BOT ERROR]', error));
clientLogs.on('shardError', (error) => console.error('[LOGS BOT SHARD ERROR]', error));
clientRoles.on('error', (error) => console.error('[ROLES BOT ERROR]', error));
clientRoles.on('shardError', (error) => console.error('[ROLES BOT SHARD ERROR]', error));

clientLogs.once('clientReady', () => {
    logsReady = true;
    clientLogs.user.setPresence({ status: 'invisible' });
    console.log(`Bot Logs connected as ${clientLogs.user.tag}`);
});

clientRoles.once('clientReady', () => {
    rolesReady = true;
    clientRoles.user.setPresence({ status: 'invisible' });
    console.log(`Bot Roles connected as ${clientRoles.user.tag}`);
});

async function loginClientWithRetry(botClient, token, label, retries = 5, delay = 10000) {
    for (let i = 1; i <= retries; i++) {
        try {
            await botClient.login(token);
            return true;
        } catch (error) {
            console.error(`[${label} LOGIN_ERROR] attempt ${i}/${retries}`, error.message);
            if (i === retries) {
                console.error(`[${label}] login fallito dopo tutti i tentativi`);
                return false;
            }
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    return false;
}

async function startSecondaryBots() {
    if (process.env.DISCORD_TOKEN_LOGS) {
        await loginClientWithRetry(clientLogs, process.env.DISCORD_TOKEN_LOGS, 'LOGS');
    } else {
        console.warn('[BOTS] DISCORD_TOKEN_LOGS non configurato, i log passeranno dal bot principale');
    }

    if (process.env.DISCORD_TOKEN_ROLES) {
        await loginClientWithRetry(clientRoles, process.env.DISCORD_TOKEN_ROLES, 'ROLES');
    } else {
        console.warn('[BOTS] DISCORD_TOKEN_ROLES non configurato, i ruoli passeranno dal bot principale');
    }
}

function getLogsClient(fallbackClient) {
    return logsReady ? clientLogs : fallbackClient;
}

function getRolesClient(fallbackClient) {
    return rolesReady ? clientRoles : fallbackClient;
}

module.exports = {
    clientLogs,
    clientRoles,
    startSecondaryBots,
    getLogsClient,
    getRolesClient,
    isLogsReady: () => logsReady,
    isRolesReady: () => rolesReady
};