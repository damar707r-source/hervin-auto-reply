
const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// HERVIN TICKET SYSTEM
// =====================================

const configPath = path.join(__dirname, "tickets.json");

function loadConfig() {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("HERVIN Tickets Load Error:", error);
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  );
}

function getConfig(guildId) {
  return loadConfig()[guildId] || null;
}

// =====================================
// SLASH COMMANDS
// =====================================

function registerTicketCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("ticket-setup")
      .setDescription("Configure HERVIN ticket system")
      .addChannelOption(option =>
        option.setName("panel")
          .setDescription("Ticket panel channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addChannelOption(option =>
        option.setName("category")
          .setDescription("Tickets category")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))
      .addRoleOption(option =>
        option.setName("support")
          .setDescription("Support team role")
          .setRequired(true))
      .addStringOption(option =>
        option.setName("image")
          .setDescription("Panel image URL")
          .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("Send HERVIN ticket panel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON()
  );
}

// =====================================
// EMBEDS
// =====================================

function createPanelEmbed(config) {
  const embed = new EmbedBuilder()
    .setColor(config.color || 0xD9B84F)
    .setTitle(config.panelTitle || "𝐇𝐄𝐑𝐕𝐈𝐍 SUPPORT")
    .setDescription(
      config.panelDescription ||
      "مرحبًا بك في مركز الدعم الفني الخاص بـ HERVIN\n\n" +
      "إذا كنت تحتاج إلى المساعدة، اضغط على الزر بالأسفل لفتح تذكرة خاصة مع فريق الدعم."
    )
    .setFooter({ text: "HERVIN Ticket System" });

  if (config.panelImage) {
    embed.setImage(config.panelImage);
  }

  return embed;
}

function createTicketEmbed(user, supportRole) {
  return new EmbedBuilder()
    .setColor(0xD9B84F)
    .setTitle("🎫 تذكرتك جاهزة")
    .setDescription(
      `أهلًا ${user}\n\n` +
      "تم فتح تذكرتك بنجاح.\n" +
      "اكتب تفاصيل طلبك وسيقوم فريق الدعم بمساعدتك.\n\n" +
      `**فريق الدعم:** ${supportRole}`
    )
    .setFooter({ text: "HERVIN Support System" });
}

// =====================================
// TICKET BUTTONS
// =====================================

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_ticket_open")
      .setLabel("فتح تذكرة")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
  );
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_ticket_claim")
      .setLabel("استلام")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_close")
      .setLabel("إغلاق")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function closedTicketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_ticket_reopen")
      .setLabel("إعادة فتح")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_delete")
      .setLabel("حذف التذكرة")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );
}

// =====================================
// SETUP
// =====================================

async function setupTickets(interaction) {
  const panel = interaction.options.getChannel("panel");
  const category = interaction.options.getChannel("category");
  const support = interaction.options.getRole("support");
  const image = interaction.options.getString("image");

  if (image && !/^https?:\/\/\S+$/i.test(image)) {
    return interaction.reply({
      content: "رابط الصورة غير صالح.",
      ephemeral: true
    });
  }

  const data = loadConfig();

  data[interaction.guildId] = {
    panelChannelId: panel.id,
    categoryId: category.id,
    supportRoleId: support.id,
    panelImage: image || null,
    panelTitle: "𝐇𝐄𝐑𝐕𝐈𝐍 SUPPORT",
    panelDescription:
      "مرحبًا بك في مركز الدعم الفني الخاص بـ HERVIN\n\n" +
      "اضغط على الزر بالأسفل لفتح تذكرة خاصة مع فريق الدعم.",
    color: 0xD9B84F
  };

  saveConfig(data);

  return interaction.reply({
    content:
      "تم حفظ إعدادات نظام التذاكر بنجاح ✅\n" +
      `قناة اللوحة: ${panel}\n` +
      `قسم التذاكر: ${category}\n` +
      `رتبة الدعم: ${support}\n` +
      "استخدم /ticket-panel لنشر اللوحة.",
    ephemeral: true
  });
}

// =====================================
// SEND PANEL
// =====================================

async function sendPanel(interaction) {
  const config = getConfig(interaction.guildId);

  if (!config) {
    return interaction.reply({
      content: "إعدادات التذاكر غير موجودة. استخدم /ticket-setup أولًا.",
      ephemeral: true
    });
  }

  const channel = interaction.guild.channels.cache.get(
    config.panelChannelId
  );

  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: "قناة لوحة التذاكر غير موجودة.",
      ephemeral: true
    });
  }

  await channel.send({
    embeds: [createPanelEmbed(config)],
    components: [panelButtons()]
  });

  return interaction.reply({
    content: `تم نشر لوحة التذاكر في ${channel} بنجاح ✅`,
    ephemeral: true
  });
}

// =====================================
// OPEN TICKET
// =====================================

