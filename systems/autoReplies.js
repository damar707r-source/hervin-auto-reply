
const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder
} = require("discord.js");

// ==========================================
// HERVIN AUTO REPLIES ULTIMATE ENGINE
// ==========================================

const DATA_PATH = path.join(__dirname, "..", "replies.json");

const DEFAULT_DATA = {
  version: 1,

  system: {
    name: "HERVIN AUTO REPLIES",
    enabled: true,
    instant: true,
    caseSensitive: false,
    normalizeArabic: true,
    ignoreBots: true,
    preventDuplicates: true,
    allowMultipleMatches: false,
    defaultMatchMode: "contains",
    maxMatchesPerMessage: 1
  },

  settings: {
    randomReplies: true,
    allowMentions: false,
    allowEmbeds: true,
    statistics: true,
    logging: true
  },

  guilds: {},
  groups: {},
  replies: {},

  blacklist: {
    users: [],
    roles: [],
    channels: [],
    guilds: [],
    words: []
  },

  whitelist: {
    users: [],
    roles: [],
    channels: [],
    guilds: []
  },

  statistics: {
    totalTriggers: 0,
    totalReplies: 0,
    lastTriggered: null
  },

  logs: [],

  backup: {
    enabled: true,
    lastBackup: null
  }
};

let data = null;
let initialized = false;
let saveQueue = Promise.resolve();

const processedMessages = new Map();
const cooldowns = new Map();

const MAX_LOGS = 500;
const MAX_PROCESSED_MESSAGES = 5000;

// ==========================================
// HELPERS
// ==========================================

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureDataShape(input) {
  const result = {
    ...clone(DEFAULT_DATA),
    ...ensureObject(input)
  };

  result.system = {
    ...DEFAULT_DATA.system,
    ...ensureObject(result.system)
  };

  result.settings = {
    ...DEFAULT_DATA.settings,
    ...ensureObject(result.settings)
  };

  result.guilds = ensureObject(result.guilds);
  result.groups = ensureObject(result.groups);
  result.replies = ensureObject(result.replies);

  result.blacklist = {
    ...DEFAULT_DATA.blacklist,
    ...ensureObject(result.blacklist)
  };

  result.whitelist = {
    ...DEFAULT_DATA.whitelist,
    ...ensureObject(result.whitelist)
  };

  for (const key of Object.keys(result.blacklist)) {
    result.blacklist[key] = ensureArray(result.blacklist[key]);
  }

  for (const key of Object.keys(result.whitelist)) {
    result.whitelist[key] = ensureArray(result.whitelist[key]);
  }

  result.statistics = {
    ...DEFAULT_DATA.statistics,
    ...ensureObject(result.statistics)
  };

  result.logs = ensureArray(result.logs);

  result.backup = {
    ...DEFAULT_DATA.backup,
    ...ensureObject(result.backup)
  };

  return result;
}

// ==========================================
// DATABASE
// ==========================================

function initializeDatabase() {
  if (initialized) return;

  const directory = path.dirname(DATA_PATH);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify(DEFAULT_DATA, null, 2),
      "utf8"
    );
  }

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    data = ensureDataShape(JSON.parse(raw || "{}"));
  } catch (error) {
    console.error("[HERVIN AUTO REPLIES] Database read error:", error);
    throw new Error("تعذر قراءة replies.json، لم يتم استبدال الملف.");
  }

  initialized = true;
}

function getData() {
  initializeDatabase();
  return data;
}

function saveDatabase() {
  initializeDatabase();

  const snapshot = JSON.stringify(data, null, 2);
  const tempPath = `${DATA_PATH}.tmp`;

  saveQueue = saveQueue.then(async () => {
    await fs.promises.writeFile(tempPath, snapshot, "utf8");
    await fs.promises.rename(tempPath, DATA_PATH);
  });

  return saveQueue.catch(error => {
    console.error("[HERVIN AUTO REPLIES] Database save error:", error);
    throw error;
  });
}

// ==========================================
// TEXT NORMALIZATION
// ==========================================

function normalizeText(value) {
  const config = getData().system;

  let text = String(value || "").trim();

  if (!config.caseSensitive) {
    text = text.toLowerCase();
  }

  if (config.normalizeArabic) {
    text = text
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ـ/g, "")
      .replace(/[\u064B-\u065F\u0670]/g, "");
  }

  return text;
}

// ==========================================
// LOGGING
// ==========================================

