const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');

const DROPMAP_ROLE_ID = '1348738768223469695';
const DROPMAP_GUILD_ID = '1341033385090486323';
const DROPMAP_DURATION_DAYS = 30;
const DROPMAP_COLOR = 0x6B6E73;
const UPLOAD_PREFIX = 'upload:';
const MENU_TIMEOUT_MS = 60000;
const URL_CACHE_MS = 6 * 60 * 60 * 1000;

function createDropmap({ client, db, botClients, getGuildConfig, logCrash, thumbnailUrl }) {
    const activeMessages = new Map();
    const sessions = new Map();
    const refreshedUrls = new Map();

    function report(type, error, context) {
        if (typeof logCrash === 'function') logCrash(type, error, context || {});
        else console.error(`[DROPMAP] ${type}:`, error && error.message ? error.message : error);
    }

    function isHttpUrl(value) {
        if (!value || typeof value !== 'string') return false;
        try {
            const u = new URL(value);
            return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
            return false;
        }
    }

    function isValidImageRef(value) {
        if (!value || typeof value !== 'string') return false;
        if (value.startsWith(UPLOAD_PREFIX)) return /^[a-f0-9]{24}$/i.test(value.slice(UPLOAD_PREFIX.length));
        return isHttpUrl(value);
    }

    function isDiscordCdn(value) {
        try {
            const host = new URL(value).hostname;
            return host === 'cdn.discordapp.com' || host === 'media.discordapp.net';
        } catch {
            return false;
        }
    }

    async function refreshDiscordUrl(url) {
        if (!isDiscordCdn(url)) return url;
        const cached = refreshedUrls.get(url);
        if (cached && cached.expires > Date.now()) return cached.url;
        try {
            const result = await client.rest.post('/attachments/refresh-urls', { body: { attachment_urls: [url] } });
            const fresh = result && result.refreshed_urls && result.refreshed_urls[0] && result.refreshed_urls[0].refreshed;
            if (fresh) {
                refreshedUrls.set(url, { url: fresh, expires: Date.now() + URL_CACHE_MS });
                return fresh;
            }
        } catch (err) {
            report('DROPMAP_URL_REFRESH', err, { url });
        }
        return url;
    }

    function extensionFor(contentType) {
        if (contentType === 'image/jpeg') return 'jpg';
        if (contentType === 'image/webp') return 'webp';
        if (contentType === 'image/gif') return 'gif';
        return 'png';
    }

    async function resolveImage(ref) {
        if (!ref) return null;
        if (ref.startsWith(UPLOAD_PREFIX)) {
            const file = await db.getDropmapFileDB(ref.slice(UPLOAD_PREFIX.length));
            if (!file || !file.data) return null;
            const name = `dropmap.${extensionFor(file.contentType)}`;
            const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data.buffer || file.data);
            return { url: `attachment://${name}`, files: [new AttachmentBuilder(buffer, { name })] };
        }
        if (!isHttpUrl(ref)) return null;
        return { url: await refreshDiscordUrl(ref), files: [] };
    }

    function getCommunityGuildId() {
        return process.env.COMMUNITY_GUILD_ID || null;
    }

    function sortNames(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    async function loadAreas(guildId) {
        const docs = await db.getDropmapImagesDB(guildId);
        return docs.filter(d => !d.isMiniarea).sort((a, b) => sortNames(a.areaName, b.areaName))
            .concat(docs.filter(d => d.isMiniarea).sort((a, b) => sortNames(a.areaName, b.areaName)));
    }

    function sortedSubs(area) {
        return Object.keys(area.subAreas || {}).sort(sortNames);
    }

    function getItemImage(area, subAreaName) {
        if (!area) return null;
        if (subAreaName) return (area.subAreas || {})[subAreaName] || null;
        return area.imageUrl || null;
    }

    function findDropmapRoleGuild() {
        const rolesClient = botClients.getRolesClient(client);
        const communityId = getCommunityGuildId();
        const candidates = [];
        if (communityId) candidates.push(communityId);
        for (const id of rolesClient.guilds.cache.keys()) if (!candidates.includes(id)) candidates.push(id);
        for (const id of candidates) {
            const g = rolesClient.guilds.cache.get(id);
            if (g && g.roles.cache.has(DROPMAP_ROLE_ID)) return g;
        }
        return null;
    }

    async function canUseDropmap(member) {
        if (!member) return false;
        if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
        const config = await getGuildConfig(member.guild.id);
        const has = (id) => !!id && member.roles.cache.has(id);
        if (has(config.adminRoleId) || has(config.modRoleId)) return true;
        const lists = [config.adminRoleIds, config.modRoleIds, config.headModRoleIds];
        return lists.some(list => Array.isArray(list) && list.some(has));
    }

    async function canSetupDropmap(member) {
        if (!member) return false;
        if (member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
        const config = await getGuildConfig(member.guild.id);
        const has = (id) => !!id && member.roles.cache.has(id);
        if (has(config.adminRoleId)) return true;
        return Array.isArray(config.adminRoleIds) && config.adminRoleIds.some(has);
    }

    async function writeLog(sourceGuild, requester, targetUser, areaName, subAreaName, imageRef, success) {
        try {
            const guildId = sourceGuild ? sourceGuild.id : (getCommunityGuildId() || 'unknown');
            await db.addDropmapLogDB({
                guildId,
                guildName: sourceGuild ? sourceGuild.name : null,
                requesterId: requester.id,
                requesterTag: requester.tag || requester.username,
                targetId: targetUser.id,
                targetTag: targetUser.tag || targetUser.username || null,
                areaName,
                subAreaName: subAreaName || null,
                imageUrl: imageRef || null,
                success,
                date: new Date()
            });
            if (!success || !sourceGuild) return;
            const config = await getGuildConfig(sourceGuild.id);
            if (!config.dropmapLogChannelId) return;
            const logChannel = botClients.getLogsClient(client).channels.cache.get(config.dropmapLogChannelId)
                || client.channels.cache.get(config.dropmapLogChannelId);
            if (!logChannel) return;
            const embed = new EmbedBuilder()
                .setTitle('Dropmap Sent')
                .setColor(DROPMAP_COLOR)
                .addFields(
                    { name: 'Sent by', value: `<@${requester.id}>`, inline: true },
                    { name: 'Received by', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Dropmap', value: `${subAreaName ? `${areaName} - ${subAreaName}` : areaName}`, inline: true },
                    { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                );
            if (imageRef && isHttpUrl(imageRef)) embed.setThumbnail(await refreshDiscordUrl(imageRef));
            await logChannel.send({ embeds: [embed] }).catch(() => {});
        } catch (err) {
            report('DROPMAP_LOG', err, { areaName, subAreaName });
        }
    }

    async function sendDropmap({ dataGuildId, sourceGuild, requester, targetUserId, areaName, subAreaName }) {
        if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return { ok: false, error: 'Invalid user ID.' };

        const targetUser = await client.users.fetch(targetUserId).catch(() => null);
        if (!targetUser) return { ok: false, error: 'Invalid user ID.' };
        if (targetUser.bot) return { ok: false, error: 'You can\'t send a dropmap to a bot.' };

        const area = await db.getDropmapImageDB(dataGuildId, areaName);
        const imageRef = getItemImage(area, subAreaName);
        if (!imageRef) return { ok: false, error: 'This dropmap has no image.' };

        const roleGuild = findDropmapRoleGuild();
        if (!roleGuild) return { ok: false, error: 'The "Dropmap Riscattata" role was not found in any server.' };

        const member = await roleGuild.members.fetch(targetUserId).catch(() => null);
        if (!member) {
            await writeLog(sourceGuild, requester, targetUser, areaName, subAreaName, null, false);
            return { ok: false, error: `<@${targetUserId}> is not in **${roleGuild.name}**.` };
        }

        if (member.roles.cache.has(DROPMAP_ROLE_ID)) {
            const temp = (await db.getTempRolesByGuildDB(roleGuild.id)).find(r => r.userId === targetUserId && r.roleId === DROPMAP_ROLE_ID);
            const until = temp ? ` It expires <t:${Math.floor(new Date(temp.expiresAt).getTime() / 1000)}:R>.` : '';
            await writeLog(sourceGuild, requester, targetUser, areaName, subAreaName, null, false);
            return { ok: false, error: `<@${targetUserId}> already redeemed a dropmap.${until}` };
        }

        const image = await resolveImage(imageRef);
        if (!image) return { ok: false, error: 'The image of this dropmap could not be loaded.' };

        const dmEmbed = new EmbedBuilder()
            .setTitle('Here is your dropmap')
            .setColor(DROPMAP_COLOR)
            .setImage(image.url);

        const dmSent = await targetUser.send({ embeds: [dmEmbed], files: image.files }).then(() => true).catch(() => false);
        if (!dmSent) {
            await writeLog(sourceGuild, requester, targetUser, areaName, subAreaName, imageRef, false);
            return { ok: false, error: `I can't DM <@${targetUserId}>. Their DMs are probably closed.` };
        }

        const reason = `Dropmap redeemed - ${areaName}${subAreaName ? '/' + subAreaName : ''}`;
        let roleWarning = null;
        try {
            await member.roles.add(DROPMAP_ROLE_ID, reason);
            await db.addTempRoleDB({
                guildId: roleGuild.id,
                userId: targetUserId,
                roleId: DROPMAP_ROLE_ID,
                expiresAt: new Date(Date.now() + DROPMAP_DURATION_DAYS * 24 * 60 * 60 * 1000),
                assignedBy: requester.id,
                assignedByTag: requester.tag || requester.username,
                reason,
                assignedAt: new Date(),
                type: 'dropmap'
            });
        } catch (err) {
            report('DROPMAP_ROLE', err, { targetUserId });
            roleWarning = 'The dropmap was sent, but I could not give the "Dropmap Riscattata" role.';
        }

        await writeLog(sourceGuild, requester, targetUser, areaName, subAreaName, imageRef, true);
        return { ok: true, targetUser, roleWarning };
    }

    function errorEmbed(text) {
        return new EmbedBuilder().setDescription(text).setColor(DROPMAP_COLOR);
    }

    async function updateMenuMessage(channel, payload) {
        const existingId = activeMessages.get(channel.id);
        if (existingId) {
            const msg = await channel.messages.fetch(existingId).catch(() => null);
            if (msg) {
                const edited = await msg.edit({ content: null, files: [], attachments: [], ...payload }).catch(() => null);
                if (edited) return edited;
            }
        }
        const sent = await channel.send(payload).catch(() => null);
        if (sent) activeMessages.set(channel.id, sent.id);
        return sent;
    }

    async function deleteMenuMessage(channel) {
        const existingId = activeMessages.get(channel.id);
        activeMessages.delete(channel.id);
        if (!existingId) return;
        const msg = await channel.messages.fetch(existingId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
    }

    function chunkSelects(customIdBase, placeholder, options, maxMenus) {
        const rows = [];
        for (let i = 0; i < options.length && rows.length < maxMenus; i += 25) {
            const part = options.slice(i, i + 25);
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`${customIdBase}_${rows.length}`.slice(0, 100))
                .setPlaceholder(rows.length === 0 ? placeholder : `${placeholder} (${rows.length + 1})`)
                .addOptions(part);
            rows.push(new ActionRowBuilder().addComponents(menu));
        }
        return rows;
    }

    function stopSession(userId) {
        const s = sessions.get(userId);
        if (s && s.collector) s.collector.stop('replaced');
        sessions.delete(userId);
    }

    async function showMainMenu(channel, userId, dataGuildId) {
        const areas = await loadAreas(dataGuildId);

        if (!areas.length) {
            const embed = new EmbedBuilder()
                .setTitle('DROPMAP - No areas configured')
                .setDescription('No dropmap areas have been configured yet.\nAdd them from the dashboard (Dropmaps section) or with `!setupdropmap`.')
                .setColor(DROPMAP_COLOR);
            if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
            await updateMenuMessage(channel, { embeds: [embed], components: [] });
            return;
        }

        const options = [];
        for (const area of areas.filter(a => !a.isMiniarea)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(area.areaName.slice(0, 100))
                .setDescription(`Open the sub-areas of ${area.areaName}`.slice(0, 100))
                .setValue(`a:${area.areaName}`.slice(0, 100)));
        }
        for (const mini of areas.filter(a => a.isMiniarea)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(mini.areaName.slice(0, 100))
                .setDescription('Mini area · send it directly')
                .setValue(`m:${mini.areaName}`.slice(0, 100)));
        }

        const embed = new EmbedBuilder()
            .setTitle('DROPMAP - Select an area')
            .setDescription('Choose an area to see its sub-areas, or choose a mini area to send it directly.')
            .setColor(DROPMAP_COLOR);
        if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);

        const rows = chunkSelects(`dropmap_menu_${userId}`, 'Select an area or a mini area...', options, 4);
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`dropmap_close_${userId}`).setLabel('Close').setStyle(ButtonStyle.Secondary)
        ));
        await updateMenuMessage(channel, { embeds: [embed], components: rows });
    }

    async function showAreaDetail(channel, userId, dataGuildId, areaName) {
        const area = await db.getDropmapImageDB(dataGuildId, areaName);
        if (!area || area.isMiniarea) return showMainMenu(channel, userId, dataGuildId);
        const subNames = sortedSubs(area);
        const image = area.imageUrl ? await resolveImage(area.imageUrl) : null;

        const embed = new EmbedBuilder()
            .setTitle(subNames.length ? `${areaName} - Sub-areas`.slice(0, 256) : areaName.slice(0, 256))
            .setDescription(subNames.length ? 'Select a sub-area to see the details.' : 'No sub-areas configured for this area.')
            .setColor(DROPMAP_COLOR);
        if (image) embed.setImage(image.url);

        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`dropmap_back_${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        const options = subNames.map(sub => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(sub.slice(0, 100))
                .setDescription(`Open ${sub}`.slice(0, 100))
                .setValue(sub.slice(0, 100));
        });

        sessions.set(userId, { ...(sessions.get(userId) || {}), areaName, dataGuildId, channelId: channel.id });
        const rows = chunkSelects(`dropmap_sub_${userId}`, 'Select a sub-area', options, 4);
        rows.push(backRow);
        await updateMenuMessage(channel, { embeds: [embed], components: rows, files: image ? image.files : [] });
    }

    async function showItemDetail(channel, requester, dataGuildId, areaName, subAreaName) {
        const area = await db.getDropmapImageDB(dataGuildId, areaName);
        const imageRef = getItemImage(area, subAreaName);
        if (!imageRef) return showMainMenu(channel, requester.id, dataGuildId);
        const image = await resolveImage(imageRef);
        const name = subAreaName ? `${areaName} - ${subAreaName}` : areaName;

        stopSession(requester.id);

        const embed = new EmbedBuilder()
            .setTitle(name.slice(0, 256))
            .setDescription(`You selected **${name}**.\n\nType the ID of the user you want to send this dropmap to.\n\nExample: 123456789012345678`)
            .setColor(DROPMAP_COLOR);
        if (image) embed.setImage(image.url);

        const buttons = [new ButtonBuilder().setCustomId(`dropmap_cancel_${requester.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger)];
        if (subAreaName) buttons.push(new ButtonBuilder().setCustomId(`dropmap_backarea_${requester.id}`).setLabel('Back to area').setStyle(ButtonStyle.Secondary));

        await updateMenuMessage(channel, { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)], files: image ? image.files : [] });

        const collector = channel.createMessageCollector({
            filter: (m) => m.author.id === requester.id && m.channel.id === channel.id,
            time: MENU_TIMEOUT_MS,
            max: 1
        });
        sessions.set(requester.id, { areaName, subAreaName, dataGuildId, channelId: channel.id, collector });

        collector.on('collect', async (msg) => {
            try {
                await msg.delete().catch(() => {});
                sessions.delete(requester.id);
                const input = msg.content.trim().replace(/^<@!?(\d+)>$/, '$1');

                if (input.toLowerCase() === 'cancel') {
                    await showMainMenu(channel, requester.id, dataGuildId);
                    return;
                }

                if (!/^\d{17,20}$/.test(input)) {
                    await updateMenuMessage(channel, { embeds: [errorEmbed('Invalid user ID. Type a valid numeric ID.')], components: [] });
                    setTimeout(() => showMainMenu(channel, requester.id, dataGuildId).catch(() => {}), 3000);
                    return;
                }

                const result = await sendDropmap({
                    dataGuildId,
                    sourceGuild: channel.guild,
                    requester,
                    targetUserId: input,
                    areaName,
                    subAreaName
                });

                await deleteMenuMessage(channel);

                if (result.ok) {
                    const embed = new EmbedBuilder()
                        .setTitle('Dropmap Sent')
                        .setDescription(`Dropmap sent to <@${input}>${result.roleWarning ? `\n\n${result.roleWarning}` : ''}`)
                        .setColor(DROPMAP_COLOR);
                    await channel.send({ embeds: [embed] }).catch(() => {});
                } else {
                    await channel.send({ embeds: [errorEmbed(`I couldn't send the dropmap.\n\n${result.error}`)] }).catch(() => {});
                }
            } catch (err) {
                report('DROPMAP_COLLECT', err, { areaName, subAreaName });
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'replaced' || collected.size > 0) return;
            const current = sessions.get(requester.id);
            if (current && current.collector === collector) {
                sessions.delete(requester.id);
                updateMenuMessage(channel, { embeds: [errorEmbed('Time is up. Operation cancelled.')], components: [] })
                    .then(() => setTimeout(() => showMainMenu(channel, requester.id, dataGuildId).catch(() => {}), 3000))
                    .catch(() => {});
            }
        });
    }

    async function handleMapCommand(message) {
        if (!message.guild || message.guild.id !== DROPMAP_GUILD_ID) return;
        if (!(await canUseDropmap(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        await message.delete().catch(() => {});
        stopSession(message.author.id);
        await deleteMenuMessage(message.channel);
        await showMainMenu(message.channel, message.author.id, getCommunityGuildId() || message.guild.id);
    }

    function ownerOf(customId, prefix) {
        const rest = customId.slice(prefix.length);
        const idx = rest.indexOf('_');
        return idx === -1 ? rest : rest.slice(0, idx);
    }

    async function handleInteraction(interaction) {
        const id = interaction.customId || '';
        if (!id.startsWith('dropmap_')) return false;

        const prefixes = ['dropmap_menu_', 'dropmap_sub_', 'dropmap_backarea_', 'dropmap_back_', 'dropmap_cancel_', 'dropmap_close_'];
        const prefix = prefixes.find(p => id.startsWith(p));
        if (!prefix) return false;

        const ownerId = ownerOf(id, prefix);
        if (ownerId !== interaction.user.id) {
            await interaction.reply({ content: 'This menu is not yours. Use `!map` to open your own.', flags: 64 }).catch(() => {});
            return true;
        }

        await interaction.deferUpdate().catch(() => {});
        const channel = interaction.channel;
        activeMessages.set(channel.id, interaction.message.id);
        const dataGuildId = getCommunityGuildId() || interaction.guild.id;

        if (prefix === 'dropmap_menu_' && interaction.isStringSelectMenu()) {
            const value = interaction.values[0] || '';
            if (value.startsWith('a:')) await showAreaDetail(channel, interaction.user.id, dataGuildId, value.slice(2));
            else if (value.startsWith('m:')) await showItemDetail(channel, interaction.user, dataGuildId, value.slice(2), null);
            return true;
        }

        if (prefix === 'dropmap_sub_' && interaction.isStringSelectMenu()) {
            const session = sessions.get(interaction.user.id);
            if (!session || !session.areaName) {
                await showMainMenu(channel, interaction.user.id, dataGuildId);
                return true;
            }
            await showItemDetail(channel, interaction.user, dataGuildId, session.areaName, interaction.values[0]);
            return true;
        }

        if (prefix === 'dropmap_backarea_') {
            const session = sessions.get(interaction.user.id);
            const areaName = session && session.areaName;
            stopSession(interaction.user.id);
            if (areaName) await showAreaDetail(channel, interaction.user.id, dataGuildId, areaName);
            else await showMainMenu(channel, interaction.user.id, dataGuildId);
            return true;
        }

        if (prefix === 'dropmap_back_' || prefix === 'dropmap_cancel_') {
            stopSession(interaction.user.id);
            await showMainMenu(channel, interaction.user.id, dataGuildId);
            return true;
        }

        if (prefix === 'dropmap_close_') {
            stopSession(interaction.user.id);
            await deleteMenuMessage(channel);
            return true;
        }

        return true;
    }

    async function handleSetupCommand(message, args) {
        if (!message.guild || message.guild.id !== DROPMAP_GUILD_ID) return;
        if (!(await canSetupDropmap(message.member))) {
            await message.delete().catch(() => {});
            return;
        }
        const guildId = getCommunityGuildId() || message.guild.id;
        const sub = (args[0] || '').toLowerCase();
        const reply = async (text, title) => {
            const embed = new EmbedBuilder().setDescription(text.slice(0, 4000)).setColor(DROPMAP_COLOR);
            if (title) embed.setTitle(title);
            await message.channel.send({ embeds: [embed] }).catch(() => {});
        };

        if (!sub) {
            const embed = new EmbedBuilder()
                .setTitle('Dropmap Setup')
                .setDescription('You can also manage everything from the dashboard (Dropmaps section).')
                .setColor(DROPMAP_COLOR)
                .addFields(
                    { name: 'Add an area (with sub-areas)', value: '`!setupdropmap area <area_name> <image_url>`' },
                    { name: 'Add a mini area', value: '`!setupdropmap miniarea <name> <image_url>`' },
                    { name: 'Add a sub-area', value: '`!setupdropmap subarea <area_name> <sub_area_name> <image_url>`' },
                    { name: 'Delete an area', value: '`!setupdropmap deletearea <name>`' },
                    { name: 'Delete a mini area', value: '`!setupdropmap deleteminiarea <name>`' },
                    { name: 'Delete a sub-area', value: '`!setupdropmap deletesubarea <area_name> <sub_area_name>`' },
                    { name: 'Edit area image', value: '`!setupdropmap editarea <area_name> <new_url>`' },
                    { name: 'Edit mini area image', value: '`!setupdropmap editminiarea <name> <new_url>`' },
                    { name: 'Edit sub-area image', value: '`!setupdropmap editsubarea <area_name> <sub_area_name> <new_url>`' },
                    { name: 'List', value: '`!setupdropmap list`' }
                );
            await message.channel.send({ embeds: [embed] }).catch(() => {});
            return;
        }

        try {
            if (sub === 'area' || sub === 'miniarea') {
                const [name, url] = [args[1], args[2]];
                if (!name || !isHttpUrl(url)) return reply(`Usage: \`!setupdropmap ${sub} <name> <image_url>\``);
                if (await db.getDropmapImageDB(guildId, name)) return reply(`**${name}** already exists.`);
                await db.saveDropmapImageDB({ guildId, areaName: name, imageUrl: url, isMiniarea: sub === 'miniarea', subAreas: {} });
                return reply(`${sub === 'miniarea' ? 'Mini area' : 'Area'} **${name}** added.`);
            }

            if (sub === 'subarea') {
                const [areaName, subName, url] = [args[1], args[2], args[3]];
                if (!areaName || !subName || !isHttpUrl(url)) return reply('Usage: `!setupdropmap subarea <area_name> <sub_area_name> <image_url>`');
                const area = await db.getDropmapImageDB(guildId, areaName);
                if (!area || area.isMiniarea) return reply(`Area **${areaName}** not found.`);
                const subAreas = { ...(area.subAreas || {}) };
                if (subAreas[subName]) return reply(`Sub-area **${subName}** already exists in **${areaName}**.`);
                subAreas[subName] = url;
                await db.setDropmapSubAreasDB(guildId, areaName, subAreas);
                return reply(`Sub-area **${subName}** added to **${areaName}**.`);
            }

            if (sub === 'deletearea' || sub === 'deleteminiarea') {
                const name = args[1];
                const area = name ? await db.getDropmapImageDB(guildId, name) : null;
                if (!area || area.isMiniarea !== (sub === 'deleteminiarea')) return reply(`${sub === 'deleteminiarea' ? 'Mini area' : 'Area'} **${name || '?'}** not found.`);
                await db.deleteDropmapImageDB(guildId, name);
                return reply(`**${name}** deleted.`);
            }

            if (sub === 'deletesubarea') {
                const [areaName, subName] = [args[1], args[2]];
                const area = areaName ? await db.getDropmapImageDB(guildId, areaName) : null;
                if (!area || !subName || !(area.subAreas || {})[subName]) return reply('Sub-area not found.');
                const subAreas = { ...area.subAreas };
                delete subAreas[subName];
                await db.setDropmapSubAreasDB(guildId, areaName, subAreas);
                return reply(`Sub-area **${subName}** deleted from **${areaName}**.`);
            }

            if (sub === 'editarea' || sub === 'editminiarea') {
                const [name, url] = [args[1], args[2]];
                const area = name ? await db.getDropmapImageDB(guildId, name) : null;
                if (!area || area.isMiniarea !== (sub === 'editminiarea') || !isHttpUrl(url)) return reply(`Usage: \`!setupdropmap ${sub} <name> <new_url>\``);
                await db.saveDropmapImageDB({ guildId, areaName: name, imageUrl: url });
                return reply(`Image of **${name}** updated.`);
            }

            if (sub === 'editsubarea') {
                const [areaName, subName, url] = [args[1], args[2], args[3]];
                const area = areaName ? await db.getDropmapImageDB(guildId, areaName) : null;
                if (!area || !subName || !(area.subAreas || {})[subName] || !isHttpUrl(url)) return reply('Usage: `!setupdropmap editsubarea <area_name> <sub_area_name> <new_url>`');
                await db.setDropmapSubAreasDB(guildId, areaName, { ...area.subAreas, [subName]: url });
                return reply(`Image of **${areaName} - ${subName}** updated.`);
            }

            if (sub === 'list') {
                const areas = await loadAreas(guildId);
                if (!areas.length) return reply('No areas configured.');
                const lines = [];
                const normal = areas.filter(a => !a.isMiniarea);
                const minis = areas.filter(a => a.isMiniarea);
                if (normal.length) {
                    lines.push('**Areas**');
                    for (const a of normal) {
                        lines.push(`• ${a.areaName}`);
                        for (const sName of sortedSubs(a)) lines.push(`  ◦ ${sName}`);
                    }
                }
                if (minis.length) {
                    lines.push('', '**Mini areas**');
                    for (const m of minis) {
                        lines.push(`• ${m.areaName}`);
                    }
                }
                return reply(lines.join('\n'), 'Dropmap Configuration');
            }

            return reply('Unknown option. Use `!setupdropmap` to see all options.');
        } catch (err) {
            report('DROPMAP_SETUP', err, { sub });
            return reply('Something went wrong.');
        } finally {
            await message.delete().catch(() => {});
        }
    }

    return {
        DROPMAP_ROLE_ID,
        UPLOAD_PREFIX,
        isValidImageRef,
        refreshDiscordUrl,
        handleMapCommand,
        handleSetupCommand,
        handleInteraction
    };
}

module.exports = createDropmap;
