/**
 * CSV para abrir no Excel em português: separador `;`, BOM UTF-8 (acentos certos), CRLF entre
 * linhas. Célula que começa com `=`, `+`, `-`, `@`, tab ou CR ganha um apóstrofo na frente, para a
 * planilha não executar como fórmula um texto vindo de página pública (injeção de fórmula). Numa
 * planilha configurada com vírgula como separador, a vírgula abriria uma célula nova: célula com
 * vírgula vai entre aspas e a vírgula seguida de `=`, `+`, `-` ou `@` também ganha o apóstrofo.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
/** Marca de ordem de bytes: o Excel só lê o UTF-8 (acentos) com ela. */
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'boolean' ? (value ? 'sim' : 'não') : String(value);
  if (typeof value === 'string') {
    if (FORMULA_START.test(text)) text = `'${text}`;
    text = text.replace(/,(?=[=+\-@])/g, ",'");
  }
  return /[";,\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
