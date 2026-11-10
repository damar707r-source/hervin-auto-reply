
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "games.json");

const START_BALANCE = 500;
const DAILY_REWARD = 150;
const WORK_COOLDOWN = 60 * 60 * 1000;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

let data = { guilds: {} };
const xoGames = new Map();

// =====================================
// DATABASE JSON
// =====================================

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      saveData();
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    data = parsed && parsed.guilds
      ? parsed
      : { guilds: {} };

  } catch (error) {
    console.error("[HERVIN GAMES] Load Error:", error);
    data = { guilds: {} };
  }
}

function saveData() {
  const temp = DATA_FILE + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temp, DATA_FILE);
}

function getUser(guildId, userId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { users: {} };
  }

  const guild = data.guilds[guildId];

  if (!guild.users[userId]) {
    guild.users[userId] = {
      balance: START_BALANCE,
      lastDaily: 0,
      lastWork: 0
    };

    saveData();
  }

  return guild.users[userId];
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(number) {
  return number.toLocaleString("en-US");
}

function addBalance(user, amount) {
  user.balance += amount;
  saveData();
}

function spend(user, amount) {
  if (amount < 1) return "الرهان يجب أن يكون نقطة واحدة على الأقل";

  if (user.balance < amount) {
    return "رصيدك لا يكفي لهذا الرهان";
  }

  user.balance -= amount;
  saveData();

  return null;
}

function getBet(interaction) {
  return interaction.options.getInteger("bet");
}

// =====================================
// COMMANDS
// =====================================

function registerGameCommands(commands) {

  commands.push(

    new SlashCommandBuilder()
      .setName("balance")
      .setDescription("عرض رصيدك")
      .addUserOption(option =>
        option
          .setName("member")
          .setDescription("العضو")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("daily")
      .setDescription("استلام المكافأة اليومية"),

    new SlashCommandBuilder()
      .setName("work")
      .setDescription("اعمل واجمع النقاط"),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("قائمة أغنى الأعضاء"),

    new SlashCommandBuilder()
      .setName("roulette")
      .setDescription("لعبة الروليت")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("choice")
          .setDescription("اختيار اللون")
          .setRequired(true)
          .addChoices(
            { name: "أحمر", value: "red" },
            { name: "أسود", value: "black" },
            { name: "أخضر", value: "green" }
          )
      ),

    new SlashCommandBuilder()
      .setName("blackjack")
      .setDescription("لعبة بلاك جاك")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("slots")
      .setDescription("ماكينة الحظ")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName("dice")
      .setDescription("لعبة النرد")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("choice")
          .setDescription("توقعك")
          .setRequired(true)
          .addChoices(
            { name: "عالي", value: "high" },
            { name: "منخفض", value: "low" }
          )
      ),

    new SlashCommandBuilder()
      .setName("rps")
      .setDescription("حجر ورقة مقص")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(option =>
        option.setName("choice")
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
      .setDescription("خمن الرقم")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )
      .addIntegerOption(option =>
        option.setName("number")
          .setDescription("رقم من 1 إلى 10")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10)
      ),

    new SlashCommandBuilder()
      .setName("xo")
      .setDescription("لعبة إكس أو")
      .addIntegerOption(option =>
        option.setName("bet")
          .setDescription("قيمة الرهان")
          .setRequired(true)
          .setMinValue(1)
      )

  );
}

// =====================================
// INTERACTION HANDLER
// =====================================

