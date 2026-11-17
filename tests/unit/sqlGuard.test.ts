import { describe, expect, it } from 'vitest';
import { guardSql, tokenize } from '@/core/ai/sqlGuard';
import { ALLOWED_VIEWS } from '@/core/db/semantic';
import { makeEngine } from '../helpers';

const allowed = [...ALLOWED_VIEWS, 'u_price_list'];
const ok = (sql: string) => guardSql(sql, allowed);

describe('SQL guard: accepted queries', () => {
  it.each([
    'SELECT SUM(revenue) FROM v_sales',
    'select * from v_products where stock_status = \'low\'',
    'WITH t AS (SELECT category, SUM(revenue) r FROM v_sales GROUP BY 1) SELECT * FROM t ORDER BY r DESC',
    'SELECT a.sku FROM v_products a JOIN v_sales b ON a.sku = b.sku LIMIT 5',
    'SELECT name FROM v_products WHERE name LIKE \'%delete%\'', // keyword inside a string is data
    'SELECT "update" FROM v_products', // quoted identifier
    'SELECT * FROM (SELECT * FROM v_sales) s',
    'SELECT * FROM v_sales, v_products LIMIT 1',
    'SELECT REPLACE(name, \'a\', \'b\') FROM v_products', // replace() the function is fine
    'SELECT * FROM u_price_list',
    'SELECT 1;',
    'SELECT key, value FROM json_each(\'[1,2]\')',
    'SELECT * FROM v_sales WHERE sale_date IS NOT DISTINCT FROM sale_date',
  ])('accepts %s', (sql) => expect(ok(sql).ok).toBe(true));

  it('adds a LIMIT only when the outer query has none', () => {
    const a = ok('SELECT * FROM v_sales');
    expect(a.ok && a.sql).toBe('SELECT * FROM (SELECT * FROM v_sales) LIMIT 1000');
    const b = ok('SELECT * FROM v_sales LIMIT 5');
    expect(b.ok && b.sql).toBe('SELECT * FROM v_sales LIMIT 5');
    const c = ok('SELECT * FROM (SELECT * FROM v_sales LIMIT 5)');
    expect(c.ok && c.limited).toBe(true);
  });
  it('strips comments and a trailing semicolon', () => {
    const r = ok('SELECT 1 -- hello\n FROM v_sales /* x */;');
    expect(r.ok && r.sql.includes('--')).toBe(false);
  });
});

