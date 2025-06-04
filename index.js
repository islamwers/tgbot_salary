const { Telegraf, Markup } = require('telegraf');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();
const ACCESS_PASSWORD = process.env.BOT_PASSWORD;
const authorizedUsers = {}; // Хранит авторизованных пользователей

const bot = new Telegraf(process.env.BOT_TOKEN);
const SHEET_ID = process.env.SHEET_ID;
const TEMPLATE_SHEET_NAME = 'Проект 1 (АмурМинералс)';
let userState = {};

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  // Если пользователь еще не авторизован — запрашиваем пароль
  if (!authorizedUsers[chatId]) {
    return ctx.reply('🔐 Введите пароль для доступа:');
  }

  // Пользователь авторизован — загружаем список проектов
  userState[chatId] = {};

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);

    const projectButtons = sheetNames.map(name => [`📂 ${name}`]); // по одному в строке

    await ctx.reply(
      '👋 Добро пожаловать! Выберите проект или создайте новый:',
      Markup.keyboard([
        ...projectButtons,
        ['➕ Создать новый проект'],
        ['🚀 Начать заново']
      ]).resize().oneTime()
    );
  } catch (err) {
    console.error('❌ Ошибка при загрузке проектов:', err);
    ctx.reply('❌ Не удалось загрузить список проектов.');
  }
});



bot.action(/^project:(.+)$/, async (ctx) => {
  const projectName = ctx.match[1];
  const chatId = ctx.chat.id;

  if (projectName === 'new') {
    const newSheetName = `Проект ${Date.now()}`;
    try {
      await copySheet(TEMPLATE_SHEET_NAME, newSheetName);
      userState[chatId] = { sheet: newSheetName };
      ctx.reply(`✅ Новый проект создан: ${newSheetName}`);
    } catch (err) {
      return ctx.reply('❌ Не удалось создать проект');
    }
  } else {
    userState[chatId] = { sheet: projectName };
  }

  ctx.reply(
    'Что вы хотите внести?',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Расход', 'input:expense')],
      [Markup.button.callback('💰 Доход', 'input:income')],
      [Markup.button.callback('🤖 AI-ввод', 'input:ai')],
      [Markup.button.callback('📤 Скачать таблицу', 'download')],
      [Markup.button.callback('📄 Последние 5 записей', 'preview')],
      [Markup.button.callback('🔙 К проектам', 'back_to_projects')]
    ])
  );
});

bot.action('download', async (ctx) => {
  const state = userState[ctx.chat.id];
  if (!state?.sheet) return ctx.reply('Сначала выберите проект');

  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

  try {
    const res = await drive.files.export(
      {
        fileId: SHEET_ID,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(res.data);

    await ctx.replyWithDocument({
      source: buffer,
      filename: 'Финансовый_отчет.xlsx'
    });
  } catch (err) {
    console.error('Ошибка при экспорте таблицы:', err.message);
    ctx.reply('❌ Не удалось скачать таблицу. Убедитесь, что SHEET_ID корректный и таблица доступна.');
  }
});



bot.action('preview', async (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state?.sheet) return ctx.reply('Пожалуйста, выберите проект сначала.');

  const sheets = google.sheets({
    version: 'v4',
    auth: await new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    }).getClient()
  });

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${state.sheet}'!A2:F`
    });

    const rows = res.data.values || [];
    const last5 = rows.slice(-5);

    if (!last5.length) return ctx.reply('Нет записей.');

    last5.forEach((row, index) => {
      const [
        date = '—',
        category = '—',
        amountNoVAT = '—',
        amountWithVAT = '—',
        vat = '—',
        comment = '—'
      ] = row;

      ctx.reply(
        `Запись ${index + 1}:\n` +
        `📅 Дата внесения: ${date}\n` +
        `📂 Категория: ${category}\n` +
        `💵 Сумма без НДС: р.${amountNoVAT}\n` +
        `💰 Сумма с НДС: р.${amountWithVAT}\n` +
        `🧾 НДС: р.${vat}\n` +
        `📝 Комментарий: ${comment || '—'}`
      );
    });
  } catch (err) {
    console.error('❌ Ошибка при получении данных:', err);
    ctx.reply('❌ Не удалось получить записи.');
  }
});


