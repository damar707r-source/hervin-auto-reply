const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "20kb" }));

// تشغيل بوت HERVIN
require("./index");

// =====================================
// CONFIGURATION
// =====================================

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const REDIRECT_URI =
  "https://hervin-dashboard.onrender.com/auth/discord/callback";

const PORT = process.env.PORT || 3000;
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

const REPLIES_FILE = path.join(__dirname, "replies.json");
const WELCOME_FILE = path.join(__dirname, "systems", "welcome.json");
const TICKETS_FILE = path.join(__dirname, "systems", "tickets.json");
const SECURITY_FILE = path.join(__dirname, "systems", "security.json");
const MODERATION_FILE = path.join(__dirname, "systems", "moderation.json");

// =====================================
// STORAGE
// =====================================

const sessions = new Map();
const loginStates = new Map();

// =====================================
// JSON HELPERS
// =====================================

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;

    const content = fs.readFileSync(file, "utf8");
    return content.trim() ? JSON.parse(content) : fallback;
  } catch (error) {
    console.error("HERVIN JSON READ ERROR:", error.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("HERVIN JSON WRITE ERROR:", error.message);
    return false;
  }
}

function loadReplies() {
  return readJson(REPLIES_FILE, {});
}

function saveReplies(data) {
  return writeJson(REPLIES_FILE, data);
}

function loadWelcomeConfig() {
  return readJson(WELCOME_FILE, {});
}

function saveWelcomeConfig(data) {
  return writeJson(WELCOME_FILE, data);
}

function loadTicketsConfig() {
  return readJson(TICKETS_FILE, {});
}

function saveTicketsConfig(data) {
  return writeJson(TICKETS_FILE, data);
}

function loadSecurityConfig() {
  return readJson(SECURITY_FILE, {});
}

function saveSecurityConfig(data) {
  return writeJson(SECURITY_FILE, data);
}

function loadModerationConfig() {
  return readJson(MODERATION_FILE, {});
}

// =====================================
// VALIDATION
// =====================================

function validDiscordId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

function validMessage(message, max = 1000) {
  return typeof message === "string" && message.length <= max;
}

function canManageGuild(guild) {
  if (!guild) return false;
  if (guild.owner === true) return true;

  try {
    const permissions = BigInt(guild.permissions || "0");
    return (permissions & 8n) === 8n;
  } catch {
    return false;
  }
}

// =====================================
// SESSION HELPERS
// =====================================

function createSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function createSignature(sessionId) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sessionId)
    .digest("hex");
}

function getSessionToken(req) {
  const cookies = req.headers.cookie || "";

  const cookie = cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("hervin_session="));

  return cookie
    ? cookie.substring("hervin_session=".length)
    : null;
}

function getSession(req) {
  if (!SESSION_SECRET) return null;

  const token = getSessionToken(req);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [sessionId, signature] = parts;

  const expected = createSignature(sessionId);

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) return null;

  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return null;
  }

  return { id: sessionId, ...session };
}

function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "يجب تسجيل الدخول أولاً"
    });
  }

  req.session = session;
  next();
}

function requireGuild(req, res, next) {
  const session = getSession(req);

  if (!session || !session.selectedGuild) {
    return res.status(403).json({
      success: false,
      message: "يجب اختيار سيرفر أولاً"
    });
  }

  const guild = (session.guilds || []).find(
    item => item.id === session.selectedGuild
  );

  if (!guild || !canManageGuild(guild)) {
    return res.status(403).json({
      success: false,
      message: "ليس لديك صلاحية إدارة هذا السيرفر"
    });
  }

  req.session = session;
  req.guild = guild;
  next();
}

// =====================================
// ENV CHECK
// =====================================

if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET || !DISCORD_TOKEN) {
  console.error("HERVIN ERROR: Missing environment variables");
}

console.log("HERVIN Dashboard configuration loaded");

// =====================================
// DISCORD API HELPERS
// =====================================

async function discordRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "فشل الاتصال مع Discord");
  }

  return data;
}

async function discordGuildData(guildId) {
  if (!validDiscordId(guildId)) {
    throw new Error("معرّف السيرفر غير صحيح");
  }

  const [roles, channels] = await Promise.all([
    discordRequest(`https://discord.com/api/v10/guilds/${guildId}/roles`),
    discordRequest(`https://discord.com/api/v10/guilds/${guildId}/channels`)
  ]);

  return { roles, channels };
}

// =====================================
// DISCORD OAUTH LOGIN
// =====================================

