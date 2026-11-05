
const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "moderation.json");

function loadWarnings() {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("HERVIN Moderation Load Error:", error);
    return {};
  }
}

function saveWarnings(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function registerModerationCommands(commands) {
  const admin = PermissionFlagsBits;

  commands.push(
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member")
      .addUserOption(o =>
        o.setName("user").setDescription("Member to ban").setRequired(true))
      .addStringOption(o =>
        o.setName("reason").setDescription("Ban reason").setRequired(false))
      .setDefaultMemberPermissions(admin.BanMembers)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Unban a user")
      .addStringOption(o =>
        o.setName("userid").setDescription("Discord user ID").setRequired(true))
      .addStringOption(o =>
        o.setName("reason").setDescription("Unban reason").setRequired(false))
      .setDefaultMemberPermissions(admin.BanMembers)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a member")
      .addUserOption(o =>
        o.setName("user").setDescription("Member to kick").setRequired(true))
      .addStringOption(o =>
        o.setName("reason").setDescription("Kick reason").setRequired(false))
      .setDefaultMemberPermissions(admin.KickMembers)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Timeout a member")
      .addUserOption(o =>
        o.setName("user").setDescription("Member to timeout").setRequired(true))
      .addIntegerOption(o =>
        o.setName("minutes")
          .setDescription("Duration in minutes (1-40320)")
          .setMinValue(1)
          .setMaxValue(40320)
          .setRequired(true))
      .addStringOption(o =>
        o.setName("reason").setDescription("Timeout reason").setRequired(false))
      .setDefaultMemberPermissions(admin.ModerateMembers)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a member")
      .addUserOption(o =>
        o.setName("user").setDescription("Member to warn").setRequired(true))
      .addStringOption(o =>
        o.setName("reason").setDescription("Warning reason").setRequired(true))
      .setDefaultMemberPermissions(admin.ManageMessages)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Show member warnings")
      .addUserOption(o =>
        o.setName("user").setDescription("Member to check").setRequired(true))
      .setDefaultMemberPermissions(admin.ManageMessages)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Delete messages")
      .addIntegerOption(o =>
        o.setName("amount")
          .setDescription("Number of messages (1-100)")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true))
      .setDefaultMemberPermissions(admin.ManageMessages)
      .toJSON()
  );
}

