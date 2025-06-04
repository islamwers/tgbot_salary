const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');
const fetch = require('node-fetch');
require('dotenv').config();

console.log('🧪 INDEX.JS ЗАПУЩЕН');

const bot = new Telegraf(process.env.BOT_TOKEN);
let userState = {};

const YANDEX_API_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// Команда /start с выбором способа
bot.start((ctx) => {
  userState[ctx.chat.id] = {};
  ctx.reply(
    '👋 Привет! Я бот для подачи заявок на выплату.\nВыберите способ ввода данных:',
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Ввести вручную', 'manual')],
      [Markup.button.callback('🤖 Ввести сообщением (YandexGPT)', 'ai_input')]
    ])
  );
});

bot.action('manual', (ctx) => {
  userState[ctx.chat.id] = { step: 'fio' };
  ctx.reply('✏️ Введите ФИО:');
});

bot.action('ai_input', (ctx) => {
  userState[ctx.chat.id] = { step: 'ai_wait' };
  ctx.reply('🧠 Введите все данные одним сообщением:\n\nПример:\nИванов Иван Иванович, инженер, 12 светильников, 12000 руб, май 2025');
});

// Ручной пошаговый ввод
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (!userState[chatId]) {
    ctx.reply('Введите /start для начала.');
    return;
  }

  const state = userState[chatId];

  if (state.step === 'fio') {
    state.fio = text;
    state.step = 'role';
    ctx.reply('💼 Введите роль (например: инженер, ИТР, монтажник):');
  } else if (state.step === 'role') {
    state.role = text;
    state.step = 'lights';
    ctx.reply('💡 Введите количество светильников:');
  } else if (state.step === 'lights') {
    state.lights = text;
    state.step = 'amount';
    ctx.reply('💰 Введите сумму выплаты (ЗП без НДФЛ):');
  } else if (state.step === 'amount') {
    state.amount = text;
    state.step = 'period';
    ctx.reply('📆 За какой период? (например: май 2025):');
  } else if (state.step === 'period') {
    state.period = text;
    state.date = new Date().toISOString().split('T')[0];

    try {
      await appendToSheet(state);
      ctx.reply(
        '✅ Данные успешно записаны в Google Таблицу!',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Добавить ещё одну заявку', 'manual')],
          [Markup.button.callback('🏁 Завершить', 'done')]
        ])
      );
    } catch (err) {
      console.error('❌ Ошибка записи в Google Sheet:', err);
      ctx.reply('❌ Ошибка при записи.');
    }

    delete userState[chatId];
  } else if (state.step === 'ai_wait') {
    const yandexPrompt = `Извлеки из текста следующие поля: ФИО, роль, количество светильников, сумма выплаты (ЗП без НДФЛ), и период. Верни в JSON формате: { "fio": "...", "role": "...", "lights": "...", "amount": "...", "period": "..." }. Текст: "${text}"`;

    try {
      const response = await fetch(YANDEX_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.YANDEX_IAM_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          modelUri: `gpt://${process.env.YANDEX_FOLDER_ID}/yandexgpt/latest`,
          completionOptions: {
            stream: false,
            temperature: 0.3,
            maxTokens: 1000
          },
          messages: [
            { role: 'system', text: 'Ты помощник для заполнения заявок в формате JSON.' },
            { role: 'user', text: yandexPrompt }
          ]
        })
      });

      const result = await response.json();

      const aiText = result.result?.alternatives?.[0]?.message?.text;
      if (!aiText) throw new Error('YandexGPT не вернул результат');

      let extracted;
      try {
        console.log('📥 Ответ YandexGPT:\n' + aiText);
        extracted = JSON.parse(aiText);
      } catch (parseErr) {
        console.error('❌ Ошибка парсинга JSON:\n', aiText);
        ctx.reply('⚠️ YandexGPT вернул некорректный формат. Попробуйте снова или введите вручную.');
        delete userState[chatId];
        return;
      }

      const newData = {
        fio: extracted.fio,
        role: extracted.role,
        lights: extracted.lights,
        amount: extracted.amount,
        period: extracted.period,
        date: new Date().toISOString().split('T')[0]
      };

      await appendToSheet(newData);
      ctx.reply(
        `✅ Готово! Заявка записана:\n👤 ${newData.fio}\n💼 ${newData.role}\n💡 ${newData.lights} светильников\n💰 ${newData.amount}\n📆 ${newData.period}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Добавить ещё одну заявку', 'ai_input')],
          [Markup.button.callback('🏁 Завершить', 'done')]
        ])
      );
    } catch (err) {
      console.error('❌ Ошибка YandexGPT-ввода:', err.message);
      ctx.reply('❌ Не удалось обработать AI-ввод. Введите вручную.');
    }

    delete userState[chatId];
  }
});

// Завершение
bot.action('done', (ctx) => {
  ctx.reply('Спасибо за работу! Чтобы начать снова, введите /start');
});

// Google Таблица
async function appendToSheet(data) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Лист1!A1:G1',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          data.fio,
          data.role,
          data.lights,
          data.amount,
          '',
          data.date,
          data.period
        ]
      ]
    }
  });
}

// Обработчик Yandex Cloud Function
module.exports.handler = async function(event) {
  console.log('🚨 HANDLER СРАБОТАЛ');
  console.log('📦 RAW EVENT:', JSON.stringify(event, null, 2));

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Ошибка обработки запроса:', err.message);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
