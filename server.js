const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>HERVIN Dashboard</title>
      <style>
        body {
          margin: 0;
          background: #090b12;
          color: white;
          font-family: Arial;
          text-align: center;
          padding: 40px 15px;
        }
        .card {
          max-width: 500px;
          margin: 30px auto;
          padding: 30px;
          background: #151925;
          border: 1px solid #30394d;
          border-radius: 18px;
        }
        h1 { color: #a78bfa; }
        p { color: #b8bfd0; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>𝐇𝐄𝐑𝐕𝐈𝐍</h1>
        <h2>لوحة التحكم</h2>
        <p>مرحباً بك في نظام إدارة HERVIN</p>
        <p>Dashboard is being developed...</p>
      </div>
    </body>
    </html>
  `);
});

app.listen(process.env.PORT || 3000);
