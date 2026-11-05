const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json({ limit: "20kb" }));

// تشغيل بوت HERVIN
require("./index");

// =====================================
// HERVIN CONFIGURATION
// =====================================

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const REDIRECT_URI =
  "https://hervin-dashboard.onrender.com/auth/discord/callback";

const repliesFile = path.join(__dirname, "replies.json");

const welcomeConfigFile = path.join(
  __dirname,
  "systems",
  "welcome.json"
);

const sessions = new Map();
const loginStates = new Map();

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

// =====================================
// STORAGE
// =====================================

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return {};

    const data = JSON.parse(
      fs.readFileSync(file, "utf8")
    );

    return data &&
      typeof data === "object" &&
      !Array.isArray(data)
      ? data
      : {};
  } catch (error) {
    console.error("JSON read error:", error);
    return {};
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });

  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function loadReplies() {
  return readJson(repliesFile);
}

function saveReplies(data) {
  writeJson(repliesFile, data);
}

function loadWelcomeConfig() {
  return readJson(welcomeConfigFile);
}

function saveWelcomeConfig(data) {
  writeJson(welcomeConfigFile, data);
}

// =====================================
// OAUTH ENV CHECK
// =====================================

console.log("=================================");

console.log("HERVIN OAUTH ENV CHECK:", {
  CLIENT_ID: Boolean(CLIENT_ID),
  CLIENT_SECRET: Boolean(CLIENT_SECRET),
  SESSION_SECRET: Boolean(SESSION_SECRET),
  DISCORD_TOKEN: Boolean(DISCORD_TOKEN)
});

console.log("=================================");

// =====================================
// SESSION SECURITY
// =====================================

function createSignature(value) {
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing");
  }

  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("hex");
}

function getSession(req) {
  const cookies = req.headers.cookie || "";

  const match = cookies.match(
    /(?:^|;\s*)hervin_session=([^;]+)/
  );

  if (!match) return null;

  const parts = match[1].split(".");

  if (parts.length !== 2) return null;

  const [sessionId, signature] = parts;

  try {
    const expected = createSignature(sessionId);

    const receivedBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) return null;

  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

// =====================================
// SERVER PERMISSIONS
// =====================================

function canManageGuild(guild) {
  if (guild.owner === true) return true;

  try {
    const permissions = BigInt(guild.permissions || "0");

    return (permissions & 8n) === 8n;
  } catch {
    return false;
  }
}

function requireSession(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      error: "يجب تسجيل الدخول أولاً"
    });
  }

  req.hervinSession = session;
  next();
}

function getSelectedGuild(req) {
  const session = req.hervinSession;

  if (!session.selectedGuild) return null;

  return session.guilds.find(guild =>
    guild.id === session.selectedGuild.id &&
    canManageGuild(guild)
  ) || null;
}

function validDiscordId(id) {
  return typeof id === "string" &&
    /^\d{17,20}$/.test(id);
}

// =====================================
// DISCORD GUILD DATA
// =====================================

async function discordGuildData(guildId) {
  if (!DISCORD_TOKEN) {
    throw new Error(
      "إعدادات البوت غير مكتملة في Render"
    );
  }

  const headers = {
    Authorization: `Bot ${DISCORD_TOKEN}`
  };

  const [rolesResponse, channelsResponse] =
    await Promise.all([
      fetch(
        `https://discord.com/api/v10/guilds/${guildId}/roles`,
        { headers }
      ),
      fetch(
        `https://discord.com/api/v10/guilds/${guildId}/channels`,
        { headers }
      )
    ]);

  if (!rolesResponse.ok || !channelsResponse.ok) {
    throw new Error(
      "تعذر جلب بيانات السيرفر، تأكد أن البوت موجود فيه"
    );
  }

  const [roles, channels] = await Promise.all([
    rolesResponse.json(),
    channelsResponse.json()
  ]);

  return {
    roles,
    channels
  };
}

// =====================================
// DISCORD LOGIN
// =====================================

app.get("/auth/discord", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) {
    return res.status(500).send(
      "إعدادات تسجيل الدخول غير مكتملة في Render"
    );
  }

  const state = crypto.randomBytes(32).toString("hex");

  loginStates.set(state, Date.now());

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state
  });

  res.redirect(
    "https://discord.com/oauth2/authorize?" +
    params.toString()
  );
});

