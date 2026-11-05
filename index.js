
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
const tickets = require("./systems/tickets");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

const file = path.join(__dirname, "replies.json");

function load() {
  try {
    return fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {};
  } catch (error) {
    console.error("Load error:", error);
    return {};
  }
}

function save(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const admin = PermissionFlagsBits.ManageGuild;

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
      o.setName("trigger").setDescription("Trigger word").setRequired(true))
    .addStringOption(o =>
      o.setName("response").setDescription("Bot response").setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("listreplies")
    .setDescription("List all replies")
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("removereply")
    .setDescription("Delete a reply")
    .addStringOption(o =>
      o.setName("trigger").setDescription("Trigger word").setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("display")
    .setDescription("Display reply details")
    .addStringOption(o =>
      o.setName("trigger").setDescription("Trigger word").setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Edit an automatic reply")
    .addStringOption(o =>
      o.setName("trigger").setDescription("Existing trigger").setRequired(true))
    .addStringOption(o =>
      o.setName("response").setDescription("New response").setRequired(true))
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("enabled")
    .setDescription("Enable or disable a reply")
    .addStringOption(o =>
      o.setName("trigger").setDescription("Trigger word").setRequired(true))
    .addBooleanOption(o =>
      o.setName("status").setDescription("True = enabled, False = disabled").setRequired(true))
    .setDefaultMemberPermissions(admin)
].map(command => command.toJSON());

// إضافة أوامر التذاكر
tickets.registerTicketCommands(commands);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`HERVIN Online: ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  try {
    // معالجة أوامر وأزرار التذاكر أولاً
    if (await tickets.handleTicketInteraction(interaction)) return;

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      return interaction.reply({
        content: "HERVIN Online ✅",
        ephemeral: true
      });
    }

    if (interaction.commandName === "help") {
      return interaction.reply({
        content:
          "**𝐇𝐄𝐑𝐕𝐈𝐍 Commands**\n" +
          "`/ping` - Bot status\n" +
          "`/addreply` - Add reply\n" +
          "`/listreplies` - List replies\n" +
          "`/removereply` - Delete reply\n" +
          "`/display` - Display reply\n" +
          "`/edit` - Edit reply\n" +
          "`/enabled` - Enable or disable reply\n" +
          "`/ticket-setup` - Setup tickets\n" +
          "`/ticket-panel` - Send ticket panel",
        ephemeral: true
      });
    }

    if (!interaction.memberPermissions?.has(admin)) {
      return interaction.reply({
        content: "تحتاج صلاحية Manage Server لاستخدام هذا الأمر",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const data = load();

    if (!data[guildId]) data[guildId] = {};

    const trigger = interaction.options.getString("trigger")?.trim();
    const key = trigger?.toLowerCase();

    switch (interaction.commandName) {
      case "addreply": {
        const response = interaction.options.getString("response").trim();

        if (!trigger || !response) {
          return interaction.editReply("الكلمة والرد مطلوبان");
        }

        data[guildId][key] = {
          trigger,
          response,
          enabled: true
        };

        save(data);
        return interaction.editReply(`تمت إضافة الرد بنجاح ✅\n${trigger}`);
      }

      case "listreplies": {
        const replies = Object.values(data[guildId]);

        const output = replies.length
          ? replies.map(r =>
              `${r.enabled === false ? "🔴" : "🟢"} ${r.trigger} → ${r.response}`
            ).join("\n")
          : "لا توجد ردود محفوظة";

        return interaction.editReply(output.slice(0, 1900));
      }

      case "removereply": {
        if (!data[guildId][key]) {
          return interaction.editReply("الرد غير موجود");
        }

        delete data[guildId][key];
        save(data);

        return interaction.editReply("تم حذف الرد بنجاح ✅");
      }

      case "display": {
        const reply = data[guildId][key];

        if (!reply) return interaction.editReply("الرد غير موجود");

        return interaction.editReply(
          `**الكلمة:** ${reply.trigger}\n` +
          `**الاستجابة:** ${reply.response}\n` +
          `**الحالة:** ${reply.enabled === false ? "معطل 🔴" : "مفعل 🟢"}`
        );
      }

      case "edit": {
        const reply = data[guildId][key];

        if (!reply) return interaction.editReply("الرد غير موجود");

        reply.response = interaction.options.getString("response").trim();
        save(data);

        return interaction.editReply("تم تعديل الاستجابة بنجاح ✅");
      }

      case "enabled": {
        const reply = data[guildId][key];

        if (!reply) return interaction.editReply("الرد غير موجود");

        reply.enabled = interaction.options.getBoolean("status");
        save(data);

        return interaction.editReply(
          reply.enabled ? "تم تفعيل الرد 🟢" : "تم تعطيل الرد 🔴"
        );
      }

      default:
        return interaction.editReply("الأمر غير معروف");
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message = "حدث خطأ أثناء تنفيذ الأمر. راجع Logs.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          content: message,
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error(replyError);
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  try {
    const data = load();
    const replies = Object.values(data[message.guild.id] || {});
    const content = message.content.toLowerCase();

    const match = replies.find(reply =>
      reply.enabled !== false &&
      content.includes(reply.trigger.toLowerCase())
    );

    if (match) {
      await message.reply(match.response);
    }
  } catch (error) {
    console.error("Auto reply error:", error);
  }
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("HERVIN commands registered");

  await client.login(TOKEN);
}

start().catch(error => {
  console.error("Startup error:", error);
});
