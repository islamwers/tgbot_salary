# tgbot_salary
TelegramBotsalary — телеграм-бот для учёта заявок, финансовых операций или внутренних процессов. Поддерживает ввод данных вручную и с помощью ИИ, интеграцию с Google Таблицами и гибкую настройку через Yandex Cloud / Node.js.

TelegramBotsalary — a Telegram bot for managing requests, financial entries, or internal workflows. Supports both manual and AI-powered data input, integration with Google Sheets, and flexible deployment via Yandex Cloud / Node.js.

⚙️ Стек технологий
Node.js (Telegram Bot API, Google API)
Yandex Cloud Functions
Google Sheets API
OpenAI / DeepSeek API (AI-ввод данных)
Telegraf (Telegram bot framework)
dotenv (хранение переменных среды)
axios (внешние запросы)

📁 Структура проекта
TelegramBotCellary/
├── functions/
│   ├── index.js           // Главная логика бота
│   ├── handlers/          // Обработчики кнопок, ввода, состояний
│   │   ├── manualInput.js
│   │   ├── aiInput.js
│   │   └── projectSelector.js
│   ├── services/          // Работа с Google Sheets, AI и т.д.
│   │   ├── googleSheets.js
│   │   ├── openAI.js
│   │   └── utils.js
├── .env                   // Переменные окружения
├── credentials.json       // Ключ доступа к Google Sheets API
├── package.json
└── README.md
🔐 Файлы авторизации
.env — содержит токены и конфиденциальные данные. Пример:

env
BOT_TOKEN=your_telegram_bot_token
SHEET_ID=your_google_sheet_id
YANDEX_FUNCTION_URL=https://functions.yandexcloud.net/...
OPENAI_API_KEY=your_openai_or_deepseek_key
credentials.json — OAuth2-секрет для доступа к Google Sheets от сервисного аккаунта. Генерируется в Google Cloud Console.

🧠 Что умеет бот
Выбор проекта (каждый проект — отдельный лист Google Таблицы)
Два режима ввода:
💬 Ручной ввод: бот пошагово запрашивает ФИО, подразделение, сумму
🤖 AI-ввод: бот получает текст/голос/фото и извлекает данные с помощью ИИ
Запись в Google Таблицу: данные отправляются на нужный лист и структурируются (например, с расчётом НДС)
Создание новых проектов (бот предлагает создать новый лист, если нужно)
Гибкое состояние пользователя (бот “помнит” действия юзера при возвратах в меню)

✅ Требования
Node.js ≥ 16
Yandex Cloud CLI или консоль доступа
Аккаунт Telegram и Google Cloud
Таблица с листами «Проект 1», «Проект 2», … с тремя секциями: Доходы, Расходы, Сравнение

🚀 Деплой на Yandex Cloud Functions
Создать функцию на https://console.cloud.yandex.ru/functions
Настроить триггер по HTTP
Загрузить архив проекта с index.js, node_modules, и т.д.
Указать переменные окружения (BOT_TOKEN, SHEET_ID и др.)
Скопировать публичный URL для webhook