// =====================================
// DISCORD CALLBACK
// =====================================

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(
        "تم إلغاء تسجيل الدخول عبر Discord"
      );
    }

    if (!code || !state || !loginStates.has(state)) {
      return res.status(400).send(
        "طلب تسجيل الدخول غير صالح"
      );
    }

    const stateTime = loginStates.get(state);
    loginStates.delete(state);

    if (Date.now() - stateTime > 5 * 60 * 1000) {
      return res.status(400).send(
        "انتهت صلاحية تسجيل الدخول، حاول مرة أخرى"
      );
    }

    const tokenResponse = await fetch(
      "https://discord.com/api/oauth2/token",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Discord token error:", tokenData);

      return res.status(400).send(
        "تعذر إكمال تسجيل الدخول"
      );
    }

    const headers = {
      Authorization: `Bearer ${tokenData.access_token}`
    };

    const [userResponse, guildsResponse] =
      await Promise.all([
        fetch(
          "https://discord.com/api/users/@me",
          { headers }
        ),

        fetch(
          "https://discord.com/api/users/@me/guilds",
          { headers }
        )
      ]);

    if (!userResponse.ok || !guildsResponse.ok) {
      return res.status(400).send(
        "تعذر جلب بيانات حساب Discord"
      );
    }

    const user = await userResponse.json();
    const allGuilds = await guildsResponse.json();

    const ownedGuilds = allGuilds.filter(canManageGuild);

    const sessionId = crypto.randomBytes(32).toString("hex");
    const signature = createSignature(sessionId);

    sessions.set(sessionId, {
      createdAt: Date.now(),

      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar
      },

      guilds: ownedGuilds,
      selectedGuild: null
    });

    res.setHeader(
      "Set-Cookie",
      `hervin_session=${sessionId}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
    );

    res.redirect("/");

  } catch (error) {
    console.error("HERVIN OAuth error:", error);

    res.status(500).send(
      "حدث خطأ أثناء تسجيل الدخول"
    );
  }
});

// =====================================
// USER INFORMATION
// =====================================

app.get("/api/me", requireSession, (req, res) => {
  const session = req.hervinSession;

  res.json({
    loggedIn: true,
    user: session.user,
    selectedGuild: session.selectedGuild
  });
});

// =====================================
// MANAGEABLE SERVERS
// =====================================

app.get("/api/guilds", requireSession, (req, res) => {
  res.json(
    req.hervinSession.guilds
      .filter(canManageGuild)
      .map(guild => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon
      }))
  );
});

// =====================================
// SELECT SERVER
// =====================================

app.post("/api/select-server", requireSession, (req, res) => {
  const session = req.hervinSession;
  const { guildId } = req.body || {};

  if (!validDiscordId(guildId)) {
    return res.status(400).json({
      error: "معرّف السيرفر غير صالح"
    });
  }

  const guild = session.guilds.find(item =>
    item.id === guildId &&
    canManageGuild(item)
  );

  if (!guild) {
    return res.status(403).json({
      error: "غير مسموح لك بالتحكم في هذا السيرفر"
    });
  }

  session.selectedGuild = {
    id: guild.id,
    name: guild.name
  };

  res.json({
    success: true,
    selectedGuild: session.selectedGuild
  });
});

// =====================================
// HERVIN AUTO REPLIES API
// =====================================

app.get("/api/replies", requireSession, (req, res) => {
  const guild = getSelectedGuild(req);

  if (!guild) {
    return res.status(403).json({
      error: "اختر سيرفرًا تملك صلاحية إدارته أولاً"
    });
  }

  const data = loadReplies();
  const guildReplies = data[guild.id] || {};

  res.json({
    success: true,
    replies: Object.values(guildReplies)
  });
});

// =====================================
// ADD / EDIT / DELETE / TOGGLE REPLIES
// =====================================

app.post("/api/replies", requireSession, (req, res) => {
  const guild = getSelectedGuild(req);

  if (!guild) {
    return res.status(403).json({
      error: "ليس لديك صلاحية إدارة السيرفر المحدد"
    });
  }

  const {
    action,
    trigger,
    response,
    oldTrigger,
    enabled
  } = req.body || {};

  if (!["add", "edit", "delete", "toggle"].includes(action)) {
    return res.status(400).json({
      error: "العملية المطلوبة غير صحيحة"
    });
  }

  const cleanTrigger =
    typeof trigger === "string" ? trigger.trim() : "";

  const cleanOldTrigger =
    typeof oldTrigger === "string" ? oldTrigger.trim() : "";

  const key = cleanTrigger.toLowerCase();
  const oldKey = cleanOldTrigger.toLowerCase();

  const forbiddenKeys = [
    "__proto__",
    "constructor",
    "prototype"
  ];

  if (
    !cleanTrigger ||
    cleanTrigger.length > 80 ||
    cleanOldTrigger.length > 80
  ) {
    return res.status(400).json({
      error: "تحقق من كلمة التفعيل"
    });
  }

  if (
    forbiddenKeys.includes(key) ||
    forbiddenKeys.includes(oldKey)
  ) {
    return res.status(400).json({
      error: "كلمة التفعيل غير مسموحة"
    });
  }

  const data = loadReplies();

  if (!data[guild.id] || typeof data[guild.id] !== "object") {
    data[guild.id] = {};
  }

  const guildReplies = data[guild.id];

  try {
    // ADD
    if (action === "add") {
      if (
        typeof response !== "string" ||
        !response.trim()
      ) {
        return res.status(400).json({
          error: "اكتب نص الرد"
        });
      }

      if (response.length > 1900) {
        return res.status(400).json({
          error: "الرد طويل جدًا"
        });
      }

      if (guildReplies[key]) {
        return res.status(409).json({
          error: "كلمة التفعيل موجودة مسبقًا"
        });
      }

      guildReplies[key] = {
        trigger: cleanTrigger,
        response: response.trim(),
        enabled: true
      };
    }

    // EDIT
    if (action === "edit") {
      if (!cleanOldTrigger || !guildReplies[oldKey]) {
        return res.status(404).json({
          error: "الرد المطلوب غير موجود"
        });
      }

      if (
        typeof response !== "string" ||
        !response.trim() ||
        response.length > 1900
      ) {
        return res.status(400).json({
          error: "تحقق من نص الرد"
        });
      }

      if (key !== oldKey && guildReplies[key]) {
        return res.status(409).json({
          error: "كلمة التفعيل الجديدة مستخدمة"
        });
      }

      const previous = guildReplies[oldKey];

      delete guildReplies[oldKey];

      guildReplies[key] = {
        trigger: cleanTrigger,
        response: response.trim(),
        enabled: previous.enabled !== false
      };
    }

    // DELETE
    if (action === "delete") {
      if (!guildReplies[key]) {
        return res.status(404).json({
          error: "الرد غير موجود"
        });
      }

      delete guildReplies[key];
    }

    // TOGGLE
    if (action === "toggle") {
      if (!guildReplies[key]) {
        return res.status(404).json({
          error: "الرد غير موجود"
        });
      }

      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          error: "حالة التفعيل غير صحيحة"
        });
      }

      guildReplies[key].enabled = enabled;
    }

    saveReplies(data);

    res.json({
      success: true,
      message: "تم تنفيذ العملية بنجاح",
      replies: Object.values(guildReplies)
    });

  } catch (error) {
    console.error("HERVIN Replies API Error:", error);

    res.status(500).json({
      error: "حدث خطأ أثناء حفظ الردود"
    });
  }
});

// =====================================
// HERVIN WELCOME SETTINGS API
// =====================================

app.get(
  "/api/welcome-options",
  requireSession,
  async (req, res) => {
    const guild = getSelectedGuild(req);

    if (!guild) {
      return res.status(403).json({
        error: "اختر سيرفرًا أولاً"
      });
    }

    try {
      const { roles, channels } =
        await discordGuildData(guild.id);

      res.json({
        success: true,

        roles: roles
          .filter(role =>
            !role.managed &&
            role.id !== guild.id
          )
          .map(role => ({
            id: role.id,
            name: role.name,
            position: role.position
          })),

        channels: channels
          .filter(channel =>
            channel.type === 0 ||
            channel.type === 5
          )
          .map(channel => ({
            id: channel.id,
            name: channel.name
          }))
      });

    } catch (error) {
      console.error("Welcome options error:", error);

      res.status(400).json({
        error: error.message
      });
    }
  }
);

// =====================================
// GET WELCOME SETTINGS
// =====================================

app.get(
  "/api/welcome-settings",
  requireSession,
  (req, res) => {
    const guild = getSelectedGuild(req);

    if (!guild) {
      return res.status(403).json({
        error: "اختر سيرفرًا أولاً"
      });
    }

    const config = loadWelcomeConfig()[guild.id] || {};

    res.json({
      success: true,

      settings: {
        memberRoleId: config.memberRoleId || "",
        botRoleId: config.botRoleId || "",

        joinLogChannelId:
          config.joinLogChannelId || "",

        leaveLogChannelId:
          config.leaveLogChannelId || "",

        welcomeChannelId:
          config.welcome?.channelId || "",

        welcomeMessage:
          config.welcome?.message ||
          "أهلًا وسهلًا {user} في سيرفر {server} 🎉\nأنت العضو رقم {memberCount}",

        leaveChannelId:
          config.leave?.channelId || "",

        leaveMessage:
          config.leave?.message ||
          "غادرنا {username} من سيرفر {server} 👋"
      }
    });
  }
);

// =====================================
// SAVE WELCOME SETTINGS
// =====================================

app.post(
  "/api/welcome-settings",
  requireSession,
  async (req, res) => {
    const guild = getSelectedGuild(req);

    if (!guild) {
      return res.status(403).json({
        error: "ليس لديك صلاحية إدارة السيرفر"
      });
    }

    try {
      const body = req.body || {};

      const fields = [
        "memberRoleId",
        "botRoleId",
        "joinLogChannelId",
        "leaveLogChannelId",
        "welcomeChannelId",
        "leaveChannelId"
      ];

      for (const field of fields) {
        const value = body[field];

        if (
          value !== "" &&
          value !== null &&
          value !== undefined &&
          !validDiscordId(value)
        ) {
          return res.status(400).json({
            error: `قيمة غير صحيحة في ${field}`
          });
        }
      }

      const welcomeMessage =
        typeof body.welcomeMessage === "string"
          ? body.welcomeMessage.trim()
          : "";

      const leaveMessage =
        typeof body.leaveMessage === "string"
          ? body.leaveMessage.trim()
          : "";

      if (
        welcomeMessage.length > 1000 ||
        leaveMessage.length > 1000
      ) {
        return res.status(400).json({
          error: "الرسالة يجب ألا تتجاوز 1000 حرف"
        });
      }

      if (body.welcomeChannelId && !welcomeMessage) {
        return res.status(400).json({
          error: "اكتب رسالة الترحيب"
        });
      }

      if (body.leaveChannelId && !leaveMessage) {
        return res.status(400).json({
          error: "اكتب رسالة المغادرة"
        });
      }

      const { roles, channels } =
        await discordGuildData(guild.id);

      const roleIds = new Set(
        roles
          .filter(role =>
            !role.managed &&
            role.id !== guild.id
          )
          .map(role => role.id)
      );

      const channelIds = new Set(
        channels
          .filter(channel =>
            channel.type === 0 ||
            channel.type === 5
          )
          .map(channel => channel.id)
      );

      for (const field of [
        "memberRoleId",
        "botRoleId"
      ]) {
        if (body[field] && !roleIds.has(body[field])) {
          return res.status(400).json({
            error: "الرتبة المحددة غير موجودة في السيرفر"
          });
        }
      }

      for (const field of [
        "joinLogChannelId",
        "leaveLogChannelId",
        "welcomeChannelId",
        "leaveChannelId"
      ]) {
        if (
          body[field] &&
          !channelIds.has(body[field])
        ) {
          return res.status(400).json({
            error: "القناة المحددة غير موجودة في السيرفر"
          });
        }
      }

      const data = loadWelcomeConfig();
      const config = data[guild.id] || {};

      config.memberRoleId = body.memberRoleId || "";
      config.botRoleId = body.botRoleId || "";

      config.joinLogChannelId =
        body.joinLogChannelId || "";

      config.leaveLogChannelId =
        body.leaveLogChannelId || "";

      config.welcome = {
        channelId: body.welcomeChannelId || "",
        message: welcomeMessage ||
          "أهلًا وسهلًا {user} في سيرفر {server} 🎉\nأنت العضو رقم {memberCount}"
      };

      config.leave = {
        channelId: body.leaveChannelId || "",
        message: leaveMessage ||
          "غادرنا {username} من سيرفر {server} 👋"
      };

      data[guild.id] = config;

      saveWelcomeConfig(data);

      res.json({
        success: true,
        message: "تم حفظ إعدادات الترحيب والرتب واللوقات"
      });

    } catch (error) {
      console.error("Welcome settings save error:", error);

      res.status(500).json({
        error: error.message || "حدث خطأ أثناء حفظ الإعدادات"
      });
    }
  }
);

// =====================================
// HERVIN DASHBOARD PAGE
// =====================================

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HERVIN Dashboard</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: #0b0d13;
      color: #f4f4f5;
      font-family: Arial, sans-serif;
      min-height: 100vh;
    }

    button, input, textarea, select {
      font: inherit;
    }

    button {
      cursor: pointer;
      border: none;
    }

    .hidden {
      display: none !important;
    }

    .login-screen {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .login-card {
      width: 100%;
      max-width: 430px;
      background: #141722;
      border: 1px solid #252a39;
      border-radius: 22px;
      padding: 35px;
      text-align: center;
    }

    .logo {
      font-size: 42px;
      font-weight: 900;
      letter-spacing: 5px;
      color: #9b8cff;
      margin-bottom: 15px;
    }

    .login-card h1 {
      font-size: 25px;
      margin-bottom: 12px;
    }

    .login-card p {
      color: #9298aa;
      line-height: 1.8;
      margin-bottom: 25px;
    }

    .primary-btn {
      background: #7965ed;
      color: white;
      padding: 13px 20px;
      border-radius: 11px;
      font-weight: bold;
      transition: .2s;
    }

    .primary-btn:hover {
      background: #6752dc;
      transform: translateY(-1px);
    }

    .secondary-btn {
      background: #252a39;
      color: white;
      padding: 11px 16px;
      border-radius: 10px;
    }

    .danger-btn {
      background: #9d303d;
      color: white;
      padding: 9px 13px;
      border-radius: 9px;
    }

    .success-btn {
      background: #167a57;
      color: white;
      padding: 9px 13px;
      border-radius: 9px;
    }

    .dashboard {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 255px;
      background: #11141e;
      border-left: 1px solid #252a39;
      padding: 25px 16px;
      flex-shrink: 0;
    }

    .sidebar-logo {
      font-size: 27px;
      font-weight: 900;
      color: #9b8cff;
      text-align: center;
      letter-spacing: 3px;
      margin-bottom: 30px;
    }

    .sidebar-label {
      color: #72798c;
      font-size: 12px;
      margin: 22px 10px 10px;
    }

    .nav-btn {
      width: 100%;
      padding: 13px;
      border-radius: 10px;
      background: transparent;
      color: #aeb3c2;
      text-align: right;
      margin-bottom: 5px;
      transition: .2s;
    }

    .nav-btn:hover,
    .nav-btn.active {
      background: #25213f;
      color: #b5a8ff;
    }

    .main {
      flex: 1;
      min-width: 0;
      padding: 28px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }

    .topbar h1 {
      font-size: 25px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #171b28;
      border: 1px solid #282e40;
      border-radius: 12px;
      padding: 10px 14px;
    }

    .user-info span {
      color: #b8bdcb;
      font-size: 14px;
    }

    .panel {
      display: none;
    }

    .panel.active {
      display: block;
    }

    .card {
      background: #141824;
      border: 1px solid #272d3d;
      border-radius: 16px;
      padding: 22px;
      margin-bottom: 20px;
    }

    .card h2 {
      font-size: 19px;
      margin-bottom: 9px;
    }

    .card-description {
      color: #8e95a8;
      font-size: 13px;
      line-height: 1.8;
      margin-bottom: 20px;
    }

    .form-group {
      margin-bottom: 17px;
    }

    .form-group label {
      display: block;
      margin-bottom: 9px;
      color: #c9ccda;
      font-size: 14px;
    }

    .form-control {
      width: 100%;
      background: #0d1019;
      border: 1px solid #30364a;
      color: white;
      border-radius: 10px;
      padding: 12px;
      outline: none;
    }

    .form-control:focus {
      border-color: #8874ff;
    }

    textarea.form-control {
      resize: vertical;
      min-height: 100px;
      line-height: 1.8;
    }

    select.form-control {
      cursor: pointer;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .server-select {
      max-width: 500px;
    }

    .server-status {
      color: #8e95a8;
      font-size: 13px;
      margin-top: 12px;
    }

    .reply-item {
      background: #0e121c;
      border: 1px solid #2a3040;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
    }

    .reply-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .reply-trigger {
      color: #b6aaff;
      font-weight: bold;
      word-break: break-word;
    }

    .reply-response {
      color: #aeb4c3;
      font-size: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.8;
      margin-bottom: 14px;
    }

    .reply-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .reply-actions button {
      font-size: 12px;
    }

    .empty-state {
      color: #81899c;
      text-align: center;
      padding: 25px;
      border: 1px dashed #30364a;
      border-radius: 12px;
    }

    .status-message {
      padding: 12px;
      border-radius: 10px;
      margin-bottom: 15px;
      font-size: 13px;
      display: none;
      line-height: 1.7;
    }

    .status-message.success {
      display: block;
      background: #12372d;
      color: #76e2b7;
    }

    .status-message.error {
      display: block;
      background: #421d27;
      color: #ff9ba7;
    }

    .user-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .hint {
      color: #858da0;
      font-size: 12px;
      line-height: 1.8;
      margin-top: 8px;
    }

    .section-title {
      margin-bottom: 18px;
    }

    .section-title p {
      color: #8e95a8;
      margin-top: 8px;
      font-size: 13px;
      line-height: 1.8;
    }

    @media (max-width: 850px) {
      .dashboard {
        display: block;
      }

      .sidebar {
        width: 100%;
        border-left: none;
        border-bottom: 1px solid #252a39;
        padding: 15px;
      }

      .sidebar-logo {
        margin-bottom: 15px;
      }

      .sidebar-label {
        display: none;
      }

      .sidebar nav {
        display: flex;
        overflow-x: auto;
        gap: 5px;
      }

      .nav-btn {
        white-space: nowrap;
        width: auto;
        margin: 0;
      }

      .main {
        padding: 18px;
      }
    }

    @media (max-width: 550px) {
      .grid {
        grid-template-columns: 1fr;
      }

      .topbar h1 {
        font-size: 20px;
      }

      .card {
        padding: 16px;
      }

      .login-card {
        padding: 25px 18px;
      }
    }
  </style>
</head>

<body>

  <!-- LOGIN SCREEN -->

  <section id="loginScreen" class="login-screen">
    <div class="login-card">
      <div class="logo">HERVIN</div>

      <h1>لوحة تحكم هيرفن</h1>

      <p>
        أهلاً بك في لوحة تحكم HERVIN
        <br>
        سجل دخولك باستخدام Discord لإدارة سيرفرك
      </p>

      <a href="/auth/discord">
        <button class="primary-btn">
          تسجيل الدخول عبر Discord
        </button>
      </a>
    </div>
  </section>

  <!-- DASHBOARD -->

  <div id="dashboard" class="dashboard hidden">

    <aside class="sidebar">

      <div class="sidebar-logo">HERVIN</div>

      <div class="sidebar-label">القائمة الرئيسية</div>

      <nav>
        <button class="nav-btn active" data-panel="home">
          الرئيسية
        </button>

        <button class="nav-btn" data-panel="replies">
          الردود التلقائية
        </button>

        <button class="nav-btn" data-panel="welcome">
          الترحيب والمغادرة
        </button>
      </nav>

    </aside>

    <main class="main">

      <header class="topbar">

        <h1 id="pageTitle">الرئيسية</h1>

        <div class="user-actions">

          <div class="user-info">
            <span id="username">...</span>
          </div>

          <button
            class="danger-btn"
            id="logoutBtn"
          >
            تسجيل الخروج
          </button>

        </div>

      </header>

      <!-- HOME -->

      <section id="panel-home" class="panel active">

        <div class="section-title">
          <h2>مرحباً بك في HERVIN</h2>

          <p>
            تحكم في إعدادات البوت وأنظمة السيرفر من مكان واحد
          </p>
        </div>

        <div class="card">

          <h2>اختيار السيرفر</h2>

          <p class="card-description">
            اختر السيرفر الذي تملك صلاحية إدارته
            أو لديك فيه صلاحية Administrator
          </p>

          <div class="form-group server-select">

            <label>السيرفرات المتاحة</label>

            <select
              id="guildSelect"
              class="form-control"
            >
              <option value="">جاري تحميل السيرفرات...</option>
            </select>

          </div>

          <p id="serverStatus" class="server-status">
            لم يتم اختيار سيرفر بعد
          </p>

        </div>

        <div class="card">

          <h2>أنظمة HERVIN</h2>

          <p class="card-description">
            يمكنك إدارة الردود التلقائية وإعدادات الترحيب
            والمغادرة من القائمة الجانبية
          </p>

        </div>

      </section>

      <!-- AUTO REPLIES -->

      <section id="panel-replies" class="panel">

        <div class="section-title">
          <h2>الردود التلقائية</h2>

          <p>
            أضف كلمات تفعيل واجعل HERVIN يرد عليها تلقائياً
          </p>
        </div>

        <div id="repliesMessage" class="status-message"></div>

        <div class="card">

          <h2>إضافة رد جديد</h2>

          <p class="card-description">
            حدد كلمة التفعيل والرد الذي سيرسله البوت
          </p>

          <div class="form-group">

            <label>كلمة التفعيل</label>

            <input
              id="replyTrigger"
              class="form-control"
              maxlength="80"
              placeholder="مثال: السلام عليكم"
            >

          </div>

          <div class="form-group">

            <label>نص الرد</label>

            <textarea
              id="replyResponse"
              class="form-control"
              maxlength="1900"
              placeholder="اكتب الرد هنا..."
            ></textarea>

          </div>

          <button
            class="primary-btn"
            id="addReplyBtn"
          >
            إضافة الرد
          </button>

        </div>

        <div class="card">

          <h2>الردود الموجودة</h2>

          <p class="card-description">
            يمكنك تعديل الردود أو حذفها أو إيقافها مؤقتاً
          </p>

          <div id="repliesList">
            <div class="empty-state">
              اختر سيرفراً لعرض الردود
            </div>
          </div>

        </div>

      </section>

      <!-- WELCOME SETTINGS -->

      <section id="panel-welcome" class="panel">

        <div class="section-title">

          <h2>إعدادات الترحيب والمغادرة</h2>

          <p>
            تحكم في رسائل الترحيب والمغادرة والرتب التلقائية
            وقنوات تسجيل الدخول والخروج
          </p>

        </div>

        <div id="welcomeMessageStatus" class="status-message"></div>

        <div class="card">

          <h2>الرتب التلقائية</h2>

          <p class="card-description">
            اختر الرتبة التي يحصل عليها العضو أو البوت عند دخوله
          </p>

          <div class="grid">

            <div class="form-group">

              <label>رتبة الأعضاء</label>

              <select
                id="memberRoleId"
                class="form-control"
              >
                <option value="">بدون رتبة تلقائية</option>
              </select>

            </div>

            <div class="form-group">

              <label>رتبة البوتات</label>

              <select
                id="botRoleId"
                class="form-control"
              >
                <option value="">بدون رتبة تلقائية</option>
              </select>

            </div>

          </div>

          <p class="hint">
            يجب أن تكون رتبة البوت أعلى من الرتب التي تريد منحهـا للأعضاء
          </p>

        </div>

        <div class="card">

          <h2>رسالة الترحيب</h2>

          <p class="card-description">
            اختر القناة واكتب الرسالة التي تظهر عند دخول عضو جديد
          </p>

          <div class="form-group">

            <label>قناة الترحيب</label>

            <select
              id="welcomeChannelId"
              class="form-control"
            >
              <option value="">تعطيل رسالة الترحيب</option>
            </select>

          </div>

          <div class="form-group">

            <label>نص الترحيب</label>

            <textarea
              id="welcomeMessage"
              class="form-control"
              maxlength="1000"
            >أهلًا وسهلًا {user} في سيرفر {server} 🎉
أنت العضو رقم {memberCount}</textarea>

            <p class="hint">
              المتغيرات المتاحة:
              {user} اسم العضو مع المنشن،
              {username} اسم العضو،
              {server} اسم السيرفر،
              {memberCount} عدد الأعضاء
            </p>

          </div>

        </div>

        <div class="card">

          <h2>رسالة المغادرة</h2>

          <p class="card-description">
            حدد القناة والرسالة التي تظهر عند خروج عضو
          </p>

          <div class="form-group">

            <label>قناة المغادرة</label>

            <select
              id="leaveChannelId"
              class="form-control"
            >
              <option value="">تعطيل رسالة المغادرة</option>
            </select>

          </div>

          <div class="form-group">

            <label>نص المغادرة</label>

            <textarea
              id="leaveMessage"
              class="form-control"
              maxlength="1000"
            >غادرنا {username} من سيرفر {server} 👋</textarea>

            <p class="hint">
              المتغيرات المتاحة:
              {user}،
              {username}،
              {server}،
              {memberCount}
            </p>

          </div>

        </div>

        <div class="card">

          <h2>سجلات الدخول والخروج</h2>

          <p class="card-description">
            اختر القنوات التي تستقبل سجلات دخول الأعضاء وخروجهم
          </p>

          <div class="grid">

            <div class="form-group">

              <label>قناة سجل الدخول</label>

              <select
                id="joinLogChannelId"
                class="form-control"
              >
                <option value="">بدون سجل دخول</option>
              </select>

            </div>

            <div class="form-group">

              <label>قناة سجل الخروج</label>

              <select
                id="leaveLogChannelId"
                class="form-control"
              >
                <option value="">بدون سجل خروج</option>
              </select>

            </div>

          </div>

        </div>

        <div class="card">

          <button
            class="primary-btn"
            id="saveWelcomeBtn"
          >
            حفظ جميع الإعدادات
          </button>

        </div>

      </section>

    </main>

  </div>

  <script>
    let selectedGuildId = null;
    let currentReplies = [];
    let welcomeOptions = {
      roles: [],
      channels: []
    };

    const loginScreen = document.getElementById("loginScreen");
    const dashboard = document.getElementById("dashboard");

    const guildSelect = document.getElementById("guildSelect");
    const serverStatus = document.getElementById("serverStatus");

    // =====================================
    // API HELPER
    // =====================================

    async function api(url, options) {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...(options || {})
      });

      let data = {};

      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (response.status === 401) {
        showLogin();
        throw new Error("انتهت جلسة تسجيل الدخول");
      }

      if (!response.ok) {
        throw new Error(
          data.error || "حدث خطأ أثناء تنفيذ الطلب"
        );
      }

      return data;
    }

    // =====================================
    // LOGIN STATE
    // =====================================

    function showLogin() {
      loginScreen.classList.remove("hidden");
      dashboard.classList.add("hidden");
    }

    function showDashboard() {
      loginScreen.classList.add("hidden");
      dashboard.classList.remove("hidden");
    }

    async function loadDashboard() {
      try {
        const data = await api("/api/me");

        if (!data.loggedIn) {
          showLogin();
          return;
        }

        document.getElementById("username").textContent =
          data.user.username || "Discord User";

        showDashboard();

        await loadGuilds();

      } catch (error) {
        showLogin();
      }
    }

    // =====================================
    // NAVIGATION
    // =====================================

    document.querySelectorAll(".nav-btn").forEach(button => {
      button.addEventListener("click", () => {
        const panelName = button.dataset.panel;

        document.querySelectorAll(".nav-btn").forEach(item => {
          item.classList.remove("active");
        });

        document.querySelectorAll(".panel").forEach(panel => {
          panel.classList.remove("active");
        });

        button.classList.add("active");

        const panel = document.getElementById(
          "panel-" + panelName
        );

        if (panel) panel.classList.add("active");

        const titles = {
          home: "الرئيسية",
          replies: "الردود التلقائية",
          welcome: "الترحيب والمغادرة"
        };

        document.getElementById("pageTitle").textContent =
          titles[panelName] || "HERVIN";
      });
    });

    // =====================================
    // LOAD GUILDS
    // =====================================

    async function loadGuilds() {
      try {
        const data = await api("/api/guilds");

        guildSelect.replaceChildren();

        const defaultOption = document.createElement("option");

        defaultOption.value = "";
        defaultOption.textContent = "اختر السيرفر";

        guildSelect.appendChild(defaultOption);

        data.forEach(guild => {
          const option = document.createElement("option");

          option.value = guild.id;
          option.textContent = guild.name;

          guildSelect.appendChild(option);
        });

        const me = await api("/api/me");

        if (
          me.selectedGuild &&
          data.some(item => item.id === me.selectedGuild.id)
        ) {
          guildSelect.value = me.selectedGuild.id;
          selectedGuildId = me.selectedGuild.id;

          serverStatus.textContent =
            "السيرفر المحدد: " + me.selectedGuild.name;

          await loadReplies();
          await loadWelcomeSettings();

        } else {
          selectedGuildId = null;

          serverStatus.textContent =
            "لم يتم اختيار سيرفر بعد";

          clearDashboardSettings();
        }

      } catch (error) {
        serverStatus.textContent = error.message;
      }
    }

    // =====================================
    // SELECT SERVER
    // =====================================

    guildSelect.addEventListener("change", async () => {
      const guildId = guildSelect.value;

      if (!guildId) {
        selectedGuildId = null;
        serverStatus.textContent = "لم يتم اختيار سيرفر";
        clearDashboardSettings();
        return;
      }

      try {
        const data = await api("/api/select-server", {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            guildId
          })
        });

        selectedGuildId = guildId;

        serverStatus.textContent =
          "السيرفر المحدد: " + data.selectedGuild.name;

        await loadReplies();
        await loadWelcomeSettings();

      } catch (error) {
        selectedGuildId = null;
        serverStatus.textContent = error.message;
      }
    });

    // =====================================
    // CLEAR SETTINGS
    // =====================================

    function clearDashboardSettings() {
      currentReplies = [];

      document.getElementById("repliesList").replaceChildren();

      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "اختر سيرفراً لعرض الردود";

      document.getElementById("repliesList").appendChild(empty);

      welcomeOptions = {
        roles: [],
        channels: []
      };

      clearWelcomeSelects();
    }

    function clearWelcomeSelects() {
      const ids = [
        "memberRoleId",
        "botRoleId",
        "welcomeChannelId",
        "leaveChannelId",
        "joinLogChannelId",
        "leaveLogChannelId"
      ];

      ids.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;

        element.replaceChildren();

        const option = document.createElement("option");
        option.value = "";
        option.textContent = "اختر السيرفر أولاً";

        element.appendChild(option);
      });
    }

    // =====================================
    // REPLIES MESSAGE
    // =====================================

    function showReplyMessage(message, type) {
      const element = document.getElementById("repliesMessage");

      element.textContent = message;
      element.className = "status-message " + type;
    }

    // =====================================
    // LOAD REPLIES
    // =====================================

    async function loadReplies() {
      if (!selectedGuildId) return;

      try {
        const data = await api("/api/replies");

        currentReplies = Array.isArray(data.replies)
          ? data.replies
          : [];

        renderReplies();

      } catch (error) {
        showReplyMessage(error.message, "error");
      }
    }

    // =====================================
    // RENDER REPLIES
    // =====================================

    function renderReplies() {
      const container = document.getElementById("repliesList");

      container.replaceChildren();

      if (!currentReplies.length) {
        const empty = document.createElement("div");

        empty.className = "empty-state";
        empty.textContent = "لا توجد ردود تلقائية حالياً";

        container.appendChild(empty);
        return;
      }

      currentReplies.forEach(reply => {
        const item = document.createElement("div");
        item.className = "reply-item";

        const header = document.createElement("div");
        header.className = "reply-header";

        const trigger = document.createElement("div");
        trigger.className = "reply-trigger";
        trigger.textContent = "كلمة التفعيل: " + reply.trigger;

        const state = document.createElement("span");
        state.textContent =
          reply.enabled === false ? "معطل" : "مفعل";

        state.style.color =
          reply.enabled === false ? "#ff929c" : "#76e2b7";

        header.appendChild(trigger);
        header.appendChild(state);

        const response = document.createElement("div");
        response.className = "reply-response";
        response.textContent = reply.response;

        const actions = document.createElement("div");
        actions.className = "reply-actions";

        const editButton = document.createElement("button");
        editButton.className = "secondary-btn";
        editButton.textContent = "تعديل";

        editButton.addEventListener("click", () => {
          editReply(reply);
        });

        const toggleButton = document.createElement("button");

        toggleButton.className =
          reply.enabled === false
            ? "success-btn"
            : "secondary-btn";

        toggleButton.textContent =
          reply.enabled === false ? "تفعيل" : "تعطيل";

        toggleButton.addEventListener("click", () => {
          toggleReply(reply);
        });

        const deleteButton = document.createElement("button");
        deleteButton.className = "danger-btn";
        deleteButton.textContent = "حذف";

        deleteButton.addEventListener("click", () => {
          deleteReply(reply);
        });

        actions.appendChild(editButton);
        actions.appendChild(toggleButton);
        actions.appendChild(deleteButton);

        item.appendChild(header);
        item.appendChild(response);
        item.appendChild(actions);

        container.appendChild(item);
      });
    }

    // =====================================
    // ADD REPLY
    // =====================================

    document.getElementById("addReplyBtn").addEventListener(
      "click",
      async () => {
        if (!selectedGuildId) {
          showReplyMessage("اختر سيرفراً أولاً", "error");
          return;
        }

        const trigger =
          document.getElementById("replyTrigger").value.trim();

        const response =
          document.getElementById("replyResponse").value.trim();

        if (!trigger || !response) {
          showReplyMessage(
            "اكتب كلمة التفعيل ونص الرد",
            "error"
          );
          return;
        }

        try {
          const data = await api("/api/replies", {
            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            body: JSON.stringify({
              action: "add",
              trigger,
              response
            })
          });

          currentReplies = data.replies;
          renderReplies();

          document.getElementById("replyTrigger").value = "";
          document.getElementById("replyResponse").value = "";

          showReplyMessage(data.message, "success");

        } catch (error) {
          showReplyMessage(error.message, "error");
        }
      }
    );

    // =====================================
    // EDIT REPLY
    // =====================================

    async function editReply(reply) {
      const newTrigger = prompt(
        "اكتب كلمة التفعيل الجديدة:",
        reply.trigger
      );

      if (newTrigger === null) return;

      const newResponse = prompt(
        "اكتب نص الرد الجديد:",
        reply.response
      );

      if (newResponse === null) return;

      if (!newTrigger.trim() || !newResponse.trim()) {
        showReplyMessage("لا يمكن ترك الحقول فارغة", "error");
        return;
      }

      try {
        const data = await api("/api/replies", {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            action: "edit",
            oldTrigger: reply.trigger,
            trigger: newTrigger.trim(),
            response: newResponse.trim()
          })
        });

        currentReplies = data.replies;
        renderReplies();

        showReplyMessage(data.message, "success");

      } catch (error) {
        showReplyMessage(error.message, "error");
      }
    }

    // =====================================
    // DELETE REPLY
    // =====================================

    async function deleteReply(reply) {
      if (!confirm("هل أنت متأكد من حذف هذا الرد؟")) {
        return;
      }

      try {
        const data = await api("/api/replies", {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            action: "delete",
            trigger: reply.trigger
          })
        });

        currentReplies = data.replies;
        renderReplies();

        showReplyMessage(data.message, "success");

      } catch (error) {
        showReplyMessage(error.message, "error");
      }
    }

    // =====================================
    // TOGGLE REPLY
    // =====================================

    async function toggleReply(reply) {
      try {
        const data = await api("/api/replies", {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            action: "toggle",
            trigger: reply.trigger,
            enabled: reply.enabled === false
          })
        });

        currentReplies = data.replies;
        renderReplies();

        showReplyMessage(data.message, "success");

      } catch (error) {
        showReplyMessage(error.message, "error");
      }
    }

    // =====================================
    // WELCOME STATUS
    // =====================================

    function showWelcomeMessage(message, type) {
      const element = document.getElementById(
        "welcomeMessageStatus"
      );

      element.textContent = message;
      element.className = "status-message " + type;
    }

    // =====================================
    // SELECT OPTIONS HELPER
    // =====================================

    function fillSelect(id, items, emptyText, getName) {
      const select = document.getElementById(id);

      select.replaceChildren();

      const emptyOption = document.createElement("option");

      emptyOption.value = "";
      emptyOption.textContent = emptyText;

      select.appendChild(emptyOption);

      items.forEach(item => {
        const option = document.createElement("option");

        option.value = item.id;
        option.textContent = getName(item);

        select.appendChild(option);
      });
    }

    // =====================================
    // LOAD WELCOME OPTIONS
    // =====================================

    async function loadWelcomeOptions() {
      const data = await api("/api/welcome-options");

      welcomeOptions = {
        roles: Array.isArray(data.roles) ? data.roles : [],
        channels: Array.isArray(data.channels) ? data.channels : []
      };

      fillSelect(
        "memberRoleId",
        welcomeOptions.roles,
        "بدون رتبة تلقائية",
        item => item.name
      );

      fillSelect(
        "botRoleId",
        welcomeOptions.roles,
        "بدون رتبة تلقائية",
        item => item.name
      );

      fillSelect(
        "welcomeChannelId",
        welcomeOptions.channels,
        "تعطيل رسالة الترحيب",
        item => "#" + item.name
      );

      fillSelect(
        "leaveChannelId",
        welcomeOptions.channels,
        "تعطيل رسالة المغادرة",
        item => "#" + item.name
      );

      fillSelect(
        "joinLogChannelId",
        welcomeOptions.channels,
        "بدون سجل دخول",
        item => "#" + item.name
      );

      fillSelect(
        "leaveLogChannelId",
        welcomeOptions.channels,
        "بدون سجل خروج",
        item => "#" + item.name
      );
    }

    // =====================================
    // LOAD WELCOME SETTINGS
    // =====================================

    async function loadWelcomeSettings() {
      if (!selectedGuildId) return;

      try {
        await loadWelcomeOptions();

        const data = await api("/api/welcome-settings");
        const settings = data.settings || {};

        const fields = [
          "memberRoleId",
          "botRoleId",
          "joinLogChannelId",
          "leaveLogChannelId",
          "welcomeChannelId",
          "leaveChannelId"
        ];

        fields.forEach(id => {
          document.getElementById(id).value =
            settings[id] || "";
        });

        document.getElementById("welcomeMessage").value =
          settings.welcomeMessage || "";

        document.getElementById("leaveMessage").value =
          settings.leaveMessage || "";

      } catch (error) {
        showWelcomeMessage(error.message, "error");
      }
    }

    // =====================================
    // SAVE WELCOME SETTINGS
    // =====================================

    document.getElementById("saveWelcomeBtn").addEventListener(
      "click",
      async () => {
        if (!selectedGuildId) {
          showWelcomeMessage("اختر سيرفراً أولاً", "error");
          return;
        }

        const payload = {
          memberRoleId:
            document.getElementById("memberRoleId").value,

          botRoleId:
            document.getElementById("botRoleId").value,

          joinLogChannelId:
            document.getElementById("joinLogChannelId").value,

          leaveLogChannelId:
            document.getElementById("leaveLogChannelId").value,

          welcomeChannelId:
            document.getElementById("welcomeChannelId").value,

          leaveChannelId:
            document.getElementById("leaveChannelId").value,

          welcomeMessage:
            document.getElementById("welcomeMessage").value,

          leaveMessage:
            document.getElementById("leaveMessage").value
        };

        try {
          const data = await api("/api/welcome-settings", {
            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            body: JSON.stringify(payload)
          });

          showWelcomeMessage(data.message, "success");

        } catch (error) {
          showWelcomeMessage(error.message, "error");
        }
      }
    );

    // =====================================
    // LOGOUT
    // =====================================

    document.getElementById("logoutBtn").addEventListener(
      "click",
      async () => {
        try {
          await fetch("/auth/logout", {
            method: "POST",
            credentials: "same-origin"
          });
        } catch (error) {
          console.error("Logout error:", error);
        }

        selectedGuildId = null;
        window.location.reload();
      }
    );

    // =====================================
    // START DASHBOARD
    // =====================================

    loadDashboard();

  </script>

</body>
</html>`);
});

// =====================================
// LOGOUT API
// =====================================

app.post("/auth/logout", (req, res) => {
  const session = getSession(req);

  if (session) {
    const cookies = req.headers.cookie || "";

    const match = cookies.match(
      /(?:^|;\s*)hervin_session=([^;]+)/
    );

    if (match) {
      const sessionId = match[1].split(".")[0];
      sessions.delete(sessionId);
    }
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
// START SERVER
// =====================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("HERVIN Dashboard is running");
  console.log("Port:", PORT);
  console.log("=================================");
});