describe('SQL guard: blocked queries (attack cases)', () => {
  it.each([
    ['', 'EMPTY'], ['   ', 'EMPTY'], [';', 'EMPTY'],
    ['DELETE FROM sales', 'NOT_SELECT'], ['UPDATE products SET price_paise = 0', 'NOT_SELECT'], ['INSERT INTO sales VALUES (1)', 'NOT_SELECT'],
    ['DROP TABLE products', 'NOT_SELECT'], ['PRAGMA table_info(products)', 'NOT_SELECT'], ['ATTACH DATABASE \'x\' AS y', 'NOT_SELECT'],
    ['VACUUM', 'NOT_SELECT'], ['REINDEX', 'NOT_SELECT'], ['ALTER TABLE products ADD x', 'NOT_SELECT'], ['CREATE TABLE x(a)', 'NOT_SELECT'],
    ['SELECT 1; DELETE FROM sales', 'MULTI_STATEMENT'], ['SELECT 1;; SELECT 2', 'MULTI_STATEMENT'], ['SELECT 1 /* ; */ ; DROP TABLE x', 'MULTI_STATEMENT'],
    ['SELECT * FROM sales', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM products', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM _settings', 'TABLE_NOT_ALLOWED'],
    ['SELECT * FROM _qa_log', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM _meta_columns', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM sqlite_master', 'TABLE_NOT_ALLOWED'],
    ['SELECT * FROM v_sales JOIN customers ON 1', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM v_sales, _settings', 'TABLE_NOT_ALLOWED'],
    ['SELECT * FROM (SELECT * FROM stock_movements)', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM "sales"', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM [products]', 'TABLE_NOT_ALLOWED'],
    ['SELECT * FROM `suppliers`', 'TABLE_NOT_ALLOWED'], ['SELECT * FROM main.sales', 'QUALIFIED_NAME'], ['SELECT * FROM temp.v_sales', 'QUALIFIED_NAME'],
    ['SELECT load_extension(\'x\')', 'FORBIDDEN_FUNCTION'], ['SELECT readfile(\'/etc/passwd\')', 'FORBIDDEN_FUNCTION'], ['SELECT * FROM pragma_table_info(\'sales\')', 'FORBIDDEN_FUNCTION'],
    ['SELECT sqlite_version()', 'FORBIDDEN_FUNCTION'], ['SELECT zeroblob(1000000000)', 'FORBIDDEN_FUNCTION'], ['SELECT randomblob(1e9)', 'FORBIDDEN_FUNCTION'],
    ['WITH x AS (DELETE FROM sales RETURNING *) SELECT * FROM x', 'FORBIDDEN_KEYWORD'], ['SELECT * FROM v_sales; PRAGMA writable_schema=1', 'MULTI_STATEMENT'],
    ['WITH sales AS (SELECT 1) SELECT * FROM sales', 'BAD_CTE_NAME'], ['WITH _settings AS (SELECT 1) SELECT * FROM _settings', 'BAD_CTE_NAME'],
    ["SELECT 'unterminated FROM v_sales", 'UNTERMINATED'], ['SELECT 1 /* never closed', 'UNTERMINATED'],
    ['SELECT * FROM v_sales WHERE 1=1 UNION SELECT * FROM _settings', 'TABLE_NOT_ALLOWED'], ['select * from V_SALES union all select * from Sales', 'TABLE_NOT_ALLOWED'],
    ['SELECT * FROM generate_series(1,10) JOIN sales', 'TABLE_NOT_ALLOWED'], ['SELECT 1 FROM v_sales WHERE x IN (SELECT 1 FROM purchases)', 'TABLE_NOT_ALLOWED'],
    ['BEGIN; SELECT 1', 'MULTI_STATEMENT'], ['BEGIN', 'NOT_SELECT'], ['SAVEPOINT a', 'NOT_SELECT'], ['SELECT * FROM v_sales WHERE TRIGGER = 1', 'FORBIDDEN_KEYWORD'],
    ['SELECT 1 FROM v_sales WHERE name = (SELECT value FROM _settings)', 'TABLE_NOT_ALLOWED'], ['REPLACE INTO products VALUES (1)', 'NOT_SELECT'],
  ])('blocks %s', (sql, code) => {
    const r = ok(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it('rejects very long SQL', () => expect(ok('SELECT ' + '1,'.repeat(3000) + '1 FROM v_sales').ok).toBe(false));
});

describe('tokenizer', () => {
  it('handles doubled quotes and nested parentheses', () => {
    const t = tokenize("SELECT 'it''s', \"a\"\"b\" FROM (SELECT 1)")!;
    expect(t.tokens.find((x) => x.t === 'string')?.v).toBe("it's");
    expect(t.tokens.find((x) => x.t === 'qident')?.v).toBe('a"b');
    expect(Math.max(...t.tokens.map((x) => x.depth))).toBe(1);
  });
});

describe('defence in depth inside the engine', () => {
  it('readOnly queries cannot change data even if the guard were bypassed', async () => {
    const e = await makeEngine();
    e.exec("INSERT INTO products(sku, name) VALUES ('A', 'Apple')");
    expect(() => e.query('DELETE FROM products', [], { readOnly: true })).toThrow();
    expect(() => e.query('SELECT * FROM products', [], { readOnly: true })).toThrow(/not a table/);
    expect(e.scalar('SELECT COUNT(*) FROM products')).toBe(1);
    // query_only is switched back off afterwards
    e.exec("INSERT INTO products(sku, name) VALUES ('B', 'Banana')");
    expect(e.scalar('SELECT COUNT(*) FROM products')).toBe(2);
  });
});
