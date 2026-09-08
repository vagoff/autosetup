100% автоматически воспроизводимый windows и 1c environment в qemu с загруженной копией инфобазы с продакшена для отладки и экспериментов
с удобной декларативной модульной конфигурацией.

центральная идея проекта -- полностью автоматизированная установка окружения без внутреннего вмешательства руками вообще, что агента что человека.

документация проекта:

- `/data/wd/aibox/autosetup/doc/INVARIANTS.md` -- локальные инварианты, читать до правок;
- `/data/wd/aibox/autosetup/doc/architecture.md` -- из чего это собрано;
- `/data/wd/aibox/autosetup/doc/BUGS.md` -- известные дефекты;
- `/data/wd/aibox/autosetup/doc/TODO.md` -- отложенное, с причинами отсрочки.

VM запускаются как сервисы process-manager: `/data/wd/aibox/autosetup/scripts/services.def`
(пробы и штатный shutdown через COM2 -- `/data/wd/aibox/dev-env/tools/process-manager/doc/PROBES.md`).
