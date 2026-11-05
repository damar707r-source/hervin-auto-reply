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

const REDIRECT_URI =
  "https://hervin-dashboard.onrender.com/auth/discord/callback";

const repliesFile = path.join(__dirname, "replies.json");

const sessions = new Map();
const loginStates = new Map();

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

// =====================================
// STORAGE
// =====================================

function loadReplies() {
  try {
    if (!fs.existsSync(repliesFile)) return {};

    const data = JSON.parse(
      fs.readFileSync(repliesFile, "utf8")
    );

    return data &&
      typeof data === "object" &&
      !Array.isArray(data)
      ? data
      : {};
  } catch (error) {
    console.error("Replies load error:", error);
    return {};
  }
}

function saveReplies(data) {
  fs.writeFileSync(
    repliesFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// =====================================
// OAUTH ENV CHECK
// =====================================

console.log("=================================");
console.log("HERVIN OAUTH ENV CHECK:", {
  CLIENT_ID: Boolean(CLIENT_ID),
  CLIENT_SECRET: Boolean(CLIENT_SECRET),
  SESSION_SECRET: Boolean(SESSION_SECRET)
});
console.log("=================================");

// =====================================
// SESSION SECURITY
// =====================================

function createSignature(value) {
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

    const [userResponse, guildsResponse] = await Promise.all([
      fetch("https://discord.com/api/users/@me", { headers }),
      fetch("https://discord.com/api/users/@me/guilds", { headers })
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
  const { guildId } = req.body;

  if (!guildId || typeof guildId !== "string") {
    return res.status(400).json({
      error: "معرّف السيرفر غير صالح"
    });
  }

  const guild = session.guilds.find(item =>
    item.id === guildId && canManageGuild(item)
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

  const allowedActions = [
    "add",
    "edit",
    "delete",
    "toggle"
  ];

  if (!allowedActions.includes(action)) {
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
    ["add", "edit", "delete", "toggle"].includes(action) &&
    !cleanTrigger
  ) {
    return res.status(400).json({
      error: "اكتب كلمة التفعيل"
    });
  }

  if (
    cleanTrigger.length > 80 ||
    cleanOldTrigger.length > 80
  ) {
    return res.status(400).json({
      error: "كلمة التفعيل طويلة جدًا"
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
          error: "الرد طويل جدًا، الحد الأقصى 1900 حرف"
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
          error: "الرد المطلوب تعديله غير موجود"
        });
      }

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

      if (key !== oldKey && guildReplies[key]) {
        return res.status(409).json({
          error: "كلمة التفعيل الجديدة مستخدمة مسبقًا"
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

const welcomeConfigFile = path.join(
  __dirname,
  "systems",
  "welcome.json"
);

function loadWelcomeConfig() {
  try {
    if (!fs.existsSync(welcomeConfigFile)) return {};

    const data = JSON.parse(
      fs.readFileSync(welcomeConfigFile, "utf8")
    );

    return data &&
      typeof data === "object" &&
      !Array.isArray(data)
      ? data
      : {};
  } catch (error) {
    console.error("HERVIN Welcome Config Error:", error);
    return {};
  }
}

function saveWelcomeConfig(data) {
  fs.writeFileSync(
    welcomeConfigFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function validDiscordId(id) {
  return typeof id === "string" &&
    /^\d{17,20}$/.test(id);
}

// =====================================
// GET SERVER ROLES AND CHANNELS
// =====================================

app.get(
  "/api/welcome-options",
  requireSession,
  async (req, res) => {
    const guild = getSelectedGuild(req);

    if (!guild) {
      return res.status(403).json({
        error: "اختر سيرفرًا تملك صلاحية إدارته"
      });
    }

    if (!process.env.DISCORD_TOKEN) {
      return res.status(500).json({
        error: "إعدادات البوت غير مكتملة"
      });
    }

    try {
      const headers = {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`
      };

      const [rolesResponse, channelsResponse] =
        await Promise.all([
          fetch(
            `https://discord.com/api/v10/guilds/${guild.id}/roles`,
            { headers }
          ),
          fetch(
            `https://discord.com/api/v10/guilds/${guild.id}/channels`,
            { headers }
          )
        ]);

      if (!rolesResponse.ok || !channelsResponse.ok) {
        return res.status(400).json({
          error: "تعذر جلب الرتب والقنوات، تأكد أن البوت موجود في السيرفر"
        });
      }

      const [roles, channels] = await Promise.all([
        rolesResponse.json(),
        channelsResponse.json()
      ]);

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
      console.error("HERVIN Welcome Options Error:", error);

      res.status(500).json({
        error: "حدث خطأ أثناء تحميل إعدادات السيرفر"
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

    const data = loadWelcomeConfig();
    const config = data[guild.id] || {};

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

      if (
        body.welcomeChannelId &&
        !welcomeMessage
      ) {
        return res.status(400).json({
          error: "اكتب رسالة الترحيب"
        });
      }

      if (
        body.leaveChannelId &&
        !leaveMessage
      ) {
        return res.status(400).json({
          error: "اكتب رسالة المغادرة"
        });
      }

      // التحقق من أن الرتب والقنوات تابعة للسيرفر المحدد
      const headers = {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`
      };

      const [rolesResponse, channelsResponse] =
        await Promise.all([
          fetch(
            `https://discord.com/api/v10/guilds/${guild.id}/roles`,
            { headers }
          ),
          fetch(
            `https://discord.com/api/v10/guilds/${guild.id}/channels`,
            { headers }
          )
        ]);

      if (!rolesResponse.ok || !channelsResponse.ok) {
        return res.status(400).json({
          error: "تعذر التحقق من رتب وقنوات السيرفر"
        });
      }

      const [roles, channels] = await Promise.all([
        rolesResponse.json(),
        channelsResponse.json()
      ]);

      const roleIds = new Set(
        roles
          .filter(role =>
            !role.managed &&
            role.id !== guild.id
          )
          .map(role => role.id)
      );

      const textChannelIds = new Set(
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
          !textChannelIds.has(body[field])
        ) {
          return res.status(400).json({
            error: "القناة المحددة غير موجودة في السيرفر"
          });
        }
      }

      const data = loadWelcomeConfig();

      if (!data[guild.id]) {
        data[guild.id] = {};
      }

      const config = data[guild.id];

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

      saveWelcomeConfig(data);

      res.json({
        success: true,
        message: "تم حفظ إعدادات الترحيب والرتب واللوقات بنجاح"
      });

    } catch (error) {
      console.error("HERVIN Welcome Save Error:", error);

      res.status(500).json({
        error: "حدث خطأ أثناء حفظ الإعدادات"
      });
    }
  }
);
// =====================================
// HERVIN DASHBOARD
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
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #09090f;
  --panel: #12121c;
  --panel2: #191927;
  --purple: #8b5cf6;
  --purple2: #6d3de0;
  --gold: #d6b56d;
  --text: #f5f3ff;
  --muted: #9995aa;
  --border: rgba(255,255,255,.08);
  --green: #35c98a;
  --red: #ef6464;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: Arial, sans-serif;
  min-height: 100vh;
}

button, input, textarea, select {
  font-family: inherit;
}

button {
  cursor: pointer;
}

.header {
  height: 75px;
  padding: 0 5%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(18,18,28,.95);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}

.logo {
  font-size: 25px;
  font-weight: 900;
  letter-spacing: 4px;
  color: var(--gold);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.main {
  width: 92%;
  max-width: 1250px;
  margin: 35px auto;
}

.welcome-box {
  background:
    radial-gradient(circle at 90% 10%, rgba(139,92,246,.25), transparent 35%),
    linear-gradient(135deg,#171525,#11111b);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 35px;
  margin-bottom: 25px;
}

.welcome-box h1 {
  font-size: 30px;
  margin-bottom: 12px;
}

.welcome-box p {
  color: var(--muted);
  line-height: 1.8;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 22px;
}

.panel h2 {
  font-size: 20px;
  margin-bottom: 10px;
}

.description {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
  margin-bottom: 20px;
}

.btn {
  border: 0;
  border-radius: 9px;
  padding: 12px 18px;
  background: var(--purple);
  color: white;
  font-weight: bold;
  transition: .2s;
}

.btn:hover {
  background: var(--purple2);
}

.btn.gold {
  background: var(--gold);
  color: #17120a;
}

.btn.dark {
  background: var(--panel2);
  border: 1px solid var(--border);
  color: var(--text);
}

.btn.danger {
  background: rgba(239,100,100,.15);
  color: #ff8585;
  border: 1px solid rgba(239,100,100,.25);
}

.btn.success {
  background: rgba(53,201,138,.15);
  color: #55dfa5;
  border: 1px solid rgba(53,201,138,.25);
}

.login-screen {
  text-align: center;
  padding: 75px 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 18px;
}

.login-screen h2 {
  margin-bottom: 15px;
}

.login-screen p {
  color: var(--muted);
  margin-bottom: 25px;
  line-height: 1.8;
}

.dashboard-content {
  display: none;
}

.server-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  flex-wrap: wrap;
  margin-bottom: 25px;
}

.server-area label {
  color: var(--muted);
  display: block;
  margin-bottom: 8px;
}

select, input, textarea {
  width: 100%;
  background: var(--panel2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 13px;
  outline: none;
}

select:focus, input:focus, textarea:focus {
  border-color: var(--purple);
}

.server-select {
  min-width: 240px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 18px;
  margin-bottom: 25px;
}

.stat-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px;
}

.stat-card span {
  display: block;
  color: var(--muted);
  margin-bottom: 12px;
}

.stat-card strong {
  color: var(--gold);
  font-size: 23px;
}

.section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 25px;
  margin-bottom: 22px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}

.section-icon {
  width: 45px;
  height: 45px;
  border-radius: 12px;
  background: rgba(139,92,246,.15);
  color: var(--gold);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}

.section-head h2 {
  font-size: 19px;
  margin-bottom: 6px;
}

.section-head p {
  font-size: 13px;
  color: var(--muted);
}

.reply-form {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 18px;
  margin-bottom: 22px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 9px;
  font-size: 14px;
  color: #d5d0e5;
}

textarea {
  resize: vertical;
  min-height: 110px;
  line-height: 1.7;
}

.reply-message {
  color: var(--muted);
  font-size: 14px;
  margin: 12px 0;
  line-height: 1.7;
}

.reply-list {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.reply-item {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 17px;
}

.reply-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.reply-trigger {
  color: var(--gold);
  font-weight: bold;
  overflow-wrap: anywhere;
}

.reply-status {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 20px;
}

.reply-status.active {
  color: #55dfa5;
  background: rgba(53,201,138,.12);
}

.reply-status.disabled {
  color: #ff8585;
  background: rgba(239,100,100,.12);
}

.reply-response {
  color: #c4bfd2;
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-bottom: 15px;
}

.reply-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reply-actions .btn {
  padding: 9px 13px;
  font-size: 12px;
}

.empty-state {
  text-align: center;
  padding: 25px;
  color: var(--muted);
  background: var(--panel2);
  border-radius: 12px;
  line-height: 1.8;
}

.hidden {
  display: none !important;
}

.footer {
  text-align: center;
  color: var(--muted);
  padding: 30px 15px;
  font-size: 12px;
}

@media(max-width:700px) {
  .header {
    padding: 0 4%;
    height: 65px;
  }

  .logo {
    font-size: 21px;
  }

  .main {
    width: 94%;
    margin-top: 20px;
  }

  .welcome-box {
    padding: 23px;
  }

  .welcome-box h1 {
    font-size: 24px;
  }

  .panel, .section {
    padding: 17px;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .server-area {
    align-items: stretch;
    flex-direction: column;
  }

  .server-select {
    min-width: 0;
  }

  .reply-actions .btn {
    flex: 1;
  }
}
</style>
</head>

<body>

<header class="header">
  <div class="logo">HERVIN</div>

  <div class="header-actions">
    <button class="btn dark" onclick="logout()">
      تسجيل الخروج
    </button>
  </div>
</header>

<main class="main">

  <div class="welcome-box">
    <h1>مرحباً بك في HERVIN</h1>
    <p>
      لوحة التحكم الرسمية لإدارة بوت HERVIN
      والتحكم في أنظمة السيرفر الخاص بك
    </p>
  </div>

  <div class="login-screen" id="loginScreen">
    <h2>تسجيل الدخول إلى HERVIN</h2>

    <p>
      سجل دخولك باستخدام Discord للوصول إلى لوحة التحكم
      <br>
      يجب أن تكون مالك السيرفر أو لديك صلاحية Administrator
    </p>

    <button class="btn gold" onclick="login()">
      تسجيل الدخول عبر Discord
    </button>
  </div>

  <div class="dashboard-content" id="dashboardContent">

    <div class="server-area">
      <div>
        <label>السيرفر المحدد</label>

        <select
          class="server-select"
          id="serverSelect"
          onchange="selectServer()"
        >
          <option value="">اختر السيرفر</option>
        </select>
      </div>

      <button class="btn dark" onclick="loadGuilds()">
        تحديث السيرفرات
      </button>
    </div>

    <div class="dashboard-grid">

      <div class="stat-card">
        <span>حالة لوحة التحكم</span>
        <strong>متصلة</strong>
      </div>

      <div class="stat-card">
        <span>النظام</span>
        <strong>HERVIN BOT</strong>
      </div>

    </div>

    <section class="section" id="replies">

      <div class="section-head">
        <div class="section-icon">✉</div>

        <div>
          <h2>الردود التلقائية</h2>
          <p>إدارة ردود HERVIN الذكية</p>
        </div>
      </div>

      <p class="description">
        أضف كلمات تفعيل واجعل HERVIN يرد عليها تلقائياً
        ويمكنك تعديل الردود أو حذفها أو إيقافها
      </p>

      <div class="reply-form">

        <div class="form-group">
          <label for="replyTrigger">
            كلمة التفعيل
          </label>

          <input
            id="replyTrigger"
            type="text"
            maxlength="80"
            placeholder="مثال: السلام عليكم"
          >
        </div>

        <div class="form-group">
          <label for="replyResponse">
            نص الرد
          </label>

          <textarea
            id="replyResponse"
            maxlength="1900"
            placeholder="اكتب الرد الذي سيظهر من البوت..."
          ></textarea>
        </div>

        <div class="reply-actions">
          <button
            class="btn gold"
            id="replySaveButton"
            onclick="saveReply()"
          >
            إضافة الرد
          </button>

          <button
            class="btn dark hidden"
            id="replyCancelButton"
            onclick="cancelReplyEdit()"
          >
            إلغاء التعديل
          </button>
        </div>

        <div
          class="reply-message"
          id="replyMessage"
          aria-live="polite"
        ></div>

      </div>

      <h3 style="margin-bottom:15px">
        الردود المحفوظة
      </h3>

      <div id="replyList" class="reply-list">

        <div class="empty-state">
          اختر سيرفرًا لعرض الردود
        </div>

      </div>

    </section>

    <section class="section">

      <div class="section-head">
        <div class="section-icon">⚙</div>

        <div>
          <h2>إعدادات HERVIN</h2>
          <p>أقسام لوحة التحكم</p>
        </div>
      </div>

      <div class="empty-state">
        سيتم تفعيل بقية أنظمة لوحة التحكم وربطها
        تدريجيًا
      </div>

    </section>

  </div>

</main>

<footer class="footer">
  HERVIN DASHBOARD © 2026
</footer>

<script>

// =====================================
// HERVIN DASHBOARD JAVASCRIPT
// =====================================

let selectedGuildId = null;
let replies = [];
let editingTrigger = null;

// =====================================
// API HELPER
// =====================================

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error || "حدث خطأ أثناء تنفيذ الطلب"
    );
  }

  return data;
}

// =====================================
// LOGIN
// =====================================

function login() {
  window.location.href = "/auth/discord";
}

// =====================================
// DASHBOARD
// =====================================

async function loadDashboard() {
  try {
    const data = await api("/api/me");

    if (!data.loggedIn) {
      showLogin();
      return;
    }

    document.getElementById("loginScreen").style.display = "none";

    document.getElementById("dashboardContent").style.display = "block";

    await loadGuilds();

  } catch (error) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "block";

  document.getElementById("dashboardContent").style.display = "none";
}

// =====================================
// LOAD SERVERS
// =====================================

async function loadGuilds() {
  const select = document.getElementById("serverSelect");

  try {
    const guilds = await api("/api/guilds");

    select.replaceChildren();

    const defaultOption = document.createElement("option");

    defaultOption.value = "";
    defaultOption.textContent = "اختر السيرفر";

    select.appendChild(defaultOption);

    guilds.forEach(guild => {
      const option = document.createElement("option");

      option.value = guild.id;
      option.textContent = guild.name;

      select.appendChild(option);
    });

    const me = await api("/api/me");

    if (
      me.selectedGuild &&
      guilds.some(guild => guild.id === me.selectedGuild.id)
    ) {
      selectedGuildId = me.selectedGuild.id;
      select.value = selectedGuildId;

      await loadReplies();

    } else {
      selectedGuildId = null;
      replies = [];

      renderReplies();
    }

  } catch (error) {
    showReplyMessage(error.message, true);
  }
}

// =====================================
// SELECT SERVER
// =====================================

async function selectServer() {
  const guildId = document.getElementById("serverSelect").value;

  if (!guildId) {
    selectedGuildId = null;
    replies = [];

    cancelReplyEdit();
    renderReplies();

    return;
  }

  try {
    await api("/api/select-server", {
      method: "POST",

      body: JSON.stringify({
        guildId
      })
    });

    selectedGuildId = guildId;

    cancelReplyEdit();

    await loadReplies();

  } catch (error) {
    showReplyMessage(error.message, true);
  }
}

// =====================================
// LOAD REPLIES
// =====================================

async function loadReplies() {
  const list = document.getElementById("replyList");

  if (!selectedGuildId) {
    replies = [];
    renderReplies();
    return;
  }

  list.textContent = "جاري تحميل الردود...";

  try {
    const data = await api("/api/replies");

    replies = Array.isArray(data.replies)
      ? data.replies
      : [];

    renderReplies();

  } catch (error) {
    list.textContent = error.message;
  }
}

// =====================================
// RENDER REPLIES
// =====================================

function renderReplies() {
  const list = document.getElementById("replyList");

  list.replaceChildren();

  if (!selectedGuildId) {
    const empty = document.createElement("div");

    empty.className = "empty-state";
    empty.textContent = "اختر سيرفرًا أولاً لعرض الردود";

    list.appendChild(empty);
    return;
  }

  if (!replies.length) {
    const empty = document.createElement("div");

    empty.className = "empty-state";
    empty.textContent = "لا توجد ردود محفوظة في هذا السيرفر حتى الآن";

    list.appendChild(empty);
    return;
  }

  replies.forEach(reply => {
    const item = document.createElement("div");

    item.className = "reply-item";

    const top = document.createElement("div");

    top.className = "reply-top";

    const trigger = document.createElement("div");

    trigger.className = "reply-trigger";
    trigger.textContent = "الكلمة: " + reply.trigger;

    const status = document.createElement("span");

    status.className = "reply-status " +
      (reply.enabled === false ? "disabled" : "active");

    status.textContent = reply.enabled === false
      ? "متوقف"
      : "مفعل";

    top.append(trigger, status);

    const response = document.createElement("div");

    response.className = "reply-response";
    response.textContent = reply.response;

    const actions = document.createElement("div");

    actions.className = "reply-actions";

    const editButton = document.createElement("button");

    editButton.className = "btn dark";
    editButton.textContent = "تعديل";

    editButton.addEventListener("click", () => {
      startReplyEdit(reply);
    });

    const toggleButton = document.createElement("button");

    toggleButton.className = "btn " +
      (reply.enabled === false ? "success" : "dark");

    toggleButton.textContent = reply.enabled === false
      ? "تفعيل"
      : "إيقاف";

    toggleButton.addEventListener("click", () => {
      toggleReply(reply);
    });

    const deleteButton = document.createElement("button");

    deleteButton.className = "btn danger";
    deleteButton.textContent = "حذف";

    deleteButton.addEventListener("click", () => {
      deleteReply(reply);
    });

    actions.append(
      editButton,
      toggleButton,
      deleteButton
    );

    item.append(
      top,
      response,
      actions
    );

    list.appendChild(item);
  });
}

// =====================================
// ADD REPLY
// =====================================

async function saveReply() {
  const triggerInput = document.getElementById("replyTrigger");

  const responseInput = document.getElementById("replyResponse");

  const trigger = triggerInput.value.trim();

  const response = responseInput.value.trim();

  if (!selectedGuildId) {
    showReplyMessage("اختر سيرفرًا أولاً", true);
    return;
  }

  if (!trigger || !response) {
    showReplyMessage("اكتب كلمة التفعيل والرد", true);
    return;
  }

  const button = document.getElementById("replySaveButton");

  button.disabled = true;

  try {
    if (editingTrigger !== null) {
      await api("/api/replies", {
        method: "POST",

        body: JSON.stringify({
          action: "edit",
          oldTrigger: editingTrigger,
          trigger,
          response
        })
      });

      showReplyMessage("تم تعديل الرد بنجاح");

    } else {
      await api("/api/replies", {
        method: "POST",

        body: JSON.stringify({
          action: "add",
          trigger,
          response
        })
      });

      showReplyMessage("تمت إضافة الرد بنجاح");
    }

    triggerInput.value = "";
    responseInput.value = "";

    cancelReplyEdit();

    await loadReplies();

  } catch (error) {
    showReplyMessage(error.message, true);

  } finally {
    button.disabled = false;
  }
}

// =====================================
// EDIT REPLY
// =====================================

function startReplyEdit(reply) {
  editingTrigger = reply.trigger;

  document.getElementById("replyTrigger").value = reply.trigger;

  document.getElementById("replyResponse").value = reply.response;

  document.getElementById("replySaveButton").textContent = "حفظ التعديل";

  document.getElementById("replyCancelButton").classList.remove("hidden");

  showReplyMessage("أنت الآن تعدل الرد المحدد");
}

function cancelReplyEdit() {
  editingTrigger = null;

  document.getElementById("replyTrigger").value = "";

  document.getElementById("replyResponse").value = "";

  document.getElementById("replySaveButton").textContent = "إضافة الرد";

  document.getElementById("replyCancelButton").classList.add("hidden");
}

// =====================================
// TOGGLE REPLY
// =====================================

async function toggleReply(reply) {
  try {
    await api("/api/replies", {
      method: "POST",

      body: JSON.stringify({
        action: "toggle",
        trigger: reply.trigger,
        enabled: reply.enabled === false
      })
    });

    showReplyMessage("تم تحديث حالة الرد");

    await loadReplies();

  } catch (error) {
    showReplyMessage(error.message, true);
  }
}

// =====================================
// DELETE REPLY
// =====================================

async function deleteReply(reply) {
  const confirmed = confirm(
    "هل أنت متأكد من حذف الرد: " + reply.trigger + " ؟"
  );

  if (!confirmed) return;

  try {
    await api("/api/replies", {
      method: "POST",

      body: JSON.stringify({
        action: "delete",
        trigger: reply.trigger
      })
    });

    if (editingTrigger === reply.trigger) {
      cancelReplyEdit();
    }

    showReplyMessage("تم حذف الرد بنجاح");

    await loadReplies();

  } catch (error) {
    showReplyMessage(error.message, true);
  }
}

// =====================================
// STATUS MESSAGE
// =====================================

function showReplyMessage(message, isError = false) {
  const element = document.getElementById("replyMessage");

  element.textContent = message;

  element.style.color = isError
    ? "#ff8585"
    : "#55dfa5";
}

// =====================================
// LOGOUT
// =====================================

async function logout() {
  try {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch (error) {
    console.error("Logout error:", error);
  }

  window.location.href = "/";
}

// =====================================
// START
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
    success: true
  });
});

// =====================================
// START SERVER
// =====================================

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("HERVIN Dashboard is running");
});