app.get("/auth/discord", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) {
    return res.status(500).send("إعدادات تسجيل الدخول غير مكتملة في Render");
  }

  const state = crypto.randomBytes(24).toString("hex");
  loginStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send("تم إلغاء تسجيل الدخول من Discord");
    }

    if (!code || !state || !loginStates.has(state)) {
      return res.status(400).send("طلب تسجيل الدخول غير صالح أو انتهت صلاحيته");
    }

    const stateTime = loginStates.get(state);
    loginStates.delete(state);

    if (Date.now() - stateTime > 5 * 60 * 1000) {
      return res.status(400).send("انتهت صلاحية رابط تسجيل الدخول");
    }

    const tokenResponse = await fetch(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error("تعذر إكمال تسجيل الدخول من Discord");
    }

    const userResponse = await fetch(
      "https://discord.com/api/v10/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    const user = await userResponse.json();

    if (!userResponse.ok || !user.id) {
      throw new Error("تعذر جلب بيانات حساب Discord");
    }

    const guildsResponse = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      }
    );

    const allGuilds = await guildsResponse.json();

    if (!guildsResponse.ok || !Array.isArray(allGuilds)) {
      throw new Error("تعذر جلب سيرفرات حسابك");
    }

    const manageableGuilds = allGuilds.filter(canManageGuild);

    const sessionId = createSessionId();

    sessions.set(sessionId, {
      user: {
        id: user.id,
        username: user.username,
        global_name: user.global_name || user.username,
        avatar: user.avatar
      },
      guilds: manageableGuilds,
      selectedGuild: null,
      createdAt: Date.now()
    });

    const signature = createSignature(sessionId);

    res.setHeader(
      "Set-Cookie",
      `hervin_session=${sessionId}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
    );

    res.redirect("/");
  } catch (error) {
    console.error("HERVIN OAUTH ERROR:", error.message);
    res.status(500).send("حدث خطأ أثناء تسجيل الدخول: " + error.message);
  }
});

// تنظيف حالات تسجيل الدخول والجلسات القديمة
setInterval(() => {
  const now = Date.now();

  for (const [state, createdAt] of loginStates) {
    if (now - createdAt > 5 * 60 * 1000) {
      loginStates.delete(state);
    }
  }

  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      sessions.delete(id);
    }
  }
}, 60 * 1000);

// =====================================
// AUTH API
// =====================================

app.get("/api/me", (req, res) => {
  const session = getSession(req);

  res.json({
    success: true,
    user: session ? session.user : null
  });
});

app.get("/api/guilds", requireAuth, (req, res) => {
  res.json({
    success: true,
    guilds: (req.session.guilds || []).filter(canManageGuild),
    selectedGuild: req.session.selectedGuild || null
  });
});

app.post("/api/select-server", requireAuth, (req, res) => {
  const guildId = req.body.guildId;

  if (!validDiscordId(guildId)) {
    return res.status(400).json({
      success: false,
      message: "معرّف السيرفر غير صحيح"
    });
  }

  const guild = (req.session.guilds || []).find(
    item => item.id === guildId
  );

  if (!guild || !canManageGuild(guild)) {
    return res.status(403).json({
      success: false,
      message: "لا تملك صلاحية إدارة هذا السيرفر"
    });
  }

  const storedSession = sessions.get(req.session.id);

  if (!storedSession) {
    return res.status(401).json({
      success: false,
      message: "انتهت الجلسة، سجل الدخول مرة أخرى"
    });
  }

  storedSession.selectedGuild = guildId;

  res.json({
    success: true,
    message: "تم اختيار السيرفر بنجاح"
  });
});

// =====================================
// DASHBOARD OPTIONS
// =====================================

app.get("/api/dashboard-options", requireGuild, async (req, res) => {
  try {
    const { roles, channels } = await discordGuildData(req.guild.id);

    res.json({
      success: true,
      roles: roles
        .filter(role => !role.managed && role.id !== req.guild.id)
        .map(role => ({
          id: role.id,
          name: role.name,
          position: role.position
        })),
      channels: channels
        .filter(channel => [0, 4, 5].includes(channel.type))
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          type: channel.type
        }))
    });
  } catch (error) {
    console.error("DASHBOARD OPTIONS ERROR:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================
// AUTO REPLIES API
// =====================================

app.get("/api/replies", requireGuild, (req, res) => {
  const allReplies = loadReplies();
  const guildReplies = allReplies[req.guild.id] || {};

  res.json({
    success: true,
    replies: guildReplies
  });
});

app.post("/api/replies", requireGuild, (req, res) => {
  const { action, trigger, response } = req.body;

  if (!["add", "edit", "delete"].includes(action)) {
    return res.status(400).json({
      success: false,
      message: "نوع العملية غير صحيح"
    });
  }

  if (!validMessage(trigger, 100) || !trigger.trim()) {
    return res.status(400).json({
      success: false,
      message: "اكتب كلمة أو عبارة صحيحة"
    });
  }

  const cleanTrigger = trigger.trim();
  const key = cleanTrigger.toLowerCase();

  const allReplies = loadReplies();

  if (
    !allReplies[req.guild.id] ||
    typeof allReplies[req.guild.id] !== "object" ||
    Array.isArray(allReplies[req.guild.id])
  ) {
    allReplies[req.guild.id] = {};
  }

  const guildReplies = allReplies[req.guild.id];

  if (action === "delete") {
    if (!guildReplies[key]) {
      return res.status(404).json({
        success: false,
        message: "هذا الرد غير موجود"
      });
    }

    delete guildReplies[key];
  }

  if (action === "add") {
    if (!validMessage(response, 1500) || !response.trim()) {
      return res.status(400).json({
        success: false,
        message: "اكتب نص الرد"
      });
    }

    if (guildReplies[key]) {
      return res.status(409).json({
        success: false,
        message: "هذه العبارة موجودة مسبقاً"
      });
    }

    guildReplies[key] = {
      trigger: cleanTrigger,
      response: response.trim(),
      enabled: true
    };
  }

  if (action === "edit") {
    if (!guildReplies[key]) {
      return res.status(404).json({
        success: false,
        message: "هذا الرد غير موجود"
      });
    }

    if (!validMessage(response, 1500) || !response.trim()) {
      return res.status(400).json({
        success: false,
        message: "اكتب نص الرد"
      });
    }

    guildReplies[key].response = response.trim();
  }

  if (!saveReplies(allReplies)) {
    return res.status(500).json({
      success: false,
      message: "تعذر حفظ الردود"
    });
  }

  res.json({
    success: true,
    message: "تم تنفيذ العملية بنجاح"
  });
});

// =====================================
// TICKETS SETTINGS API
// =====================================

app.get("/api/tickets-settings", requireGuild, (req, res) => {
  const allConfigs = loadTicketsConfig();
  const config = allConfigs[req.guild.id] || {};

  res.json({
    success: true,
    settings: {
      panelChannelId: config.panelChannelId || "",
      categoryId: config.categoryId || "",
      supportRoleId: config.supportRoleId || "",
      logsChannelId: config.logsChannelId || "",

      // الإصلاح الأول: التحقق من قيمة الحد الأقصى
      maxOpen:
        Number.isInteger(config.maxOpen) &&
        config.maxOpen >= 1 &&
        config.maxOpen <= 10
          ? config.maxOpen
          : 1,

      panelImage: config.panelImage || "",
      panelTitle: config.panelTitle || "",
      panelDescription: config.panelDescription || "",
      color: config.color || "#5865F2"
    }
  });
});

app.post("/api/tickets-settings", requireGuild, async (req, res) => {
  try {
    const {
      panelChannelId,
      categoryId,
      supportRoleId,
      logsChannelId,
      maxOpen, // الإصلاح الثاني: استقبال الحد الأقصى
      panelImage,
      panelTitle,
      panelDescription,
      color
    } = req.body;

    if (
      !validDiscordId(panelChannelId) ||
      !validDiscordId(categoryId) ||
      !validDiscordId(supportRoleId)
    ) {
      return res.status(400).json({
        success: false,
        message: "اختر قناة اللوحة والتصنيف ورتبة الدعم"
      });
    }

    // التحقق من الحد الأقصى للتذاكر
    if (
      !Number.isInteger(Number(maxOpen)) ||
      Number(maxOpen) < 1 ||
      Number(maxOpen) > 10
    ) {
      return res.status(400).json({
        success: false,
        message: "الحد الأقصى للتذاكر يجب أن يكون من 1 إلى 10"
      });
    }

    if (
      !validMessage(panelImage || "", 1000) ||
      !validMessage(panelTitle || "", 100) ||
      !validMessage(panelDescription || "", 2000)
    ) {
      return res.status(400).json({
        success: false,
        message: "بعض البيانات أطول من الحد المسموح"
      });
    }

    if (panelImage && !/^https:\/\/\S+$/i.test(panelImage)) {
      return res.status(400).json({
        success: false,
        message: "رابط الصورة يجب أن يبدأ بـ https://"
      });
    }

    if (logsChannelId && !validDiscordId(logsChannelId)) {
      return res.status(400).json({
        success: false,
        message: "معرّف قناة السجلات غير صحيح"
      });
    }

    const { roles, channels } = await discordGuildData(req.guild.id);

    const panelChannel = channels.find(
      channel => channel.id === panelChannelId && channel.type === 0
    );

    const category = channels.find(
      channel => channel.id === categoryId && channel.type === 4
    );

    const supportRole = roles.find(
      role =>
        role.id === supportRoleId &&
        !role.managed &&
        role.id !== req.guild.id
    );

    const logsChannel = logsChannelId
      ? channels.find(
          channel =>
            channel.id === logsChannelId &&
            [0, 5].includes(channel.type)
        )
      : null;

    if (
      !panelChannel ||
      !category ||
      !supportRole ||
      (logsChannelId && !logsChannel)
    ) {
      return res.status(400).json({
        success: false,
        message: "القناة أو التصنيف أو الرتبة غير صحيحة"
      });
    }

    const allConfigs = loadTicketsConfig();
    const oldConfig = allConfigs[req.guild.id] || {};

    allConfigs[req.guild.id] = {
      ...oldConfig,
      panelChannelId,
      categoryId,
      supportRoleId,
      logsChannelId: logsChannelId || null,

      // حفظ الحد الأقصى بعد التحقق منه
      maxOpen: Number(maxOpen),

      panelImage: panelImage || null,
      panelTitle: panelTitle || "",
      panelDescription: panelDescription || "",
      color: /^#[0-9A-Fa-f]{6}$/.test(color || "")
        ? color
        : "#5865F2"
    };

    if (!saveTicketsConfig(allConfigs)) {
      return res.status(500).json({
        success: false,
        message: "تعذر حفظ إعدادات التذاكر"
      });
    }

    res.json({
      success: true,
      message: "تم حفظ إعدادات التذاكر"
    });
  } catch (error) {
    console.error("TICKETS SETTINGS ERROR:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================
// SECURITY SETTINGS API
// =====================================

app.get("/api/security-settings", requireGuild, (req, res) => {
  const allConfigs = loadSecurityConfig();
  const config = allConfigs[req.guild.id] || {};

  res.json({
    success: true,
    settings: {
      enabled: config.enabled !== false,
      threshold: config.threshold || 3,
      logsChannelId: config.logsChannelId || ""
    }
  });
});

app.post("/api/security-settings", requireGuild, async (req, res) => {
  try {
    const { enabled, threshold, logsChannelId } = req.body;

    if (
      typeof enabled !== "boolean" ||
      !Number.isInteger(Number(threshold)) ||
      Number(threshold) < 2 ||
      Number(threshold) > 10
    ) {
      return res.status(400).json({
        success: false,
        message: "إعدادات الحماية غير صحيحة"
      });
    }

    if (logsChannelId && !validDiscordId(logsChannelId)) {
      return res.status(400).json({
        success: false,
        message: "معرّف قناة السجلات غير صحيح"
      });
    }

    if (logsChannelId) {
      const { channels } = await discordGuildData(req.guild.id);

      const validChannel = channels.some(
        channel =>
          channel.id === logsChannelId &&
          [0, 5].includes(channel.type)
      );

      if (!validChannel) {
        return res.status(400).json({
          success: false,
          message: "قناة السجلات غير صالحة"
        });
      }
    }

    const allConfigs = loadSecurityConfig();

    allConfigs[req.guild.id] = {
      ...(allConfigs[req.guild.id] || {}),
      enabled,
      threshold: Number(threshold),
      logsChannelId: logsChannelId || null
    };

    if (!saveSecurityConfig(allConfigs)) {
      return res.status(500).json({
        success: false,
        message: "تعذر حفظ إعدادات الحماية"
      });
    }

    res.json({
      success: true,
      message: "تم حفظ إعدادات الحماية"
    });
  } catch (error) {
    console.error("SECURITY SETTINGS ERROR:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================
// WELCOME SETTINGS API
// =====================================

app.get("/api/welcome-settings", requireGuild, (req, res) => {
  const config = loadWelcomeConfig();

  res.json({
    success: true,
    settings: {
      welcomeChannelId: config.welcome?.channelId || "",
      welcomeMessage: config.welcome?.message || "",
      leaveChannelId: config.leave?.channelId || "",
      leaveMessage: config.leave?.message || "",
      memberRoleId: config.memberRoleId || "",
      botRoleId: config.botRoleId || "",
      joinLogChannelId: config.joinLogChannelId || "",
      leaveLogChannelId: config.leaveLogChannelId || ""
    }
  });
});

app.post("/api/welcome-settings", requireGuild, async (req, res) => {
  try {
    const {
      welcomeChannelId,
      welcomeMessage,
      leaveChannelId,
      leaveMessage,
      memberRoleId,
      botRoleId,
      joinLogChannelId,
      leaveLogChannelId
    } = req.body;

    if (
      !validMessage(welcomeMessage || "", 1000) ||
      !validMessage(leaveMessage || "", 1000)
    ) {
      return res.status(400).json({
        success: false,
        message: "رسالة الترحيب أو المغادرة طويلة جداً"
      });
    }

    const selectedIds = [
      welcomeChannelId,
      leaveChannelId,
      memberRoleId,
      botRoleId,
      joinLogChannelId,
      leaveLogChannelId
    ].filter(Boolean);

    if (!selectedIds.every(validDiscordId)) {
      return res.status(400).json({
        success: false,
        message: "يوجد معرّف غير صحيح"
      });
    }

    const { roles, channels } = await discordGuildData(req.guild.id);

    const channelIds = new Set(
      channels
        .filter(channel => [0, 5].includes(channel.type))
        .map(channel => channel.id)
    );

    const roleIds = new Set(
      roles
        .filter(role => !role.managed && role.id !== req.guild.id)
        .map(role => role.id)
    );

    const selectedChannels = [
      welcomeChannelId,
      leaveChannelId,
      joinLogChannelId,
      leaveLogChannelId
    ].filter(Boolean);

    const selectedRoles = [memberRoleId, botRoleId].filter(Boolean);

    if (
      !selectedChannels.every(id => channelIds.has(id)) ||
      !selectedRoles.every(id => roleIds.has(id))
    ) {
      return res.status(400).json({
        success: false,
        message: "تأكد من اختيار قنوات ورتب صحيحة"
      });
    }

    // إعدادات الترحيب الحالية مشتركة بين السيرفرات
    const config = loadWelcomeConfig();

    config.welcome = {
      ...(config.welcome || {}),
      channelId: welcomeChannelId || null,
      message: welcomeMessage || ""
    };

    config.leave = {
      ...(config.leave || {}),
      channelId: leaveChannelId || null,
      message: leaveMessage || ""
    };

    config.memberRoleId = memberRoleId || null;
    config.botRoleId = botRoleId || null;
    config.joinLogChannelId = joinLogChannelId || null;
    config.leaveLogChannelId = leaveLogChannelId || null;

    if (!saveWelcomeConfig(config)) {
      return res.status(500).json({
        success: false,
        message: "تعذر حفظ إعدادات الترحيب"
      });
    }

    res.json({
      success: true,
      message: "تم حفظ إعدادات الترحيب والمغادرة"
    });
  } catch (error) {
    console.error("WELCOME SETTINGS ERROR:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =====================================
// MODERATION WARNINGS API
// =====================================

app.get("/api/moderation-settings", requireGuild, (req, res) => {
  const allWarnings = loadModerationConfig();

  res.json({
    success: true,
    warnings: allWarnings[req.guild.id] || {}
  });
});

// =====================================
// DASHBOARD STATUS API
// =====================================

app.get("/api/dashboard-status", requireGuild, (req, res) => {
  res.json({
    success: true,
    server: {
      id: req.guild.id,
      name: req.guild.name
    },
    systems: {
      tickets: true,
      security: true,
      welcome: true,
      moderation: true,
      autoReplies: true
    }
  });
});

// =====================================
// DASHBOARD HTML START
// الجزء الثاني يكمل هذا القالب
// =====================================

let dashboardHTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HERVIN Dashboard</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');
:root {
  --bg:#090b12;--panel:#111522;--panel2:#171d2d;
  --border:#252d40;--primary:#7185ff;--primary2:#5369ed;
  --text:#f4f5ff;--muted:#929bb1;--green:#36d69a;--red:#ff6379;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Cairo',sans-serif}
button,input,textarea,select{font-family:inherit}
button{cursor:pointer}
.login-screen{min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;background:radial-gradient(circle at 50% 20%,#26336b55,transparent 40%),var(--bg)}
.login-card{width:100%;max-width:440px;background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:35px;text-align:center;box-shadow:0 20px 80px #0008}
.logo{font-size:42px;font-weight:900;letter-spacing:5px;color:white}
.logo span,.sidebar-logo span{color:var(--primary)}
.login-card p{color:var(--muted);line-height:1.9}
.primary-btn{border:0;background:linear-gradient(135deg,var(--primary),var(--primary2));color:white;padding:12px 22px;border-radius:12px;font-weight:800}
.login-card .primary-btn{width:100%;margin-top:18px;padding:15px}
.dashboard{display:none;min-height:100vh}
.sidebar{width:260px;position:fixed;right:0;top:0;bottom:0;background:#0e121e;border-left:1px solid var(--border);padding:22px 15px;overflow-y:auto;z-index:5}
.sidebar-logo{font-size:26px;font-weight:900;text-align:center;padding:10px 0 25px;letter-spacing:3px}
.nav-label{color:#68738d;font-size:11px;font-weight:800;padding:15px 12px 7px}
.nav-btn{display:flex;align-items:center;gap:12px;width:100%;border:1px solid transparent;background:transparent;color:#aab3c9;padding:12px;margin:4px 0;border-radius:11px;text-align:right;font-size:13px;font-weight:700}
.nav-btn:hover,.nav-btn.active{background:#7185ff18;border-color:#7185ff33;color:white}
.nav-icon{width:25px;text-align:center;font-size:17px}
.main{margin-right:260px;padding:25px;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:28px;flex-wrap:wrap}
.topbar h1{font-size:23px;margin:0}
.topbar p{color:var(--muted);font-size:12px;margin:4px 0}
.server-select{background:var(--panel);color:white;border:1px solid var(--border);padding:11px;border-radius:10px;min-width:190px}
.page{display:none}.page.active{display:block}
.welcome-banner{padding:25px;border-radius:18px;background:linear-gradient(110deg,#5369ed55,#171d2d 70%);border:1px solid #7185ff33;margin-bottom:22px}
.welcome-banner h2{font-size:24px;margin:0 0 8px}
.welcome-banner p{color:#b1bad0;margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:15px;margin-bottom:22px}
.stat-card{background:var(--panel);border:1px solid var(--border);padding:20px;border-radius:15px}
.stat-card .icon{font-size:25px}.stat-card h3{font-size:15px;margin:10px 0 3px}
.stat-card p{color:var(--muted);font-size:12px;margin:0;overflow-wrap:anywhere}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:18px}
.panel h2{font-size:17px;margin:0 0 8px}
.panel-desc{color:var(--muted);font-size:12px;margin-bottom:20px}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.field{display:flex;flex-direction:column;gap:7px;margin-bottom:15px}
.field.full{grid-column:1/-1}
.field label{color:#c8cee0;font-size:12px;font-weight:700}
.field input,.field textarea,.field select{width:100%;background:#0b0f19;border:1px solid var(--border);border-radius:10px;color:white;padding:12px;outline:none}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--primary)}
.field textarea{min-height:100px;resize:vertical}
.field option{background:#111522}
.save-btn{background:var(--primary2);color:white;border:0;border-radius:10px;padding:12px 25px;font-weight:800}
.status{color:var(--muted);font-size:12px;margin-top:12px}
.system-status{display:flex;align-items:center;gap:7px;color:var(--green);font-size:12px}
.system-status:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}
.danger-btn{background:#ff63791a;border:1px solid #ff637955;color:var(--red);padding:10px 15px;border-radius:10px}
.mobile-menu{display:none;background:var(--panel2);border:1px solid var(--border);color:white;border-radius:9px;padding:9px 12px}
.empty-state{padding:25px;text-align:center;color:var(--muted)}
@media(max-width:850px){.sidebar{transform:translateX(100%);transition:.25s}.sidebar.open{transform:translateX(0)}.main{margin-right:0;padding:17px}.mobile-menu{display:block}}
@media(max-width:550px){.form-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.login-card{padding:25px 18px}.topbar h1{font-size:19px}}
</style>
</head>
<body>
`;
dashboardHTML += `
<div class="login-screen" id="loginScreen">
  <div class="login-card">
    <div class="logo">HER<span>VIN</span></div>
    <h2>لوحة تحكم HERVIN</h2>
    <p>أهلاً بك في لوحة التحكم الخاصة ببوت HERVIN لإدارة سيرفر Discord بسهولة</p>
    <button class="primary-btn" onclick="login()">تسجيل الدخول باستخدام Discord</button>
  </div>
</div>

<div class="dashboard" id="dashboard">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">HER<span>VIN</span></div>

    <div class="nav-label">الرئيسية</div>
    <button class="nav-btn active" data-page="home" onclick="showPage('home',this)">
      <span class="nav-icon">⌂</span> الرئيسية
    </button>

    <div class="nav-label">إدارة السيرفر</div>
    <button class="nav-btn" data-page="replies" onclick="showPage('replies',this)">
      <span class="nav-icon">💬</span> الردود التلقائية
    </button>
    <button class="nav-btn" data-page="tickets" onclick="showPage('tickets',this)">
      <span class="nav-icon">🎫</span> التذاكر
    </button>
    <button class="nav-btn" data-page="security" onclick="showPage('security',this)">
      <span class="nav-icon">🛡️</span> الحماية
    </button>
    <button class="nav-btn" data-page="welcome" onclick="showPage('welcome',this)">
      <span class="nav-icon">👋</span> الترحيب والمغادرة
    </button>
    <button class="nav-btn" data-page="moderation" onclick="showPage('moderation',this)">
      <span class="nav-icon">🔨</span> الإشراف
    </button>

    <div class="nav-label">الحساب</div>
    <button class="nav-btn" onclick="logout()">
      <span class="nav-icon">↪</span> تسجيل الخروج
    </button>
  </aside>

  <main class="main">
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="mobile-menu" onclick="toggleSidebar()">☰</button>
        <div>
          <h1 id="pageTitle">الرئيسية</h1>
          <p id="userName">مرحباً بك في HERVIN</p>
        </div>
      </div>

      <select class="server-select" id="serverSelect" onchange="selectServer()">
        <option value="">اختر السيرفر</option>
      </select>
    </div>

    <section class="page active" id="page-home">
      <div class="welcome-banner">
        <h2>مرحباً بك في HERVIN</h2>
        <p>تحكم في أنظمة بوتك وإعدادات سيرفرك من مكان واحد</p>
      </div>

      <div class="cards">
        <div class="stat-card">
          <div class="icon">🎫</div>
          <h3>نظام التذاكر</h3>
          <p>إعداد وإدارة التذاكر</p>
        </div>
        <div class="stat-card">
          <div class="icon">🛡️</div>
          <h3>نظام الحماية</h3>
          <p>إعدادات حماية السيرفر</p>
        </div>
        <div class="stat-card">
          <div class="icon">👋</div>
          <h3>الترحيب</h3>
          <p>رسائل دخول ومغادرة الأعضاء</p>
        </div>
        <div class="stat-card">
          <div class="icon">💬</div>
          <h3>الردود التلقائية</h3>
          <p>إدارة الردود والكلمات</p>
        </div>
      </div>

      <div class="panel">
        <h2>حالة لوحة التحكم</h2>
        <p class="panel-desc">تم تحميل لوحة التحكم بنجاح</p>
        <div class="system-status">لوحة التحكم جاهزة للاستخدام</div>
      </div>
    </section>

    <section class="page" id="page-replies">
      <div class="panel">
        <h2>الردود التلقائية</h2>
        <p class="panel-desc">أضف عبارة واجعل البوت يرد عليها تلقائياً</p>

        <div class="form-grid">
          <div class="field">
            <label>العبارة</label>
            <input id="replyTrigger" maxlength="100" placeholder="مثال: السلام عليكم">
          </div>
          <div class="field">
            <label>الرد</label>
            <input id="replyResponse" maxlength="1500" placeholder="اكتب رد البوت">
          </div>
        </div>

        <button class="save-btn" onclick="addReply()">إضافة الرد</button>
        <div class="status" id="repliesStatus"></div>
      </div>

      <div class="panel">
        <h2>الردود الحالية</h2>
        <div id="repliesList" class="empty-state">اختر سيرفراً أولاً</div>
      </div>
    </section>

    <section class="page" id="page-tickets">
      <div class="panel">
        <h2>إعدادات التذاكر</h2>
        <p class="panel-desc">حدد القنوات والرتب الخاصة بنظام التذاكر</p>

        <div class="form-grid">
          <div class="field">
            <label>قناة لوحة التذاكر</label>
            <select id="ticketPanelChannel"></select>
          </div>
          <div class="field">
            <label>تصنيف التذاكر</label>
            <select id="ticketCategory"></select>
          </div>
          <div class="field">
            <label>رتبة الدعم</label>
            <select id="ticketSupportRole"></select>
          </div>
          <div class="field">
            <label>قناة السجلات</label>
            <select id="ticketLogsChannel"></select>
          </div>
          <div class="field">
            <label>الحد الأقصى للتذاكر المفتوحة</label>
            <input id="ticketMaxOpen" type="number" min="1" max="10" value="1">
          </div>
          <div class="field">
            <label>رابط صورة اللوحة</label>
            <input id="ticketPanelImage" placeholder="https://example.com/image.png">
          </div>
          <div class="field">
            <label>عنوان اللوحة</label>
            <input id="ticketPanelTitle" maxlength="100">
          </div>
          <div class="field">
            <label>لون اللوحة</label>
            <input id="ticketColor" type="color" value="#5865F2">
          </div>
          <div class="field full">
            <label>وصف اللوحة</label>
            <textarea id="ticketPanelDescription" maxlength="2000"></textarea>
          </div>
        </div>

        <button class="save-btn" onclick="saveTickets()">حفظ إعدادات التذاكر</button>
        <div class="status" id="ticketsStatus"></div>
      </div>
    </section>

    <section class="page" id="page-security">
      <div class="panel">
        <h2>نظام الحماية</h2>
        <p class="panel-desc">تحكم في إعدادات الحماية والتنبيهات</p>

        <div class="field">
          <label>تفعيل الحماية</label>
          <select id="securityEnabled">
            <option value="true">مفعلة</option>
            <option value="false">معطلة</option>
          </select>
        </div>

        <div class="field">
          <label>حد التكرار</label>
          <input id="securityThreshold" type="number" min="2" max="10" value="3">
        </div>

        <div class="field">
          <label>قناة سجلات الحماية</label>
          <select id="securityLogsChannel"></select>
        </div>

        <button class="save-btn" onclick="saveSecurity()">حفظ إعدادات الحماية</button>
        <div class="status" id="securityStatus"></div>
      </div>
    </section>

    <section class="page" id="page-welcome">
      <div class="panel">
        <h2>إعدادات الترحيب والمغادرة</h2>
        <p class="panel-desc">خصص رسائل دخول وخروج الأعضاء</p>

        <div class="form-grid">
          <div class="field">
            <label>قناة الترحيب</label>
            <select id="welcomeChannel"></select>
          </div>
          <div class="field">
            <label>قناة المغادرة</label>
            <select id="leaveChannel"></select>
          </div>
          <div class="field full">
            <label>رسالة الترحيب</label>
            <textarea id="welcomeMessage" maxlength="1000"></textarea>
          </div>
          <div class="field full">
            <label>رسالة المغادرة</label>
            <textarea id="leaveMessage" maxlength="1000"></textarea>
          </div>
          <div class="field">
            <label>رتبة العضو</label>
            <select id="memberRole"></select>
          </div>
          <div class="field">
            <label>رتبة البوت</label>
            <select id="botRole"></select>
          </div>
          <div class="field">
            <label>سجلات الدخول</label>
            <select id="joinLogChannel"></select>
          </div>
          <div class="field">
            <label>سجلات المغادرة</label>
            <select id="leaveLogChannel"></select>
          </div>
        </div>

        <button class="save-btn" onclick="saveWelcome()">حفظ إعدادات الترحيب</button>
        <div class="status" id="welcomeStatus"></div>
      </div>
    </section>

    <section class="page" id="page-moderation">
      <div class="panel">
        <h2>نظام الإشراف</h2>
        <p class="panel-desc">سجل التحذيرات المحفوظة في النظام</p>
        <div id="moderationList" class="empty-state">لا توجد بيانات حالياً</div>
      </div>
    </section>
  </main>
</div>
`;

dashboardHTML += `
<script>
let currentGuild = null;
let guildChannels = [];
let guildRoles = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "حدث خطأ في الاتصال");
  }

  return data;
}

function login() {
  window.location.href = "/auth/discord";
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function showPage(page, button) {
  document.querySelectorAll(".page").forEach(item => {
    item.classList.remove("active");
  });

  const target = document.getElementById("page-" + page);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(item => {
    item.classList.remove("active");
  });

  if (button) button.classList.add("active");

  const titles = {
    home: "الرئيسية",
    replies: "الردود التلقائية",
    tickets: "التذاكر",
    security: "الحماية",
    welcome: "الترحيب والمغادرة",
    moderation: "الإشراف"
  };

  document.getElementById("pageTitle").textContent =
    titles[page] || "HERVIN";

  document.getElementById("sidebar").classList.remove("open");

  if (!currentGuild) return;

  if (page === "replies") loadReplies();
  if (page === "tickets") loadTickets();
  if (page === "security") loadSecurity();
  if (page === "welcome") loadWelcome();
  if (page === "moderation") loadModeration();
}

function setStatus(id, message, error = false) {
  const element = document.getElementById(id);
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "var(--red)" : "var(--green)";
}

async function checkLogin() {
  try {
    const data = await api("/api/me");

    if (!data.user) {
      document.getElementById("loginScreen").style.display = "flex";
      document.getElementById("dashboard").style.display = "none";
      return;
    }

    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    document.getElementById("userName").textContent =
      "مرحباً، " + (data.user.global_name || data.user.username);

    await loadGuilds();
  } catch (error) {
    console.error(error);
  }
}

async function loadGuilds() {
  try {
    const data = await api("/api/guilds");
    const select = document.getElementById("serverSelect");

    select.innerHTML = '<option value="">اختر السيرفر</option>';

    data.guilds.forEach(guild => {
      const option = document.createElement("option");
      option.value = guild.id;
      option.textContent = guild.name;
      select.appendChild(option);
    });

    if (data.selectedGuild) {
      select.value = data.selectedGuild;
      currentGuild = data.selectedGuild;
      await loadDashboardOptions();
    }
  } catch (error) {
    alert(error.message);
  }
}

async function selectServer() {
  const guildId = document.getElementById("serverSelect").value;

  if (!guildId) {
    currentGuild = null;
    return;
  }

  try {
    await api("/api/select-server", {
      method: "POST",
      body: JSON.stringify({ guildId })
    });

    currentGuild = guildId;
    await loadDashboardOptions();
    alert("تم اختيار السيرفر بنجاح");
  } catch (error) {
    alert(error.message);
  }
}

async function loadDashboardOptions() {
  try {
    const data = await api("/api/dashboard-options");

    guildChannels = data.channels || [];
    guildRoles = data.roles || [];

    fillSelect("ticketPanelChannel", guildChannels.filter(c => c.type === 0));
    fillSelect("ticketCategory", guildChannels.filter(c => c.type === 4));
    fillSelect("ticketSupportRole", guildRoles, "اختر رتبة الدعم");
    fillSelect("ticketLogsChannel", guildChannels.filter(c => [0, 5].includes(c.type)));

    fillSelect("securityLogsChannel", guildChannels.filter(c => [0, 5].includes(c.type)));

    fillSelect("welcomeChannel", guildChannels.filter(c => [0, 5].includes(c.type)));
    fillSelect("leaveChannel", guildChannels.filter(c => [0, 5].includes(c.type)));
    fillSelect("joinLogChannel", guildChannels.filter(c => [0, 5].includes(c.type)));
    fillSelect("leaveLogChannel", guildChannels.filter(c => [0, 5].includes(c.type)));

    fillSelect("memberRole", guildRoles);
    fillSelect("botRole", guildRoles);
  } catch (error) {
    alert(error.message);
  }
}

function fillSelect(id, items, placeholder = "بدون تحديد") {
  const select = document.getElementById(id);
  if (!select) return;

  select.innerHTML = "";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.appendChild(first);

  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  });
}

// =====================================
// REPLIES
// =====================================

async function loadReplies() {
  try {
    const data = await api("/api/replies");
    const list = document.getElementById("repliesList");

    list.innerHTML = "";

    const entries = Object.entries(data.replies || {});

    if (!entries.length) {
      list.textContent = "لا توجد ردود تلقائية";
      return;
    }

    entries.forEach(([key, item]) => {
      const card = document.createElement("div");
      card.className = "stat-card";
      card.style.marginBottom = "10px";

      const title = document.createElement("h3");
      title.textContent = item.trigger || key;

      const response = document.createElement("p");
      response.textContent = item.response || "";

      const edit = document.createElement("button");
      edit.className = "save-btn";
      edit.textContent = "تعديل";
      edit.style.marginLeft = "8px";

      edit.onclick = async () => {
        const newResponse = prompt("اكتب الرد الجديد", item.response || "");
        if (newResponse === null || !newResponse.trim()) return;

        try {
          await api("/api/replies", {
            method: "POST",
            body: JSON.stringify({
              action: "edit",
              trigger: key,
              response: newResponse
            })
          });

          loadReplies();
        } catch (error) {
          alert(error.message);
        }
      };

      const remove = document.createElement("button");
      remove.className = "danger-btn";
      remove.textContent = "حذف";

      remove.onclick = async () => {
        if (!confirm("هل تريد حذف هذا الرد؟")) return;

        try {
          await api("/api/replies", {
            method: "POST",
            body: JSON.stringify({
              action: "delete",
              trigger: key
            })
          });

          loadReplies();
        } catch (error) {
          alert(error.message);
        }
      };

      card.append(title, response, edit, remove);
      list.appendChild(card);
    });
  } catch (error) {
    setStatus("repliesStatus", error.message, true);
  }
}

async function addReply() {
  const trigger = document.getElementById("replyTrigger").value.trim();
  const response = document.getElementById("replyResponse").value.trim();

  try {
    await api("/api/replies", {
      method: "POST",
      body: JSON.stringify({
        action: "add",
        trigger,
        response
      })
    });

    document.getElementById("replyTrigger").value = "";
    document.getElementById("replyResponse").value = "";

    setStatus("repliesStatus", "تمت إضافة الرد بنجاح");
    loadReplies();
  } catch (error) {
    setStatus("repliesStatus", error.message, true);
  }
}

// =====================================
// TICKETS
// =====================================

async function loadTickets() {
  try {
    const data = await api("/api/tickets-settings");
    const s = data.settings;

    document.getElementById("ticketPanelChannel").value = s.panelChannelId;
    document.getElementById("ticketCategory").value = s.categoryId;
    document.getElementById("ticketSupportRole").value = s.supportRoleId;
    document.getElementById("ticketLogsChannel").value = s.logsChannelId;
    document.getElementById("ticketMaxOpen").value = s.maxOpen;
    document.getElementById("ticketPanelImage").value = s.panelImage;
    document.getElementById("ticketPanelTitle").value = s.panelTitle;
    document.getElementById("ticketPanelDescription").value = s.panelDescription;
    document.getElementById("ticketColor").value = s.color;
  } catch (error) {
    setStatus("ticketsStatus", error.message, true);
  }
}

async function saveTickets() {
  const settings = {
    panelChannelId: document.getElementById("ticketPanelChannel").value,
    categoryId: document.getElementById("ticketCategory").value,
    supportRoleId: document.getElementById("ticketSupportRole").value,
    logsChannelId: document.getElementById("ticketLogsChannel").value,
    maxOpen: Number(document.getElementById("ticketMaxOpen").value),
    panelImage: document.getElementById("ticketPanelImage").value.trim(),
    panelTitle: document.getElementById("ticketPanelTitle").value.trim(),
    panelDescription: document.getElementById("ticketPanelDescription").value.trim(),
    color: document.getElementById("ticketColor").value
  };

  try {
    await api("/api/tickets-settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });

    setStatus("ticketsStatus", "تم حفظ إعدادات التذاكر بنجاح");
  } catch (error) {
    setStatus("ticketsStatus", error.message, true);
  }
}

// =====================================
// SECURITY
// =====================================

async function loadSecurity() {
  try {
    const data = await api("/api/security-settings");
    const s = data.settings;

    document.getElementById("securityEnabled").value = String(s.enabled);
    document.getElementById("securityThreshold").value = s.threshold;
    document.getElementById("securityLogsChannel").value = s.logsChannelId;
  } catch (error) {
    setStatus("securityStatus", error.message, true);
  }
}

async function saveSecurity() {
  const settings = {
    enabled: document.getElementById("securityEnabled").value === "true",
    threshold: Number(document.getElementById("securityThreshold").value),
    logsChannelId: document.getElementById("securityLogsChannel").value
  };

  try {
    await api("/api/security-settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });

    setStatus("securityStatus", "تم حفظ إعدادات الحماية");
  } catch (error) {
    setStatus("securityStatus", error.message, true);
  }
}

// =====================================
// WELCOME
// =====================================

async function loadWelcome() {
  try {
    const data = await api("/api/welcome-settings");
    const s = data.settings;

    document.getElementById("welcomeChannel").value = s.welcomeChannelId;
    document.getElementById("leaveChannel").value = s.leaveChannelId;
    document.getElementById("welcomeMessage").value = s.welcomeMessage;
    document.getElementById("leaveMessage").value = s.leaveMessage;
    document.getElementById("memberRole").value = s.memberRoleId;
    document.getElementById("botRole").value = s.botRoleId;
    document.getElementById("joinLogChannel").value = s.joinLogChannelId;
    document.getElementById("leaveLogChannel").value = s.leaveLogChannelId;
  } catch (error) {
    setStatus("welcomeStatus", error.message, true);
  }
}

async function saveWelcome() {
  const settings = {
    welcomeChannelId: document.getElementById("welcomeChannel").value,
    welcomeMessage: document.getElementById("welcomeMessage").value,
    leaveChannelId: document.getElementById("leaveChannel").value,
    leaveMessage: document.getElementById("leaveMessage").value,
    memberRoleId: document.getElementById("memberRole").value,
    botRoleId: document.getElementById("botRole").value,
    joinLogChannelId: document.getElementById("joinLogChannel").value,
    leaveLogChannelId: document.getElementById("leaveLogChannel").value
  };

  try {
    await api("/api/welcome-settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });

    setStatus("welcomeStatus", "تم حفظ إعدادات الترحيب");
  } catch (error) {
    setStatus("welcomeStatus", error.message, true);
  }
}

// =====================================
// MODERATION
// =====================================

async function loadModeration() {
  try {
    const data = await api("/api/moderation-settings");
    const list = document.getElementById("moderationList");

    list.innerHTML = "";

    const entries = Object.entries(data.warnings || {});

    if (!entries.length) {
      list.textContent = "لا توجد تحذيرات مسجلة";
      return;
    }

    entries.forEach(([userId, warning]) => {
      const item = document.createElement("div");
      item.className = "stat-card";
      item.style.marginBottom = "10px";

      const title = document.createElement("h3");
      title.textContent = "العضو: " + userId;

      const details = document.createElement("p");
      details.textContent = JSON.stringify(warning);

      item.append(title, details);
      list.appendChild(item);
    });
  } catch (error) {
    document.getElementById("moderationList").textContent = error.message;
  }
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    console.error(error);
  }

  currentGuild = null;
  window.location.reload();
}

document.addEventListener("DOMContentLoaded", checkLogin);
</script>
</body>
</html>
`;

app.post("/api/logout", (req, res) => {
  const session = getSession(req);

  if (session) {
    sessions.delete(session.id);
  }

  res.setHeader(
    "Set-Cookie",
    "hervin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({
    success: true,
    message: "تم تسجيل الخروج"
  });
});

// =====================================
// SERVE DASHBOARD
// =====================================

app.get("/", (req, res) => {
  res.status(200).send(dashboardHTML);
});

// =====================================
// START SERVER
// =====================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("HERVIN Dashboard is running on port " + PORT);
});
