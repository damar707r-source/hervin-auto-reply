
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// HERVIN SYSTEMS
// =====================================

const tickets = require("./systems/tickets");
const security = require("./systems/security");
const welcome = require("./systems/welcome");
const moderation = require("./systems/moderation");
const autoReplies = require("./systems/autoReplies");
const dmBroadcast = require("./systems/dmBroadcast");

// =====================================
// CONFIGURATION
// =====================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("[HERVIN] Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

const file = path.join(__dirname, "replies.json");

const admin = PermissionFlagsBits.ManageGuild;

// =====================================
// AUTO REPLY HELPERS
// =====================================

function normalizeTrigger(trigger) {
  return String(trigger || "").trim().toLowerCase();
}

function getGuildReplies(guildId) {
  return Object.entries(autoReplies.getAllReplies())
    .filter(([id, reply]) =>
      reply &&
      reply.guildId === guildId &&
      typeof reply === "object"
    )
    .map(([id, reply]) => ({
      id,
      ...reply
    }));
}

function findGuildReply(guildId, trigger) {
  const normalized = normalizeTrigger(trigger);

  return getGuildReplies(guildId).find(reply =>
    normalizeTrigger(
      Array.isArray(reply.triggers)
        ? reply.triggers[0]
        : reply.trigger
    ) === normalized
  );
}

function getReplyId(guildId, trigger) {
  return `guild:${guildId}:${normalizeTrigger(trigger)}`;
}

// =====================================
// LEGACY REPLIES MIGRATION
// =====================================

async function migrateLegacyReplies() {
  try {
    if (!fs.existsSync(file)) return;

    const raw = fs.readFileSync(file, "utf8");
    const oldData = JSON.parse(raw || "{}");

    if (
      !oldData ||
      typeof oldData !== "object" ||
      Array.isArray(oldData)
    ) {
      return;
    }

    let migrated = 0;

    for (const [guildId, guildData] of Object.entries(oldData)) {

      if (!/^\d{17,20}$/.test(guildId)) continue;

      if (
        !guildData ||
        typeof guildData !== "object" ||
        Array.isArray(guildData)
      ) {
        continue;
      }

      for (const [key, oldReply] of Object.entries(guildData)) {
        if (
          !oldReply ||
          typeof oldReply !== "object" ||
          typeof oldReply.trigger !== "string" ||
          typeof oldReply.response !== "string"
        ) {
          continue;
        }

        const trigger = oldReply.trigger.trim();
        const response = oldReply.response.trim();

        if (!trigger || !response) continue;

        const replyId = getReplyId(guildId, trigger);

        if (autoReplies.getReply(replyId)) continue;

        await autoReplies.addReply(replyId, {
          guildId,
          trigger,
          triggers: [trigger],
          response,
          responses: [response],
          enabled: oldReply.enabled !== false,
          priority: 1,
          matchMode: "contains",
          randomResponse: false,
          chance: 100,
          cooldown: 0,
          conditions: {},
          options: {
            replyToMessage: true,
            embed: false
          }
        });

        migrated++;
      }
    }

    if (migrated > 0) {
      console.log(
        `[HERVIN] Migrated ${migrated} legacy replies successfully.`
      );
    }

  } catch (error) {
    console.error("[HERVIN] Legacy replies migration error:", error);
  }
}

function safeError(label, error) {
  console.error(`[HERVIN] ${label}:`, error);
}