async function openTicket(interaction) {
  const config = getConfig(interaction.guildId);

  if (!config) {
    return interaction.reply({
      content: "نظام التذاكر غير مجهز.",
      ephemeral: true
    });
  }

  const category = interaction.guild.channels.cache.get(
    config.categoryId
  );

  const supportRole = interaction.guild.roles.cache.get(
    config.supportRoleId
  );

  if (!category || !supportRole) {
    return interaction.reply({
      content: "إعدادات التذاكر غير صحيحة. أعد إعداد النظام.",
      ephemeral: true
    });
  }

  const existing = interaction.guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    channel.topic === `HERVIN_TICKET:${interaction.user.id}` &&
    channel.parentId === category.id
  );

  if (existing) {
    return interaction.reply({
      content: `لديك تذكرة مفتوحة بالفعل: ${existing}`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const username = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 80) || "member";

  const ticket = await interaction.guild.channels.create({
    name: `ticket-${username}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `HERVIN_TICKET:${interaction.user.id}`,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: supportRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ]
  });

  await ticket.send({
    content: `${interaction.user} ${supportRole}`,
    embeds: [createTicketEmbed(interaction.user, supportRole)],
    components: [ticketButtons()]
  });

  await interaction.editReply({
    content: `تم فتح تذكرتك بنجاح 🎫 ${ticket}`
  });
}

// =====================================
// TICKET PERMISSIONS
// =====================================

function getTicketOwner(channel) {
  if (!channel.topic?.startsWith("HERVIN_TICKET:")) return null;
  return channel.topic.replace("HERVIN_TICKET:", "");
}

function canManageTicket(interaction, config) {
  const support = interaction.member.roles.cache.has(
    config?.supportRoleId
  );

  const admin = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageChannels
  );

  return support || admin;
}

// =====================================
// CLAIM TICKET
// =====================================

async function claimTicket(interaction) {
  const config = getConfig(interaction.guildId);

  if (!getTicketOwner(interaction.channel)) {
    return interaction.reply({
      content: "هذه ليست تذكرة HERVIN.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "هذا الزر مخصص لفريق الدعم.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: `تم استلام التذكرة بواسطة ${interaction.user} ✅`
  });

  await interaction.channel.send(
    `🙋 ${interaction.user} أصبح مسؤولًا عن متابعة هذه التذكرة.`
  );
}

// =====================================
// CLOSE TICKET
// =====================================

async function closeTicket(interaction) {
  const ownerId = getTicketOwner(interaction.channel);
  const config = getConfig(interaction.guildId);

  if (!ownerId) {
    return interaction.reply({
      content: "هذه ليست تذكرة HERVIN.",
      ephemeral: true
    });
  }

  const isOwner = interaction.user.id === ownerId;

  if (!isOwner && !canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "ليس لديك صلاحية إغلاق هذه التذكرة.",
      ephemeral: true
    });
  }

  await interaction.deferUpdate();

  await interaction.channel.permissionOverwrites.edit(ownerId, {
    SendMessages: false
  });

  await interaction.channel.setName(
    `closed-${interaction.channel.name.replace(/^ticket-/, "")}`
      .slice(0, 100)
  );

  await interaction.message.edit({
    components: [closedTicketButtons()]
  });

  await interaction.channel.send(
    `🔒 تم إغلاق التذكرة بواسطة ${interaction.user}`
  );
}

// =====================================
// REOPEN TICKET
// =====================================

async function reopenTicket(interaction) {
  const ownerId = getTicketOwner(interaction.channel);
  const config = getConfig(interaction.guildId);

  if (!ownerId || !canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "ليس لديك صلاحية إعادة فتح التذكرة.",
      ephemeral: true
    });
  }

  await interaction.channel.permissionOverwrites.edit(ownerId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true
  });

  await interaction.channel.setName(
    interaction.channel.name.replace(/^closed-/, "ticket-").slice(0, 100)
  );

  await interaction.message.edit({
    components: [ticketButtons()]
  });

  await interaction.reply({
    content: `تمت إعادة فتح التذكرة بواسطة ${interaction.user} 🔓`
  });
}

// =====================================
// DELETE TICKET
// =====================================

async function deleteTicket(interaction) {
  const ownerId = getTicketOwner(interaction.channel);
  const config = getConfig(interaction.guildId);

  if (!ownerId || !canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "ليس لديك صلاحية حذف التذكرة.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content: "سيتم حذف التذكرة خلال 5 ثوانٍ 🗑️",
    ephemeral: true
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete("HERVIN ticket deleted");
    } catch (error) {
      console.error("Ticket Delete Error:", error);
    }
  }, 5000);
}

// =====================================
// INTERACTION HANDLER
// =====================================

async function handleTicketInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ticket-setup") {
      await setupTickets(interaction);
      return true;
    }

    if (interaction.commandName === "ticket-panel") {
      await sendPanel(interaction);
      return true;
    }
  }

  if (interaction.isButton()) {
    switch (interaction.customId) {
      case "hervin_ticket_open":
        await openTicket(interaction);
        return true;

      case "hervin_ticket_claim":
        await claimTicket(interaction);
        return true;

      case "hervin_ticket_close":
        await closeTicket(interaction);
        return true;

      case "hervin_ticket_reopen":
        await reopenTicket(interaction);
        return true;

      case "hervin_ticket_delete":
        await deleteTicket(interaction);
        return true;
    }
  }

  return false;
}

module.exports = {
  registerTicketCommands,
  handleTicketInteraction
};
