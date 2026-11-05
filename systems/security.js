
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  AuditLogEvent
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "security.json");

const DEFAULT_THRESHOLD = 3;
const WINDOW_MS = 10000;

const dangerousPermissions = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks
];

const actionCounts = new Map();
const spamMessages = new Map();
const punishedUsers = new Set();
const processedAuditEntries = new Set();

function loadConfig() {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("Security config error:", error);
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function getConfig(guildId) {
  return loadConfig()[guildId] || null;
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  );
}

function registerSecurityCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("security-setup")
      .setDescription("Configure HERVIN security system")
      .addChannelOption(option =>
        option.setName("logs")
          .setDescription("Security alerts channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addIntegerOption(option =>
        option.setName("threshold")
          .setDescription("Maximum actions before protection activates")
          .setMinValue(2)
          .setMaxValue(10)
          .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("security-status")
      .setDescription("Show HERVIN security settings")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON()
  );
}

async function sendLog(guild, message) {
  const config = getConfig(guild.id);
  if (!config?.logsChannelId) return;

  const channel = guild.channels.cache.get(config.logsChannelId);
  if (!channel?.isTextBased()) return;

  try {
    await channel.send({ content: message });
  } catch (error) {
    console.error("Security log error:", error);
  }
}

async function handleSecurityInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "security-setup") {
    if (!isAdmin(interaction)) {
      await interaction.reply({
        content: "تحتاج صلاحية Manage Server.",
        ephemeral: true
      });
      return true;
    }

    const logs = interaction.options.getChannel("logs");
    const threshold =
      interaction.options.getInteger("threshold") || DEFAULT_THRESHOLD;

    const data = loadConfig();

    data[interaction.guildId] = {
      logsChannelId: logs.id,
      threshold,
      enabled: true
    };

    saveConfig(data);

    await interaction.reply({
      content:
        "تم إعداد حماية HERVIN بنجاح 🛡️\n\n" +
        `قناة السجلات: ${logs}\n` +
        `حد العمليات: ${threshold}\n` +
        "حماية التخريب والسبام مفعلة.",
      ephemeral: true
    });

    await sendLog(
      interaction.guild,
      "🛡️ تم إعداد نظام حماية HERVIN."
    );

    return true;
  }

  if (interaction.commandName === "security-status") {
    if (!isAdmin(interaction)) {
      await interaction.reply({
        content: "تحتاج صلاحية Manage Server.",
        ephemeral: true
      });
      return true;
    }

    const config = getConfig(interaction.guildId);

    if (!config) {
      await interaction.reply({
        content: "نظام الحماية غير مجهز. استخدم /security-setup أولًا.",
        ephemeral: true
      });
      return true;
    }

    const logs = interaction.guild.channels.cache.get(
      config.logsChannelId
    );

    await interaction.reply({
      content:
        "**HERVIN SECURITY STATUS** 🛡️\n\n" +
        `الحالة: ${config.enabled ? "مفعل 🟢" : "معطل 🔴"}\n` +
        `السجلات: ${logs || "القناة غير موجودة"}\n` +
        `حد العمليات: ${config.threshold}`,
      ephemeral: true
    });

    return true;
  }

  return false;
}

// =====================================
// ANTI-NUKE
// =====================================

async function getExecutor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: auditType,
      limit: 5
    });

    const entry = logs.entries.find(item =>
      item.target?.id === targetId &&
      Date.now() - item.createdTimestamp < 8000 &&
      !processedAuditEntries.has(item.id)
    );

    if (!entry) return null;

    processedAuditEntries.add(entry.id);

    setTimeout(() => {
      processedAuditEntries.delete(entry.id);
    }, 30000);

    return entry.executor || null;
  } catch (error) {
    console.error("Audit log error:", error);
    return null;
  }
}

async function punishExecutor(guild, user, reason) {
  if (!user || user.id === guild.ownerId || user.bot) return;

  const key = `${guild.id}:${user.id}`;

  if (punishedUsers.has(key)) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member || !member.manageable) return;

  punishedUsers.add(key);

  try {
    const removableRoles = member.roles.cache.filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      dangerousPermissions.some(permission =>
        role.permissions.has(permission)
      ) &&
      role.editable
    );

    if (removableRoles.size) {
      await member.roles.remove(
        removableRoles,
        "HERVIN Anti-Nuke Protection"
      );
    }

    await sendLog(
      guild,
      "🚨 **HERVIN ANTI-NUKE**\n" +
      `العضو: ${user}\n` +
      `المعرف: \`${user.id}\`\n` +
      `السبب: ${reason}\n` +
      "الإجراء: إزالة الرتب ذات الصلاحيات الخطرة\n" +
      `عدد الرتب المتأثرة: ${removableRoles.size}`
    );
  } catch (error) {
    console.error("Anti-nuke action error:", error);

    await sendLog(
      guild,
      `⚠️ تعذرت إزالة صلاحيات ${user}، تحقق من ترتيب رتب البوت.`
    );
  } finally {
    setTimeout(() => {
      punishedUsers.delete(key);
    }, 30000);
  }
}