async function handleGameInteraction(interaction) {

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("hervin_xo:")
  ) {
    return handleXOButton(interaction);
  }

  if (!interaction.isChatInputCommand()) return false;

  const name = interaction.commandName;

  const commands = [
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
    "xo"
  ];

  if (!commands.includes(name)) return false;

  if (!interaction.guildId) {
    await interaction.reply({
      content: "الألعاب متاحة داخل السيرفرات فقط",
      ephemeral: true
    });

    return true;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const user = getUser(guildId, userId);

  // BALANCE

  if (name === "balance") {

    const target =
      interaction.options.getUser("member") ||
      interaction.user;

    const targetData = getUser(guildId, target.id);

    await interaction.reply({
      content:
        `💰 رصيد **${target.username}** هو **${formatNumber(targetData.balance)}** نقطة`,
      ephemeral: true
    });

    return true;
  }

  // DAILY

  if (name === "daily") {

    const remaining =
      DAILY_COOLDOWN - (Date.now() - user.lastDaily);

    if (remaining > 0) {
      const hours = Math.ceil(remaining / 3600000);

      await interaction.reply({
        content: `🎁 استلمت مكافأتك بالفعل، ارجع بعد ${hours} ساعة`,
        ephemeral: true
      });

      return true;
    }

    user.lastDaily = Date.now();

    addBalance(user, DAILY_REWARD);

    await interaction.reply({
      content:
        `🎁 استلمت مكافأتك اليومية!\n💰 +${DAILY_REWARD} نقطة\nرصيدك: ${formatNumber(user.balance)}`,
      ephemeral: true
    });

    return true;
  }

  // WORK

  if (name === "work") {

    const remaining =
      WORK_COOLDOWN - (Date.now() - user.lastWork);

    if (remaining > 0) {

      const minutes = Math.ceil(remaining / 60000);

      await interaction.reply({
        content: `🧰 ارجع للعمل بعد ${minutes} دقيقة`,
        ephemeral: true
      });

      return true;
    }

    const earned = random(25, 100);

    user.lastWork = Date.now();

    addBalance(user, earned);

    await interaction.reply({
      content:
        `🧰 عملت بنجاح!\n💰 ربحت ${earned} نقطة\nرصيدك: ${formatNumber(user.balance)}`,
      ephemeral: true
    });

    return true;
  }

  // LEADERBOARD

  if (name === "leaderboard") {

    const users = Object.entries(
      data.guilds[guildId]?.users || {}
    )
      .sort((a, b) => b[1].balance - a[1].balance)
      .slice(0, 10);

    if (!users.length) {
      await interaction.reply({
        content: "لا توجد أرصدة مسجلة",
        ephemeral: true
      });

      return true;
    }

    const lines = await Promise.all(
      users.map(async ([id, info], index) => {

        let username = `عضو ${id}`;

        try {
          const member = await interaction.guild.members.fetch(id);
          username = member.user.username;
        } catch {}

        return `${index + 1}. **${username}** — ${formatNumber(info.balance)} نقطة`;
      })
    );

    await interaction.reply({
      content:
        `🏆 **HERVIN GAMES LEADERBOARD**\n\n${lines.join("\n")}`
    });

    return true;
  }

  // GAME BET

  const bet = getBet(interaction);

  const error = spend(user, bet);

  if (error) {
    await interaction.reply({
      content: `❌ ${error}`,
      ephemeral: true
    });

    return true;
  }

  // ROULETTE

  if (name === "roulette") {

    const choice = interaction.options.getString("choice");

    const number = random(0, 36);

    const color =
      number === 0
        ? "green"
        : number % 2 === 0
          ? "black"
          : "red";

    const won = choice === color;

    const payout =
      won
        ? bet * (color === "green" ? 14 : 2)
        : 0;

    if (payout) addBalance(user, payout);

    const colors = {
      red: "🔴 أحمر",
      black: "⚫ أسود",
      green: "🟢 أخضر"
    };

    await interaction.reply({
      content:
        `🎡 **HERVIN ROULETTE**\n\n` +
        `الرقم: **${number}** ${colors[color]}\n` +
        `اختيارك: ${colors[choice]}\n\n` +
        `${won ? `🎉 ربحت ${payout} نقطة` : `💔 خسرت ${bet} نقطة`}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // BLACKJACK

  if (name === "blackjack") {

    const draw = () => random(1, 11);

    const player = [draw(), draw()];
    const dealer = [draw(), draw()];

    const total = hand =>
      hand.reduce((sum, card) => sum + card, 0);

    while (total(player) < 17) player.push(draw());
    while (total(dealer) < 17) dealer.push(draw());

    const p = total(player);
    const d = total(dealer);

    let payout = 0;
    let result = "";

    if (p > 21) {
      result = "💔 تجاوزت 21 وخسرت";
    } else if (d > 21 || p > d) {
      payout = bet * 2;
      result = `🎉 فزت! ربحت ${payout} نقطة`;
    } else if (p === d) {
      payout = bet;
      result = "🤝 تعادل، تم إرجاع رهانك";
    } else {
      result = "💔 الموزع فاز";
    }

    if (payout) addBalance(user, payout);

    await interaction.reply({
      content:
        `🃏 **HERVIN BLACKJACK**\n\n` +
        `أوراقك: ${player.join(" + ")} = **${p}**\n` +
        `أوراق الموزع: ${dealer.join(" + ")} = **${d}**\n\n` +
        `${result}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // SLOTS

  if (name === "slots") {

    const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "⭐"];

    const reels = [
      symbols[random(0, 5)],
      symbols[random(0, 5)],
      symbols[random(0, 5)]
    ];

    const same =
      reels[0] === reels[1] &&
      reels[1] === reels[2];

    const pair =
      !same &&
      (
        reels[0] === reels[1] ||
        reels[1] === reels[2] ||
        reels[0] === reels[2]
      );

    const payout =
      same ? bet * 5 :
      pair ? Math.floor(bet * 1.5) :
      0;

    if (payout) addBalance(user, payout);

    await interaction.reply({
      content:
        `🎰 **HERVIN SLOTS**\n\n` +
        `${reels.join(" | ")}\n\n` +
        `${same ? `🔥 فوز كبير! +${payout} نقطة` : pair ? `✨ زوج متطابق! +${payout} نقطة` : `💔 خسرت ${bet} نقطة`}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // DICE

  if (name === "dice") {

    const choice = interaction.options.getString("choice");

    const first = random(1, 6);
    const second = random(1, 6);

    const total = first + second;

    const won =
      choice === "high"
        ? total >= 8
        : total <= 6;

    const payout = won ? bet * 2 : 0;

    if (payout) addBalance(user, payout);

    await interaction.reply({
      content:
        `🎲 **HERVIN DICE**\n\n` +
        `${first} + ${second} = **${total}**\n` +
        `${won ? `🎉 فزت وربحت ${payout} نقطة` : `💔 خسرت ${bet} نقطة`}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // ROCK PAPER SCISSORS

  if (name === "rps") {

    const choices = ["rock", "paper", "scissors"];

    const playerChoice =
      interaction.options.getString("choice");

    const botChoice = choices[random(0, 2)];

    const labels = {
      rock: "🪨 حجر",
      paper: "📄 ورقة",
      scissors: "✂️ مقص"
    };

    const tie = playerChoice === botChoice;

    const won =
      !tie &&
      (
        (playerChoice === "rock" && botChoice === "scissors") ||
        (playerChoice === "paper" && botChoice === "rock") ||
        (playerChoice === "scissors" && botChoice === "paper")
      );

    const payout =
      tie ? bet :
      won ? bet * 2 :
      0;

    if (payout) addBalance(user, payout);

    await interaction.reply({
      content:
        `✊ **HERVIN RPS**\n\n` +
        `اختيارك: ${labels[playerChoice]}\n` +
        `اختيار البوت: ${labels[botChoice]}\n\n` +
        `${tie ? "🤝 تعادل وتم إرجاع رهانك" : won ? `🎉 فزت وربحت ${payout} نقطة` : `💔 خسرت ${bet} نقطة`}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // GUESS

  if (name === "guess") {

    const number =
      interaction.options.getInteger("number");

    const secret = random(1, 10);

    const won = number === secret;

    const payout = won ? bet * 8 : 0;

    if (payout) addBalance(user, payout);

    await interaction.reply({
      content:
        `🔢 **HERVIN GUESS**\n\n` +
        `الرقم الصحيح: **${secret}**\n` +
        `تخمينك: **${number}**\n\n` +
        `${won ? `🎉 فزت وربحت ${payout} نقطة` : `💔 خسرت ${bet} نقطة`}\n` +
        `💰 رصيدك: ${formatNumber(user.balance)}`
    });

    return true;
  }

  // XO

  if (name === "xo") {

    const gameId = `${guildId}:${userId}`;

    if (xoGames.has(gameId)) {
      addBalance(user, bet);

      await interaction.reply({
        content: "لديك لعبة XO لم تنتهِ بعد",
        ephemeral: true
      });

      return true;
    }

    const game = {
      board: Array(9).fill(null),
      guildId,
      userId,
      bet
    };

    xoGames.set(gameId, game);

    await interaction.reply({
      content: renderXO(game, "دورك! أنت ❌ والكمبيوتر ⭕"),
      components: xoRows(game, gameId)
    });

    return true;
  }

  return true;
}

// =====================================
// XO GAME
// =====================================

function xoRows(game, gameId, disabled = false) {

  const rows = [];

  for (let r = 0; r < 3; r++) {

    const row = new ActionRowBuilder();

    for (let c = 0; c < 3; c++) {

      const index = r * 3 + c;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`hervin_xo:${gameId}:${index}`)
          .setLabel(game.board[index] || "・")
          .setStyle(
            game.board[index] === "❌"
              ? ButtonStyle.Primary
              : game.board[index] === "⭕"
                ? ButtonStyle.Danger
                : ButtonStyle.Secondary
          )
          .setDisabled(disabled || Boolean(game.board[index]))
      );
    }

    rows.push(row);
  }

  return rows;
}

function renderXO(game, status) {

  const board = game.board;

  return (
    `⭕ **HERVIN XO** ❌\n\n` +
    `${board.slice(0, 3).map(x => x || "▫️").join(" ")}\n` +
    `${board.slice(3, 6).map(x => x || "▫️").join(" ")}\n` +
    `${board.slice(6, 9).map(x => x || "▫️").join(" ")}\n\n` +
    `${status}\n` +
    `🎯 الرهان: **${game.bet}** نقطة`
  );
}

function getWinner(board) {

  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];

  for (const [a, b, c] of lines) {
    if (
      board[a] &&
      board[a] === board[b] &&
      board[b] === board[c]
    ) {
      return board[a];
    }
  }

  return board.every(Boolean) ? "draw" : null;
}

async function handleXOButton(interaction) {

  const parts = interaction.customId.split(":");

  const guildId = parts[1];
  const userId = parts[2];
  const index = Number(parts[3]);

  const gameId = `${guildId}:${userId}`;

  const game = xoGames.get(gameId);

  if (!game) {
    await interaction.reply({
      content: "انتهت هذه اللعبة",
      ephemeral: true
    });

    return true;
  }

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: "هذه اللعبة ليست لك",
      ephemeral: true
    });

    return true;
  }

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 8 ||
    game.board[index]
  ) {
    await interaction.reply({
      content: "هذا المربع غير متاح",
      ephemeral: true
    });

    return true;
  }

  game.board[index] = "❌";

  let winner = getWinner(game.board);

  if (!winner) {

    const free = game.board
      .map((value, i) => value ? -1 : i)
      .filter(i => i !== -1);

    if (free.length) {
      const selected = free[random(0, free.length - 1)];
      game.board[selected] = "⭕";
    }

    winner = getWinner(game.board);
  }

  let status = "اللعبة مستمرة";
  let disabled = false;

  const user = getUser(guildId, userId);

  if (winner) {

    disabled = true;
    xoGames.delete(gameId);

    if (winner === "❌") {

      const payout = game.bet * 2;

      addBalance(user, payout);

      status = `🎉 فزت! ربحت ${payout} نقطة`;

    } else if (winner === "⭕") {

      status = `💔 فاز HERVIN وخسرت ${game.bet} نقطة`;

    } else {

      addBalance(user, game.bet);

      status = "🤝 تعادل! تم إرجاع رهانك";
    }

    status += `\n💰 رصيدك: ${formatNumber(user.balance)} نقطة`;

  } else {

    status = "دورك! اختر مربعاً";
  }

  await interaction.update({
    content: renderXO(game, status),
    components: xoRows(game, gameId, disabled)
  });

  return true;
}

// =====================================
// INITIALIZE
// =====================================

loadData();

module.exports = {
  registerGameCommands,
  handleGameInteraction
};
