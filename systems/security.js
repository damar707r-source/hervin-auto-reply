
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  AuditLogEvent
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// HERVIN ADVANCED SECURITY SYSTEM
// =====================================

const configPath = path.join(__dirname, "security.json");
const tempConfigPath = configPath + ".tmp";

const DEFAULT_THRESHOLD = 3;
const WINDOW_MS = 10000;

const SPAM_LIMIT = 6;
const SPAM_WINDOW = 5000;
const SPAM_TIMEOUT = 10 * 60 * 1000;

const AUDIT_DELAY = 1200;
const AUDIT_MAX_AGE = 10000;

const dangerousPermissions = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks
];

// =====================================
// STORAGE & MEMORY
// =====================================

const actionCounts = new Map();
const spamMessages = new Map();

const punishedUsers = new Set();
const spamPunishedUsers = new Set();
const processedAuditEntries = new Set();

const initializedClients = new WeakSet();

let configCache = null;

// =====================================
// CONFIGURATION
// =====================================

function loadConfig() {
  try {
    if (!fs.existsSync(configPath)) {
      configCache = {};
      return configCache;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Invalid security configuration format");
    }

    configCache = parsed;
    return configCache;

  } catch (error) {
    console.error("[HERVIN SECURITY] Config load error:", error);
    return configCache || {};
  }
}

function saveConfig(data) {
  try {
    const json = JSON.stringify(data, null, 2);

    fs.writeFileSync(tempConfigPath, json, "utf8");

    fs.renameSync(tempConfigPath, configPath);

    configCache = data;

    return true;

  } catch (error) {
    console.error("[HERVIN SECURITY] Config save error:", error);

    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch {}

    throw error;
  }
}

function getConfig(guildId) {
  const data = configCache || loadConfig();
  return data[guildId] || null;
}

// =====================================
// HELPERS
// =====================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  ) ?? false;
}

function safeError(label, error) {
  console.error(`[HERVIN SECURITY] ${label}:`, error);
}

async function safeEvent(label, callback) {
  try {
    await callback();
  } catch (error) {
    safeError(label, error);
  }
}

// =====================================
// SLASH COMMANDS
// =====================================

function registerSecurityCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("security-setup")
      .setDescription("Configure HERVIN security system")
      .addChannelOption(option =>
        option
          .setName("logs")
          .setDescription("Security alerts channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addIntegerOption(option =>
        option
          .setName("threshold")
          .setDescription("Maximum actions before protection activates")
          .setMinValue(2)
          .setMaxValue(10)
          .setRequired(false)
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName("security-status")
      .setDescription("Show HERVIN security settings")
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
      )
      .toJSON()
  );
}

// =====================================
// SECURITY LOGS
// =====================================

async function sendLog(guild, message) {
  try {
    if (!guild) return;

    const config = getConfig(guild.id);

    if (!config?.enabled || !config.logsChannelId) return;

    let channel = guild.channels.cache.get(
      config.logsChannelId
    );

    if (!channel) {
      channel = await guild.channels.fetch(
        config.logsChannelId
      ).catch(() => null);
    }

    if (
      !channel ||
      !channel.isTextBased() ||
      typeof channel.send !== "function"
    ) {
      return;
    }

    await channel.send({
      content: message,
      allowedMentions: {
        parse: []
      }
    });

  } catch (error) {
    safeError("Security log", error);
  }
}

// =====================================
// INTERACTION HANDLER
// =====================================

async function handleSecurityInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (
    interaction.commandName !== "security-setup" &&
    interaction.commandName !== "security-status"
  ) {
    return false;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: "هذا الأمر متاح داخل السيرفر فقط.",
      ephemeral: true
    });

    return true;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: "تحتاج صلاحية Manage Server.",
      ephemeral: true
    });

    return true;
  }

  // SETUP

  if (interaction.commandName === "security-setup") {
    const logs = interaction.options.getChannel("logs");

    const threshold =
      interaction.options.getInteger("threshold") ||
      DEFAULT_THRESHOLD;

    if (
      !logs ||
      logs.guildId !== interaction.guildId ||
      !logs.isTextBased() ||
      typeof logs.send !== "function"
    ) {
      await interaction.reply({
        content: "يرجى اختيار قناة نصية صحيحة.",
        ephemeral: true
      });

      return true;
    }

    try {
      const data = {
        ...(configCache || loadConfig())
      };

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
        "🛡️ تم إعداد نظام حماية HERVIN بنجاح."
      );

    } catch (error) {
      safeError("Security setup", error);

      await interaction.reply({
        content: "حدث خطأ أثناء حفظ إعدادات الحماية.",
        ephemeral: true
      }).catch(() => {});
    }

    return true;
  }

  // STATUS

  if (interaction.commandName === "security-status") {
    const config = getConfig(interaction.guildId);

    if (!config) {
      await interaction.reply({
        content:
          "نظام الحماية غير مجهز. استخدم /security-setup أولًا.",
        ephemeral: true
      });

      return true;
    }

    const logs = await interaction.guild.channels.fetch(
      config.logsChannelId
    ).catch(() => null);

    await interaction.reply({
      content:
        "**HERVIN SECURITY STATUS** 🛡️\n\n" +
        `الحالة: ${config.enabled ? "مفعل 🟢" : "معطل 🔴"}\n` +
        `السجلات: ${logs || "القناة غير موجودة"}\n` +
        `حد العمليات: ${config.threshold || DEFAULT_THRESHOLD}\n` +
        `حماية السبام: ${config.enabled ? "مفعلة" : "معطلة"}`,
      ephemeral: true
    });

    return true;
  }

  return false;
}