function addLog(type, details = {}) {
  const db = getData();

  if (!db.settings.logging) return;

  db.logs.push({
    type,
    details,
    timestamp: new Date().toISOString()
  });

  if (db.logs.length > MAX_LOGS) {
    db.logs.splice(0, db.logs.length - MAX_LOGS);
  }
}

// ==========================================
// BLACKLIST / WHITELIST
// ==========================================

function includesId(list, id) {
  return ensureArray(list).includes(String(id));
}

function isBlocked(message, db) {
  const blacklist = db.blacklist;

  if (includesId(blacklist.guilds, message.guild.id)) return true;
  if (includesId(blacklist.channels, message.channel.id)) return true;
  if (includesId(blacklist.users, message.author.id)) return true;

  const memberRoles = message.member?.roles?.cache;

  if (memberRoles) {
    for (const roleId of blacklist.roles) {
      if (memberRoles.has(roleId)) return true;
    }
  }

  const content = normalizeText(message.content);

  for (const word of blacklist.words) {
    if (content.includes(normalizeText(word))) return true;
  }

  return false;
}

function isAllowed(message, db) {
  const whitelist = db.whitelist;

  const configured =
    whitelist.guilds.length ||
    whitelist.channels.length ||
    whitelist.users.length ||
    whitelist.roles.length;

  if (!configured) return true;

  if (includesId(whitelist.guilds, message.guild.id)) return true;
  if (includesId(whitelist.channels, message.channel.id)) return true;
  if (includesId(whitelist.users, message.author.id)) return true;

  const memberRoles = message.member?.roles?.cache;

  if (memberRoles) {
    for (const roleId of whitelist.roles) {
      if (memberRoles.has(roleId)) return true;
    }
  }

  return false;
}

// ==========================================
// GUILD SETTINGS
// ==========================================

function getGuildSettings(guildId, db) {
  return {
    ...db.system,
    ...ensureObject(db.guilds[guildId])
  };
}

// ==========================================
// CONDITIONS
// ==========================================

function checkConditions(message, conditions = {}) {
  conditions = ensureObject(conditions);

  const guildId = message.guild.id;
  const channelId = message.channel.id;
  const userId = message.author.id;
  const roles = message.member?.roles?.cache;

  const checks = [
    ["guilds", guildId],
    ["channels", channelId],
    ["users", userId]
  ];

  for (const [key, value] of checks) {
    const allowed = ensureArray(conditions[key]);

    if (allowed.length && !allowed.includes(value)) {
      return false;
    }
  }

  const allowedRoles = ensureArray(conditions.roles);

  if (allowedRoles.length) {
    const hasRole = allowedRoles.some(id => roles?.has(id));

    if (!hasRole) return false;
  }

  const excludedChecks = [
    ["excludedUsers", userId],
    ["excludedChannels", channelId]
  ];

  for (const [key, value] of excludedChecks) {
    if (ensureArray(conditions[key]).includes(value)) {
      return false;
    }
  }

  const excludedRoles = ensureArray(conditions.excludedRoles);

  if (excludedRoles.some(id => roles?.has(id))) {
    return false;
  }

  return true;
}

// ==========================================
// MATCH ENGINE
// ==========================================

function matchTrigger(content, trigger, mode, settings) {
  const messageText = settings.caseSensitive
    ? String(content).trim()
    : normalizeText(content);

  const triggerText = settings.caseSensitive
    ? String(trigger).trim()
    : normalizeText(trigger);

  if (!messageText || !triggerText) return false;

  switch (mode || settings.defaultMatchMode) {
    case "exact":
      return messageText === triggerText;

    case "startsWith":
      return messageText.startsWith(triggerText);

    case "endsWith":
      return messageText.endsWith(triggerText);

    case "word":
      return messageText
        .split(/\s+/)
        .includes(triggerText);

    case "contains":
    default:
      return messageText.includes(triggerText);
  }
}

function getMatchingReplies(message, db, settings) {
  const matches = [];

  for (const [id, reply] of Object.entries(db.replies)) {
    if (!reply || typeof reply !== "object") continue;
    if (reply.enabled === false) continue;

    if (reply.guildId && reply.guildId !== message.guild.id) {
      continue;
    }

    if (reply.groupId) {
      const group = db.groups[reply.groupId];

      if (!group || group.enabled === false) continue;
    }

    if (!checkConditions(message, reply.conditions)) continue;

    const triggers = ensureArray(reply.triggers);

    const matched = triggers.some(trigger =>
      matchTrigger(
        message.content,
        trigger,
        reply.matchMode,
        settings
      )
    );

    if (!matched) continue;

    matches.push({
      id,
      reply,
      priority: Number(reply.priority) || 0,
      triggerLength: Math.max(
        0,
        ...triggers.map(trigger => String(trigger).length)
      )
    });
  }

  matches.sort((a, b) =>
    b.priority - a.priority ||
    b.triggerLength - a.triggerLength
  );

  return matches;
}