bot.action(/^input:(.+)$/, (ctx) => {
  const type = ctx.match[1];
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state) return ctx.reply('Пожалуйста, выберите проект командой /start.');

  state.step = type;
  state.data = { date: new Date().toISOString().split('T')[0] };

  if (type === 'income') {
    ctx.reply('Введите сведения о доходе: ваш комментарий');
    state.substep = 'info';
  } else if (type === 'expense') {
    ctx.reply('Выберите категорию расхода:', Markup.keyboard([
      ['Закупка Электромонтажных Материалов', 'Закупка Светильников'], ['Проживание', 'Автомобили обслуживание'],
      ['Спецодежда', 'Обучение'], ['НДС', 'НП'], ['Проезд (транспортные расходы)', 'Лизинг'], ['Прочие расходы']
    ]).oneTime().resize());
    state.substep = 'category';
  } else if (type === 'ai') {
    ctx.reply(`💰 Отправьте сообщение с доходом/расходом:
(пример: 
💵 1. Доход: сведения о доходе - ..., сумма 50000 (без учета НДС), дата: 01.05.2025

🧾 2. Расход: стоимость 10000 (с учетом НДС или без учета НДС), категория - ФОТ РП, комментарий)`);
    state.substep = 'ai_wait';
  }
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();

  if (!authorizedUsers[chatId]) {
    if (text === ACCESS_PASSWORD) {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (err) {
      console.error('❌ Не удалось удалить сообщение с паролем:', err.message);
      }

      authorizedUsers[chatId] = true;

    // Показываем меню сразу после ввода пароля
      userState[chatId] = {};
      // Получить список листов из таблицы
      const auth = new google.auth.GoogleAuth({
        keyFile: 'credentials.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const client = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: client });

      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
      const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);

      // Собираем клавиатуру из листов
      const projectButtons = sheetNames.map(name => [`📂 ${name}`]);

      await ctx.reply(
        '✅ Пароль принят. Добро пожаловать! Выберите проект или создайте новый:',
        Markup.keyboard([
          ...projectButtons,
          ['➕ Создать новый проект'],
          ['🚀 Начать заново']
        ]).resize().oneTime()
      );

    } else {
    return ctx.reply('❌ Неверный пароль. Попробуйте снова:');
    }
  }


  // Обработка выбора проекта — БЕЗ state
  if (text.startsWith('📂 ')) {
    const projectName = text.replace('📂 ', '');
    userState[chatId] = { sheet: projectName };

    return ctx.reply(
      'Что вы хотите внести?',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Расход', 'input:expense'), Markup.button.callback('💰 Доход', 'input:income')],
        [Markup.button.callback('🤖 AI-ввод', 'input:ai'), Markup.button.callback('📄 Последние 5 записей', 'preview')],
        [Markup.button.callback('📤 Скачать таблицу', 'download')],
        [Markup.button.callback('🔙 К проектам', 'back_to_projects')]
      ])
    );
  }


  if (text === '➕ Создать новый проект') {
  userState[chatId] = { ...userState[chatId], creatingProject: true };
  return ctx.reply('📝 Введите название нового проекта (это будет имя нового листа в Google таблице):');
  }

  if (userState[chatId]?.creatingProject) {
    const projectName = text.trim();
    if (!projectName) return ctx.reply('⚠️ Название проекта не может быть пустым.');

    try {
      await copySheet(TEMPLATE_SHEET_NAME, projectName);
      userState[chatId] = {
        sheet: projectName,
        step: null,
        data: {},
        lastRow: {}
      };
      delete userState[chatId].creatingProject; // ←❗ ключевая строка: сбрасываем флаг
      return ctx.reply(
        `✅ Проект "${projectName}" успешно создан и выбран.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Расход', 'input:expense'), Markup.button.callback('💰 Доход', 'input:income')],
          [Markup.button.callback('🤖 AI-ввод', 'input:ai'), Markup.button.callback('📄 Последние 5 записей', 'preview')],
          [Markup.button.callback('📤 Скачать таблицу', 'download')],
          [Markup.button.callback('🔙 Меню проектов', 'back_to_projects')]
        ])
      );
    } catch (err) {
    console.error('❌ Ошибка создания проекта:', err.message);
    return ctx.reply('❌ Не удалось создать проект. Попробуйте другое имя.');
    }
  }


  if (text === '🚀 Начать заново') {
    return bot.start(ctx);
  }

  // Всё остальное — только если state уже есть
  const state = userState[chatId];
  if (!state || !state.step) return ctx.reply('Введите /start для начала.');

  // ---- Ручной ввод дохода ----
  if (state.step === 'income') {
    if (state.substep === 'info') {
      state.data.info = text;
      ctx.reply('Введите сумму с НДС или без НДС (например: "5000" или "5000 с НДС")');
      state.substep = 'amount';
    } else if (state.substep === 'amount') {
      const amountMatch = text.match(/(\d+(\.\d+)?)(\s*с\s*ндс)?/i);
      if (!amountMatch) return ctx.reply('Введите корректную сумму.');

      const value = parseFloat(amountMatch[1]);
      const isWithVAT = /с\s*ндс/i.test(text);

      if (isWithVAT) {
        state.data.amountWithVAT = value;
        state.data.amountNoVAT = +(value / 1.2).toFixed(2);
        state.data.vat = +(value - state.data.amountNoVAT).toFixed(2);
      } else {
        state.data.amountNoVAT = value;
        state.data.amountWithVAT = +(value * 1.2).toFixed(2);
        state.data.vat = +(state.data.amountWithVAT - value).toFixed(2);
      }
      console.log('📌 State before confirm:', state);
      state.lastRow = { type: 'income' };
      await confirmLastEntry(ctx, state);
      
    }
    return;
  }

  // ---- Ручной ввод расхода ----
  if (state.step === 'expense') {
    if (state.substep === 'category') {
      state.data.category = text;
      ctx.reply('Введите сумму с НДС или без НДС (например: "5000" или "5000 с НДС")');
      state.substep = 'amount';
    } else if (state.substep === 'amount') {
      const amountMatch = text.match(/(\d+(\.\d+)?)(\s*с\s*ндс)?/i);
      if (!amountMatch) return ctx.reply('Введите корректную сумму.');

      const value = parseFloat(amountMatch[1]);
      const isWithVAT = /с\s*ндс/i.test(text);

      if (isWithVAT) {
        state.data.amountWithVAT = value;
        state.data.amountNoVAT = +(value / 1.2).toFixed(2);
        state.data.vat = +(value - state.data.amountNoVAT).toFixed(2);
      } else {
        state.data.amountNoVAT = value;
        state.data.amountWithVAT = +(value * 1.2).toFixed(2);
        state.data.vat = +(state.data.amountWithVAT - value).toFixed(2);
      }

      ctx.reply('Введите комментарий (или "-" для пропуска):');
      state.substep = 'comment';
    } else if (state.substep === 'comment') {
      state.data.comment = text === '-' ? '' : text;
      console.log('📌 State before confirm:', state);
      state.lastRow = { type: 'expense' };
      await confirmLastEntry(ctx, state);
    }
    return;
  }

  // ---- AI ввод ----
  if (state.step === 'ai' && state.substep === 'ai_wait') {
    const prompt = `Преобразуй текст в JSON с полями:
{
  "type": "Доход или Расход",
  "category": "категория расходов: (они должны быть из этого списка: 1.	Расходы с НДС 2.	Расходы без НДС 3.	ФОТ МОНТАЖНИКИ 4.	ФОТ ИТР 5.	ФОТ РП
)",
  "amount": "сумма без НДС (только число). Сделай внимание на том, что эта сумма без учета налога (без НДС). Причем если написано 10к, то это 10000, 1 млн - это 1000000 и т.д",
  "amount1": "сумма с НДС (только число). Сделай внимание на том, что эта сумма с учетом налога (с НДС). Причем если написано 10к, то это 10000, 1 млн - это 1000000 и т.д",
  "date": "дата (в формате ГГГГ-ММ-ДД). Если будет указано "сегодня", то укажи текущую дату (сегодняшнюю)",
  "comment": "комментарий (если есть)"
}
Возвращай ТОЛЬКО JSON без пояснений. Вот текст: "${text}"`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'Ты помощник по заполнению финансовых записей. Отвечай только JSON.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 1000
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const result = await response.json();

      if (result.error) {
        console.error('DeepSeek error:', result.error.message);
        ctx.reply(`⚠️ GPT ошибка: ${result.error.message}`);
        return;
      }

      const raw = result.choices?.[0]?.message?.content || '';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const extracted = JSON.parse(cleaned);

      const date = extracted.date || new Date().toISOString().split('T')[0];
      const comment = extracted.comment || '';
      const amount = parseFloat(extracted.amount);

      if (isNaN(amount)) return ctx.reply('⚠️ AI не смог распознать сумму.');

      if (extracted.type?.toLowerCase() === 'доход') {
        const incomeData = {
          date,
          info: extracted.description || 'AI доход',
          amountNoVAT: amount,
          amountWithVAT: +(amount * 1.2).toFixed(2),
          vat: +(amount * 0.2).toFixed(2)
        };
        state.data = incomeData;
        state.lastRow = { type: 'income' };
        console.log('📌 State before confirm:', state);
        await confirmLastEntry(ctx, state);
      } else if (extracted.type?.toLowerCase() === 'расход') {
        const expenseData = {
          date,
          category: extracted.category || 'Прочее',
          amountNoVAT: amount,
          amountWithVAT: +(amount * 1.2).toFixed(2),
          vat: +(amount * 0.2).toFixed(2),
          comment
        };
        state.data = expenseData;
        state.lastRow = { type: 'expense' };
        console.log('📌 State before confirm:', state);
        await confirmLastEntry(ctx, state);
      }
      else {
        ctx.reply('⚠️ AI не смог определить тип: Доход или Расход.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        ctx.reply('⚠️ GPT не ответил вовремя.');
      } else {
        console.error('❌ Ошибка AI-ввода:', err);
        ctx.reply('❌ Не удалось обработать AI-ввод.');
      }
    }

    // delete userState[chatId]; удалено для исправления ошибки сохранения состояния
    return;
  }
});

async function appendExpense(state) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const values = [[
    state.data.date,
    state.data.category,
    state.data.amountNoVAT,
    state.data.amountWithVAT,
    state.data.vat,
    state.data.comment || ''
  ]];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${state.sheet}'!A1:F1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });

  const updatedRange = res.data.updates.updatedRange;
  const rowIndex = parseInt(updatedRange.match(/!(?:[A-Z]+)(\d+)/)[1]);
  state.lastRow = { index: rowIndex, type: 'expense' };
console.log('✅ Expense appended, state updated:', state.lastRow);
}

async function appendIncome(state) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const values = [[
    state.data.date,
    state.data.info,
    state.data.amountNoVAT,
    state.data.amountWithVAT,
    state.data.vat
  ]];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${state.sheet}'!H1:L1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values }
  });

  const updatedRange = res.data.updates.updatedRange;
  const rowIndex = parseInt(updatedRange.match(/!(?:[A-Z]+)(\d+)/)[1]);
  state.lastRow = { index: rowIndex, type: 'income' };
console.log('✅ Income appended, state updated:', state.lastRow);
}



async function confirmLastEntry(ctx, state) {
  const data = state.data;
  if (state.lastRow.type === 'expense') {
    await ctx.reply(
      `✅ Запись обработана. Проверьте на корректность:
📅 Дата внесения: ${data.date}
📂 Категория: ${data.category}
💵 Сумма без НДС: р.${data.amountNoVAT.toLocaleString('ru-RU')}
💰 Сумма с НДС: р.${data.amountWithVAT.toLocaleString('ru-RU')}
🧾 НДС: р.${data.vat.toLocaleString('ru-RU')}
📝 Комментарий: ${data.comment || '—'}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Оставить', 'keep_last')],
        [Markup.button.callback('🗑 Удалить', 'delete_last')]
      ])
    );
  } else {
    await ctx.reply(
      `✅ Запись обработана. Проверьте на корректность:
📅 Дата внесения: ${data.date}
🧾 Сведения о доходе: ${data.info}
💰 Пришло с НДС: р.${data.amountWithVAT.toLocaleString('ru-RU')}
💵 Без НДС: р.${data.amountNoVAT.toLocaleString('ru-RU')}
🧾 НДС: р.${data.vat.toLocaleString('ru-RU')}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Оставить', 'keep_last')],
        [Markup.button.callback('🗑 Удалить', 'delete_last')]
      ])
    );
  }
}



bot.action('keep_last', async (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state?.data || !state?.lastRow) return ctx.reply('❌ Нет данных для сохранения.');

  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  let updatedRange, rowIndex;

  if (state.lastRow.type === 'income') {
    const values = [[
      state.data.date,
      state.data.info,
      state.data.amountNoVAT,
      state.data.amountWithVAT,
      state.data.vat
    ]];

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `'${state.sheet}'!H1:L1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });

    updatedRange = res.data.updates.updatedRange;
    rowIndex = parseInt(updatedRange.match(/\d+/)[0]);
    state.lastRow.index = rowIndex;

  } else {
    const values = [[
      state.data.date,
      state.data.category,
      state.data.amountNoVAT,
      state.data.amountWithVAT,
      state.data.vat,
      state.data.comment || ''
    ]];

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `'${state.sheet}'!A1:F1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });

    updatedRange = res.data.updates.updatedRange;
    rowIndex = parseInt(updatedRange.match(/\d+/)[0]);
    state.lastRow.index = rowIndex;
  }

  // ✅ Ответ с кнопками
  await ctx.reply('✅ Запись сохранена в таблицу.', Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить ещё', 'start_over')],
    [Markup.button.callback('📄 Последние записи', 'preview')],
    [Markup.button.callback('🔙 В меню', 'back_to_menu')]
  ]));

  // ✅ Сохраняем только нужную часть состояния для новой итерации
  userState[chatId] = {
    sheet: state.sheet,
    step: state.lastRow.type,
    lastRow: { type: state.lastRow.type }
  };
});



async function copySheet(fromSheetName, toSheetName) {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const fromSheet = spreadsheet.data.sheets.find(s => s.properties.title === fromSheetName);

  if (!fromSheet) throw new Error('Шаблонный лист не найден');

  const copy = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId: SHEET_ID,
    sheetId: fromSheet.properties.sheetId,
    requestBody: { destinationSpreadsheetId: SHEET_ID },
  });

  const newSheetId = copy.data.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: newSheetId,
            title: toSheetName
          },
          fields: 'title'
        }
      }]
    }
  });

  // ✅ Очистить значения в диапазонах расходов, доходов, сравнения
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: SHEET_ID,
    requestBody: {
      ranges: [
        `'${toSheetName}'!A2:F`, // Расходы
        `'${toSheetName}'!H2:L`, // Доходы
        `'${toSheetName}'!N2:U`  // Сравнение
      ]
    }
  });
}

module.exports.handler = async function(event) {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    await bot.handleUpdate(body);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('❌ Ошибка обработки запроса:', err.message);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

bot.action('delete_last', async (ctx) => {
  const chatId = ctx.chat.id;
  const oldState = userState[chatId];
  userState[chatId] = { sheet: oldState?.sheet }; // сохраняем проект

  await ctx.reply('🗑 Запись удалена (отменена).');

  await ctx.reply(
    'Что вы хотите внести?',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Расход', 'input:expense'), Markup.button.callback('💰 Доход', 'input:income')],
      [Markup.button.callback('🤖 AI-ввод', 'input:ai'), Markup.button.callback('📄 Последние 5 записей', 'preview')],
      [Markup.button.callback('📤 Скачать таблицу', 'download')],
      [Markup.button.callback('🔙 К проектам', 'back_to_projects')]
    ])
  );
});


bot.action('create_project', async (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { ...userState[chatId], creatingProject: true };
  await ctx.reply('📝 Введите название нового проекта (это будет имя нового листа в таблице):');
});

bot.action('back_to_projects', async (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = {}; // Сбросим выбор проекта

  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  try {
    const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheetTitles = sheetMeta.data.sheets.map(s => s.properties.title);

    const buttons = sheetTitles.map(name => [Markup.button.callback(name, `project:${name}`)]);
    buttons.push([Markup.button.callback('📁 Создать новый проект', 'create_project')]);

    await ctx.reply(
      'Выберите проект:',
      Markup.inlineKeyboard(buttons)
    );
  } catch (err) {
    console.error('Ошибка при возврате к проектам:', err.message);
    ctx.reply('❌ Не удалось получить список проектов.');
  }
});


bot.action('start_over', (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];

  if (!state || !state.lastRow?.type) {
    return ctx.reply('❌ Не удалось определить, что добавить. Начните заново.');
  }

  const type = state.lastRow.type;

  if (type === 'income') {
    state.step = 'income';
    state.substep = 'info';
    state.data = { date: new Date().toISOString().split('T')[0] };
    ctx.reply('Введите сведения о доходе: ваш комментарий');
  }

  else if (type === 'expense') {
    state.step = 'expense';
    state.substep = 'category';
    state.data = { date: new Date().toISOString().split('T')[0] };
    ctx.reply('Выберите категорию расхода:', Markup.keyboard([
      ['Закупка Электромонтажных Материалов', 'Закупка Светильников'],
      ['Проживание', 'Автомобили обслуживание'],
      ['Спецодежда', 'Обучение'],
      ['НДС', 'НП'],
      ['Проезд (транспортные расходы)', 'Лизинг'],
      ['Прочие расходы']
    ]).oneTime().resize());
  }

  else if (type === 'ai') {
    state.step = 'ai';
    state.substep = 'ai_wait';
    ctx.reply(`💰 Отправьте сообщение с доходом/расходом:
(пример: Доход: поступление на сумму 50000 руб без НДС, дата: 01.05.2025
Расход: 10000 с НДС, категория - ФОТ РП, комментарий)`);
  }

  else {
    ctx.reply('❌ Неизвестный тип записи.');
  }
});

bot.action('back_to_menu', async (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state?.sheet) {
    return ctx.reply('Пожалуйста, выберите проект сначала.');
  }

  await ctx.reply(
    'Что вы хотите внести?',
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Расход', 'input:expense'), Markup.button.callback('💰 Доход', 'input:income')],
      [Markup.button.callback('🤖 AI-ввод', 'input:ai'), Markup.button.callback('📄 Последние 5 записей', 'preview')],
      [Markup.button.callback('📤 Скачать таблицу', 'download')],
      [Markup.button.callback('🔙 К проектам', 'back_to_projects')]
    ])
  );
});
