# 1C OData demo

Маленькая демо-страница поверх опубликованного стандартного OData-интерфейса
(`src/publish-1c-odata.js`): просмотр и редактирование топ-документов из
`data/1c-odata.json5#demo.documentNames`, включая ссылочный реквизит
(`Организация`, справочник `Catalog_Организации`).

Не фреймворк: `server.js` -- голый `node:http`, `index.html` -- один файл без
сборки. Правки реально пишутся в загруженную копию продакшн-ИБ через
`@1c-odata/client` (`vendor/1c-odata`).

## Запуск

```
cd features/odata-demo
npm install                                     # один раз
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node server.js
```

Откройте `http://127.0.0.1:8090/`. Порт/хост -- `data/1c-odata.json5#demo`.

Предпосылки: 1С+конфигурация установлены, `node src/publish-1c-odata.js`
уже прогнан (публикация и пользователь `autosetup-odata` существуют), Apache
и OData отвечают на `data/1c-odata.json5#endpointPath`.

Сервер работает в foreground -- не забудьте остановить его (`Ctrl+C`), когда
закончите, иначе он будет висеть и держать порт.

## Регрессия

`test/live/odata-demo.test.js` (`AUTOSETUP_LIVE_TESTS=1 npm run test:live`) --
поднимает сервер сам (свой порт через `ODATA_DEMO_PORT`, не 8090), проверяет
список документов/организаций и реальный `PATCH` с percent-encoded кириллицей
в пути (регрессия на баг, из-за которого правки со страницы раньше падали 404).
