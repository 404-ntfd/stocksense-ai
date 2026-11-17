// SQL guard: the model may write SQL, but only a single read-only SELECT over the allowed views
// ever reaches SQLite. This is a real tokenizer (strings, quoted identifiers and comments are
// understood), not a regex over the raw text, so keywords hidden in comments or split by
// whitespace tricks do not get through.

export type GuardResult =
  | { ok: true; sql: string; tables: string[]; limited: boolean }
  | { ok: false; code: GuardCode; reason: string };

export type GuardCode =
  | 'EMPTY' | 'TOO_LONG' | 'UNTERMINATED' | 'MULTI_STATEMENT' | 'NOT_SELECT' | 'FORBIDDEN_KEYWORD'
  | 'FORBIDDEN_FUNCTION' | 'TABLE_NOT_ALLOWED' | 'QUALIFIED_NAME' | 'BAD_CTE_NAME';

export interface Token { t: 'word' | 'qident' | 'string' | 'num' | 'punct' | 'param'; v: string; depth: number }

const FORBIDDEN = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE', 'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX',
  'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'TRIGGER', 'UPSERT', 'TRUNCATE', 'MERGE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL',
]);
const FORBIDDEN_FUNCTIONS = new Set(['load_extension', 'readfile', 'writefile', 'zeroblob', 'randomblob', 'fts3_tokenizer', 'sqlite_compileoption_get', 'edit']);
const TABLE_FUNCTIONS = new Set(['json_each', 'json_tree', 'generate_series']);
const BASE_TABLES = new Set(['products', 'sales', 'purchases', 'expenses', 'stock_movements', 'suppliers', 'customers']);
const END_FROM = new Set(['WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'SELECT', 'WINDOW', 'RETURNING', 'VALUES']);
export const DEFAULT_LIMIT = 1000;
export const MAX_SQL_LENGTH = 4000;

/** Splits SQL into tokens and returns the text with comments removed. Returns null when a string or comment never ends. */
export function tokenize(input: string): { tokens: Token[]; clean: string } | null {
  const tokens: Token[] = [];
  let clean = '';
  let i = 0;
  let depth = 0;
  const n = input.length;
  const isWord = (c: string): boolean => /[A-Za-z0-9_$\u0080-￿]/.test(c);
  while (i < n) {
    const c = input[i];
    const c2 = input[i + 1];
    if (c === '-' && c2 === '-') { // line comment
      while (i < n && input[i] !== '\n') i++;
      clean += ' ';
      continue;
    }
    if (c === '/' && c2 === '*') { // block comment
      const end = input.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      clean += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      let found = false;
      while (j < n) {
        if (input[j] === close) {
          if (close !== ']' && input[j + 1] === close) { j += 2; continue; } // doubled quote = escaped
          found = true;
          break;
        }
        j++;
      }
      if (!found) return null;
      const raw = input.slice(i, j + 1);
      const inner = raw.slice(1, -1).split(close + close).join(close);
      tokens.push({ t: c === "'" ? 'string' : 'qident', v: inner, depth });
      clean += raw;
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) { clean += c; i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && c2 !== undefined && /[0-9]/.test(c2))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(input[j])) {
        if ((input[j] === 'e' || input[j] === 'E') && (input[j + 1] === '+' || input[j + 1] === '-')) j++;
        j++;
      }
      tokens.push({ t: 'num', v: input.slice(i, j), depth });
      clean += input.slice(i, j);
      i = j;
      continue;
    }
    if (isWord(c)) {
      let j = i + 1;
      while (j < n && isWord(input[j])) j++;
      tokens.push({ t: 'word', v: input.slice(i, j), depth });
      clean += input.slice(i, j);
      i = j;
      continue;
    }
    if (c === '?' || c === ':' || c === '@') {
      let j = i + 1;
      while (j < n && isWord(input[j])) j++;
      tokens.push({ t: 'param', v: input.slice(i, j), depth });
      clean += input.slice(i, j);
      i = j;
      continue;
    }
    if (c === '(') { tokens.push({ t: 'punct', v: c, depth }); depth++; clean += c; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); tokens.push({ t: 'punct', v: c, depth }); clean += c; i++; continue; }
    tokens.push({ t: 'punct', v: c, depth });
    clean += c;
    i++;
  }
  return { tokens, clean };
}

const up = (t: Token | undefined): string => (t && t.t === 'word' ? t.v.toUpperCase() : '');

/**
 * Validates model-written SQL against the allow-list and returns a safe version
 * (comments stripped, trailing semicolon removed, LIMIT added when missing).
 */
