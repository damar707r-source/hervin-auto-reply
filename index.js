
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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID");
  process.exit(1);
}

const dataPath = path.join(__dirname, "replies.json");

function loadReplies() {
  if (!fs.existsSync(dataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch {
    return {};
  }
}

function saveReplies(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check HERVIN status"),

  new SlashCommandBuilder()
    .setName("addreply")
    .setDescription("Add automatic reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("response")
        .setDescription("Automatic response")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("removereply")
    .setDescription("Remove automatic reply")
    .addStringOption(o =>
      o.setName("trigger")
        .setDescription("Trigger word")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("listreplies")
    .setDescription("List automatic replies")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

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
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;

  if (interaction.commandName === "ping") {
    return interaction.reply({
      content: "HERVIN Online ✅",
      ephemeral: true
    });
  }

  if (!guildId) return;

  const data = loadReplies();
  if (!data[guildId]) data[guildId] = {};

  if (interaction.commandName === "addreply") {
    const trigger = interaction.options.getString("trigger").trim();
    const response = interaction.options.getString("response").trim();

    data[guildId][trigger.toLowerCase()] = {
      trigger,
      response
    };

    saveReplies(data);

    return interaction.reply({
      content: `تمت إضافة الرد التلقائي بنجاح ✅\n${trigger}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "removereply") {
    const trigger = interaction.options.getString("trigger").trim().toLowerCase();

    if (!data[guildId][trigger]) {
      return interaction.reply({
        content: "الرد غير موجود",
        ephemeral: true
      });
    }

    delete data[guildId][trigger];
    saveReplies(data);

    return interaction.reply({
      content: "تم حذف الرد بنجاح ✅",
      ephemeral: true
    });
  }

  if (interaction.commandName === "listreplies") {
    const replies = Object.values(data[guildId]);

    return interaction.reply({
      content: replies.length
        ? replies.map(r => `${r.trigger} → ${r.response}`).join("\n").slice(0, 1900)
        : "لا توجد ردود تلقائية",
      ephemeral: true
    });
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const data = loadReplies();
  const replies = data[message.guild.id] || {};
  const trigger = message.content.trim().toLowerCase();

  if (replies[trigger]) {
    await message.reply(replies[trigger].response);
  }
});

async function start() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  await client.login(TOKEN);
}

start().catch(console.error);