async function handleModerationInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const command = interaction.commandName;

  const supported = [
    "ban",
    "unban",
    "kick",
    "timeout",
    "warn",
    "warnings",
    "clear"
  ];

  if (!supported.includes(command)) return false;

  const permissions = {
    ban: PermissionFlagsBits.BanMembers,
    unban: PermissionFlagsBits.BanMembers,
    kick: PermissionFlagsBits.KickMembers,
    timeout: PermissionFlagsBits.ModerateMembers,
    warn: PermissionFlagsBits.ManageMessages,
    warnings: PermissionFlagsBits.ManageMessages,
    clear: PermissionFlagsBits.ManageMessages
  };

  if (!interaction.memberPermissions?.has(permissions[command])) {
    await interaction.reply({
      content: "ما عندك الصلاحية المطلوبة لهذا الأمر.",
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const reason = interaction.options.getString("reason") || "No reason provided";

  try {
    switch (command) {
      case "ban": {
        const user = interaction.options.getUser("user");

        if (user.id === interaction.user.id) {
          return interaction.editReply("ما تقدر تحظر نفسك.");
        }

        if (user.id === guild.ownerId) {
          return interaction.editReply("ما تقدر تحظر مالك السيرفر.");
        }

        await guild.members.ban(user.id, {
          reason: `${reason} | Moderator: ${interaction.user.tag}`
        });

        return interaction.editReply(`تم حظر ${user.tag} بنجاح 🔨`);
      }

      case "unban": {
        const userId = interaction.options.getString("userid").trim();

        if (!/^\d{17,20}$/.test(userId)) {
          return interaction.editReply("معرف المستخدم غير صحيح.");
        }

        await guild.members.unban(
          userId,
          `${reason} | Moderator: ${interaction.user.tag}`
        );

        return interaction.editReply(`تم فك الحظر عن <@${userId}> بنجاح ✅`);
      }

      case "kick": {
        const user = interaction.options.getUser("user");

        if (user.id === interaction.user.id) {
          return interaction.editReply("ما تقدر تطرد نفسك.");
        }

        if (user.id === guild.ownerId) {
          return interaction.editReply("ما تقدر تطرد مالك السيرفر.");
        }

        const member = await guild.members.fetch(user.id);

        if (!member.kickable) {
          return interaction.editReply(
            "ما أقدر أطرد هذا العضو. تأكد من ترتيب رتب البوت وصلاحياته."
          );
        }

        await member.kick(
          `${reason} | Moderator: ${interaction.user.tag}`
        );

        return interaction.editReply(`تم طرد ${user.tag} بنجاح 👢`);
      }

      case "timeout": {
        const user = interaction.options.getUser("user");
        const minutes = interaction.options.getInteger("minutes");

        if (user.id === interaction.user.id) {
          return interaction.editReply("ما تقدر تسكت نفسك.");
        }

        if (user.id === guild.ownerId) {
          return interaction.editReply("ما تقدر تسكت مالك السيرفر.");
        }

        const member = await guild.members.fetch(user.id);

        if (!member.moderatable) {
          return interaction.editReply(
            "ما أقدر أسكت هذا العضو. تأكد من ترتيب رتب البوت وصلاحياته."
          );
        }

        await member.timeout(
          minutes * 60 * 1000,
          `${reason} | Moderator: ${interaction.user.tag}`
        );

        return interaction.editReply(
          `تم إسكات ${user.tag} لمدة ${minutes} دقيقة 🔇`
        );
      }

      case "warn": {
        const user = interaction.options.getUser("user");
        const warningReason = interaction.options.getString("reason");

        if (user.bot) {
          return interaction.editReply("لا يمكن تحذير البوتات.");
        }

        const data = loadWarnings();

        if (!data[guild.id]) data[guild.id] = {};
        if (!data[guild.id][user.id]) data[guild.id][user.id] = [];

        data[guild.id][user.id].push({
          reason: warningReason,
          moderator: interaction.user.id,
          createdAt: new Date().toISOString()
        });

        saveWarnings(data);

        const count = data[guild.id][user.id].length;

        return interaction.editReply(
          `تم تحذير ${user.tag} بنجاح ⚠️\nعدد تحذيراته: ${count}`
        );
      }

      case "warnings": {
        const user = interaction.options.getUser("user");
        const data = loadWarnings();

        const warnings = data[guild.id]?.[user.id] || [];

        if (!warnings.length) {
          return interaction.editReply(`لا توجد تحذيرات على ${user.tag} ✅`);
        }

        const output = warnings.map((w, i) => {
          const date = new Date(w.createdAt).toLocaleString("en-GB", {
            timeZone: "Asia/Riyadh"
          });

          return (
            `**${i + 1}.** ${w.reason}\n` +
            `المشرف: <@${w.moderator}>\n` +
            `التاريخ: ${date}`
          );
        }).join("\n\n");

        return interaction.editReply(
          `**تحذيرات ${user.tag} (${warnings.length})**\n\n${output}`.slice(0, 1950)
        );
      }

      case "clear": {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return interaction.editReply("هذا الأمر غير متاح في هذه القناة.");
        }

        const deleted = await interaction.channel.bulkDelete(amount, true);

        return interaction.editReply(
          `تم حذف ${deleted.size} رسالة بنجاح 🧹\n` +
          (deleted.size < amount
            ? "قد تكون بعض الرسائل أقدم من 14 يومًا."
            : "")
        );
      }
    }
  } catch (error) {
    console.error(`HERVIN ${command} Error:`, error);

    return interaction.editReply(
      "تعذر تنفيذ الأمر. تحقق من صلاحيات البوت وترتيب الرتب، وراجع Logs."
    );
  }

  return true;
}

module.exports = {
  registerModerationCommands,
  handleModerationInteraction
};
