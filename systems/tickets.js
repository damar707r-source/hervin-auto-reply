
const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// HERVIN ADVANCED TICKET SYSTEM
// =====================================

const configPath = path.join(__dirname, "tickets.json");

const TICKET_TYPES = {
  support: {
    label: "الدعم الفني",
    emoji: "🛠️",
    description: "للمساعدة والاستفسارات التقنية"
  },
  complaint: {
    label: "الشكاوى",
    emoji: "📢",
    description: "لتقديم شكوى أو الإبلاغ عن مشكلة"
  },
  admin: {
    label: "الإدارة",
    emoji: "👑",
    description: "للتواصل مع إدارة السيرفر"
  },
  store: {
    label: "المتجر",
    emoji: "🛒",
    description: "للطلبات والاستفسارات التجارية"
  }
};

// =====================================
// CONFIG
// =====================================

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
  try {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("HERVIN Tickets Save Error:", error);
    throw error;
  }
}

function getConfig(guildId) {
  return loadConfig()[guildId] || null;
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  );
}

function getTicketOwner(channel) {
  const match = channel?.topic?.match(/HERVIN_TICKET:(\d+)/);
  return match ? match[1] : null;
}

function getTicketType(channel) {
  const match = channel?.topic?.match(/TYPE:([a-z]+)/);
  return match ? match[1] : "support";
}

function getClaimedBy(channel) {
  const match = channel?.topic?.match(/CLAIMED:(\d+)/);
  return match ? match[1] : null;
}

function setTopicValue(topic, key, value) {
  const regex = new RegExp(`\\|${key}:[^|]*`);
  const replacement = value ? `|${key}:${value}` : "";

  if (regex.test(topic)) {
    return topic.replace(regex, replacement);
  }

  return topic + replacement;
}

// =====================================
// PERMISSIONS
// =====================================

function isSupport(interaction, config) {
  if (!config) return false;

  const roles = interaction.member?.roles;

  if (roles?.cache?.has(config.supportRoleId)) {
    return true;
  }

  if (Array.isArray(roles) && roles.includes(config.supportRoleId)) {
    return true;
  }

  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageChannels
  ) || false;
}

function canManageTicket(interaction, config) {
  return isSupport(interaction, config);
}

function isTicket(channel) {
  return Boolean(getTicketOwner(channel));
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
      .addChannelOption(option =>
        option.setName("logs")
          .setDescription("Transcript logs channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false))
      .addIntegerOption(option =>
        option.setName("max_open")
          .setDescription("Maximum open tickets per member")
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("Send HERVIN ticket panel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ticket-add")
      .setDescription("Add a member to this ticket")
      .addUserOption(option =>
        option.setName("member")
          .setDescription("Member to add")
          .setRequired(true))
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ticket-remove")
      .setDescription("Remove a member from this ticket")
      .addUserOption(option =>
        option.setName("member")
          .setDescription("Member to remove")
          .setRequired(true))
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ticket-transcript")
      .setDescription("Create a transcript of this ticket")
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
      "اختر نوع التذكرة من الأزرار أو القائمة بالأسفل."
    )
    .addFields({
      name: "🎫 أنواع التذاكر",
      value:
        "🛠️ الدعم الفني\n" +
        "📢 الشكاوى\n" +
        "👑 الإدارة\n" +
        "🛒 المتجر"
    })
    .setFooter({ text: "HERVIN Advanced Ticket System" });

  if (config.panelImage) {
    embed.setImage(config.panelImage);
  }

  return embed;
}

function createTicketEmbed(user, supportRole, type) {
  const ticketType = TICKET_TYPES[type] || TICKET_TYPES.support;

  return new EmbedBuilder()
    .setColor(0xD9B84F)
    .setTitle(`${ticketType.emoji} ${ticketType.label}`)
    .setDescription(
      `أهلًا ${user}\n\n` +
      "تم فتح تذكرتك بنجاح.\n" +
      "اكتب تفاصيل طلبك وسيقوم فريق الدعم بمساعدتك.\n\n" +
      `**نوع التذكرة:** ${ticketType.label}\n` +
      `**فريق الدعم:** ${supportRole}\n\n` +
      "يرجى عدم إغلاق التذكرة قبل حل مشكلتك."
    )
    .setFooter({ text: "HERVIN Support System" })
    .setTimestamp();
}

// =====================================
// PANEL COMPONENTS
// =====================================

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_ticket_open_support")
      .setLabel("الدعم الفني")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_open_complaint")
      .setLabel("شكوى")
      .setEmoji("📢")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_open_admin")
      .setLabel("الإدارة")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_open_store")
      .setLabel("المتجر")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Success)
  );
}

function panelSelectMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("hervin_ticket_select")
    .setPlaceholder("اختر نوع التذكرة من هنا")
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) => ({
        label: type.label,
        description: type.description,
        value,
        emoji: type.emoji
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

// =====================================
// TICKET COMPONENTS
// =====================================

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_ticket_claim")
      .setLabel("استلام")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("hervin_ticket_transcript")
      .setLabel("Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Secondary),

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
      .setCustomId("hervin_ticket_transcript")
      .setLabel("Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Secondary),

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
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "تحتاج صلاحية Manage Server.",
      ephemeral: true
    });
  }

  const panel = interaction.options.getChannel("panel");
  const category = interaction.options.getChannel("category");
  const support = interaction.options.getRole("support");
  const image = interaction.options.getString("image");
  const logs = interaction.options.getChannel("logs");
  const maxOpen = interaction.options.getInteger("max_open") || 1;

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
    logsChannelId: logs?.id || null,
    maxOpen,
    panelImage: image || null,
    panelTitle: "𝐇𝐄𝐑𝐕𝐈𝐍 SUPPORT",
    panelDescription:
      "مرحبًا بك في مركز الدعم الفني الخاص بـ HERVIN\n\n" +
      "اختر نوع التذكرة من الأزرار أو القائمة بالأسفل.",
    color: 0xD9B84F
  };

  saveConfig(data);

  return interaction.reply({
    content:
      "تم إعداد نظام التذاكر المتقدم بنجاح ✅\n\n" +
      `قناة اللوحة: ${panel}\n` +
      `قسم التذاكر: ${category}\n` +
      `رتبة الدعم: ${support}\n` +
      `قناة السجلات: ${logs || "غير محددة"}\n` +
      `الحد الأقصى للتذاكر: ${maxOpen}\n\n` +
      "استخدم /ticket-panel لنشر اللوحة.",
    ephemeral: true
  });
}

// =====================================
// SEND PANEL
// =====================================

async function sendPanel(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({
      content: "تحتاج صلاحية Manage Server.",
      ephemeral: true
    });
  }

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
    components: [
      panelButtons(),
      panelSelectMenu()
    ]
  });

  return interaction.reply({
    content: `تم نشر لوحة التذاكر في ${channel} بنجاح ✅`,
    ephemeral: true
  });
}

// =====================================
// OPEN TICKET
// =====================================