export function guardSql(input: string, allowedTables: string[]): GuardResult {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, code: 'EMPTY', reason: 'No SQL was produced.' };
  if (input.length > MAX_SQL_LENGTH) return { ok: false, code: 'TOO_LONG', reason: 'The query is too long.' };
  const lexed = tokenize(input);
  if (!lexed) return { ok: false, code: 'UNTERMINATED', reason: 'The query has an unterminated string or comment.' };
  let { tokens } = lexed;
  let clean = lexed.clean.trim();

  // exactly one statement: a single trailing semicolon is tolerated, anything after it is not
  while (tokens.length && tokens[tokens.length - 1].t === 'punct' && tokens[tokens.length - 1].v === ';') {
    tokens = tokens.slice(0, -1);
    clean = clean.replace(/;\s*$/, '').trim();
  }
  if (!tokens.length) return { ok: false, code: 'EMPTY', reason: 'No SQL was produced.' };
  if (tokens.some((t) => t.t === 'punct' && t.v === ';')) return { ok: false, code: 'MULTI_STATEMENT', reason: 'Only one statement is allowed.' };

  const first = up(tokens[0]);
  if (first !== 'SELECT' && first !== 'WITH') return { ok: false, code: 'NOT_SELECT', reason: 'Only SELECT queries are allowed.' };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'word') continue;
    const U = t.v.toUpperCase();
    const next = tokens[k + 1];
    const isCall = next?.t === 'punct' && next.v === '(';
    if (FORBIDDEN.has(U) && !(U === 'REPLACE' && isCall)) return { ok: false, code: 'FORBIDDEN_KEYWORD', reason: `"${U}" is not allowed: queries are read-only.` };
    const lower = t.v.toLowerCase();
    if (isCall && (FORBIDDEN_FUNCTIONS.has(lower) || lower.startsWith('pragma_') || lower.startsWith('sqlite_'))) {
      return { ok: false, code: 'FORBIDDEN_FUNCTION', reason: `The function ${lower}() is not allowed.` };
    }
  }

  // CTE names: ident [ (cols) ] AS [NOT] [MATERIALIZED] (
  const cteNames = new Set<string>();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'word' && t.t !== 'qident') continue;
    let j = k + 1;
    if (tokens[j]?.t === 'punct' && tokens[j].v === '(') { // optional column list
      const d = tokens[j].depth;
      j++;
      while (j < tokens.length && !(tokens[j].t === 'punct' && tokens[j].v === ')' && tokens[j].depth === d)) j++;
      j++;
    }
    if (up(tokens[j]) !== 'AS') continue;
    j++;
    if (up(tokens[j]) === 'NOT') j++;
    if (up(tokens[j]) === 'MATERIALIZED') j++;
    if (!(tokens[j]?.t === 'punct' && tokens[j].v === '(')) continue;
    const after = up(tokens[j + 1]);
    if (after !== 'SELECT' && after !== 'WITH' && after !== 'VALUES') continue;
    const prev = up(tokens[k - 1]);
    const prevTok = tokens[k - 1];
    const startsCte = prev === 'WITH' || prev === 'RECURSIVE' || (prevTok?.t === 'punct' && prevTok.v === ',');
    if (!startsCte) continue;
    const name = t.v.toLowerCase();
    if (BASE_TABLES.has(name) || name.startsWith('_') || name.startsWith('sqlite_') || /^v_|^u_/.test(name)) {
      return { ok: false, code: 'BAD_CTE_NAME', reason: `A temporary result cannot be named "${t.v}".` };
    }
    cteNames.add(name);
  }

  // table references: whatever follows FROM / JOIN, and every comma-separated item of a FROM list
  const allowed = new Set(allowedTables.map((a) => a.toLowerCase()));
  const tables = new Set<string>();
  const fromListAt = new Set<number>(); // paren depths currently inside a FROM list
  let expectTable = false;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const U = up(t);
    if (t.t === 'punct' && t.v === ')') { fromListAt.delete(t.depth + 1); expectTable = false; continue; }
    if (U === 'FROM') {
      // "EXTRACT(x FROM y)"-style and "IS DISTINCT FROM" are not table references
      const p1 = up(tokens[k - 1]);
      if (p1 === 'DISTINCT' && (up(tokens[k - 2]) === 'IS' || (up(tokens[k - 2]) === 'NOT' && up(tokens[k - 3]) === 'IS'))) continue;
      expectTable = true; fromListAt.add(t.depth); continue;
    }
    if (U === 'JOIN') { expectTable = true; fromListAt.add(t.depth); continue; }
    if (END_FROM.has(U)) { fromListAt.delete(t.depth); expectTable = false; continue; }
    if (t.t === 'punct' && t.v === ',' && fromListAt.has(t.depth)) { expectTable = true; continue; }
    if (!expectTable) continue;
    if (t.t === 'punct' && t.v === '(') { expectTable = false; continue; } // subquery: handled when we reach its own FROM
    if (t.t === 'word' || t.t === 'qident') {
      expectTable = false;
      const name = t.v.toLowerCase();
      const next = tokens[k + 1];
      if (next?.t === 'punct' && next.v === '.') return { ok: false, code: 'QUALIFIED_NAME', reason: 'Schema-qualified table names are not allowed.' };
      if (next?.t === 'punct' && next.v === '(') {
        if (!TABLE_FUNCTIONS.has(name)) return { ok: false, code: 'TABLE_NOT_ALLOWED', reason: `"${t.v}" is not a table I can read.` };
        continue;
      }
      if (cteNames.has(name)) continue;
      if (!allowed.has(name)) return { ok: false, code: 'TABLE_NOT_ALLOWED', reason: `"${t.v}" is not a table I can read.` };
      tables.add(name);
      continue;
    }
    expectTable = false;
  }

  const hasOuterLimit = tokens.some((t) => t.depth === 0 && up(t) === 'LIMIT');
  const sql = hasOuterLimit ? clean : `SELECT * FROM (${clean}) LIMIT ${DEFAULT_LIMIT}`;
  return { ok: true, sql, tables: [...tables], limited: !hasOuterLimit };
}