// =====================================
// AUDIT LOG SYSTEM
// =====================================

async function getExecutor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: auditType,
      limit: 10
    });

    const now = Date.now();

    const entry = logs.entries
      .filter(item =>
        item.target?.id === targetId &&
        now - item.createdTimestamp >= 0 &&
        now - item.createdTimestamp <= AUDIT_MAX_AGE &&
        !processedAuditEntries.has(item.id)
      )
      .sort((a, b) =>
        b.createdTimestamp - a.createdTimestamp
      )[0];

    if (!entry?.executor) return null;

    processedAuditEntries.add(entry.id);

    setTimeout(() => {
      processedAuditEntries.delete(entry.id);
    }, 60000);

    return entry.executor;

  } catch (error) {
    safeError("Audit log fetch", error);
    return null;
  }
}

async function auditEvent(guild, auditType, targetId, reason) {
  await sleep(AUDIT_DELAY);

  const executor = await getExecutor(
    guild,
    auditType,
    targetId
  );

  if (!executor) return;

  await recordAction(guild, executor, reason);
}

// =====================================
// ANTI-NUKE PUNISHMENT
// =====================================

async function punishExecutor(guild, user, reason) {
  if (
    !user ||
    user.bot ||
    user.id === guild.ownerId
  ) {
    return;
  }

  const key = `${guild.id}:${user.id}`;

  if (punishedUsers.has(key)) return;

  punishedUsers.add(key);

  try {
    const member = await guild.members.fetch(user.id)
      .catch(() => null);

    if (!member) {
      await sendLog(
        guild,
        `⚠️ تعذر العثور على العضو ${user.id} لتنفيذ الحماية.`
      );

      return;
    }

    if (!member.manageable) {
      await sendLog(
        guild,
        `⚠️ لا يستطيع البوت تعديل رتب ${user} بسبب ترتيب الرتب.`
      );

      return;
    }

    const removableRoles = member.roles.cache.filter(role =>
      role.id !== guild.id &&
      !role.managed &&
      role.editable &&
      dangerousPermissions.some(permission =>
        role.permissions.has(permission)
      )
    );

    if (removableRoles.size > 0) {
      await member.roles.remove(
        removableRoles.map(role => role.id),
        "HERVIN Anti-Nuke Protection"
      );
    }

    await sendLog(
      guild,
      "🚨 **HERVIN ANTI-NUKE**\n\n" +
      `العضو: ${user.tag || user.username}\n` +
      `المعرف: \`${user.id}\`\n` +
      `السبب: ${reason}\n` +
      "الإجراء: إزالة الرتب ذات الصلاحيات الخطرة\n" +
      `عدد الرتب المتأثرة: ${removableRoles.size}`
    );

  } catch (error) {
    safeError("Anti-nuke punishment", error);

    await sendLog(
      guild,
      `⚠️ فشل تنفيذ الحماية على ${user.username}. تحقق من صلاحيات البوت.`
    );

  } finally {
    setTimeout(() => {
      punishedUsers.delete(key);
    }, 30000);
  }
}

// =====================================
// ACTION COUNTER
// =====================================

async function recordAction(guild, user, reason) {
  const config = getConfig(guild.id);

  if (
    !config?.enabled ||
    !user ||
    user.bot ||
    user.id === guild.ownerId
  ) {
    return;
  }

  const key = `${guild.id}:${user.id}`;
  const now = Date.now();

  const previous = actionCounts.get(key) || [];

  const recent = previous.filter(
    time => now - time < WINDOW_MS
  );

  recent.push(now);

  actionCounts.set(key, recent);

  const threshold =
    Number(config.threshold) || DEFAULT_THRESHOLD;

  if (recent.length >= threshold) {
    actionCounts.delete(key);

    await punishExecutor(
      guild,
      user,
      `تجاوز حد العمليات: ${reason}`
    );

    return;
  }

  await sendLog(
    guild,
    "⚠️ **HERVIN SECURITY ALERT**\n\n" +
    `العضو: <@${user.id}>\n` +
    `العملية: ${reason}\n` +
    `العدد خلال 10 ثوانٍ: ${recent.length}/${threshold}`
  );
}

