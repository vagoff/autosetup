Для нашей задачи ответ — «Это копия» (Продолжить работу с копией / работа с внешними ресурсами блокируется): копия продакшена не должна слать почту, обмениваться данными и выполнять регламентные задания наружу. Ответ «перемещена» разблокирует внешние ресурсы — для копии продакшена это опасно.

---

```
node src/send-guest-text.js --text 'hello'
printf 'hello' | node src/send-guest-text.js --stdin
AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/send-guest-text.js --file a
```

