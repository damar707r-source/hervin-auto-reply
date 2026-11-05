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

    return JSON.parse(
      fs.readFileSync(configPath, "utf8")
    );
  } catch (error) {
    console.error("HERVIN Welcome Load Error:", error);
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(
    configPath,
    JSON.stringify(data, null, 2)
  );
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
          .setDescription("Welcome message")
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
          .setDescription("Leave message")
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

async function sendConfiguredMessage(
  guild,
  channelId,
  template,
  user,
  memberCount
) {
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);

    if (!channel?.isTextBased() || !channel.send) return;

    await channel.send({
      content: formatMessage(
        template,
        user,
        guild,
        memberCount
      ),
      allowedMentions: {
        parse: ["users"]
      }
    });
  } catch (error) {
    console.error("HERVIN Welcome Send Error:", error);
  }
}

// =====================================
// MEMBER AUTO ROLES
// =====================================

async function giveAutoRole(member, roleId, type) {
  if (!roleId) return;

  try {
    const role = await member.guild.roles.fetch(roleId);

    if (!role) {
      console.log(`HERVIN ${type} role not found`);
      return;
    }

    if (!member.guild.members.me) {
      await member.guild.members.fetchMe();
    }

    const botMember = member.guild.members.me;

    if (!botMember.permissions.has(
      PermissionFlagsBits.ManageRoles
    )) {
      console.log("HERVIN needs Manage Roles permission");
      return;
    }

    if (role.position >= botMember.roles.highest.position) {
      console.log("HERVIN cannot assign a role above its highest role");
      return;
    }

    if (role.managed || role.id === member.guild.id) return;

    await member.roles.add(
      role,
      `HERVIN automatic ${type} role`
    );

    console.log(
      `HERVIN assigned ${type} role to ${member.user.tag}`
    );

  } catch (error) {
    console.error(`HERVIN ${type} Role Error:`, error);
  }
}

// =====================================
// JOIN / LEAVE LOGS
// =====================================

async function sendMemberLog(
  guild,
  channelId,
  title,
  member,
  color
) {
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);

    if (!channel?.isTextBased() || !channel.send) return;

    await channel.send({
      embeds: [{
        color,
        title,
        fields: [
          {
            name: "العضو",
            value: `${member.user.tag}\n<@${member.id}>`,
            inline: true
          },
          {
            name: "معرّف العضو",
            value: member.id,
            inline: true
          },
          {
            name: "عدد أعضاء السيرفر",
            value: String(guild.memberCount),
            inline: true
          }
        ],
        thumbnail: {
          url: member.user.displayAvatarURL({
            size: 256
          })
        },
        timestamp: new Date().toISOString(),
        footer: {
          text: "HERVIN MEMBER LOGS"
        }
      }],
      allowedMentions: {
        parse: []
      }
    });

  } catch (error) {
    console.error("HERVIN Member Log Error:", error);
  }
}

// =====================================
// COMMAND HANDLER
// =====================================

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
      ...data[guildId].welcome,
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
      ...data[guildId].leave,
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

    const memberRole = config.memberRoleId
      ? `<@&${config.memberRoleId}>`
      : "غير مضبوط";

    const botRole = config.botRoleId
      ? `<@&${config.botRoleId}>`
      : "غير مضبوط";

    const joinLog = config.joinLogChannelId
      ? `<#${config.joinLogChannelId}>`
      : "غير مضبوط";

    const leaveLog = config.leaveLogChannelId
      ? `<#${config.leaveLogChannelId}>`
      : "غير مضبوط";

    await interaction.reply({
      content:
        "**𝐇𝐄𝐑𝐕𝐈𝐍 WELCOME STATUS**\n\n" +
        `🎉 قناة الترحيب: ${welcomeChannel}\n` +
        `👋 قناة المغادرة: ${leaveChannel}\n` +
        `👤 رتبة الأعضاء: ${memberRole}\n` +
        `🤖 رتبة البوتات: ${botRole}\n` +
        `📥 لوق الدخول: ${joinLog}\n` +
        `📤 لوق الخروج: ${leaveLog}`,
      ephemeral: true
    });

    return true;
  }

  return false;
}

// =====================================
// INITIALIZE WELCOME SYSTEM
// =====================================

function initializeWelcome(client) {

  client.on("guildMemberAdd", async member => {
    const config = loadConfig()[member.guild.id] || {};

    // Automatic roles
    if (member.user.bot) {
      await giveAutoRole(
        member,
        config.botRoleId,
        "BOT"
      );
    } else {
      await giveAutoRole(
        member,
        config.memberRoleId,
        "MEMBER"
      );
    }

    // Welcome message for human members
    if (!member.user.bot && config.welcome) {
      await sendConfiguredMessage(
        member.guild,
        config.welcome.channelId,
        config.welcome.message,
        member.user,
        member.guild.memberCount
      );
    }

    // Join logs for members and bots
    await sendMemberLog(
      member.guild,
      config.joinLogChannelId,
      member.user.bot
        ? "🤖 دخول بوت جديد"
        : "📥 دخول عضو جديد",
      member,
      0x35c98a
    );
  });

  client.on("guildMemberRemove", async member => {
    const config = loadConfig()[member.guild.id] || {};

    // Leave message for human members
    if (!member.user.bot && config.leave) {
      await sendConfiguredMessage(
        member.guild,
        config.leave.channelId,
        config.leave.message,
        member.user,
        member.guild.memberCount
      );
    }

    // Leave logs
    await sendMemberLog(
      member.guild,
      config.leaveLogChannelId,
      member.user.bot
        ? "🤖 خروج بوت"
        : "📤 خروج عضو",
      member,
      0xef6464
    );
  });

  console.log("HERVIN Welcome initialized");
}

module.exports = {
  registerWelcomeCommands,
  handleWelcomeInteraction,
  initializeWelcome
};
