const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());

// تشغيل بوت HERVIN
require("./index");

// =====================================
// HERVIN DISCORD OAUTH SYSTEM
// =====================================

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

const REDIRECT_URI =
  "https://hervin-dashboard.onrender.com/auth/discord/callback";

const sessions = new Map();
const loginStates = new Map();

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

// فحص المتغيرات عند تشغيل الموقع
console.log("=================================");
console.log("HERVIN OAUTH ENV CHECK:", {
  CLIENT_ID: Boolean(CLIENT_ID),
  CLIENT_SECRET: Boolean(CLIENT_SECRET),
  SESSION_SECRET: Boolean(SESSION_SECRET)
});
console.log("=================================");

function createSignature(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("hex");
}

function getSession(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)hervin_session=([^;]+)/);

  if (!match) return null;

  const parts = match[1].split(".");

  if (parts.length !== 2) return null;

  const [sessionId, signature] = parts;

  let expected;

  try {
    expected = createSignature(sessionId);

    const receivedBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
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

// =====================================
// DISCORD LOGIN
// =====================================

app.get("/auth/discord", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) {
    console.log("OAuth ENV CHECK:", {
      CLIENT_ID: Boolean(CLIENT_ID),
      CLIENT_SECRET: Boolean(CLIENT_SECRET),
      SESSION_SECRET: Boolean(SESSION_SECRET)
    });

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
    "https://discord.com/oauth2/authorize?" + params.toString()
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

    // السيرفرات التي المستخدم مالكها فقط
    const ownedGuilds = allGuilds.filter(
      guild => guild.owner === true
    );

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
// GET USER INFORMATION
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
// GET OWNED SERVERS
// =====================================

app.get("/api/guilds", requireSession, (req, res) => {
  const session = req.hervinSession;

  res.json(
    session.guilds.map(guild => ({
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

  const guild = session.guilds.find(
    item => item.id === guildId && item.owner === true
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
// LOGOUT
// =====================================

app.post("/auth/logout", (req, res) => {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)hervin_session=([^;]+)/);

  if (match) {
    const sessionId = match[1].split(".")[0];
    sessions.delete(sessionId);
  }

  res.setHeader(
    "Set-Cookie",
    "hervin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ success: true });
});

// =====================================
// HERVIN DASHBOARD
// =====================================

app.get("/", (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HERVIN | Dashboard</title>

<style>
*{box-sizing:border-box}

:root{
--bg:#030512;
--card:#080b1b;
--purple:#211b45;
--purple2:#17132f;
--gold:#d9b84f;
--white:#fff;
--muted:#a7a8b5;
--border:#171b2d;
}

body{
margin:0;
background:var(--bg);
color:var(--white);
font-family:Arial,sans-serif;
}

.header{
height:125px;
background:#03040d;
border-bottom:1px solid #292a38;
display:flex;
align-items:center;
justify-content:space-between;
padding:0 25px;
position:sticky;
top:0;
z-index:10;
}

.header-left,.header-right{
display:flex;
align-items:center;
gap:12px;
}

.logo{
position:absolute;
left:50%;
transform:translateX(-50%);
font-size:27px;
font-weight:bold;
letter-spacing:3px;
color:var(--gold);
}

.icon-btn{
width:66px;
height:66px;
border-radius:23px;
background:#111225;
border:1px solid #25263a;
color:white;
font-size:25px;
cursor:pointer;
}

.avatar{
width:55px;
height:55px;
border-radius:50%;
background:var(--purple);
display:grid;
place-items:center;
color:var(--gold);
font-weight:bold;
}

.menu{
position:absolute;
top:105px;
left:20px;
width:230px;
background:#101124;
border:1px solid #292940;
border-radius:15px;
padding:12px;
display:none;
}

.menu.show{display:block}

.menu a{
display:block;
padding:13px;
color:#ddd;
text-decoration:none;
border-radius:9px;
}

.menu a:hover{background:var(--purple)}

main{
max-width:1100px;
margin:auto;
padding:25px 24px 60px;
}

.page-title{
display:flex;
align-items:center;
justify-content:space-between;
margin:10px 0 25px;
}

.page-title h1{
font-size:28px;
margin:0;
}

.page-title p{
color:var(--muted);
margin:10px 0 0;
}

.status{
background:#151c27;
color:#9ce5ad;
padding:10px 15px;
border-radius:20px;
font-size:13px;
}

.section{
background:var(--card);
border:1px solid var(--border);
border-radius:23px;
padding:35px 40px;
margin-bottom:35px;
}

.section-head{
display:flex;
align-items:center;
gap:18px;
margin-bottom:40px;
}

.section-icon{
width:80px;
height:80px;
border-radius:23px;
background:#15112f;
display:grid;
place-items:center;
color:var(--gold);
font-size:33px;
}

.section-head h2{
font-size:31px;
margin:0;
}

.section-head p{
color:var(--muted);
font-size:18px;
margin:12px 0 0;
}

.field{margin-bottom:35px}

.field label{
display:block;
font-size:20px;
color:#b9b9c5;
margin-bottom:20px;
}

select,input{
width:100%;
height:68px;
padding:0 20px;
border:1px solid #33354b;
border-radius:12px;
background:var(--purple);
color:white;
font-size:19px;
outline:none;
}

select option{background:#15112f}

.preview{
background:#10142c;
border:1px solid #292d46;
border-right:5px solid #a7a7ae;
border-radius:13px;
padding:24px;
display:flex;
align-items:center;
justify-content:space-between;
gap:15px;
margin-top:15px;
}

.preview h3{
font-size:22px;
margin:0 0 12px;
}

.preview p{
color:#c2c2cf;
margin:0;
font-size:18px;
}

.preview-icon{
width:55px;
height:55px;
border:4px solid #41445e;
border-radius:10px;
background:#aaa;
flex-shrink:0;
}

.hint{
color:#888b9e;
font-size:16px;
line-height:1.8;
margin-top:18px;
}

.role-box{
min-height:75px;
padding:12px;
border:2px solid #34364e;
background:#15132e;
border-radius:10px;
display:flex;
align-items:center;
justify-content:space-between;
gap:10px;
}

.role-tag{
background:#30303b;
border-radius:10px;
padding:12px 15px;
display:flex;
align-items:center;
gap:15px;
color:white;
}

.role-dot{
width:25px;
height:25px;
border-radius:50%;
background:#cdb6e9;
}

.actions{
display:flex;
gap:20px;
}

.actions button{
background:transparent;
border:0;
color:#ddd;
font-size:27px;
cursor:pointer;
}

button.save{
background:var(--purple);
color:var(--gold);
padding:13px 25px;
border:1px solid #39305f;
border-radius:10px;
font-size:16px;
cursor:pointer;
}

.stats{
display:grid;
grid-template-columns:repeat(3,1fr);
gap:15px;
margin-bottom:30px;
}

.stat{
background:var(--card);
border:1px solid var(--border);
border-radius:17px;
padding:22px;
}

.stat p{color:var(--muted)}
.stat h2{color:var(--gold)}

footer{
text-align:center;
padding:25px;
color:#77798c;
}

/* LOGIN AND SERVER SELECTOR */

#loginPanel{
max-width:600px;
margin:60px auto;
padding:35px;
background:var(--card);
border:1px solid var(--border);
border-radius:23px;
text-align:center;
}

#loginPanel h1{
color:var(--gold);
font-size:30px;
}

#loginPanel p{
color:var(--muted);
line-height:1.8;
}

.discord-login{
display:block;
width:100%;
padding:18px;
margin-top:25px;
background:#5865F2;
color:white;
border:0;
border-radius:12px;
font-size:18px;
font-weight:bold;
text-decoration:none;
cursor:pointer;
}

#dashboardContent{display:none}

#serverArea{
background:var(--card);
border:1px solid var(--border);
border-radius:17px;
padding:20px;
margin-bottom:25px;
}

#serverArea label{
display:block;
margin-bottom:12px;
color:var(--gold);
}

#serverSelect{width:100%}

#userArea{
display:flex;
align-items:center;
gap:10px;
color:var(--gold);
font-size:14px;
}

#logoutBtn{
background:#2b1723;
color:#ff9a9a;
border:1px solid #57303d;
padding:10px 15px;
border-radius:10px;
cursor:pointer;
}

#loginMessage{
color:#e8c76c;
margin-top:15px;
}

@media(max-width:650px){
.header{height:60px;padding:0 9px}
.logo{font-size:17px}
.icon-btn{width:34px;height:34px;font-size:17px}
.avatar{width:30px;height:30px;font-size:15px}

main{padding:9px 8px 20px}

.page-title{margin-bottom:12px}
.page-title h1{font-size:17px}
.page-title p{font-size:11px}
.status{font-size:9px;padding:5px 7px}

.section{
padding:12px 10px;
margin-bottom:10px;
border-radius:11px;
}

.section-head{
gap:8px;
margin-bottom:12px;
}

.section-head h2{font-size:15px}
.section-head p{font-size:10px;margin-top:3px}

.section-icon{
width:34px;
height:34px;
font-size:16px;
border-radius:9px;
}

.field{margin-bottom:11px}
.field label{font-size:12px;margin-bottom:6px}

select,input{
height:36px;
font-size:12px;
padding:5px 9px;
}

.preview{padding:9px;border-radius:9px}
.preview h3{font-size:13px}
.preview p{font-size:11px}

.stats{
grid-template-columns:repeat(2,1fr);
gap:6px;
margin-bottom:12px;
}

.stat{
padding:9px;
border-radius:9px;
}

.stat p{font-size:10px}
.stat h2{font-size:16px}

.save{
padding:9px 14px;
font-size:12px;
}

.hint{font-size:10px}
.role-box{padding:8px}
footer{padding:15px;font-size:10px}

#loginPanel{
margin:25px 8px;
padding:20px;
}

#loginPanel h1{font-size:22px}
#loginPanel p{font-size:13px}
.discord-login{font-size:14px;padding:13px}

#userArea{font-size:10px}
#logoutBtn{font-size:11px;padding:7px}
}
</style>
</head>

<body>

<header class="header">

<div class="header-left">
<div class="avatar">H</div>
</div>

<div class="logo">𝐇𝐄𝐑𝐕𝐈𝐍</div>

<div class="header-right">
<div id="userArea" style="display:none">
<span id="usernameDisplay"></span>
<button id="logoutBtn" onclick="logout()">خروج</button>
</div>

<button class="icon-btn" onclick="toggleMenu()">☰</button>
</div>

<nav class="menu" id="menu">
<a href="#home">الرئيسية</a>
<a href="#basics">الأساسيات</a>
<a href="#roles">الرتب التلقائية</a>
<a href="#security">الحماية والأمان</a>
<a href="#moderation">الإشراف والعقوبات</a>
<a href="#replies">الردود التلقائية</a>
<a href="#tickets">التذاكر</a>
<a href="#welcome">الترحيب</a>
<a href="#levels">المستويات والنقاط</a>
<a href="#logs">السجلات</a>
</nav>

</header>

<div id="loginPanel">
<h1>𝐇𝐄𝐑𝐕𝐈𝐍</h1>
<p>مرحباً بك في لوحة تحكم HERVIN</p>
<p>سجّل دخولك باستخدام Discord لإدارة السيرفرات التي تملكها</p>

<a class="discord-login" href="/auth/discord">
تسجيل الدخول باستخدام Discord
</a>

<p id="loginMessage"></p>
</div>

<main id="dashboardContent">

<div class="page-title">
<div>
<h1>لوحة تحكم HERVIN</h1>
<p>إدارة إعدادات البوت والسيرفر</p>
</div>
<div class="status">● الواجهة تعمل</div>
</div>

<div id="serverArea">
<label>السيرفر الذي تريد إدارته</label>

<select id="serverSelect">
<option value="">جاري تحميل السيرفرات...</option>
</select>

<p class="hint" id="serverMessage">
اختر سيرفراً تملكه حتى تتمكن من إدارته
</p>
</div>

<div class="stats">
<div class="stat">
<p>حالة اللوحة</p>
<h2>نشطة</h2>
</div>
<div class="stat">
<p>أنظمة البوت</p>
<h2>9</h2>
</div>
<div class="stat">
<p>الإصدار</p>
<h2>1.0</h2>
</div>
</div>

<section class="section" id="basics">
<div class="section-head">
<div class="section-icon">⚙</div>
<div>
<h2>الأساسيات</h2>
<p>إعدادات أساسية للسيرفر</p>
</div>
</div>

<div class="field">
<label>لغة البوت</label>
<select>
<option>العربية 🇸🇦</option>
<option>English 🇺🇸</option>
</select>
</div>

<div class="field">
<label>لون الامبد الافتراضي</label>
<div class="preview">
<div>
<h3>مثال على عنوان الامبد</h3>
<p>مثال على وصف الامبد</p>
</div>
<div class="preview-icon"></div>
</div>
<p class="hint">
هذا اللون سيستخدم في جميع رسائل الامبد الافتراضية من البوت
</p>
</div>

<button class="save">حفظ الإعدادات</button>
</section>

<section class="section" id="roles">
<div class="section-head">
<div class="section-icon">♟</div>
<div>
<h2>الرتب التلقائية</h2>
<p>رتب تمنح تلقائياً للأعضاء الجدد</p>
</div>
</div>

<div class="field">
<label>👥 رتب المستخدمين</label>
<div class="role-box">
<div class="actions">
<button>⌄</button>
<button>×</button>
</div>
<div class="role-tag">
<span>MEMBER</span>
<span class="role-dot"></span>
</div>
</div>
<p class="hint">الرتب التي سيحصل عليها المستخدمون الجدد تلقائياً</p>
</div>

<div class="field">
<label>🤖 رتب البوتات</label>
<div class="role-box">
<div class="actions">
<button>⌄</button>
<button>×</button>
</div>
<div class="role-tag">
<span>BOT</span>
<span class="role-dot" style="background:#ddd"></span>
</div>
</div>
<p class="hint">الرتب التي ستحصل عليها البوتات الجديدة تلقائياً</p>
</div>

<button class="save">حفظ الإعدادات</button>
</section>

<section class="section" id="security">
<div class="section-head">
<div class="section-icon">♜</div>
<div>
<h2>الحماية والأمان</h2>
<p>حماية السيرفر من التخريب والغارات</p>
</div>
</div>
<div class="field">
<label>مكافحة السبام</label>
<select><option>معطل</option><option>مفعل</option></select>
</div>
<div class="field">
<label>مكافحة الغارات Anti-Raid</label>
<select><option>معطل</option><option>مفعل</option></select>
</div>
</section>

<section class="section" id="moderation">
<div class="section-head">
<div class="section-icon">⚖</div>
<div>
<h2>الإشراف والعقوبات</h2>
<p>إدارة أعضاء السيرفر والعقوبات</p>
</div>
</div>
<p class="hint">الحظر، الطرد، الكتم، التحذيرات وإدارة المخالفات</p>
</section>

<section class="section" id="replies">
<div class="section-head">
<div class="section-icon">✉</div>
<div>
<h2>الردود التلقائية</h2>
<p>إدارة ردود HERVIN الذكية</p>
</div>
</div>
</section>

<section class="section" id="tickets">
<div class="section-head">
<div class="section-icon">▤</div>
<div>
<h2>التذاكر</h2>
<p>إعداد نظام التذاكر والدعم الفني</p>
</div>
</div>
</section>

<section class="section" id="welcome">
<div class="section-head">
<div class="section-icon">♔</div>
<div>
<h2>الترحيب</h2>
<p>رسائل وصور الترحيب والمغادرة</p>
</div>
</div>
</section>

<section class="section" id="levels">
<div class="section-head">
<div class="section-icon">★</div>
<div>
<h2>المستويات والنقاط</h2>
<p>إعداد الخبرة والمكافآت</p>
</div>
</div>
</section>

<section class="section" id="logs">
<div class="section-head">
<div class="section-icon">▣</div>
<div>
<h2>السجلات</h2>
<p>متابعة جميع الأحداث داخل السيرفر</p>
</div>
</div>
</section>

<footer>
𝐇𝐄𝐑𝐕𝐈𝐍 © 2026
</footer>

</main>

<script>
function toggleMenu(){
  document.getElementById("menu").classList.toggle("show");
}

document.querySelectorAll(".menu a").forEach(link=>{
  link.addEventListener("click",()=>{
    document.getElementById("menu").classList.remove("show");
  });
});

async function loadDashboard(){
  const loginPanel = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboardContent");
  const userArea = document.getElementById("userArea");

  try {
    const response = await fetch("/api/me");

    if (!response.ok) {
      loginPanel.style.display = "block";
      dashboard.style.display = "none";
      return;
    }

    const data = await response.json();

    loginPanel.style.display = "none";
    dashboard.style.display = "block";
    userArea.style.display = "flex";

    document.getElementById("usernameDisplay").textContent =
      data.user.username;

    await loadGuilds(data.selectedGuild?.id);

  } catch (error) {
    document.getElementById("loginMessage").textContent =
      "تعذر الاتصال بالخادم، حاول تحديث الصفحة";
  }
}

async function loadGuilds(selectedId){
  const select = document.getElementById("serverSelect");
  const message = document.getElementById("serverMessage");

  try {
    const response = await fetch("/api/guilds");

    if (!response.ok) {
      message.textContent = "تعذر تحميل السيرفرات";
      return;
    }

    const guilds = await response.json();

    select.innerHTML = "";

    if (!guilds.length) {
      select.innerHTML =
        '<option value="">لا تملك أي سيرفرات</option>';

      message.textContent =
        "يجب أن تكون مالك السيرفر حتى يظهر هنا";

      return;
    }

    select.innerHTML =
      '<option value="">اختر السيرفر</option>';

    guilds.forEach(guild => {
      const option = document.createElement("option");

      option.value = guild.id;
      option.textContent = guild.name;

      select.appendChild(option);
    });

    if (selectedId) {
      select.value = selectedId;
    }

  } catch (error) {
    message.textContent = "حدث خطأ أثناء تحميل السيرفرات";
  }
}

document.getElementById("serverSelect").addEventListener(
  "change",
  async function(){
    const guildId = this.value;
    const message = document.getElementById("serverMessage");

    if (!guildId) return;

    message.textContent = "جاري التحقق من ملكية السيرفر...";

    try {
      const response = await fetch("/api/select-server", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ guildId })
      });

      const data = await response.json();

      if (!response.ok) {
        message.textContent = data.error || "تعذر اختيار السيرفر";
        return;
      }

      message.textContent =
        "تم اختيار السيرفر: " + data.selectedGuild.name;

    } catch (error) {
      message.textContent = "حدث خطأ أثناء اختيار السيرفر";
    }
  }
);

async function logout(){
  try {
    await fetch("/auth/logout", {
      method: "POST"
    });

    window.location.reload();

  } catch (error) {
    alert("تعذر تسجيل الخروج");
  }
}

loadDashboard();
</script>

</body>
</html>`);
});

// =====================================
// START SERVER
// =====================================

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("HERVIN Dashboard is running");
});
