window.FIXTURE = {
  "exchanges": [
    {
      "id": "u0",
      "ts": "2026-10-09T09:40:00Z",
      "title": "How many tokens does it use when I write in English?",
      "blocks": [
        {
          "id": "u0",
          "role": "user",
          "state": "done",
          "tutor": "correction",
          "html": "<p>How <del>much</del> <strong>many</strong> tokens <del>it use</del> <strong>does it use</strong> when I write in <del>english</del> <strong>English</strong>?<br>Tokens считаются, поэтому many; в вопросе нужен does; названия языков с заглавной.</p>\n"
        },
        {
          "id": "a0",
          "role": "assistant",
          "state": "done",
          "html": "<p><span class=\"s\" tabindex=\"0\">About as many as the reply is long, once in and once out.</span><span class=\"tr\"><span class=\"tr-text\">Примерно столько, сколько длится ответ: один раз на вход и один на выход.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\">The main model does not pay anything extra.</span><span class=\"tr\"><span class=\"tr-text\">Основная модель ничего лишнего не тратит.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        }
      ]
    },
    {
      "id": "u1",
      "ts": "2026-10-09T10:02:00Z",
      "title": "How do I clear the panel?",
      "blocks": [
        {
          "id": "u1",
          "role": "user",
          "state": "done",
          "tutor": "translation",
          "html": "<p><span class=\"s\" tabindex=\"0\">How do I clear the panel?</span><span class=\"tr\"><span class=\"tr-text\">Как очистить панель?</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\">Let&#39;s think about the UX.</span><span class=\"tr\"><span class=\"tr-text\">Давай подумаем про UX.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\">I suggest showing only the latest exchange, with a history for this session.</span><span class=\"tr\"><span class=\"tr-text\">Я предлагаю показывать только последнее общение и сделать историю в рамках сессии.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        },
        {
          "id": "a1",
          "role": "assistant",
          "state": "done",
          "html": "<p><span class=\"s\" tabindex=\"0\">You can clear the panel from the History sheet.</span><span class=\"tr\"><span class=\"tr-text\">Очистить панель можно из шторки «История».</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\">It deletes only this session, and Claude keeps the conversation as it is.</span><span class=\"tr\"><span class=\"tr-text\">Удаляется только эта сессия, а разговор в Claude остаётся как есть.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n<p><span class=\"s\" tabindex=\"0\">To check the files, run:</span><span class=\"tr\"><span class=\"tr-text\">Чтобы проверить файлы, выполни:</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n<pre><code class=\"language-powershell\">Get-ChildItem $HOME\\.claude\\language-tutor\\sessions\n</code></pre>\n"
        },
        {
          "id": "a2",
          "role": "assistant",
          "state": "untranslated",
          "html": "<p><span class=\"s\" tabindex=\"0\">Готово: панель показывает только последнее общение, а история живёт в шторке.</span></p>\n"
        }
      ]
    }
  ],
  "settings": {
    "enabled": true,
    "level": "B1",
    "target": "English",
    "native": "Russian",
    "tutorModel": "haiku",
    "autoRead": false
  },
  "usage": {
    "input": 6200,
    "output": 3100,
    "calls": 9
  },
  "translatedA2": "<p><span class=\"s\" tabindex=\"0\">Done: the panel shows only the latest exchange, and the history lives in the sheet.</span><span class=\"tr\"><span class=\"tr-text\">Готово: панель показывает только последнее общение, а история живёт в шторке.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
};
