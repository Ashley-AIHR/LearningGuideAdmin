/**
 * 文本模式的结构（PRD 12.5.2）：只有 Heading 1 是学习点（LP），H1 文字即 LP 标题，
 * H2 及以下是正文里的小标题。
 *
 * 这里只放纯函数，不碰数据库：完成度规则、LP 同步和导入都用同一份解析。
 *
 * 服务端保存时在每个 H1 上盖一个 `data-lp="T3"` 章（stampLearningPoints），
 * 下次保存时按章认出"这是同一个 LP"，改标题也不会换编号。
 */

export interface TextHeading {
  /** H1 上的 data-lp 章；还没盖过章（新写的标题）时为 null。 */
  code: string | null;
  /** H1 的文字；空标题保留为空字符串，由调用方决定怎么提示。 */
  title: string;
  /** 这个 H1 到下一个 H1（或文末）之间有没有文字；展品卡片里的字不算。 */
  hasBody: boolean;
  /** 在所有 H1 里的位置，从 0 起，空标题也占位。 */
  index: number;
}

const HEADING = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi;
const STAMP = /\sdata-lp\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SAFE_CODE = /^[\w.-]+$/;
/** 编辑器插入的展品卡片（TextEditor.tsx）；卡片里的标题和说明不是正文。 */
const EXHIBIT_CARD =
  /<figure\b[^>]*\bdata-exhibit-code\b[^>]*>[\s\S]*?<\/figure>/gi;

export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTextStructure(
  html: string | null | undefined,
): TextHeading[] {
  if (!html) return [];
  const matches = [...html.matchAll(HEADING)];
  return matches.map((match, index) => {
    const stamp = STAMP.exec(` ${match[1] ?? ''}`);
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? html.length)
        : html.length;
    const body = stripHtml(html.slice(start, end).replace(EXHIBIT_CARD, ' '));
    return {
      code: (stamp?.[1] ?? stamp?.[2] ?? '').trim() || null,
      title: stripHtml(match[2] ?? ''),
      hasBody: body.length > 0,
      index,
    };
  });
}

/**
 * 把这次保存的每个 H1 对到库里已有的 TEXT 学习点行（D2 的认人顺序）：
 * 1) 先按章：H1 带着某一行的 code 就是那一行，改了标题也一样；一行只认一次；
 * 2) 没有章的 H1 再按标题：从前往后认第一条还没被认走、标题相同的行（标题重复也能一一对上）；
 * 3) 都认不出的得到 null，由调用方分配新编号。
 * 带了章但这一章已被别的 H1 用掉（复制粘贴出来的标题）或库里没有这一行的，按新标题处理，
 * 不去按标题抢别人的行。返回值与 headings 一一对应。
 */
export function matchTextPoints<
  Row extends { id: string; code: string; title: string },
>(
  headings: ReadonlyArray<{ code: string | null; title: string }>,
  rows: ReadonlyArray<Row>,
): Array<Row | null> {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const used = new Set<string>();
  const result: Array<Row | null> = headings.map(() => null);

  for (const [position, heading] of headings.entries()) {
    if (!heading.code) continue;
    const row = byCode.get(heading.code);
    if (row && !used.has(row.id)) {
      used.add(row.id);
      result[position] = row;
    }
  }
  for (const [position, heading] of headings.entries()) {
    if (heading.code) continue;
    const row = rows.find(
      (candidate) =>
        !used.has(candidate.id) && candidate.title === heading.title,
    );
    if (row) {
      used.add(row.id);
      result[position] = row;
    }
  }
  return result;
}

/** 去掉所有学习点章：内容指纹不看章，只盖章不会让草稿变成"有改动"。 */
export function stripLearningPointStamps(html: string): string {
  return html.replace(new RegExp(STAMP.source, 'gi'), '');
}

/**
 * 按顺序给每个 H1 盖上学习点编号；已有的章先去掉再写，所以重复盖章结果不变。
 * codes 比 H1 少时，多出来的 H1 不带章；带引号、尖括号等写进属性会破坏 HTML 的编号也不盖章
 * （导入的编号可以是任意文字），这样的 H1 下次保存时按标题认人。
 */
export function stampLearningPoints(
  html: string,
  codes: ReadonlyArray<string | null | undefined>,
): string {
  let position = 0;
  return html.replace(
    /(<h1\b)([^>]*)(>[\s\S]*?<\/h1>)/gi,
    (_whole, open: string, attributes: string, rest: string) => {
      const code = codes[position++];
      const kept = ` ${attributes}`.replace(STAMP, '').trim();
      const stamp = code && SAFE_CODE.test(code) ? `data-lp="${code}"` : '';
      const joined = [kept, stamp].filter(Boolean).join(' ');
      return `${open}${joined ? ` ${joined}` : ''}${rest}`;
    },
  );
}