// ==========================================
// COOLDOWN / CHANCE
// ==========================================

function getCooldownKey(replyId, userId) {
  return `${replyId}:${userId}`;
}

function isOnCooldown(reply, replyId, userId) {
  const seconds = Math.max(0, Number(reply.cooldown) || 0);

  if (!seconds) return false;

  const key = getCooldownKey(replyId, userId);
  const lastUsed = cooldowns.get(key) || 0;

  return Date.now() - lastUsed < seconds * 1000;
}

function startCooldown(reply, replyId, userId) {
  const seconds = Math.max(0, Number(reply.cooldown) || 0);

  if (!seconds) return;

  cooldowns.set(
    getCooldownKey(replyId, userId),
    Date.now()
  );
}

function passesChance(reply) {
  const chance = Math.max(
    0,
    Math.min(100, Number(reply.chance ?? 100))
  );

  return Math.random() * 100 < chance;
}

// ==========================================
// RESPONSE BUILDER
// ==========================================

function replaceVariables(text, message) {
  return String(text || "")
    .replace(/\{user\}/g, message.author.username)
    .replace(/\{mention\}/g, `<@${message.author.id}>`)
    .replace(/\{server\}/g, message.guild.name)
    .replace(/\{channel\}/g, message.channel.name)
    .replace(/\{userId\}/g, message.author.id)
    .replace(/\{serverId\}/g, message.guild.id)
    .replace(/\{channelId\}/g, message.channel.id)
    .replace(/\{tag\}/g, message.author.tag);
}

function chooseResponse(reply) {
  const responses = ensureArray(reply.responses);

  if (!responses.length) {
    return reply.response || null;
  }

  if (reply.randomResponse === false) {
    return responses[0];
  }

  return responses[
    Math.floor(Math.random() * responses.length)
  ];
}

function buildEmbed(reply, message) {
  if (!reply.options?.embed) return null;

  const options = reply.options;

  const embed = new EmbedBuilder();

  if (options.embedTitle) {
    embed.setTitle(
      replaceVariables(options.embedTitle, message)
    );
  }

  if (options.embedDescription) {
    embed.setDescription(
      replaceVariables(options.embedDescription, message)
    );
  }

  if (options.embedColor) {
    embed.setColor(options.embedColor);
  }

  if (options.image) {
    embed.setImage(options.image);
  }

  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  if (options.footer) {
    embed.setFooter({
      text: replaceVariables(options.footer, message)
    });
  }

  if (options.timestamp) {
    embed.setTimestamp();
  }

  return embed;
}

// ==========================================
// SEND RESPONSE
// ==========================================

async function sendReply(message, reply, replyId, db) {
  const response = chooseResponse(reply);

  const embed = buildEmbed(reply, message);

  if (!response && !embed) return false;

  const text = response
    ? replaceVariables(response, message)
    : null;

  if (text && text.length > 1900) {
    console.warn(
      `[HERVIN AUTO REPLIES] Response too long: ${replyId}`
    );

    return false;
  }

  const options = {
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false
    }
  };

  if (text) options.content = text;
  if (embed && db.settings.allowEmbeds) {
    options.embeds = [embed];
  }

  if (reply.options?.replyToMessage) {
    await message.reply(options);
  } else {
    await message.channel.send(options);
  }

  return true;
}

// ==========================================
// STATISTICS
// ==========================================

function updateStatistics(replyId, db) {
  const reply = db.replies[replyId];

  if (!reply) return;

  if (!reply.statistics || typeof reply.statistics !== "object") {
    reply.statistics = {
      uses: 0,
      lastUsed: null
    };
  }

  reply.statistics.uses =
    (Number(reply.statistics.uses) || 0) + 1;

  reply.statistics.lastUsed = new Date().toISOString();

  db.statistics.totalTriggers =
    (Number(db.statistics.totalTriggers) || 0) + 1;

  db.statistics.totalReplies =
    (Number(db.statistics.totalReplies) || 0) + 1;

  db.statistics.lastTriggered = new Date().toISOString();
}

// ==========================================
// MAIN MESSAGE HANDLER
// ==========================================

