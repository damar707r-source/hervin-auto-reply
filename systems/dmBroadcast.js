
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "dm-subscribers.json");
const admin = PermissionFlagsBits.ManageGuild;

const sendingGuilds = new Set();

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ guilds: {} }, null, 2)
      );
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8") || "{}"
    );

    if (!data.guilds || typeof data.guilds !== "object") {
      data.guilds = {};
    }

    return data;
  } catch (error) {
    console.error("[HERVIN DM] Load error:", error);
    return { guilds: {} };
  }
}

let data = loadData();

function saveData() {
  const tempFile = DATA_FILE + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2)
  );

  fs.renameSync(tempFile, DATA_FILE);
}

function getGuildData(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      subscribers: [],
      welcomed: []
    };
  }

  const guild = data.guilds[guildId];

  if (!Array.isArray(guild.subscribers)) {
    guild.subscribers = [];
  }

  if (!Array.isArray(guild.welcomed)) {
    guild.welcomed = [];
  }

  return guild;
}

function subscribe(guildId, userId) {
  const guild = getGuildData(guildId);

  if (!guild.subscribers.includes(userId)) {
    guild.subscribers.push(userId);
    saveData();
  }
}

function unsubscribe(guildId, userId) {
  const guild = getGuildData(guildId);

  guild.subscribers = guild.subscribers.filter(
    id => id !== userId
  );

  saveData();
}

function registerDMCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("dm-panel")
      .setDescription("Create HERVIN DM subscription panel")
      .setDefaultMemberPermissions(admin)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("dm-send")
      .setDescription("Send a private announcement to subscribers")
      .addStringOption(option =>
        option
          .setName("message")
          .setDescription("Announcement message")
          .setMaxLength(1900)
          .setRequired(true)
      )
      .setDefaultMemberPermissions(admin)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("dm-stats")
      .setDescription("Show HERVIN DM statistics")
      .setDefaultMemberPermissions(admin)
      .toJSON()
  );
}

// =====================================
// NEW MEMBER WELCOME DM
// =====================================

