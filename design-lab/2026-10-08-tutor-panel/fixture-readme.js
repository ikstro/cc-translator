window.FIXTURE = {
  "exchanges": [
    {
      "id": "u1",
      "ts": "2026-10-21T09:05:00Z",
      "title": "Can you explain me why the build take so long?",
      "blocks": [
        {
          "id": "u1",
          "role": "user",
          "state": "done",
          "tutor": "correction",
          "html": "<p>Can you <del>explain me</del> <strong>explain to me</strong> why the build <del>take</del> <strong>takes</strong> so long?<br>После explain нужен to; the build — это «оно», поэтому takes.</p>\n"
        },
        {
          "id": "a1",
          "role": "assistant",
          "state": "done",
          "html": "<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">Most of the time goes to type checking, not to bundling.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Большая часть времени уходит на проверку типов, а не на сборку.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\" dir=\"auto\">esbuild alone finishes in under a second.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Сам esbuild справляется меньше чем за секунду.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        }
      ]
    },
    {
      "id": "u2",
      "ts": "2026-10-21T09:18:00Z",
      "title": "Great, let's look at the failing test next.",
      "blocks": [
        {
          "id": "u2",
          "role": "user",
          "state": "done",
          "tutor": "correct",
          "html": "<p>Great, let's look at the failing test next.</p>"
        },
        {
          "id": "a2",
          "role": "assistant",
          "state": "done",
          "html": "<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">Sure. Which test fails for you?</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Конечно. Какой тест у тебя падает?</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        }
      ]
    },
    {
      "id": "p1",
      "ts": "2026-10-21T09:30:00Z",
      "title": "Fix the path check on Windows",
      "kind": "plan",
      "blocks": [
        {
          "id": "p1",
          "role": "assistant",
          "state": "done",
          "html": "<h1><span class=\"s\" tabindex=\"0\" dir=\"auto\">Fix the path check on Windows</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Исправить проверку путей в Windows</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></h1>\n<h2><span class=\"s\" tabindex=\"0\" dir=\"auto\">Context</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Контекст</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></h2>\n<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">The check compares paths as they come, so a path with backslashes never matches.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Проверка сравнивает пути как есть, поэтому путь с обратными слэшами никогда не совпадает.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n<h2><span class=\"s\" tabindex=\"0\" dir=\"auto\">Steps</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Шаги</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></h2>\n<ol>\n<li><span class=\"s\" tabindex=\"0\" dir=\"auto\">Turn every backslash into a slash before comparing.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Перед сравнением заменять все обратные слэши на прямые.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></li>\n<li><span class=\"s\" tabindex=\"0\" dir=\"auto\">Compare drive letters without case.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Сравнивать буквы дисков без учёта регистра.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></li>\n<li><span class=\"s\" tabindex=\"0\" dir=\"auto\">Add tests for both kinds of path.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Добавить тесты для обоих видов путей.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></li>\n</ol>\n<h2><span class=\"s\" tabindex=\"0\" dir=\"auto\">Check</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Проверка</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></h2>\n<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">Run the tests in the panel folder; all of them should pass.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Запусти тесты в папке панели; все должны пройти.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        }
      ]
    },
    {
      "id": "u3",
      "ts": "2026-10-21T09:41:00Z",
      "title": "Why does the test fail only on Windows?",
      "blocks": [
        {
          "id": "u3",
          "role": "user",
          "state": "done",
          "tutor": "translation",
          "html": "<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">Why does the test fail only on Windows?</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Почему тест падает только на Windows?</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\" dir=\"auto\">Please look at the paths in feed.ts.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Посмотри, пожалуйста, пути в feed.ts.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
        },
        {
          "id": "a3",
          "role": "assistant",
          "state": "done",
          "html": "<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">The test builds the path with forward slashes, but Windows gives back backslashes.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Тест собирает путь с прямыми слэшами, а Windows возвращает обратные.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\" dir=\"auto\">So the two strings never match, even when they point to the same file.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Поэтому строки не совпадают, даже когда указывают на один и тот же файл.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">I changed the check so it turns every backslash into a slash first.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Я поменял проверку: сначала она заменяет все обратные слэши на прямые.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span>\n<span class=\"s\" tabindex=\"0\" dir=\"auto\">Run the tests again:</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Запусти тесты ещё раз:</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n<pre><code class=\"language-powershell\">npm test\n</code></pre>\n<p><span class=\"s\" tabindex=\"0\" dir=\"auto\">All 74 tests pass now.</span><span class=\"tr\"><span class=\"tr-text\" dir=\"auto\">Теперь проходят все 74 теста.</span><button class=\"icon-btn play\" data-play=\"sentence\" aria-label=\"Listen\" title=\"Listen\"><i class=\"codicon codicon-play\"></i></button></span></p>\n"
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
    "input": 5400,
    "output": 2900,
    "calls": 7
  }
};
