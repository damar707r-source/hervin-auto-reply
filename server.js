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
  try {
    const allConfigs = loadWelcomeConfig();
    const config = allConfigs[req.guild.id] || {};

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
  } catch (error) {
    console.error("WELCOME SETTINGS LOAD ERROR:", error);

    res.status(500).json({
      success: false,
      message: "تعذر تحميل إعدادات الترحيب"
    });
  }
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

    // التحقق من طول الرسائل
    if (
      !validMessage(welcomeMessage || "", 1000) ||
      !validMessage(leaveMessage || "", 1000)
    ) {
      return res.status(400).json({
        success: false,
        message: "رسالة الترحيب أو المغادرة طويلة جداً"
      });
    }

    // التحقق من صحة المعرفات
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

    // جلب قنوات ورتب السيرفر
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

    const selectedRoles = [
      memberRoleId,
      botRoleId
    ].filter(Boolean);

    // التأكد من أن القنوات والرتب تتبع للسيرفر
    if (
      !selectedChannels.every(id => channelIds.has(id)) ||
      !selectedRoles.every(id => roleIds.has(id))
    ) {
      return res.status(400).json({
        success: false,
        message: "تأكد من اختيار قنوات ورتب صحيحة"
      });
    }

    // تحميل إعدادات جميع السيرفرات
    const guildId = req.guild.id;
    const allConfigs = loadWelcomeConfig();

    // إنشاء إعدادات للسيرفر إذا لم تكن موجودة
    if (!allConfigs[guildId]) {
      allConfigs[guildId] = {};
    }

    const config = allConfigs[guildId];

    // حفظ إعدادات الترحيب
    config.welcome = {
      ...(config.welcome || {}),
      channelId: welcomeChannelId || null,
      message: welcomeMessage || ""
    };

    // حفظ إعدادات المغادرة
    config.leave = {
      ...(config.leave || {}),
      channelId: leaveChannelId || null,
      message: leaveMessage || ""
    };

    // حفظ الرتب
    config.memberRoleId = memberRoleId || null;
    config.botRoleId = botRoleId || null;

    // حفظ قنوات السجلات
    config.joinLogChannelId = joinLogChannelId || null;
    config.leaveLogChannelId = leaveLogChannelId || null;

    // حفظ جميع إعدادات السيرفرات مرة واحدة
    if (!saveWelcomeConfig(allConfigs)) {
      return res.status(500).json({
        success: false,
        message: "تعذر حفظ إعدادات الترحيب"
      });
    }

    return res.json({
      success: true,
      message: "تم حفظ إعدادات الترحيب والمغادرة"
    });

  } catch (error) {
    console.error("WELCOME SETTINGS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حفظ إعدادات الترحيب"
    });
  }
});
// =====================================
// START HERVIN DASHBOARD
// =====================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HERVIN Dashboard running on port ${PORT}`);
});
