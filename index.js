
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
const tempFile = file + ".tmp";

const admin = PermissionFlagsBits.ManageGuild;

// =====================================
// AUTO REPLY STORAGE
// =====================================

let repliesCache = {};

function load() {
  try {
    if (!fs.existsSync(file)) {
      repliesCache = {};
      return repliesCache;
    }

    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      throw new Error("Invalid replies.json format");
    }

    repliesCache = data;
    return repliesCache;

  } catch (error) {
    console.error("[HERVIN] Replies load error:", error);

    return repliesCache;
  }
}

function save(data) {
  try {
    const json = JSON.stringify(data, null, 2);

    fs.writeFileSync(tempFile, json, "utf8");
    fs.renameSync(tempFile, file);

    repliesCache = data;

    return true;

  } catch (error) {
    console.error("[HERVIN] Replies save error:", error);

    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {}

    throw error;
  }
}

// Load once when starting
load();

// =====================================
// HELPERS
// =====================================

function getGuildReplies(guildId) {
  const guildData = repliesCache[guildId];

  if (
    !guildData ||
    typeof guildData !== "object" ||
    Array.isArray(guildData)
  ) {
    return [];
  }

  return Object.values(guildData).filter(reply =>
    reply &&
    typeof reply.trigger === "string" &&
    typeof reply.response === "string" &&
    reply.trigger.trim().length > 0 &&
    reply.response.trim().length > 0
  );
}

function normalizeTrigger(trigger) {
  return trigger.trim().toLowerCase();
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

// Register system commands
tickets.registerTicketCommands(commands);
security.registerSecurityCommands(commands);
welcome.registerWelcomeCommands(commands);
moderation.registerModerationCommands(commands);

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
  console.log("--------------------------------");
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
          "`/clear` - Clear messages",

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

    const data = {
      ...repliesCache
    };

    if (
      !data[guildId] ||
      typeof data[guildId] !== "object" ||
      Array.isArray(data[guildId])
    ) {
      data[guildId] = {};
    }

    const trigger = interaction.options
      .getString("trigger")?.trim();

    const key = trigger
      ? normalizeTrigger(trigger)
      : null;

    // =================================
    // ADD REPLY
    // =================================

    switch (interaction.commandName) {

      case "addreply": {
        const response = interaction.options
          .getString("response")?.trim();

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

        if (data[guildId][key]) {
          return interaction.editReply(
            "هذه الكلمة موجودة مسبقًا. استخدم /edit لتعديل الرد."
          );
        }

        data[guildId][key] = {
          trigger,
          response,
          enabled: true
        };

        save(data);

        return interaction.editReply(
          `تمت إضافة الرد بنجاح ✅\nالكلمة: ${trigger}`
        );
      }

      // =================================
      // LIST REPLIES
      // =================================

      case "listreplies": {
        const replies = Object.values(data[guildId]);

        if (!replies.length) {
          return interaction.editReply(
            "لا توجد ردود محفوظة."
          );
        }

        const output = replies.map(reply =>
          `${reply.enabled === false ? "🔴" : "🟢"} ` +
          `${reply.trigger} → ${reply.response}`
        ).join("\n");

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
        if (!data[guildId][key]) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        delete data[guildId][key];

        save(data);

        return interaction.editReply(
          "تم حذف الرد بنجاح ✅"
        );
      }

      // =================================
      // DISPLAY REPLY
      // =================================

      case "display": {
        const reply = data[guildId][key];

        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        return interaction.editReply(
          `**الكلمة:** ${reply.trigger}\n` +
          `**الاستجابة:** ${reply.response}\n` +
          `**الحالة:** ${reply.enabled === false ? "معطل 🔴" : "مفعل 🟢"}`
        );
      }

      // =================================
      // EDIT REPLY
      // =================================

      case "edit": {
        const reply = data[guildId][key];

        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        const response = interaction.options
          .getString("response")?.trim();

        if (!response || response.length > 1900) {
          return interaction.editReply(
            "الرد الجديد غير صالح."
          );
        }

        reply.response = response;

        save(data);

        return interaction.editReply(
          "تم تعديل الاستجابة بنجاح ✅"
        );
      }

      // =================================
      // ENABLE / DISABLE
      // =================================

      case "enabled": {
        const reply = data[guildId][key];

        if (!reply) {
          return interaction.editReply(
            "الرد غير موجود."
          );
        }

        reply.enabled = interaction.options
          .getBoolean("status");

        save(data);

        return interaction.editReply(
          reply.enabled
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
// AUTO REPLY SYSTEM
// =====================================

const processedMessages = new Set();

client.on("messageCreate", async message => {
  try {
    if (
      !message.guild ||
      message.author.bot ||
      message.webhookId
    ) {
      return;
    }

    if (!message.content || !message.content.trim()) {
      return;
    }

    // Prevent duplicate processing

    if (processedMessages.has(message.id)) return;

    processedMessages.add(message.id);

    setTimeout(() => {
      processedMessages.delete(message.id);
    }, 30000);

    const replies = getGuildReplies(message.guild.id);

    if (!replies.length) return;

    const content = message.content.toLowerCase();

    // Longest triggers first

    const sortedReplies = replies
      .filter(reply => reply.enabled !== false)
      .sort((a, b) =>
        b.trigger.length - a.trigger.length
      );

    const match = sortedReplies.find(reply =>
      content.includes(
        normalizeTrigger(reply.trigger)
      )
    );

    if (!match) return;

    await message.reply({
      content: match.response,
      allowedMentions: {
        parse: []
      }
    });

    console.log(
      `[HERVIN AUTO REPLY] ${message.guild.name}: ${match.trigger}`
    );

  } catch (error) {
    safeError("Auto reply handler", error);
  }
});

// =====================================
// START BOT
// =====================================

async function start() {
  try {
    console.log("[HERVIN] Starting...");

    // Register commands

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

    // Login

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