async function handleMessage(message) {
  if (!message || !message.guild || !message.author) return;

  if (message.author.bot && getData().system.ignoreBots) return;
  if (message.webhookId && getData().system.ignoreBots) return;

  const db = getData();

  if (!db.system.enabled) return;
  if (!message.content) return;

  const settings = getGuildSettings(message.guild.id, db);

  if (!settings.enabled) return;
  if (isBlocked(message, db)) return;
  if (!isAllowed(message, db)) return;

  if (settings.preventDuplicates) {
    if (processedMessages.has(message.id)) return;

    processedMessages.set(message.id, Date.now());

    if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
      const oldest = processedMessages.keys().next().value;
      processedMessages.delete(oldest);
    }
  }

  const matches = getMatchingReplies(message, db, settings);

  if (!matches.length) return;

  const maxMatches = settings.allowMultipleMatches
    ? Math.max(1, Number(settings.maxMatchesPerMessage) || 1)
    : 1;

  let sent = 0;
  let changed = false;

  for (const match of matches) {
    if (sent >= maxMatches) break;

    const { id, reply } = match;

    if (isOnCooldown(reply, id, message.author.id)) {
      continue;
    }

    if (!passesChance(reply)) continue;

    try {
      const success = await sendReply(
        message,
        reply,
        id,
        db
      );

      if (!success) continue;

      startCooldown(reply, id, message.author.id);

      updateStatistics(id, db);

      addLog("reply_sent", {
        replyId: id,
        userId: message.author.id,
        guildId: message.guild.id,
        channelId: message.channel.id
      });

      sent++;
      changed = true;

    } catch (error) {
      console.error(
        `[HERVIN AUTO REPLIES] Failed reply ${id}:`,
        error
      );
    }
  }

  if (changed) {
    saveDatabase().catch(() => {});
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

function initializeAutoReplies(client) {
  initializeDatabase();

  if (client.__hervinAutoRepliesInitialized) {
    return;
  }

  client.__hervinAutoRepliesInitialized = true;

  client.on("messageCreate", message => {
    handleMessage(message).catch(error => {
      console.error(
        "[HERVIN AUTO REPLIES] Message handler error:",
        error
      );
    });
  });

  console.log(
    "[HERVIN AUTO REPLIES] Ultimate engine initialized."
  );
}

// ==========================================
// PUBLIC API
// ==========================================

function getReply(replyId) {
  return getData().replies[replyId] || null;
}

function getAllReplies() {
  return getData().replies;
}

async function addReply(replyId, replyData) {
  if (!replyId || !replyData) {
    throw new Error("replyId and replyData are required.");
  }

  const db = getData();

  if (db.replies[replyId]) {
    throw new Error("هذا الرد موجود مسبقًا.");
  }

  db.replies[replyId] = {
    enabled: true,
    priority: 1,
    triggers: [],
    responses: [],
    matchMode: "contains",
    randomResponse: true,
    chance: 100,
    cooldown: 0,
    conditions: {},
    options: {
      replyToMessage: true,
      embed: false
    },
    statistics: {
      uses: 0,
      lastUsed: null
    },
    ...replyData
  };

  await saveDatabase();
  return db.replies[replyId];
}

async function updateReply(replyId, changes) {
  const db = getData();
  const reply = db.replies[replyId];

  if (!reply) {
    throw new Error("الرد غير موجود.");
  }

  db.replies[replyId] = {
    ...reply,
    ...changes
  };

  await saveDatabase();
  return db.replies[replyId];
}

async function removeReply(replyId) {
  const db = getData();

  if (!db.replies[replyId]) return false;

  delete db.replies[replyId];

  await saveDatabase();
  return true;
}

async function setReplyEnabled(replyId, enabled) {
  return updateReply(replyId, {
    enabled: Boolean(enabled)
  });
}

async function setGuildSettings(guildId, settings) {
  const db = getData();

  db.guilds[guildId] = {
    ...ensureObject(db.guilds[guildId]),
    ...settings
  };

  await saveDatabase();
  return db.guilds[guildId];
}

function getStatistics() {
  const db = getData();

  return {
    ...db.statistics,
    repliesCount: Object.keys(db.replies).length,
    enabledReplies: Object.values(db.replies)
      .filter(reply => reply?.enabled !== false).length
  };
}

module.exports = {
  initializeAutoReplies,
  handleMessage,
  getReply,
  getAllReplies,
  addReply,
  updateReply,
  removeReply,
  setReplyEnabled,
  setGuildSettings,
  getStatistics,
  saveDatabase
};
