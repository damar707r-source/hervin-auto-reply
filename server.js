
const express = require("express");
const app = express();

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

.field{
margin-bottom:35px;
}

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

select option{
background:#15112f;
}

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


@media(max-width:650px){
.header{height:75px;padding:0 12px}
.logo{font-size:20px}
.icon-btn{width:42px;height:42px}
.avatar{width:36px;height:36px}
main{padding:12px 10px 25px}
.section{padding:16px 13px;margin-bottom:14px}
.section-head{gap:10px;margin-bottom:16px}
.section-head h2{font-size:18px}
.section-head p{font-size:12px}
.section-icon{width:43px;height:43px;font-size:19px}
.field{margin-bottom:15px}
.field label{font-size:14px;margin-bottom:8px}
select,input{height:43px;font-size:14px}
.preview{padding:12px}
.preview h3{font-size:15px}
.preview p{font-size:13px}
.stats{grid-template-columns:repeat(2,1fr);gap:8px}
.stat{padding:12px;border-radius:12px}
.stat h2{font-size:19px}
.page-title h1{font-size:20px}
.status{font-size:10px}
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

<main id="home">

<div class="page-title">
<div>
<h1>لوحة تحكم HERVIN</h1>
<p>إدارة إعدادات البوت والسيرفر</p>
</div>
<div class="status">● الواجهة تعمل</div>
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
</script>

</body>
</html>`);
});

app.listen(process.env.PORT || 3000, "0.0.0.0");
