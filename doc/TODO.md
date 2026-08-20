# отложенные работы

Область действия: проект `/data/wd/aibox/autosetup`. Замыслы и отложенное с причиной
отсрочки; воспроизводимые дефекты -- в `BUGS.md`, инварианты -- в `INVARIANTS.md`.

## per-profile port base: свой набор портов каждому VM-профилю

Сейчас `data/vars.json5` объявляет один набор номеров (`qmpPort: 4000`, `spicePort`,
`vncPort`, `serialLogTcpPort`, `serialCommandTcpPort`, `guestPortForwards[].hostPort`) на
все профили из `data/profiles/`. Следствия:

- две VM физически не могут работать одновременно: вторая не займёт порты и упадёт;
- проба порта сама по себе ничего не доказывает о том, *какая* VM поднялась -- поэтому
  профили в `scripts/services.def` обязаны сверять `query-name` с `vm_name`
  (`/data/wd/aibox/dev-env/tools/process-manager/doc/PROBES.md`, плагин `qmp-probe`).

Задумано: номер порта выводится из базы, объявленной в самом профиле
(`data/profiles/<имя>.json5`), а `data/vars.json5` объявляет смещения внутри набора --
тогда `vmName` перестаёт быть единственным различителем, а `services.def` перестаёт
повторять число 4000 в обоих профилях.

Отложено: затрагивает `src/config.js`, `src/spawn-qemu-process.js` и всех потребителей
`config.qemu.*Port`, и не нужно до тех пор, пока обе VM не понадобятся одновременно.
