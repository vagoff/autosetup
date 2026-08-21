## CI/Deploy

1C CI/deploy workflow уже оформился. В 2026 году типовая схема такая:

```mermaid
flowchart TD
    A["push / merge в Git"] --> B["CI: GitLab / GitHub / Jenkins / Forgejo"]
    B --> C["self-hosted runner с платформой 1С"]
    C --> D["проверки и тесты"]
    D --> E["сборка .cf / .cfe"]
    E --> F["загрузка в тестовую ИБ"]
    F --> G["UpdateDBCfg + обработчики обновления"]
```

Никакого специального демона внутри 1С, который сам следит за Git, обычно нет. Push запускает CI, а runner вызывает штатные CLI платформы или их удобную обёртку.

### Главный стандартный инструмент — Vanessa Runner

[`vanessa-runner`](https://github.com/vanessa-opensource/vanessa-runner) — фактически сложившийся стандарт автоматизации 1С: сборка `.cf/.cfe`, загрузка исходников, обновление ИБ, запуск тестов и работа с хранилищем. Он одинаково запускается локально и в CI.

Для новой версии 3.0 команда выглядит так:

```bash
vrunner infobase update \
    --src ./src/cf \
    --ibconnection '/Sserver\database'
```

Она загружает исходники в конфигурацию и обновляет конфигурацию БД. Поддерживаются:

* XML-выгрузка Конфигуратора;
* EDT-проект;
* готовый `.cf`;
* файловые и серверные ИБ;
* Конфигуратор либо `ibcmd`.

[Документация `infobase update`](https://autumn-library.github.io/vanessa-runner/%D0%BA%D0%BE%D0%BC%D0%B0%D0%BD%D0%B4%D1%8B/infobase) прямо описывает загрузку нового источника и `UpdateDBCfg`.

Но есть нюанс: ветка 3.0 сейчас новая и несовместимая с предыдущей. Авторы пока рекомендуют для production закреплять LTS `2.6.1`; там эквивалентная команда:

```bash
vrunner update-dev \
    --src ./src/cf \
    --ibconnection '/Sserver\database'
```

То есть я бы сейчас сделал так:

* для консервативной боевой автоматизации — pin `vanessa-runner@2.6.1`;
* для нового проекта — испытать 3.0 на тестовой базе и только потом закрепить конкретную версию, не ставить плавающий `latest`.

### Что находится под Git

Есть три разумных варианта.

| Формат в Git                    | Где применяют              | Моя оценка                                 |
| ------------------------------- | -------------------------- | ------------------------------------------ |
| Иерархический XML Конфигуратора | Классический 1С-dev и CI   | Самый надёжный и простой для автоматизации |
| Нативный проект EDT             | Разработка полностью в EDT | Современнее, но CI тяжелее                 |
| `.cf/.cfe`                      | Только артефакт сборки     | Не исходники, а результат pipeline         |

EDT официально ориентирован на Git и даже умеет связывать разные ветки с разными информационными базами. [1С прямо описывает такой workflow](https://edt.1c.ru/docs/intro/features3.php).

Но платформа не читает формат EDT непосредственно: сначала нужен `1cedtcli`, превращающий EDT-проект в обычный XML, а затем уже загрузка платформой. Vanessa Runner 3 умеет делать это самостоятельно: [описание поддержки EDT](https://autumn-library.github.io/vanessa-runner/%D0%BA%D0%BE%D0%BC%D0%B0%D0%BD%D0%B4%D1%8B/edt). При этом `1cedtcli` довольно тяжёлый и ещё имеет реальные CI/headless-баги даже в версиях 2025–2026, например [регрессию headless import](https://github.com/1C-Company/1c-edt-issues/issues/2245). Если EDT вам сам по себе не нужен, для чистого agentic/CI workflow я бы выбрал XML Конфигуратора.

### Что делает runner на push

Практически правильная конфигурация:

1. Push в feature branch — анализ и тесты, без обновления общей базы.
2. Merge в `develop` — автоматическое обновление общей dev/test ИБ.
3. Tag/release — сборка неизменяемого `.cf/.cfe`.
4. Stage/prod — развёртывание именно собранного артефакта, желательно с ручным approval.

На runner:

```bash
git checkout "$CI_COMMIT_SHA"

bsl-language-server --analyze --srcDir ./src/cf

vrunner cf compile \
    --src ./src/cf \
    ./build/application.cf

vrunner infobase update \
    --src ./build/application.cf \
    --ibconnection "$IB_CONNECTION"
```

[`BSL Language Server`](https://1c-syntax.github.io/bsl-language-server/) — стандартный статический анализатор BSL. Для модульных тестов сейчас разумно смотреть на [`YAxUnit`](https://bia-technologies.github.io/yaxunit/), для сценарных/UI — [`Vanessa Automation`](https://github.com/Pr-Mex/vanessa-automation).

Runner должен быть self-hosted — Windows либо Linux-машина с нужной версией платформы, доступом к ИБ и соответствующим окружением. GitHub/GitLab/Forgejo лишь ставят job в очередь.

### Можно обойтись вообще без Vanessa Runner

Под ним лежит официальный пакетный интерфейс Конфигуратора:

```bash
1cv8 DESIGNER \
    /S 'server\database' \
    /N ci-user \
    /LoadConfigFromFiles ./src/cf \
    /UpdateDBCfg \
    /DisableStartupDialogs \
    /DisableStartupMessages \
    /Out ./build/deploy.log
```

Платформа официально поддерживает `/LoadConfigFromFiles` и `/UpdateDBCfg`; также существуют `-files`/`-listFile` для выборочной загрузки. [Документация пакетного режима](https://1c-dn.com/1c_enterprise/designer_batch_mode/).

Есть и официальный `ibcmd`:

```bash
ibcmd infobase config import ...
ibcmd infobase config apply ...
```

Он особенно интересен для headless Linux и автоматизации без GUI Конфигуратора. Но он требует параметров СУБД и работает ближе к кишкам базы, поэтому для первого production-конвейера я бы оставил Vanessa Runner поверх обычного Designer, а `ibcmd` включал после отдельного тестирования. Официальная документация подтверждает раздельные стадии [`config import`](https://kb.1ci.com/1C_Enterprise_Platform/Guides/Administrator_Guides/1C_Enterprise_8.3.24_Administrator_Guide/Chapter_7._Standalone_server/7.4._Examples_of_managing_and_starting_the_standalone_server/7.4.13._Dumping_configurations_to_files_Loading_configurations_from_files/) и [`config apply`](https://kb.1ci.com/1C_Enterprise_Platform/Guides/Administrator_Guides/1C_Enterprise_8.3.23_Administrator_Guide/7._Standalone_server/7.4._Examples_of_managing_and_starting_the_standalone_server/7.4.5._Load_configuration_from___.cf__file/).

### Важные грабли

* Деплой в одну ИБ обязательно сериализовать: два одновременных push не должны параллельно запускать обновление.
* Делать checkout точного SHA в чистый каталог, а не вечный `git pull`.
* Инкрементальную загрузку использовать только с сохранением состояния последнего успешно развёрнутого commit. При любой неопределённости — полная загрузка.
* `UpdateDBCfg` обновляет структуру базы, но не заменяет прикладные обработчики обновления БСП. Если конфигурация их использует, после этого нужен отдельный запуск режима Предприятия.
* `GitSync` здесь не нужен: он преимущественно выгружает версии из старого хранилища 1С в Git, то есть решает обратную задачу. [Это прямо видно из его описания](https://github.com/oscript-library/gitsync).
* В prod не стоит деплоить каждый случайный push. Автоматический push→deploy нормален для dev/test; production — только из защищённой ветки или тега, с backup и сохранённым `.cf`.

Итого: для вашей задачи я бы взял **иерархический XML → Git → Forgejo/GitLab runner → Vanessa Runner 2.6 LTS → dev-ИБ**, а после стабилизации проверил переход на Runner 3 и `ibcmd`. Это уже не кустарщина, а наиболее оформленный стандартный 1С-конвейер.

## Публикация ODATA

Штатная полностью автоматическая схема здесь такая:

**`.dt` → post-deploy обработка внутри ИБ → `webinst.exe` с шаблоном `.vrd` → restart Apache → проверка `$metadata` → запуск приложения.**

Одной загрузки `.dt` недостаточно: веб-публикация — состояние конкретной машины и Apache, в `.dt` она не входит. А публикация в Apache, в свою очередь, ещё не определяет, какие объекты конфигурации видны через OData.

## Что требуется именно для `hacker-cb/1c-odata`

Эта библиотека обращается только к стандартному интерфейсу:

```text
http://host/<publication>/odata/standard.odata
```

Web-сервисы `<ws>` и пользовательские `<httpServices>` ей не нужны. Для codegen/runtime metadata она читает `$metadata`. Текущая версия серверная, ESM, требует Node 24.18+ и обязательный `serverTimezone`. [README проекта](https://github.com/hacker-cb/1c-odata).

## 1. После восстановления `.dt`: настроить ИБ

Нужны две вещи.

### Состав OData

Для современных конфигураций публикация интерфейса не означает публикацию всех данных. Нужно вызвать:

```bsl
Состав = Новый Массив;

Для Каждого ПолноеИмя Из ТребуемыеОбъекты Цикл
    ОбъектМетаданных = Метаданные.НайтиПоПолномуИмени(ПолноеИмя);

    Если ОбъектМетаданных = Неопределено Тогда
        ВызватьИсключение "Не найден объект метаданных: " + ПолноеИмя;
    КонецЕсли;

    Состав.Добавить(ОбъектМетаданных);
КонецЦикла;

УстановитьСоставСтандартногоИнтерфейсаOData(Состав);
```

Например, `ТребуемыеОбъекты` берутся из версионируемого манифеста:

```text
Справочник.Номенклатура
Справочник.Контрагенты
Документ.РеализацияТоваровУслуг
РегистрСведений.ЦеныНоменклатуры
```

В production лучше публиковать точный allowlist, а не все метаданные. Официальная документация прямо рекомендует выполнять это внешней обработкой, не модифицируя конфигурацию. [Документация 1С по OData](https://kb.1ci.com/1C_Enterprise_Platform/FAQ/Development/Integration/How_to_use_the_oData_protocol_when_publishing_an_infobase_to_web_server/).

Обработку запускаете unattended:

```powershell
& $onecv8 ENTERPRISE `
    /F $baseDir `
    /N $adminUser `
    /P $adminPassword `
    /Execute $setupOdataEpf `
    /DisableStartupMessages `
    /DisableStartupDialogs `
    /Out $setupLog
```

Она устанавливает точный состав, пишет машинно-проверяемый результат и вызывает `ЗавершитьРаботуСистемы()`. Это можно завернуть в Vanessa Runner, но для единственного post-deploy шага необязательно.

### Служебный пользователь

Нужен отдельный пользователь ИБ со стандартной аутентификацией:

* скрытый из списка выбора;
* с известным паролем из secret storage;
* с минимальными правами на требуемые объекты;
* в типовой БСП-конфигурации — обычно роль/профиль `УдаленныйДоступOData` плюс предметные права.

`УдаленныйДоступOData` — не универсальная магическая роль платформы: назначение групп доступа в конфигурациях на БСП делается средствами БСП. Поэтому создание пользователя — единственная часть, которая зависит от конкретной конфигурации.

Пользователи ИБ приезжают внутри `.dt`, но хранить интеграционный пароль в образе — плохая идея. Нормальнее после восстановления идемпотентно создать/обновить пользователя и установить пароль из секрета той же EPF.

## 2. Версионируемый шаблон публикации

Минимальный `odata.vrd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<point xmlns="http://v8.1c.ru/8.2/virtual-resource-system"
       xmlns:xs="http://www.w3.org/2001/XMLSchema"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       base="/placeholder"
       ib="File=&quot;C:\placeholder&quot;;"
       enable="false">
    <standardOdata
        enable="true"
        reuseSessions="autouse"
        sessionMaxAge="20"
        poolSize="10"
        poolTimeout="5"/>
</point>
```

`enable="false"` отключает ненужный веб-клиент, но `standardOdata enable="true"` оставляет OData.

Старый атрибут корневого элемента `enableStandardOData="true"` устарел с 8.3.9; современная форма — дочерний `<standardOdata>`. Она же позволяет настроить пул сеансов. [Описание переиспользования сеансов от 1С](https://1c-dn.com/blog/improving-performance-of-web-services/).

## 3. Публикация штатным `webinst.exe`

Это канонический инструмент 1С. Он создаёт `default.vrd`, добавляет в Apache модуль `wsap24.dll`, `Alias`, `SetHandler 1c-application` и `ManagedApplicationDescriptor`.

```powershell
$webinstArgs = @(
    '-publish',
    '-apache24',
    '-wsdir', 'trade',
    '-dir', 'C:\1c\web\trade',
    '-connstr', 'File="C:\1c\bases\trade";',
    '-confpath', 'C:\Apache24\conf\httpd.conf',
    '-descriptor', 'C:\deploy\odata.vrd'
)

New-Item -ItemType Directory -Force 'C:\1c\web\trade' | Out-Null

& 'C:\Program Files\1cv8\8.3.27.x\bin\webinst.exe' @webinstArgs

if ($LASTEXITCODE -ne 0) {
    throw "webinst failed: $LASTEXITCODE"
}

& 'C:\Apache24\bin\httpd.exe' -t -f 'C:\Apache24\conf\httpd.conf'

if ($LASTEXITCODE -ne 0) {
    throw 'Apache configuration is invalid'
}

Restart-Service 'Apache2.4'
```

Важно:

* запускать elevated;
* брать `webinst.exe` из той же версии платформы, которой обслуживается база;
* Apache и web-extension 1С должны совпадать по разрядности;
* компонент платформы «Модули расширения веб-сервера» должен быть установлен;
* после обновления платформы публикацию надо прогнать заново, чтобы Apache ссылался на новый `wsap24.dll`;
* для файловой ИБ учётной записи службы Apache нужны `Modify` на каталог базы и `Read/Execute` на `bin` платформы; для клиент-серверной базы доступ к каталогу ИБ не нужен.

Параметр `-descriptor` как раз предназначен для автоматической публикации по заранее сохранённому шаблону. [Официальное описание `webinst`](https://1c-dn.com/anticrisis/tools-and-technologies/embedded-web-client/setting-up/).

## 4. Первоначальный bootstrap Apache

`webinst` конфигурирует публикацию 1С, но не превращает произвольно распакованный Apache в рабочую службу. Один раз автоматически нужно:

1. Проверить `ServerRoot`, `Listen`, `ServerName`.
2. Проверить `httpd.exe -t`.
3. Установить службу, если её нет:

```powershell
& $httpd -k install -n 'Apache2.4' -f $httpdConf
```

4. Запустить службу.
5. Если приложение находится на той же машине — слушать только `127.0.0.1`, вообще не открывая firewall.
6. Если OData доступна по сети — только HTTPS: библиотека использует Basic Auth, а по обычному HTTP пароль защищён лишь base64-кодированием.

## 5. Обязательный health check

Деплой считается завершённым только после реального запроса:

```powershell
$baseUrl = 'http://127.0.0.1:8080/trade/odata/standard.odata'
curl.exe --fail --silent --show-error `
    --user "${odataUser}:${odataPassword}" `
    "$baseUrl/`$metadata" `
    --output "$env:TEMP\1c-metadata.xml"
```

Затем уже проверка самой библиотеки:

```powershell
$env:ONEC_URL = "http://${odataUser}:${odataPassword}@127.0.0.1:8080/trade/odata/standard.odata"
pnpm 1c-odata fetch
```

Диагностика получается однозначной:

| Симптом                           | Что не настроено                                               |
| --------------------------------- | -------------------------------------------------------------- |
| 404                               | Apache/webinst/VRD                                             |
| 401                               | пользователь или пароль ИБ                                     |
| `$metadata` есть, но почти пустой | не вызван `УстановитьСоставСтандартногоИнтерфейсаOData()`      |
| ошибка прав                       | роли, группы доступа или RLS                                   |
| HTTP 500 с лицензией              | нет доступной лицензии 1С                                      |
| Apache не стартует                | разрядность/версия `wsap24.dll`, права либо битый `httpd.conf` |

Итого: я бы держал рядом с deployment-кодом четыре артефакта — `odata.vrd`, манифест состава OData, `setup-odata.epf` и `deploy.ps1`. Тогда после любого восстановления `.dt` вся связка действительно поднимается одной командой без единого клика.

## ODATA App side

Running integration tests locally

Live and write tests run against real 1С bases. Drop credentials into a repo-root .env.local:
```
ONEC_TESTS_ALLOW_WRITES=true
ONEC_TRADE_V11_5_URL=http://user:pass@host/path/odata/standard.odata
ONEC_BP_V3_0_URL=http://user:pass@host/path/odata/standard.odata
HTTP_PROXY=http://proxy.example.com:8080   # only if behind a corporate proxy
HTTPS_PROXY=http://proxy.example.com:8080  # mirror for HTTPS fixture URLs
```

The test setup installs an undici ProxyAgent directly from HTTP_PROXY / HTTPS_PROXY — no NODE_USE_ENV_PROXY needed (that flag governs Node's native fetch in the app runtime; see the root README "Network configuration").

Then pnpm test exercises every gate (unit + offline + live + write + e2e). Without .env.local, the live and write categories are silently skipped — setting any single ONEC_<ID>_URL activates only that fixture; missing URLs skip cleanly.

.env.local is git-ignored. Values never leave the developer machine and are not part of the published package.
