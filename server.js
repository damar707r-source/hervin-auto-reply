
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HERVIN | لوحة التحكم</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#090b12;color:#fff;font-family:Arial,sans-serif}
.layout{display:flex;min-height:100vh}
.sidebar{width:245px;background:#101521;padding:25px 15px;border-left:1px solid #252d3e}
.logo{text-align:center;font-size:27px;font-weight:bold;color:#a78bfa;margin:15px 0 35px}
.menu a{display:block;padding:14px;margin:7px 0;color:#aeb7ca;text-decoration:none;border-radius:10px}
.menu a.active,.menu a:hover{background:#27213e;color:#c4a8ff}
main{flex:1;padding:30px;min-width:0}
.top{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}
h1{font-size:25px;margin:0}
.muted{color:#929db2;margin-top:10px}
.status{background:#123528;color:#69e3a4;padding:10px 16px;border-radius:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:35px}
.card{background:#141b29;border:1px solid #273247;border-radius:15px;padding:22px}
.card p{color:#9ca8bc;margin:0 0 15px}
.card h2{font-size:25px;margin:0;color:#c4a8ff}
.section{margin-top:30px;background:#141b29;border:1px solid #273247;padding:23px;border-radius:15px}
.section h3{margin-top:0}
.section p{color:#aab4c7;line-height:1.8}
button{background:#8061d9;border:0;color:white;padding:12px 18px;border-radius:9px;font-size:15px}
@media(max-width:650px){
.layout{display:block}
.sidebar{width:100%;padding:15px}
.logo{margin:8px 0 18px}
.menu{display:flex;overflow-x:auto;gap:5px}
.menu a{white-space:nowrap;margin:0;padding:11px}
main{padding:20px 14px}
}
</style>
</head>
<body>
<div class="layout">
<aside class="sidebar">
<div class="logo">𝐇𝐄𝐑𝐕𝐈𝐍</div>
<nav class="menu">
<a class="active" href="/">الرئيسية</a>
<a href="#security">الحماية والأمان</a>
<a href="#moderation">الإشراف والعقوبات</a>
<a href="#replies">الردود التلقائية</a>
<a href="#tickets">التذاكر</a>
<a href="#welcome">الترحيب</a>
<a href="#levels">المستويات والنقاط</a>
<a href="#logs">السجلات</a>
<a href="#settings">الإعدادات</a>
</nav>
</aside>
<main>
<div class="top">
<div>
<h1>لوحة تحكم HERVIN</h1>
<p class="muted">مرحباً بك في مركز إدارة السيرفر</p>
</div>
<div class="status">● الواجهة تعمل</div>
</div>
<div class="cards">
<div class="card"><p>حالة لوحة التحكم</p><h2>نشطة</h2></div>
<div class="card"><p>أنظمة الإدارة</p><h2>9</h2></div>
<div class="card"><p>إصدار المشروع</p><h2>1.0</h2></div>
</div>
<div class="section" id="security">
<h3>الحماية والأمان</h3>
<p>إعدادات مكافحة السبام والغارات والحماية من التخريب.</p>
<button>قريباً</button>
</div>
<div class="section" id="moderation">
<h3>الإشراف والعقوبات</h3>
<p>إدارة الحظر والطرد والتحذيرات وكتم الأعضاء.</p>
</div>
<div class="section" id="replies">
<h3>الردود التلقائية</h3>
<p>إدارة الكلمات والردود الخاصة ببوت HERVIN.</p>
</div>
<div class="section" id="tickets">
<h3>نظام التذاكر</h3>
<p>إعداد الأقسام والرتب ورسائل التذاكر.</p>
</div>
<div class="section" id="welcome">
<h3>الترحيب</h3>
<p>إعداد رسائل وصور الترحيب والمغادرة.</p>
</div>
<div class="section" id="levels">
<h3>المستويات والنقاط</h3>
<p>إعداد الخبرة والمكافآت وترقيات الأعضاء.</p>
</div>
<div class="section" id="logs">
<h3>السجلات</h3>
<p>متابعة الأحداث والتغييرات داخل السيرفر.</p>
</div>
<div class="section" id="settings">
<h3>الإعدادات</h3>
<p>إعدادات لوحة التحكم والبوت.</p>
</div>
</main>
</div>
</body>
</html>`);
});

app.listen(process.env.PORT || 3000, "0.0.0.0");