// =====================================
// ANTI-NUKE EVENTS
// =====================================

function initializeSecurity(client) {
  if (!client || !client.on) {
    throw new Error("Invalid Discord client");
  }

  // Prevent duplicate listeners

  if (initializedClients.has(client)) {
    console.log(
      "[HERVIN SECURITY] Already initialized."
    );

    return;
  }

  initializedClients.add(client);

  loadConfig();

  // CHANNEL DELETE

  client.on("channelDelete", channel => {
    safeEvent("Channel delete", async () => {
      if (!channel.guild) return;

      await auditEvent(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id,
        "حذف قناة"
      );
    });
  });

  // ROLE DELETE

  client.on("roleDelete", role => {
    safeEvent("Role delete", async () => {
      await auditEvent(
        role.guild,
        AuditLogEvent.RoleDelete,
        role.id,
        "حذف رتبة"
      );
    });
  });

  // MEMBER BAN

  client.on("guildBanAdd", ban => {
    safeEvent("Member ban", async () => {
      await auditEvent(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id,
        "حظر عضو"
      );
    });
  });

  // MEMBER KICK

  client.on("guildMemberRemove", member => {
    safeEvent("Member remove", async () => {
      await auditEvent(
        member.guild,
        AuditLogEvent.MemberKick,
        member.id,
        "طرد عضو"
      );
    });
  });

  // ROLE UPDATE

  client.on("roleUpdate", (oldRole, newRole) => {
    safeEvent("Role update", async () => {
      const gainedDangerousPermission =
        dangerousPermissions.some(permission =>
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
  });

  // =====================================
  // ANTI-SPAM SYSTEM
  // =====================================

  client.on("messageCreate", message => {
    safeEvent("Anti-spam", async () => {
      if (
        !message.guild ||
        message.author.bot ||
        message.webhookId
      ) {
        return;
      }

      const config = getConfig(message.guild.id);

      if (!config?.enabled) return;

      const member = message.member;

      if (!member) return;

      // Ignore administrators and moderators

      if (
        member.permissions.has(
          PermissionFlagsBits.Administrator
        ) ||
        member.permissions.has(
          PermissionFlagsBits.ManageMessages
        )
      ) {
        return;
      }

      const key =
        `${message.guild.id}:${message.author.id}`;

      if (spamPunishedUsers.has(key)) return;

      const now = Date.now();

      const previous = spamMessages.get(key) || [];

      const recent = previous.filter(
        time => now - time < SPAM_WINDOW
      );

      recent.push(now);

      spamMessages.set(key, recent);

      if (recent.length < SPAM_LIMIT) return;

      // Prevent repeated punishment

      spamMessages.delete(key);
      spamPunishedUsers.add(key);

      try {
        // Fetch recent messages

        const messages = await message.channel.messages.fetch({
          limit: 30
        });

        const userMessages = messages.filter(msg =>
          msg.author.id === message.author.id &&
          Date.now() - msg.createdTimestamp < 7000 &&
          Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
        );

        // Delete spam messages

        if (userMessages.size > 1) {
          await message.channel.bulkDelete(
            userMessages,
            true
          );
        } else if (userMessages.size === 1) {
          await userMessages.first()
            .delete()
            .catch(error =>
              safeError("Spam message delete", error)
            );
        }

      } catch (error) {
        safeError("Spam deletion", error);
      }

      // Timeout independently of message deletion

      try {
        if (member.moderatable) {
          await member.timeout(
            SPAM_TIMEOUT,
            "HERVIN Anti-Spam"
          );
        }

      } catch (error) {
        safeError("Spam timeout", error);
      }

      await sendLog(
        message.guild,
        "🚫 **HERVIN ANTI-SPAM**\n\n" +
        `العضو: <@${message.author.id}>\n` +
        `القناة: <#${message.channel.id}>\n` +
        "السبب: إرسال رسائل متكررة بسرعة\n" +
        "الإجراء: حذف الرسائل ومحاولة إسكات العضو لمدة 10 دقائق."
      );

      // Release protection lock

      setTimeout(() => {
        spamPunishedUsers.delete(key);
      }, SPAM_TIMEOUT);

    });
  });

  console.log(
    "🛡️ HERVIN ADVANCED SECURITY INITIALIZED"
  );
}

// =====================================
// EXPORTS
// =====================================

module.exports = {
  registerSecurityCommands,
  handleSecurityInteraction,
  initializeSecurity
};