async function handleNewMember(member) {
  if (!member || !member.guild || member.user.bot) return;

  const guildId = member.guild.id;
  const userId = member.id;

  const guild = getGuildData(guildId);

  if (guild.welcomed.includes(userId)) return;

  // Save before sending to prevent duplicate attempts
  guild.welcomed.push(userId);
  saveData();

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle("𝐇𝐄𝐑𝐕𝐈𝐍 | أهلاً بك ❤️")
    .setDescription(
      `هلا والله ${member.user.username} ❤️\n\n` +
      "وجودك معنا في السيرفر يسعدنا، ونبي نشوف تفاعلك ومشاركاتك\n\n" +
      "وجودك يصنع فرق في مجتمعنا 🔥\n\n" +
      "لا تحرمنا من تفاعلك، ننتظرك!"
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({
      text: "HERVIN | COMMUNITY"
    })
    .setTimestamp();

  try {
    await member.send({
      embeds: [embed]
    });

    console.log(
      `[HERVIN DM] Welcome sent to ${userId}`
    );

  } catch (error) {
    console.log(
      `[HERVIN DM] Could not send welcome to ${userId}:`,
      error.code || error.message
    );
  }
}

// =====================================
// INTERACTIONS
// =====================================

async function handleDMInteraction(interaction) {
  if (
    !interaction.isChatInputCommand() &&
    !interaction.isButton()
  ) {
    return false;
  }

  if (interaction.isButton()) {
    if (
      interaction.customId !== "hervin_dm_subscribe" &&
      interaction.customId !== "hervin_dm_unsubscribe"
    ) {
      return false;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "هذا الزر يعمل داخل السيرفر فقط.",
        ephemeral: true
      });

      return true;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const guild = getGuildData(guildId);

    if (interaction.customId === "hervin_dm_subscribe") {
      if (guild.subscribers.includes(userId)) {
        await interaction.reply({
          content: "أنت مشترك بالفعل 🟢",
          ephemeral: true
        });
      } else {
        subscribe(guildId, userId);

        await interaction.reply({
          content: "تم اشتراكك بنجاح في رسائل HERVIN 🟢",
          ephemeral: true
        });
      }
    } else {
      if (!guild.subscribers.includes(userId)) {
        await interaction.reply({
          content: "أنت غير مشترك حالياً.",
          ephemeral: true
        });
      } else {
        unsubscribe(guildId, userId);

        await interaction.reply({
          content: "تم إلغاء اشتراكك بنجاح 🔴",
          ephemeral: true
        });
      }
    }

    return true;
  }

  if (!interaction.isChatInputCommand()) return false;

  if (
    !["dm-panel", "dm-send", "dm-stats"].includes(
      interaction.commandName
    )
  ) {
    return false;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "هذا الأمر متاح داخل السيرفر فقط.",
      ephemeral: true
    });

    return true;
  }

  if (!interaction.memberPermissions?.has(admin)) {
    await interaction.reply({
      content: "تحتاج صلاحية Manage Server.",
      ephemeral: true
    });

    return true;
  }

  const guildId = interaction.guildId;
  const guildData = getGuildData(guildId);

  if (interaction.commandName === "dm-panel") {
    const embed = new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle("𝐇𝐄𝐑𝐕𝐈𝐍 | Private Messages")
      .setDescription(
        "اشترك لاستقبال إعلانات ورسائل HERVIN الخاصة\n\n" +
        "🟢 اضغط استقبال الرسائل للاشتراك\n" +
        "🔴 اضغط إلغاء الاشتراك لإيقاف الرسائل"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("hervin_dm_subscribe")
        .setLabel("استقبال الرسائل")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("hervin_dm_unsubscribe")
        .setLabel("إلغاء الاشتراك")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: "تم إنشاء لوحة الاشتراك ✅",
      ephemeral: true
    });

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    return true;
  }

  if (interaction.commandName === "dm-stats") {
    await interaction.reply({
      content:
        "**HERVIN DM Statistics**\n\n" +
        `المشتركون: ${guildData.subscribers.length}\n` +
        `رسائل الترحيب المسجلة: ${guildData.welcomed.length}\n` +
        `حالة الإرسال: ${
          sendingGuilds.has(guildId)
            ? "جارٍ الإرسال 🟡"
            : "متوقف 🟢"
        }`,
      ephemeral: true
    });

    return true;
  }

  if (interaction.commandName === "dm-send") {
    if (sendingGuilds.has(guildId)) {
      await interaction.reply({
        content: "هناك حملة إرسال تعمل حالياً.",
        ephemeral: true
      });

      return true;
    }

    const message = interaction.options
      .getString("message", true)
      .trim();

    if (!message) {
      await interaction.reply({
        content: "اكتب نص الرسالة أولاً.",
        ephemeral: true
      });

      return true;
    }

    const subscribers = [...guildData.subscribers];

    if (!subscribers.length) {
      await interaction.reply({
        content: "لا يوجد أعضاء مشتركين حالياً.",
        ephemeral: true
      });

      return true;
    }

    await interaction.deferReply({
      ephemeral: true
    });

    sendingGuilds.add(guildId);

    let success = 0;
    let failed = 0;

    try {
      for (const userId of subscribers) {
        try {
          const user = await interaction.client.users.fetch(userId);

          await user.send({
            content: message,
            allowedMentions: { parse: [] }
          });

          success++;

        } catch (error) {
          failed++;

          console.error(
            `[HERVIN DM] Failed for ${userId}:`,
            error.code || error.message
          );
        }

        await new Promise(resolve =>
          setTimeout(resolve, 1200)
        );
      }

      await interaction.editReply({
        content:
          "**انتهت حملة HERVIN DM ✅**\n\n" +
          `إجمالي المشتركين: ${subscribers.length}\n` +
          `تم الإرسال: ${success}\n` +
          `فشل الإرسال: ${failed}`
      });

    } catch (error) {
      console.error("[HERVIN DM] Campaign error:", error);

      await interaction.editReply({
        content: "حدث خطأ أثناء حملة الإرسال."
      });

    } finally {
      sendingGuilds.delete(guildId);
    }

    return true;
  }

  return false;
}

module.exports = {
  registerDMCommands,
  handleDMInteraction,
  handleNewMember
};
