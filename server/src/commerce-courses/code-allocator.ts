/**
 * 课程模块里所有给人看的编号的格式（PRD L132-L142 ID 表、L759）。
 * 这里是纯函数部分：格式化与解析。数据库计数器（allocate / raise）在同一个文件的下半部分。
 *
 * | 对象 | 格式 | 唯一范围 |
 * |---|---|---|
 * | Course ID | C001 | 全局 |
 * | Lesson ID | L001 | Course 内 |
 * | Exhibit ID | E001 | Course 内 |
 * | 知识题 | K-0201（K- + 课时号 + 序号，各至少两位） | Course 内 |
 * | 应用题 | A-0201 | Course 内 |
 * | 学习点 | V1、T1（视频 / 文本，按课时+语言分别计数） | 课时+语言+来源 |
 */

function pad(n: number, width: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(width, '0');
}

export function formatCourseCode(n: number): string {
  return `C${pad(n, 3)}`;
}

export function formatLessonCode(n: number): string {
  return `L${pad(n, 3)}`;
}

export function formatExhibitCode(n: number): string {
  return `E${pad(n, 3)}`;
}

/** 课时号：课时编号结尾的数字（L003、L3 都是 3）；没有数字时用 fallback（课时位置）。 */
export function lessonNumber(code: string, fallback = 0): number {
  const match = /(\d{1,9})$/.exec(code);
  return match ? Number(match[1]) : fallback;
}

export function formatKnowledgeCode(
  lessonNo: number,
  sequence: number,
): string {
  return `K-${pad(lessonNo, 2)}${pad(sequence, 2)}`;
}

export function formatApplicationCode(
  lessonNo: number,
  sequence: number,
): string {
  return `A-${pad(lessonNo, 2)}${pad(sequence, 2)}`;
}

export type LearningPointSource = 'VIDEO' | 'TEXT';

export function formatLearningPointCode(
  source: LearningPointSource,
  n: number,
): string {
  return `${source === 'VIDEO' ? 'V' : 'T'}${Math.max(1, Math.trunc(n))}`;
}
