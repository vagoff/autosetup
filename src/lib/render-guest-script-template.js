import { readFileSync } from 'node:fs';

// .ps1-файл остаётся настоящим, читаемым PowerShell-скриптом (можно
// открыть в редакторе, прогнать линтером отдельно) — не JS-строкой с
// экранированием кавычек. {{TOKEN}} — единственный вид подстановки,
// значения — забота вызывающего (build-first-logon-commands.js), сам
// этот файл ничего не знает про смысл токенов (SRP).
//
// Fail-fast: неразрешённый токен — это опечатка или забытый параметр,
// а не "просто оставим как есть" — такой скрипт в госте либо не
// исполнится, либо исполнится не так, как задумано.
export function renderGuestScriptTemplate(templatePath, tokens) {
  let text = readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(tokens)) {
    text = text.replaceAll(`{{${key}}}`, String(value));
  }
  const unresolved = text.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`${templatePath}: неразрешённые токены: ${unresolved.join(', ')}`);
  }
  return text;
}