// =====================================
// COMMANDS
// =====================================

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show HERVIN commands"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot status"),

  new SlashCommandBuilder()
    .setName("addreply")
    .setDescription("Add automatic reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setMaxLength(100)
        .setRequired(true))
    .addStringOption(o =>
      o.setName("response")
        .setDescription("Bot response")
        .setMaxLength(1900)
        .setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("listreplies")
    .setDescription("List all replies")
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("removereply")
    .setDescription("Delete a reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setMaxLength(100)
        .setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("display")
    .setDescription("Display reply details")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setMaxLength(100)
        .setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Edit an automatic reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Existing trigger")
        .setMaxLength(100)
        .setRequired(true))
    .addStringOption(o =>
      o.setName("response")
        .setDescription("New response")
        .setMaxLength(1900)
        .setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("enabled")
    .setDescription("Enable or disable a reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setMaxLength(100)
        .setRequired(true))
    .addBooleanOption(o =>
      o.setName("status")
        .setDescription("True = enabled, False = disabled")
        .setRequired(true))
    .setDefaultMemberPermissions(admin)
].map(command => command.toJSON());

// =====================================
// REGISTER SYSTEM COMMANDS
// =====================================

tickets.registerTicketCommands(commands);
security.registerSecurityCommands(commands);
welcome.registerWelcomeCommands(commands);
moderation.registerModerationCommands(commands);
dmBroadcast.registerDMCommands(commands);

// =====================================
// DISCORD CLIENT
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =====================================
// INITIALIZE SYSTEMS
// =====================================

security.initializeSecurity(client);
welcome.initializeWelcome(client);
autoReplies.initializeAutoReplies(client);

// =====================================
// READY
// =====================================

client.once("ready", () => {
  console.log("--------------------------------");
  console.log(`HERVIN ONLINE: ${client.user.tag}`);
  console.log(`Guilds: ${client.guilds.cache.size}`);
  console.log("Auto Replies: READY");
  console.log("Security: READY");
  console.log("Welcome: READY");
  console.log("Tickets: READY");
  console.log("Moderation: READY");
  console.log("DM Broadcast: READY");
  console.log("--------------------------------");
});

// =====================================
// NEW MEMBER DM WELCOME
// =====================================

client.on("guildMemberAdd", async member => {
  try {
    await dmBroadcast.handleNewMember(member);
  } catch (error) {
    safeError("DM Welcome", error);
  }
});

// =====================================
// CLIENT ERROR HANDLING
// =====================================

client.on("error", error => {
  safeError("Discord client error", error);
});

client.on("shardError", error => {
  safeError("Discord shard error", error);
});

client.on("warn", warning => {
  console.warn("[HERVIN WARNING]", warning);
});

// =====================================
// INTERACTION HANDLER
// =====================================

client.on("interactionCreate", async interaction => {
  try {

    // DM BROADCAST

    if (
      await dmBroadcast.handleDMInteraction(interaction)
    ) return;

    // MODERATION

    if (
      await moderation.handleModerationInteraction(interaction)
    ) return;

    // WELCOME

    if (
      await welcome.handleWelcomeInteraction(interaction)
    ) return;

    // SECURITY

    if (
      await security.handleSecurityInteraction(interaction)
    ) return;

    // TICKETS

    if (
      await tickets.handleTicketInteraction(interaction)
    ) return;

    if (!interaction.isChatInputCommand()) return;

    // PING

    if (interaction.commandName === "ping") {
      return interaction.reply({
        content: "HERVIN Online ✅",
        ephemeral: true
      });
    }

    // HELP

    if (interaction.commandName === "help") {
      return interaction.reply({
        content:
          "**𝐇𝐄𝐑𝐕𝐈𝐍 Commands**\n\n" +

          "**General**\n" +
          "`/ping` - Bot status\n" +
          "`/help` - Commands list\n\n" +

          "**Auto Replies**\n" +
          "`/addreply` - Add reply\n" +
          "`/listreplies` - List replies\n" +
          "`/removereply` - Delete reply\n" +
          "`/display` - Display reply\n" +
          "`/edit` - Edit reply\n" +
          "`/enabled` - Enable or disable reply\n\n" +

          "**Tickets**\n" +
          "`/ticket-setup` - Setup tickets\n" +
          "`/ticket-panel` - Send ticket panel\n" +
          "`/ticket-add` - Add member\n" +
          "`/ticket-remove` - Remove member\n" +
          "`/ticket-transcript` - Create transcript\n\n" +

          "**Security**\n" +
          "`/security-setup` - Setup security\n" +
          "`/security-status` - Security status\n\n" +

          "**Welcome System**\n" +
          "`/welcome-setup` - Setup welcome messages\n" +
          "`/leave-setup` - Setup leave messages\n" +
          "`/welcome-status` - Welcome settings\n\n" +

          "**Moderation System**\n" +
          "`/ban` - Ban member\n" +
          "`/unban` - Unban member\n" +
          "`/kick` - Kick member\n" +
          "`/timeout` - Timeout member\n" +
          "`/warn` - Warn member\n" +
          "`/warnings` - Show warnings\n" +
          "`/clear` - Clear messages\n\n" +

          "**DM Broadcast**\n" +
          "`/dm-panel` - Create DM subscription panel\n" +
          "`/dm-send` - Send DM announcement to subscribers\n" +
          "`/dm-stats` - DM statistics",

        ephemeral: true
      });
    }

    // PERMISSIONS

    if (!interaction.memberPermissions?.has(admin)) {
      return interaction.reply({
        content: "تحتاج صلاحية Manage Server لاستخدام هذا الأمر.",
        ephemeral: true
      });
    }

    await interaction.deferReply({
      ephemeral: true
    });

    const guildId = interaction.guildId;

    if (!guildId) {
      return interaction.editReply(
        "هذا الأمر متاح داخل السيرفر فقط."
      );
    }

    const trigger = interaction.options
      .getString("trigger")?.trim();

    const response = interaction.options
      .getString("response")?.trim();

    const reply = trigger
      ? findGuildReply(guildId, trigger)
      : null;

    // =================================
    // ADD REPLY
    // =================================

    switch (interaction.commandName) {

      case "addreply": {
        if (
          !trigger ||
          !response ||
          trigger.length > 100 ||
          response.length > 1900
        ) {
          return interaction.editReply(
            "الكلمة أو الرد غير صالح."
          );
        }

        if (reply) {
          return interaction.editReply(
            "هذه الكلمة موجودة مسبقًا. استخدم /edit لتعديل الرد."
          );
        }

        const replyId = getReplyId(guildId, trigger);

        await autoReplies.addReply(replyId, {
          guildId,
          trigger,
          triggers: [trigger],
          response,
          responses: [response],
          enabled: true,
          priority: 1,
          matchMode: "contains",
          randomResponse: false,
          chance: 100,
          cooldown: 0,
          conditions: {},
          options: {
            replyToMessage: true,
            embed: false
          }
        });

        return interaction.editReply(
          `تمت إضافة الرد بنجاح ✅\nالكلمة: ${trigger}`
        );
      }

      // =================================
      // LIST REPLIES
      // =================================

      case "listreplies": {
        const replies = getGuildReplies(guildId);

        if (!replies.length) {
          return interaction.editReply(
            "لا توجد ردود محفوظة."
          );
        }

        const output = replies.map(reply => {
          const trigger = reply.trigger ||
            reply.triggers?.[0] ||
            "بدون كلمة";

          const response = reply.response ||
            reply.responses?.[0] ||
            "بدون رد";

          return (
            `${reply.enabled === false ? "🔴" : "🟢"} ` +
            `${trigger} → ${response}`
          );
        }).join("\n");

        return interaction.editReply(
          output.length > 1900
            ? output.slice(0, 1890) + "\n..."
            : output
        );
      }

      // =================================
      // REMOVE REPLY
      // =================================

      case "removereply": {
        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        await autoReplies.removeReply(reply.id);

        return interaction.editReply(
          "تم حذف الرد بنجاح ✅"
        );
      }

      // =================================
      // DISPLAY REPLY
      // =================================

      case "display": {
        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        const triggerName = reply.trigger ||
          reply.triggers?.[0];

        const responseText = reply.response ||
          reply.responses?.[0];

        return interaction.editReply(
          `**الكلمة:** ${triggerName}\n` +
          `**الاستجابة:** ${responseText}\n` +
          `**الحالة:** ${reply.enabled === false ? "معطل 🔴" : "مفعل 🟢"}`
        );
      }

      // =================================
      // EDIT REPLY
      // =================================

      case "edit": {
        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        if (!response || response.length > 1900) {
          return interaction.editReply(
            "الرد الجديد غير صالح."
          );
        }

        await autoReplies.updateReply(reply.id, {
          response,
          responses: [response],
          randomResponse: false
        });

        return interaction.editReply(
          "تم تعديل الاستجابة بنجاح ✅"
        );
      }

      // =================================
      // ENABLE / DISABLE
      // =================================

      case "enabled": {
        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        const status = interaction.options
          .getBoolean("status");

        await autoReplies.setReplyEnabled(
          reply.id,
          status
        );

        return interaction.editReply(
          status
            ? "تم تفعيل الرد 🟢"
            : "تم تعطيل الرد 🔴"
        );
      }

      default:
        return interaction.editReply(
          "الأمر غير معروف."
        );
    }

  } catch (error) {
    safeError("Interaction handler", error);

    const errorMessage =
      "حدث خطأ أثناء تنفيذ الأمر. راجع Logs.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage);
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true
        });
      }
    } catch (replyError) {
      safeError("Interaction response", replyError);
    }
  }
});

// =====================================
// START BOT
// =====================================

async function start() {
  try {
    console.log("[HERVIN] Starting...");

    await migrateLegacyReplies();

    const rest = new REST({
      version: "10"
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("[HERVIN] Commands registered successfully.");

    await client.login(TOKEN);

  } catch (error) {
    safeError("Startup", error);
    throw error;
  }
}

// =====================================
// STARTUP
// =====================================

start().catch(error => {
  safeError("Fatal startup error", error);
  process.exitCode = 1;
});