async function openTicket(interaction, type) {
  const config = getConfig(interaction.guildId);

  if (!config) {
    return interaction.reply({
      content: "نظام التذاكر غير مجهز.",
      ephemeral: true
    });
  }

  if (!TICKET_TYPES[type]) {
    return interaction.reply({
      content: "نوع التذكرة غير صحيح.",
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

  const existingTickets = interaction.guild.channels.cache.filter(channel =>
    channel.type === ChannelType.GuildText &&
    getTicketOwner(channel) === interaction.user.id
  );

  const maxOpen = config.maxOpen || 1;

  if (existingTickets.size >= maxOpen) {
    return interaction.reply({
      content:
        `وصلت للحد الأقصى من التذاكر المفتوحة (${maxOpen}).\n` +
        `تذاكرك الحالية: ${existingTickets.map(c => c.toString()).join(", ")}`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const username = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 70) || "member";

  const typeInfo = TICKET_TYPES[type];

  const ticket = await interaction.guild.channels.create({
    name: `ticket-${type}-${username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `HERVIN_TICKET:${interaction.user.id}|TYPE:${type}`,
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
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles
        ]
      }
    ]
  });

  await ticket.send({
    content: `${interaction.user} ${supportRole}`,
    embeds: [createTicketEmbed(interaction.user, supportRole, type)],
    components: [ticketButtons()]
  });

  await interaction.editReply({
    content: `تم فتح تذكرتك بنجاح ${typeInfo.emoji}\n${ticket}`
  });
}

// =====================================
// TRANSCRIPT
// =====================================

async function createTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });

  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let transcript =
    "HERVIN TICKET TRANSCRIPT\n" +
    `Server: ${channel.guild.name}\n` +
    `Channel: ${channel.name}\n` +
    `Channel ID: ${channel.id}\n` +
    `Created: ${new Date().toISOString()}\n` +
    "========================================\n\n";

  for (const message of sorted) {
    const date = message.createdAt.toLocaleString("en-US");

    transcript +=
      `[${date}] ${message.author.tag} (${message.author.id})\n` +
      `${message.content || "[No text content]"}\n`;

    if (message.attachments.size) {
      transcript +=
        "Attachments: " +
        [...message.attachments.values()]
          .map(file => file.url)
          .join(", ") +
        "\n";
    }

    transcript += "----------------------------------------\n";
  }

  return Buffer.from(transcript, "utf8");
}

async function sendTranscript(channel, destination) {
  const buffer = await createTranscript(channel);

  const attachment = new AttachmentBuilder(buffer, {
    name: `HERVIN-${channel.name}-transcript.txt`
  });

  await destination.send({
    content: `📄 Transcript للتذكرة: **${channel.name}**`,
    files: [attachment]
  });
}

async function transcriptTicket(interaction) {
  const config = getConfig(interaction.guildId);

  if (!isTicket(interaction.channel)) {
    return interaction.reply({
      content: "هذا الأمر يعمل داخل تذاكر HERVIN فقط.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "هذا الأمر مخصص لفريق الدعم.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const logsChannel = config?.logsChannelId
    ? interaction.guild.channels.cache.get(config.logsChannelId)
    : null;

  const destination = logsChannel || interaction.channel;

  await sendTranscript(interaction.channel, destination);

  return interaction.editReply({
    content: "تم إنشاء نسخة Transcript بنجاح 📄"
  });
}

// =====================================
// CLAIM TICKET
// =====================================

async function claimTicket(interaction) {
  const config = getConfig(interaction.guildId);

  if (!isTicket(interaction.channel)) {
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

  const currentClaim = getClaimedBy(interaction.channel);

  if (currentClaim) {
    return interaction.reply({
      content: `هذه التذكرة مستلمة بالفعل بواسطة <@${currentClaim}>.`,
      ephemeral: true
    });
  }

  const newTopic = setTopicValue(
    interaction.channel.topic || "",
    "CLAIMED",
    interaction.user.id
  );

  await interaction.channel.setTopic(newTopic);

  await interaction.reply({
    content: `تم استلام التذكرة بواسطة ${interaction.user} ✅`
  });

  await interaction.channel.send(
    `🙋 أصبح ${interaction.user} مسؤولًا عن متابعة هذه التذكرة.`
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

  if (!interaction.channel.name.startsWith("closed-")) {
    await interaction.channel.setName(
      `closed-${interaction.channel.name.replace(/^ticket-/, "")}`
        .slice(0, 100)
    );
  }

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

  await interaction.deferUpdate();

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

  await interaction.channel.send(
    `🔓 تمت إعادة فتح التذكرة بواسطة ${interaction.user}`
  );
}

// =====================================
// ADD MEMBER
// =====================================

async function addMember(interaction, member) {
  const config = getConfig(interaction.guildId);

  if (!isTicket(interaction.channel)) {
    return interaction.reply({
      content: "هذا الأمر يعمل داخل التذاكر فقط.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "ليس لديك صلاحية إضافة أعضاء.",
      ephemeral: true
    });
  }

  await interaction.channel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true
  });

  return interaction.reply({
    content: `تمت إضافة ${member} إلى التذكرة بنجاح ✅`
  });
}

// =====================================
// REMOVE MEMBER
// =====================================

async function removeMember(interaction, member) {
  const config = getConfig(interaction.guildId);
  const ownerId = getTicketOwner(interaction.channel);

  if (!ownerId) {
    return interaction.reply({
      content: "هذا الأمر يعمل داخل التذاكر فقط.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction, config)) {
    return interaction.reply({
      content: "ليس لديك صلاحية إزالة أعضاء.",
      ephemeral: true
    });
  }

  if (member.id === ownerId) {
    return interaction.reply({
      content: "لا يمكنك إزالة صاحب التذكرة.",
      ephemeral: true
    });
  }

  await interaction.channel.permissionOverwrites.delete(member.id);

  return interaction.reply({
    content: `تمت إزالة ${member} من التذكرة بنجاح ✅`
  });
}

// =====================================
// DELETE TICKET
// =====================================

async function deleteTicket(interaction) {
  const config = getConfig(interaction.guildId);

  if (!isTicket(interaction.channel)) {
    return interaction.reply({
      content: "هذه ليست تذكرة HERVIN.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction, config)) {
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
      const logsChannel = config?.logsChannelId
        ? interaction.guild.channels.cache.get(config.logsChannelId)
        : null;

      if (logsChannel) {
        try {
          await sendTranscript(interaction.channel, logsChannel);
        } catch (error) {
          console.error("Auto Transcript Error:", error);
        }
      }

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
    switch (interaction.commandName) {
      case "ticket-setup":
        await setupTickets(interaction);
        return true;

      case "ticket-panel":
        await sendPanel(interaction);
        return true;

      case "ticket-add": {
        const member = interaction.options.getMember("member");

        if (!member) {
          await interaction.reply({
            content: "لم أتمكن من العثور على العضو.",
            ephemeral: true
          });
          return true;
        }

        await addMember(interaction, member);
        return true;
      }

      case "ticket-remove": {
        const member = interaction.options.getMember("member");

        if (!member) {
          await interaction.reply({
            content: "لم أتمكن من العثور على العضو.",
            ephemeral: true
          });
          return true;
        }

        await removeMember(interaction, member);
        return true;
      }

      case "ticket-transcript":
        await transcriptTicket(interaction);
        return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "hervin_ticket_select") {
      await openTicket(interaction, interaction.values[0]);
      return true;
    }
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("hervin_ticket_open_")) {
      const type = customId.replace("hervin_ticket_open_", "");
      await openTicket(interaction, type);
      return true;
    }

    switch (customId) {
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

      case "hervin_ticket_transcript":
        await transcriptTicket(interaction);
        return true;
    }
  }

  return false;
}

// =====================================
// EXPORTS
// =====================================

module.exports = {
  registerTicketCommands,
  handleTicketInteraction
};
