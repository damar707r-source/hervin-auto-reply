const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "welcome.json");

function loadConfig() {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("HERVIN Welcome Load Error:", error);
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function registerWelcomeCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("welcome-setup")
      .setDescription("Configure HERVIN welcome messages")
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("Welcome channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addStringOption(option =>
        option.setName("message")
          .setDescription("Welcome message. Variables: {user}, {username}, {server}, {memberCount}")
          .setMaxLength(1000)
          .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("leave-setup")
      .setDescription("Configure HERVIN leave messages")
      .addChannelOption(option =>
        option.setName("channel")
          .setDescription("Leave channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addStringOption(option =>
        option.setName("message")
          .setDescription("Leave message. Variables: {user}, {username}, {server}, {memberCount}")
          .setMaxLength(1000)
          .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("welcome-status")
      .setDescription("Show HERVIN welcome settings")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON()
  );
}

function formatMessage(template, user, guild, memberCount) {
  return template
    .replace(/\{user\}/gi, `<@${user.id}>`)
    .replace(/\{username\}/gi, user.username)
    .replace(/\{server\}/gi, guild.name)
    .replace(/\{memberCount\}/gi, String(memberCount));
}

async function sendConfiguredMessage(guild, channelId, template, user, memberCount) {
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);

    if (!channel?.isTextBased() || !channel.send) return;

    await channel.send({
      content: formatMessage(template, user, guild, memberCount),
      allowedMentions: {
        parse: ["users"]
      }
    });
  } catch (error) {
    console.error("HERVIN Welcome Send Error:", error);
  }
}

async function handleWelcomeInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const command = interaction.commandName;

  if (![
    "welcome-setup",
    "leave-setup",
    "welcome-status"
  ].includes(command)) {
    return false;
  }

  if (!interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  )) {
    await interaction.reply({
      content: "تحتاج صلاحية Manage Server لاستخدام هذا الأمر.",
      ephemeral: true
    });
    return true;
  }

  const data = loadConfig();
  const guildId = interaction.guildId;

  if (!data[guildId]) {
    data[guildId] = {};
  }

  if (command === "welcome-setup") {
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message");

    data[guildId].welcome = {
      channelId: channel.id,
      message: message ||
        "أهلًا وسهلًا {user} في سيرفر {server} 🎉\nأنت العضو رقم {memberCount}"
    };

    saveConfig(data);

    await interaction.reply({
      content: `تم إعداد الترحيب بنجاح 🎉\nالقناة: ${channel}`,
      ephemeral: true
    });

    return true;
  }

  if (command === "leave-setup") {
    const channel = interaction.options.getChannel("channel");
    const message = interaction.options.getString("message");

    data[guildId].leave = {
      channelId: channel.id,
      message: message ||
        "غادرنا {username} من سيرفر {server} 👋"
    };

    saveConfig(data);

    await interaction.reply({
      content: `تم إعداد رسائل المغادرة بنجاح 👋\nالقناة: ${channel}`,
      ephemeral: true
    });

    return true;
  }

  if (command === "welcome-status") {
    const config = data[guildId];

    const welcomeChannel = config.welcome?.channelId
      ? `<#${config.welcome.channelId}>`
      : "غير مضبوط";

    const leaveChannel = config.leave?.channelId
      ? `<#${config.leave.channelId}>`
      : "غير مضبوط";

    await interaction.reply({
      content:
        "**𝐇𝐄𝐑𝐕𝐈𝐍 WELCOME STATUS**\n\n" +
        `🎉 قناة الترحيب: ${welcomeChannel}\n` +
        `👋 قناة المغادرة: ${leaveChannel}`,
      ephemeral: true
    });

    return true;
  }

  return false;
}

function initializeWelcome(client) {
  client.on("guildMemberAdd", async member => {
    const config = loadConfig()[member.guild.id]?.welcome;
    if (!config) return;

    await sendConfiguredMessage(
      member.guild,
      config.channelId,
      config.message,
      member.user,
      member.guild.memberCount
    );
  });

  client.on("guildMemberRemove", async member => {
    const config = loadConfig()[member.guild.id]?.leave;
    if (!config) return;

    await sendConfiguredMessage(
      member.guild,
      config.channelId,
      config.message,
      member.user,
      member.guild.memberCount
    );
  });

  console.log("HERVIN Welcome initialized");
}

module.exports = {
  registerWelcomeCommands,
  handleWelcomeInteraction,
  initializeWelcome
};
