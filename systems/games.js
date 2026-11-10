// =============================================
// HERVIN GAMES SYSTEM - Discord.js v14
// File: systems/games.js
// Prefix commands start with "-" (example: -رصيد)
// Data is saved automatically in systems/games.json
// =============================================

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "games.json");
const PREFIX = "-";
const START_BALANCE = 500;
const DAILY_REWARD = 150;
const WORK_REWARD_MIN = 25;
const WORK_REWARD_MAX = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN = 60 * 60 * 1000;

const sessions = new Map();
const activeGames = new Map();

// أوامر السلاش التي تخص نظام الألعاب فقط
const GAME_SLASH_COMMANDS = new Set([
  "balance",
  "daily",
  "work",
  "leaderboard",
  "roulette",
  "blackjack",
  "slots",
  "dice",
  "rps",
  "guess",
  "xo",
]);

// =============================================
// DATA
// =============================================

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, "{}", "utf8");
  }
}

function readData() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");

    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    console.error("[HERVIN GAMES] games.json is invalid:", error);
    return {};
  }
}

let data = readData();

function saveData() {
  ensureDataFile();

  const temp = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temp, DATA_FILE);
}

function getPlayer(guildId, userId) {
  if (!data[guildId]) {
    data[guildId] = {};
  }

  if (!data[guildId][userId]) {
    data[guildId][userId] = {
      balance: START_BALANCE,
      dailyAt: 0,
      workAt: 0,
      wins: 0,
      losses: 0,
    };

    saveData();
  }

  const player = data[guildId][userId];

  if (!Number.isFinite(player.balance)) {
    player.balance = START_BALANCE;
  }

  if (!Number.isFinite(player.dailyAt)) {
    player.dailyAt = 0;
  }

  if (!Number.isFinite(player.workAt)) {
    player.workAt = 0;
  }

  if (!Number.isFinite(player.wins)) {
    player.wins = 0;
  }

  if (!Number.isFinite(player.losses)) {
    player.losses = 0;
  }

  return player;
}

function changeBalance(guildId, userId, amount) {
  const player = getPlayer(guildId, userId);

  player.balance = Math.max(
    0,
    player.balance + Math.trunc(amount)
  );

  saveData();

  return player.balance;
}

function money(value) {
  return `${Math.max(0, Math.floor(value)).toLocaleString("en-US")} نقطة`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ");
}

function makeEmbed(title, description, color = 0x8b5cf6) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "HERVIN GAMES ✦" })
    .setTimestamp();
}

function getBet(input, player) {
  const amount = Number(input);

  if (!Number.isInteger(amount) || amount < 1) {
    return null;
  }

  if (amount > player.balance) {
    return null;
  }

  return amount;
}

