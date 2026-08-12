import { existsSync } from 'node:fs';

// Ищет первый существующий путь из списка кандидатов известных мест
// установки пакета (например разных схем именования OVMF в разных
// дистрибутивах). Не решает МЕЖДУ разными действиями — только находит
// ресурс, аналогично поиску исполняемого файла в PATH. При отсутствии
// падает с чётким списком проверенных путей (fail-fast).
export function resolveExistingPath(candidates, description) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `${description}: не найден ни один из путей:\n` +
    candidates.map((c) => `  - ${c}`).join('\n')
  );
}