async function recordAction(guild, user, reason) {
  const config = getConfig(guild.id);
  if (!config?.enabled || !user) return;

  const key = `${guild.id}:${user.id}`;
  const now = Date.now();

  const previous = actionCounts.get(key) || [];
  const recent = previous.filter(time => now - time < WINDOW_MS);

  recent.push(now);
  actionCounts.set(key, recent);

  await sendLog(
    guild,
    `⚠️ **عملية مراقبة**\nالعضو: <@${user.id}>\nالعملية: ${reason}\nالعدد خلال 10 ثوانٍ: ${recent.length}`
  );

  if (recent.length >= (config.threshold || DEFAULT_THRESHOLD)) {
    actionCounts.delete(key);

    await punishExecutor(
      guild,
      user,
      `تجاوز حد العمليات: ${reason}`
    );
  }
}

async function auditEvent(guild, auditType, targetId, reason) {
  const user = await getExecutor(guild, auditType, targetId);
  if (!user) return;

  await recordAction(guild, user, reason);
}

// =====================================
// ANTI-NUKE EVENTS
// =====================================

function initializeSecurity(client) {
  client.on("channelDelete", async channel => {
    if (!channel.guild) return;

    await auditEvent(
      channel.guild,
      AuditLogEvent.ChannelDelete,
      channel.id,
      "حذف قناة"
    );
  });

  client.on("roleDelete", async role => {
    await auditEvent(
      role.guild,
      AuditLogEvent.RoleDelete,
      role.id,
      "حذف رتبة"
    );
  });

  client.on("guildBanAdd", async ban => {
    await auditEvent(
      ban.guild,
      AuditLogEvent.MemberBanAdd,
      ban.user.id,
      "حظر عضو"
    );
  });

  client.on("guildMemberRemove", async member => {
    await auditEvent(
      member.guild,
      AuditLogEvent.MemberKick,
      member.id,
      "طرد عضو"
    );
  });

  client.on("roleUpdate", async (oldRole, newRole) => {
    const gainedDangerousPermission = dangerousPermissions.some(
      permission =>
        !oldRole.permissions.has(permission) &&
        newRole.permissions.has(permission)
    );

    if (!gainedDangerousPermission) return;

    await auditEvent(
      newRole.guild,
      AuditLogEvent.RoleUpdate,
      newRole.id,
      "إضافة صلاحيات خطرة لرتبة"
    );
  });

  // =====================================
  // ANTI-SPAM
  // =====================================

  client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    const config = getConfig(message.guild.id);
    if (!config?.enabled) return;

    const member = message.member;

    if (
      !member ||
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    const previous = spamMessages.get(key) || [];
    const recent = previous.filter(time => now - time < 5000);

    recent.push(now);
    spamMessages.set(key, recent);

    if (recent.length < 6) return;

    spamMessages.delete(key);

    try {
      const messages = await message.channel.messages.fetch({
        limit: 30
      });

      const userMessages = messages.filter(msg =>
        msg.author.id === message.author.id &&
        Date.now() - msg.createdTimestamp < 7000
      );

      if (userMessages.size) {
        await message.channel.bulkDelete(userMessages, true);
      }

      if (member.moderatable) {
        await member.timeout(
          10 * 60 * 1000,
          "HERVIN Anti-Spam"
        );
      }

      await sendLog(
        message.guild,
        "🚫 **HERVIN ANTI-SPAM**\n" +
        `العضو: ${message.author}\n` +
        `القناة: ${message.channel}\n` +
        "السبب: إرسال رسائل متكررة بسرعة\n" +
        "الإجراء: حذف الرسائل ومحاولة إسكات العضو 10 دقائق."
      );
    } catch (error) {
      console.error("Anti-spam error:", error);
    }
  });

  console.log("HERVIN Security initialized");
}

module.exports = {
  registerSecurityCommands,
  handleSecurityInteraction,
  initializeSecurity
};