function cooldownText(ms) {
  const total = Math.ceil(ms / 1000);

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${h} ساعة و ${m} دقيقة و ${s} ثانية`;
}

// =============================================
// QUESTION BANKS
// =============================================

const questionGames = {
  "ماركات": {
    title: "خمن الماركة",
    questions: [
      ["ما الماركة صاحبة الشعار الذي يحتوي على تفاحة مقضومة؟", ["ابل", "apple"]],
      ["ما الماركة التي تشتهر بثلاثة خطوط؟", ["اديداس", "adidas"]],
      ["ما الماركة صاحبة شعار حرف M الذهبي؟", ["ماكدونالدز", "mcdonalds"]],
      ["ما الماركة التي تصنع سيارات موديل كامري؟", ["تويوتا", "toyota"]],
    ],
  },

  "مشاهير": {
    title: "خمن المشهور",
    questions: [
      ["من هو لاعب كرة القدم البرتغالي الملقب بالدون؟", ["رونالدو", "كريستيانو رونالدو"]],
      ["من هو لاعب كرة القدم الأرجنتيني الفائز بكأس العالم 2022؟", ["ميسي", "ليونيل ميسي"]],
      ["من هو المغني المعروف بلقب king of pop؟", ["مايكل جاكسون", "michael jackson"]],
    ],
  },

  "كت": {
    title: "كت",
    questions: [
      ["اذكر عاصمة اليابان", ["طوكيو"]],
      ["اذكر كوكبًا يعرف بالكوكب الأحمر", ["المريخ"]],
      ["اذكر أكبر محيط في العالم", ["الهادي", "المحيط الهادي"]],
    ],
  },

  "زر": {
    title: "زر السرعة",
    questions: [
      ["اكتب كلمة هيرفن بأسرع وقت", ["هيرفن", "hervin"]],
      ["اكتب كلمة Discord", ["discord"]],
      ["اكتب: انا الأسرع", ["انا الاسرع"]],
    ],
  },

  "اسرع": {
    title: "الأسرع",
    questions: [
      ["اكتب عكس كلمة طويل", ["قصير"]],
      ["اكتب اسم لون يبدأ بحرف أ", ["احمر", "ازرق", "اصفر", "اخضر"]],
      ["اكتب اسم حيوان يبدأ بحرف س", ["سمك", "سلحفاه", "سنجاب", "سعادين"]],
    ],
  },

  "اعلام": {
    title: "أعلام",
    questions: [
      ["ما عاصمة السعودية؟", ["الرياض"]],
      ["ما عاصمة مصر؟", ["القاهره"]],
      ["ما عاصمة فرنسا؟", ["باريس"]],
      ["ما عاصمة اليابان؟", ["طوكيو"]],
    ],
  },

  "نكته": {
    title: "نكتة",
    questions: [
      ["كمل: مرة واحد نام متأخر... وش صار؟", ["حلم متاخر", "قام متاخر"]],
      ["قل نكتة قصيرة في رسالة واحدة 😂", ["نكتة", "نكته"]],
    ],
  },

  "رياضيات": {
    title: "رياضيات",
    questions: [
      ["كم ناتج 7 × 8؟", ["56"]],
      ["كم ناتج 144 ÷ 12؟", ["12"]],
      ["كم ناتج 25 + 39؟", ["64"]],
      ["كم ناتج 100 - 37؟", ["63"]],
    ],
  },

  "مضاد": {
    title: "المضاد",
    questions: [
      ["ما مضاد كلمة شجاع؟", ["جبان"]],
      ["ما مضاد كلمة سريع؟", ["بطيء", "بطي"]],
      ["ما مضاد كلمة سعيد؟", ["حزين"]],
    ],
  },

  "جمع": {
    title: "الجمع",
    questions: [
      ["ما جمع كلمة كتاب؟", ["كتب"]],
      ["ما جمع كلمة مدينة؟", ["مدن"]],
      ["ما جمع كلمة قلم؟", ["اقلام"]],
    ],
  },

  "عقاب": {
    title: "تحدي العقاب",
    questions: [
      ["اكتب بيت شعر من تأليفك", ["شعر", "بيت"]],
      ["اذكر ثلاث صفات جميلة في نفسك", ["طيّب", "طيب"]],
    ],
  },

  "ركب": {
    title: "ركب الكلمة",
    questions: [
      ["رتب الحروف لتكوين كلمة: (ب ت ك ا)", ["كتاب"]],
      ["رتب الحروف لتكوين كلمة: (ة ر ج ش)", ["شجره", "شجرة"]],
      ["رتب الحروف لتكوين كلمة: (م ل ق)", ["قلم"]],
    ],
  },

  "سؤال": {
    title: "سؤال عام",
    questions: [
      ["كم عدد أيام الأسبوع؟", ["7", "سبعه", "سبعة"]],
      ["كم عدد ألوان قوس قزح؟", ["7", "سبعه", "سبعة"]],
      ["ما الحيوان الملقب بسفينة الصحراء؟", ["الجمل"]],
    ],
  },

  "لغز": {
    title: "لغز",
    questions: [
      ["شيء كلما أخذت منه كبر، ما هو؟", ["الحفره", "حفرة"]],
      ["له أسنان ولا يعض، ما هو؟", ["المشط"]],
      ["يمشي بلا قدمين ويبكي بلا عينين، ما هو؟", ["السحاب", "الغيم"]],
    ],
  },

  "حجره": {
    title: "حجر ورقة مقص",
    questions: [
      ["اكتب: حجر أو ورقة أو مقص", ["حجر", "ورقه", "مقص"]],
    ],
  },

  "مفرد": {
    title: "المفرد",
    questions: [
      ["ما مفرد كلمة أقلام؟", ["قلم"]],
      ["ما مفرد كلمة رجال؟", ["رجل"]],
      ["ما مفرد كلمة كتب؟", ["كتاب"]],
    ],
  },

  "سمعني": {
    title: "سمعني",
    questions: [
      ["اكتب اسم أغنية أو أنشودة تعرفها", ["اغنيه", "انشوده"]],
      ["اكتب اسم مطربك المفضل", ["مغني", "مطرب"]],
    ],
  },

  "حكمه": {
    title: "حكمة",
    questions: [
      ["أكمل: من جد وجد ومن زرع...", ["حصد"]],
      ["أكمل: الصديق وقت...", ["الضيق"]],
      ["أكمل: الوقت كالسيف إن لم تقطعه...", ["قطعك"]],
    ],
  },

  "لوخيروك": {
    title: "لو خيروك",
    questions: [
      ["لو خيروك: السفر للماضي أو المستقبل؟ اكتب اختيارك", ["الماضي", "المستقبل"]],
      ["لو خيروك: البحر أو البر؟ اكتب اختيارك", ["البحر", "البر"]],
    ],
  },
};

const aliases = {
  "ماركات": ["ماركات", "ماركه"],
  "مشاهير": ["مشاهير", "مشهور"],
  "كت": ["كت"],
  "زر": ["زر"],
  "اسرع": ["اسرع", "أسرع"],
  "اعلام": ["اعلام", "أعلام"],
  "نكته": ["نكته", "نكتة"],
  "رياضيات": ["رياضيات", "رياضه"],
  "مضاد": ["مضاد"],
  "جمع": ["جمع"],
  "عقاب": ["عقاب"],
  "ركب": ["ركب"],
  "سؤال": ["سؤال"],
  "لغز": ["لغز"],
  "حجره": ["حجره", "حجرة", "حجر"],
  "مفرد": ["مفرد"],
  "سمعني": ["سمعني"],
  "حكمه": ["حكمه", "حكمة"],
  "لوخيروك": ["لوخيروك", "لو خيروك"],
};

// =============================================
// QUESTION GAME
// =============================================

function startQuestionGame(message, key) {
  const game = questionGames[key];

  const question = game.questions[
    randomInt(0, game.questions.length - 1)
  ];

  const sessionKey = `${message.guild.id}:${message.channel.id}`;

  sessions.set(sessionKey, {
    type: "question",
    key,
    userId: message.author.id,
    answers: question[1].map(cleanText),
    expires: Date.now() + 45000,
  });

  message.reply({
    embeds: [
      makeEmbed(
        `🎮 ${game.title}`,
        `${question[0]}\n\n<@${message.author.id}> عندك **45 ثانية** للإجابة، والجائزة **30 نقطة**`
      ),
    ],
  }).catch(() => {});
}

// =============================================
// CONNECT 4
// =============================================

function startConnect4(message) {
  const key = `${message.guild.id}:${message.channel.id}`;

  if (activeGames.has(key)) {
    return message.reply("فيه لعبة شغالة في هذي الروم");
  }

  const game = {
    type: "connect4",
    players: [message.author.id],
    board: Array.from({ length: 6 }, () => Array(7).fill(0)),
    turn: 0,
  };

  activeGames.set(key, game);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hervin_c4_join")
      .setLabel("انضمام لاعب ثاني")
      .setStyle(ButtonStyle.Success)
  );

  message.reply({
    embeds: [
      makeEmbed(
        "🔴 توصيل 4",
        `بدأت اللعبة بواسطة <@${message.author.id}>\nاضغط انضمام لاعب ثاني للبدء`
      ),
    ],
    components: [row],
  }).catch(() => {});
}

function renderConnect4(board) {
  const symbols = ["⚪", "🔴", "🟡"];

  return board
    .map(row => row.map(cell => symbols[cell]).join(""))
    .join("\n");
}

function checkConnect4(board) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const value = board[r][c];

      if (!value) continue;

      for (const [dr, dc] of directions) {
        let count = 1;

        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;

          if (
            nr < 0 ||
            nr >= 6 ||
            nc < 0 ||
            nc >= 7 ||
            board[nr][nc] !== value
          ) {
            break;
          }

          count++;
        }

        if (count >= 4) return value;
      }
    }
  }

  return 0;
}

// =============================================
// MAFIA
// =============================================

function startMafia(message) {
  const key = `${message.guild.id}:${message.channel.id}`;

  if (activeGames.has(key)) {
    return message.reply("فيه لعبة شغالة في هذي الروم");
  }

  activeGames.set(key, {
    type: "mafia",
    host: message.author.id,
    players: [message.author.id],
    started: false,
  });

  message.reply({
    embeds: [
      makeEmbed(
        "🕵️ لعبة المافيا",
        `بدأ التسجيل بواسطة <@${message.author.id}>\nاكتب **-دخول** للانضمام\nالحد الأدنى 4 لاعبين، والمضيف يكتب **-بدء**`
      ),
    ],
  }).catch(() => {});
}

// =============================================
// PREFIX COMMANDS
// =============================================

async function handleGameMessage(message) {
  if (
    !message ||
    !message.guild ||
    message.author.bot ||
    !message.content
  ) {
    return;
  }

  const content = message.content.trim();

  // الإجابة على أسئلة الألعاب
  if (!content.startsWith(PREFIX)) {
    const key = `${message.guild.id}:${message.channel.id}`;
    const session = sessions.get(key);

    if (
      session &&
      session.type === "question" &&
      session.userId === message.author.id
    ) {
      if (Date.now() > session.expires) {
        sessions.delete(key);
        return;
      }

      if (session.answers.includes(cleanText(content))) {
        sessions.delete(key);

        changeBalance(
          message.guild.id,
          message.author.id,
          30
        );

        const player = getPlayer(
          message.guild.id,
          message.author.id
        );

        return message.reply(
          `🎉 إجابة صحيحة! حصلت على **30 نقطة** ورصيدك الآن **${money(player.balance)}**`
        );
      }
    }

    return;
  }

  const parts = content
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const command = cleanText(parts.shift());
  const arg = parts.join(" ").trim();

  // =============================================
  // HERVIN GAMES LIST
  // الأمر: -العاب
  // =============================================

  if (command === "العاب" || command === "الألعاب") {
    return message.reply({
      embeds: [
        makeEmbed(
          "🎮 𝐇𝐄𝐑𝐕𝐈𝐍 | قائمة الألعاب",
          "**🎯 الألعاب الفردية**\n" +
          "`-ماركات`\n" +
          "`-مشاهير`\n" +
          "`-كت`\n" +
          "`-زر`\n" +
          "`-اسرع`\n" +
          "`-اعلام`\n" +
          "`-نكته`\n" +
          "`-رياضيات`\n" +
          "`-مضاد`\n" +
          "`-جمع`\n" +
          "`-عقاب`\n" +
          "`-ركب`\n" +
          "`-سؤال`\n" +
          "`-لغز`\n" +
          "`-حجره`\n" +
          "`-مفرد`\n" +
          "`-سمعني`\n" +
          "`-حكمه`\n" +
          "`-لوخيروك`\n\n" +

          "**👥 الألعاب الجماعية**\n" +
          "`-توصيل4`\n" +
          "`-مافيا`\n" +
          "`-دخول`\n" +
          "`-بدء`\n" +
          "`-كراسي`\n" +
          "`-غميضه`\n" +
          "`-اكس_او`\n\n" +

          "**😂 أوامر الترفيه**\n" +
          "`-اضرب @عضو`\n" +
          "`-هاك @عضو`\n" +
          "`-صداقة @عضو`\n" +
          "`-عجله`\n\n" +

          "**💰 أوامر الاقتصاد**\n" +
          "`-رصيد`\n" +
          "`-يومي`\n" +
          "`-عمل`\n" +
          "`-توب`\n\n" +

          "**🎰 ألعاب النقاط**\n" +
          "`/balance`\n" +
          "`/daily`\n" +
          "`/work`\n" +
          "`/leaderboard`\n" +
          "`/roulette`\n" +
          "`/blackjack`\n" +
          "`/slots`\n" +
          "`/dice`\n" +
          "`/rps`\n" +
          "`/guess`\n" +
          "`/xo`\n\n" +

          "✦ جميع الحقوق محفوظة لـ 𝐇𝐄𝐑𝐕𝐈𝐍"
        )
      ]
    });
  }

  // تجاهل الرسائل التي تحتوي على "-" فقط
  if (!command) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  // لا ننشئ لاعبًا إلا بعد التأكد أن الأمر يخص الألعاب
  const knownPrefixCommands = [
    "رصيد", "balance", "فلوسي",
    "يومي", "daily",
    "عمل", "work",
    "توب", "leaderboard", "المتصدرين",
    "توصيل4", "توصيل",
    "مافيا", "دخول", "بدء",
    "عجله", "عجلة",
    "اضرب", "هاك", "صداقة",
    "كراسي", "غميضه", "غميضة",
    "اكس_او", "اكس", "xo",
    "روليت", "roulette",
    "بلاكجاك", "blackjack",
    "سلوت", "slots",
    "نرد", "dice",
    "حجر", "rps",
    "خمن", "guess",
  ];

  const isQuestionCommand = Object.values(aliases).some(names =>
    names.some(name => cleanText(name) === command)
  );

  if (!knownPrefixCommands.includes(command) && !isQuestionCommand) {
    return;
  }

  const player = getPlayer(guildId, userId);

  if (["رصيد", "balance", "فلوسي"].includes(command)) {
    return message.reply({
      embeds: [
        makeEmbed(
          "💰 رصيدك",
          `رصيدك الحالي: **${money(player.balance)}**\n🏆 الانتصارات: ${player.wins}\n💔 الخسائر: ${player.losses}`
        ),
      ],
    });
  }

  if (["يومي", "daily"].includes(command)) {
    const remaining =
      DAILY_COOLDOWN - (Date.now() - player.dailyAt);

    if (remaining > 0) {
      return message.reply(
        `استلمت مكافأتك اليومية، ارجع بعد **${cooldownText(remaining)}**`
      );
    }

    player.dailyAt = Date.now();

    changeBalance(
      guildId,
      userId,
      DAILY_REWARD
    );

    saveData();

    return message.reply(
      `🎁 استلمت مكافأتك اليومية **${money(DAILY_REWARD)}**`
    );
  }

  if (["عمل", "work"].includes(command)) {
    const remaining =
      WORK_COOLDOWN - (Date.now() - player.workAt);

    if (remaining > 0) {
      return message.reply(
        `تعبت من العمل 😅 ارجع بعد **${cooldownText(remaining)}**`
      );
    }

    const reward = randomInt(
      WORK_REWARD_MIN,
      WORK_REWARD_MAX
    );

    player.workAt = Date.now();

    changeBalance(guildId, userId, reward);

    saveData();

    return message.reply(
      `💼 اشتغلت وربحت **${money(reward)}**`
    );
  }

  if (["توب", "leaderboard", "المتصدرين"].includes(command)) {
    const top = Object.entries(data[guildId] || {})
      .sort(
        (a, b) =>
          (b[1].balance || 0) - (a[1].balance || 0)
      )
      .slice(0, 10);

    const lines = top.map(
      ([id, p], i) =>
        `**${i + 1}.** <@${id}> — ${money(p.balance || 0)}`
    );

    return message.reply({
      embeds: [
        makeEmbed(
          "🏆 أغنى اللاعبين",
          lines.join("\n") || "لا يوجد لاعبين بعد"
        ),
      ],
    });
  }

  if (["توصيل4", "توصيل"].includes(command)) {
    return startConnect4(message);
  }

  if (command === "مافيا") {
    return startMafia(message);
  }

  if (command === "دخول") {
    const key = `${guildId}:${message.channel.id}`;
    const game = activeGames.get(key);

    if (!game || game.type !== "mafia" || game.started) {
      return message.reply("ما فيه تسجيل مافيا مفتوح");
    }

    if (game.players.includes(userId)) {
      return message.reply("أنت مسجل بالفعل");
    }

    if (game.players.length >= 12) {
      return message.reply("اكتمل عدد اللاعبين");
    }

    game.players.push(userId);

    return message.reply(
      `تم تسجيلك في المافيا، عدد اللاعبين: **${game.players.length}**`
    );
  }

  if (command === "بدء") {
    const key = `${guildId}:${message.channel.id}`;
    const game = activeGames.get(key);

    if (!game || game.type !== "mafia") {
      return message.reply("ما فيه لعبة مافيا مفتوحة");
    }

    if (game.host !== userId) {
      return message.reply("فقط صاحب اللعبة يقدر يبدأها");
    }

    if (game.players.length < 4) {
      return message.reply("تحتاج 4 لاعبين على الأقل");
    }

    if (game.started) {
      return message.reply("اللعبة بدأت بالفعل");
    }

    game.started = true;

    const shuffled = [...game.players].sort(
      () => Math.random() - 0.5
    );

    const roles = [
      "مافيا",
      "طبيب",
      "محقق",
      ...Array(Math.max(0, shuffled.length - 3)).fill("مواطن"),
    ];

    shuffled.forEach((id, i) => {
      const member = message.guild.members.cache.get(id);

      if (member) {
        member.send(
          `🎭 دورك في لعبة المافيا: **${roles[i]}**`
        ).catch(() => {});
      }
    });

    return message.reply(
      "🎭 بدأت المافيا! تم إرسال الأدوار بالخاص، ناقشوا ثم صوّتوا يدويًا في الروم"
    );
  }

  if (command === "عجله" || command === "عجلة") {
    const outcomes = [
      "ربحت 50 نقطة",
      "ربحت 20 نقطة",
      "خسرت 15 نقطة",
      "حظ أوفر المرة القادمة",
    ];

    const result = outcomes[
      randomInt(0, outcomes.length - 1)
    ];

    const match = result.match(/(ربحت|خسرت) (\d+)/);

    if (match) {
      changeBalance(
        guildId,
        userId,
        (match[1] === "ربحت" ? 1 : -1) * Number(match[2])
      );
    }

    return message.reply(`🎡 ${result}`);
  }

  if (command === "اضرب") {
    const target = message.mentions.users.first();

    if (!target || target.bot || target.id === userId) {
      return message.reply(
        "استخدم الأمر مع منشن لاعب، مثال: `-اضرب @user`"
      );
    }

    return message.reply(
      `🥊 <@${userId}> أعطى <@${target.id}> ضربة كرتونية 😂`
    );
  }

  if (command === "هاك") {
    const target = message.mentions.users.first();

    if (!target || target.id === userId) {
      return message.reply("منشن شخصًا لتجربة الهاك الوهمي");
    }

    return message.reply(
      `💻 جاري اختراق <@${target.id}>...\nتم الاختراق بنجاح (مزحة 😂)`
    );
  }

  if (command === "صداقة") {
    const target = message.mentions.users.first();

    if (!target || target.id === userId) {
      return message.reply("منشن شخصًا لحساب نسبة الصداقة");
    }

    const percent = randomInt(1, 100);

    return message.reply(
      `🤝 نسبة الصداقة بين <@${userId}> و <@${target.id}> هي **${percent}%**`
    );
  }

  if (command === "كراسي") {
    return message.reply(
      "🪑 لعبة الكراسي: اجمعوا اللاعبين في الروم الصوتي، شغّلوا الموسيقى، وعند توقفها آخر شخص يجلس يخرج من الجولة. اكتبوا `-كراسي` لبدء جولة جديدة"
    );
  }

  if (command === "غميضه" || command === "غميضة") {
    return message.reply(
      "🙈 لعبة الغميضة: اختاروا لاعبًا يكون الباحث والباقين يختبئون في الرومات. هذه نسخة تنظيمية يدوية وليست تتبعًا تلقائيًا للرومات"
    );
  }

  if (["اكس_او", "اكس", "xo"].includes(command)) {
    return message.reply(
      "❌⭕ للعب اكس او التفاعلية استخدم الأمر `/xo`"
    );
  }

  if (
    [
      "روليت", "roulette",
      "بلاكجاك", "blackjack",
      "سلوت", "slots",
      "نرد", "dice",
      "حجر", "rps",
      "خمن", "guess",
    ].includes(command)
  ) {
    return message.reply(
      "هذه اللعبة متاحة حاليًا بأمرها السلاش مثل `/roulette` أو `/blackjack` أو `/slots` أو `/dice` أو `/rps` أو `/guess`"
    );
  }

  for (const [key, names] of Object.entries(aliases)) {
    if (names.some(name => cleanText(name) === command)) {
      return startQuestionGame(message, key);
    }
  }
}

// =============================================
// SLASH COMMANDS
// =============================================

function registerGameCommands(commands) {
  commands.push(
    new SlashCommandBuilder()
      .setName("balance")
      .setDescription("عرض رصيدك"),

    new SlashCommandBuilder()
      .setName("daily")
      .setDescription("استلام المكافأة اليومية"),

    new SlashCommandBuilder()
      .setName("work")
      .setDescription("العمل للحصول على نقاط"),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("أفضل 10 لاعبين"),

    new SlashCommandBuilder()
      .setName("roulette")
      .setDescription("لعبة الروليت")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("blackjack")
      .setDescription("لعبة بلاك جاك")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("slots")
      .setDescription("لعبة السلوت")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("dice")
      .setDescription("لعبة النرد")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("rps")
      .setDescription("حجر ورقة مقص")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(o =>
        o.setName("choice")
          .setDescription("اختيارك")
          .setRequired(true)
          .addChoices(
            { name: "حجر", value: "rock" },
            { name: "ورقة", value: "paper" },
            { name: "مقص", value: "scissors" }
          )
      ),

    new SlashCommandBuilder()
      .setName("guess")
      .setDescription("خمن الرقم من 1 إلى 5")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addIntegerOption(o =>
        o.setName("number")
          .setDescription("رقمك")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5)
      ),

    new SlashCommandBuilder()
      .setName("xo")
      .setDescription("لعبة اكس او ضد البوت")
      .addIntegerOption(o =>
        o.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
  );
}

// =============================================
// SLASH INTERACTIONS
// =============================================

async function handleGameInteraction(interaction) {
  // أزرار XO
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("hervin_xo:")
  ) {
    return handleXOButton(interaction);
  }

  // انضمام توصيل 4
  if (
    interaction.isButton() &&
    interaction.customId === "hervin_c4_join"
  ) {
    const key = `${interaction.guildId}:${interaction.channelId}`;
    const game = activeGames.get(key);

    if (!game || game.type !== "connect4") {
      return interaction.reply({
        content: "انتهت اللعبة",
        ephemeral: true,
      });
    }

    if (game.players.length !== 1) {
      return interaction.reply({
        content: "اللعبة مكتملة بالفعل",
        ephemeral: true,
      });
    }

    if (game.players[0] === interaction.user.id) {
      return interaction.reply({
        content: "تحتاج لاعبًا ثانيًا",
        ephemeral: true,
      });
    }

    game.players.push(interaction.user.id);

    const row = new ActionRowBuilder();

    for (let i = 0; i < 7; i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hervin_c4_col:${i}`)
          .setLabel(String(i + 1))
          .setStyle(ButtonStyle.Primary)
      );
    }

    return interaction.update({
      embeds: [
        makeEmbed(
          "🔴 توصيل 4",
          `🔴 <@${game.players[0]}> ضد 🟡 <@${game.players[1]}>\nالدور على <@${game.players[0]}>\n${renderConnect4(game.board)}`
        ),
      ],
      components: [row],
    });
  }

  // أزرار أعمدة توصيل 4
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("hervin_c4_col:")
  ) {
    const key = `${interaction.guildId}:${interaction.channelId}`;
    const game = activeGames.get(key);

    if (
      !game ||
      game.type !== "connect4" ||
      game.players.length !== 2
    ) {
      return interaction.reply({
        content: "اللعبة غير جاهزة",
        ephemeral: true,
      });
    }

    const current = game.players[game.turn];

    if (interaction.user.id !== current) {
      return interaction.reply({
        content: "مو دورك",
        ephemeral: true,
      });
    }

    const col = Number(
      interaction.customId.split(":")[1]
    );

    if (!Number.isInteger(col) || col < 0 || col > 6) {
      return interaction.reply({
        content: "عمود غير صحيح",
        ephemeral: true,
      });
    }

    let placed = false;

    for (let r = 5; r >= 0; r--) {
      if (game.board[r][col] === 0) {
        game.board[r][col] = game.turn + 1;
        placed = true;
        break;
      }
    }

    if (!placed) {
      return interaction.reply({
        content: "العمود ممتلئ",
        ephemeral: true,
      });
    }

    const winner = checkConnect4(game.board);

    if (
      winner ||
      game.board.every(row => row.every(cell => cell !== 0))
    ) {
      activeGames.delete(key);

      const result = winner
        ? `الفائز: <@${game.players[winner - 1]}> 🎉`
        : "تعادل!";

      return interaction.update({
        embeds: [
          makeEmbed(
            "🔴 انتهت توصيل 4",
            `${result}\n${renderConnect4(game.board)}`
          ),
        ],
        components: [],
      });
    }

    game.turn = 1 - game.turn;

    const row = new ActionRowBuilder();

    for (let i = 0; i < 7; i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hervin_c4_col:${i}`)
          .setLabel(String(i + 1))
          .setStyle(ButtonStyle.Primary)
      );
    }

    return interaction.update({
      embeds: [
        makeEmbed(
          "🔴 توصيل 4",
          `الدور على <@${game.players[game.turn]}>\n${renderConnect4(game.board)}`
        ),
      ],
      components: [row],
    });
  }

  // تجاهل أي تفاعل ليس أمر سلاش
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const { commandName, guildId, user } = interaction;

  // =============================================
  // أهم إصلاح:
  // إذا الأمر ليس من أوامر الألعاب، نخرج مباشرة
  // حتى لا يتعامل مع /help أو بقية أوامر الأنظمة
  // =============================================

  if (!GAME_SLASH_COMMANDS.has(commandName)) {
    return;
  }

  if (!guildId) {
    return interaction.reply({
      content: "أوامر الألعاب تعمل داخل السيرفر فقط",
      ephemeral: true,
    });
  }

  const player = getPlayer(guildId, user.id);

  // الرصيد
  if (commandName === "balance") {
    return interaction.reply({
      embeds: [
        makeEmbed(
          "💰 رصيدك",
          `رصيدك: **${money(player.balance)}**\n🏆 الانتصارات: ${player.wins}\n💔 الخسائر: ${player.losses}`
        ),
      ],
      ephemeral: true,
    });
  }

  // اليومي والعمل
  if (commandName === "daily" || commandName === "work") {
    const isDaily = commandName === "daily";

    const cooldown = isDaily
      ? DAILY_COOLDOWN
      : WORK_COOLDOWN;

    const field = isDaily
      ? "dailyAt"
      : "workAt";

    const remaining =
      cooldown - (Date.now() - player[field]);

    if (remaining > 0) {
      return interaction.reply({
        content: `ارجع بعد **${cooldownText(remaining)}**`,
        ephemeral: true,
      });
    }

    const reward = isDaily
      ? DAILY_REWARD
      : randomInt(WORK_REWARD_MIN, WORK_REWARD_MAX);

    player[field] = Date.now();

    changeBalance(guildId, user.id, reward);

    saveData();

    return interaction.reply({
      content: `🎉 حصلت على **${money(reward)}**`,
      ephemeral: true,
    });
  }

  // المتصدرين
  if (commandName === "leaderboard") {
    const top = Object.entries(data[guildId] || {})
      .sort(
        (a, b) =>
          (b[1].balance || 0) - (a[1].balance || 0)
      )
      .slice(0, 10);

    const lines = top.map(
      ([id, p], i) =>
        `**${i + 1}.** <@${id}> — ${money(p.balance || 0)}`
    );

    return interaction.reply({
      embeds: [
        makeEmbed(
          "🏆 أغنى اللاعبين",
          lines.join("\n") || "لا يوجد لاعبين"
        ),
      ],
      ephemeral: true,
    });
  }

  // =============================================
  // الرهانات
  // هذا الجزء لا يصل إليه إلا أوامر الألعاب
  // =============================================

  const bet = interaction.options.getInteger("bet");
  const validBet = getBet(bet, player);

  if (!validBet) {
    return interaction.reply({
      content: "رهانك غير صحيح أو رصيدك لا يكفي",
      ephemeral: true,
    });
  }

  changeBalance(guildId, user.id, -validBet);

  let resultText = "";
  let won = false;
  let payout = 0;

  // الروليت
  if (commandName === "roulette") {
    const number = randomInt(0, 36);

    won = number === 7;
    payout = won ? validBet * 5 : 0;

    resultText =
      `🎡 الرقم: **${number}**` +
      (won
        ? "\nفزت! الرقم المحظوظ 7"
        : "\nلم يحالفك الحظ");
  }

  // بلاك جاك
  else if (commandName === "blackjack") {
    const userScore = randomInt(15, 23);
    const botScore = randomInt(15, 23);

    won =
      userScore <= 21 &&
      (botScore > 21 || userScore > botScore);

    const draw = userScore === botScore;

    payout = won
      ? validBet * 2
      : draw
        ? validBet
        : 0;

    resultText =
      `🃏 نتيجتك: **${userScore}**\n` +
      `نتيجة البوت: **${botScore}**\n` +
      `${won ? "فزت!" : draw ? "تعادل واسترجعت رهانك" : "خسرت"}`;
  }

  // السلوت
  else if (commandName === "slots") {
    const icons = ["🍒", "🍋", "🍇", "💎", "7️⃣"];

    const spin = [
      icons[randomInt(0, 4)],
      icons[randomInt(0, 4)],
      icons[randomInt(0, 4)],
    ];

    won =
      spin[0] === spin[1] &&
      spin[1] === spin[2];

    payout = won ? validBet * 5 : 0;

    resultText =
      `${spin.join(" | ")}\n` +
      `${won ? "ثلاثة متطابقة! فزت" : "حظ أوفر"}`;
  }

  // النرد
  else if (commandName === "dice") {
    const a = randomInt(1, 6);
    const b = randomInt(1, 6);

    won = a > b;

    const draw = a === b;

    payout = won
      ? validBet * 2
      : draw
        ? validBet
        : 0;

    resultText =
      `🎲 أنت: **${a}** — البوت: **${b}**\n` +
      `${won ? "فزت!" : draw ? "تعادل" : "خسرت"}`;
  }

  // حجر ورقة مقص
  else if (commandName === "rps") {
    const choices = [
      "rock",
      "paper",
      "scissors",
    ];

    const names = {
      rock: "حجر",
      paper: "ورقة",
      scissors: "مقص",
    };

    const choice = interaction.options.getString("choice");

    const botChoice = choices[randomInt(0, 2)];

    won =
      (choice === "rock" && botChoice === "scissors") ||
      (choice === "paper" && botChoice === "rock") ||
      (choice === "scissors" && botChoice === "paper");

    const draw = choice === botChoice;

    payout = won
      ? validBet * 2
      : draw
        ? validBet
        : 0;

    resultText =
      `اختيارك: **${names[choice]}**\n` +
      `اختيار البوت: **${names[botChoice]}**\n` +
      `${won ? "فزت!" : draw ? "تعادل" : "خسرت"}`;
  }

  // خمن الرقم
  else if (commandName === "guess") {
    const number = randomInt(1, 5);

    won =
      interaction.options.getInteger("number") === number;

    payout = won ? validBet * 4 : 0;

    resultText =
      `الرقم الصحيح: **${number}**\n` +
      `${won ? "تخمين صحيح! فزت" : "تخمين خاطئ"}`;
  }

  // اكس او
  else if (commandName === "xo") {
    const board = Array(9).fill(null);

    const row = buildXORow(
      board,
      user.id,
      validBet
    );

    // حفظ حالة اللوحة من أول رسالة
    const embed = makeEmbed(
      "❌⭕ اكس او",
      `أنت ❌ ضد البوت ⭕\nالرهان: ${money(validBet)}\nاختر مربعًا للبدء\n\nHERVIN_XO_STATE:${board.map(x => x || ".").join("")}`
    );

    return interaction.reply({
      embeds: [embed],
      components: row,
    });
  }

  else {
    // حماية إضافية لأي أمر غير متوقع
    changeBalance(guildId, user.id, validBet);
    return;
  }

  if (payout > 0) {
    changeBalance(guildId, user.id, payout);
  }

  if (won) {
    getPlayer(guildId, user.id).wins++;
  } else if (!resultText.includes("تعادل")) {
    getPlayer(guildId, user.id).losses++;
  }

  saveData();

  const net = payout - validBet;

  return interaction.reply({
    embeds: [
      makeEmbed(
        "🎮 نتيجة اللعبة",
        `${resultText}\n\n` +
        `${net >= 0 ? "صافي ربحك" : "صافي خسارتك"}: **${money(Math.abs(net))}**\n` +
        `رصيدك: **${money(getPlayer(guildId, user.id).balance)}**`
      ),
    ],
  });
}

// =============================================
// XO GAME
// =============================================

function buildXORow(board, userId, bet) {
  return [0, 1, 2].map(rowIndex => {
    const row = new ActionRowBuilder();

    for (let col = 0; col < 3; col++) {
      const index = rowIndex * 3 + col;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `hervin_xo:${userId}:${bet}:${index}`
          )
          .setLabel(board[index] || "⠀")
          .setStyle(
            board[index] === "X"
              ? ButtonStyle.Danger
              : board[index] === "O"
                ? ButtonStyle.Success
                : ButtonStyle.Secondary
          )
          .setDisabled(Boolean(board[index]))
      );
    }

    return row;
  });
}

function checkXO(board, mark) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  return lines.some(
    line => line.every(i => board[i] === mark)
  );
}

async function handleXOButton(interaction) {
  const [, ownerId, betText, indexText] =
    interaction.customId.split(":");

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "هذه اللعبة ليست لك",
      ephemeral: true,
    });
  }

  const bet = Number(betText);
  const index = Number(indexText);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 8
  ) {
    return interaction.reply({
      content: "اختيار غير صحيح",
      ephemeral: true,
    });
  }

  const description =
    interaction.message.embeds[0]?.description || "";

  const match = description.match(
    /HERVIN_XO_STATE:([XO.]{9})/
  );

  const board = match
    ? match[1].split("").map(x => x === "." ? null : x)
    : Array(9).fill(null);

  if (board[index]) {
    return interaction.reply({
      content: "هذا المربع مستخدم",
      ephemeral: true,
    });
  }

  board[index] = "X";

  if (checkXO(board, "X")) {
    return finishXO(
      interaction,
      board,
      ownerId,
      bet,
      "فزت على البوت!",
      bet * 3
    );
  }

  if (board.every(Boolean)) {
    return finishXO(
      interaction,
      board,
      ownerId,
      bet,
      "تعادل!",
      bet
    );
  }

  const availableMoves = board
    .map((value, i) => value ? null : i)
    .filter(value => value !== null);

  const move = availableMoves[
    randomInt(0, availableMoves.length - 1)
  ];

  board[move] = "O";

  if (checkXO(board, "O")) {
    return finishXO(
      interaction,
      board,
      ownerId,
      bet,
      "البوت فاز عليك",
      0
    );
  }

  if (board.every(Boolean)) {
    return finishXO(
      interaction,
      board,
      ownerId,
      bet,
      "تعادل!",
      bet
    );
  }

  const embed = makeEmbed(
    "❌⭕ اكس او",
    `أنت ❌ ضد البوت ⭕\nاختر مربعًا\n\nHERVIN_XO_STATE:${board.map(x => x || ".").join("")}`
  );

  return interaction.update({
    embeds: [embed],
    components: buildXORow(board, ownerId, bet),
  });
}

function finishXO(
  interaction,
  board,
  userId,
  bet,
  message,
  payout
) {
  if (payout > 0) {
    changeBalance(
      interaction.guildId,
      userId,
      payout
    );
  }

  const player = getPlayer(
    interaction.guildId,
    userId
  );

  if (payout > bet) {
    player.wins++;
  } else if (payout === 0) {
    player.losses++;
  }

  saveData();

  const embed = makeEmbed(
    "❌⭕ انتهت اللعبة",
    `${message}\n` +
    `${board.map(x => x || "⬜").join(" ")}\n\n` +
    `رصيدك: **${money(player.balance)}**`
  );

  return interaction.update({
    embeds: [embed],
    components: [],
  });
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
  registerGameCommands,
  handleGameInteraction,
  handleGameMessage,
};
