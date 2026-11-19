import type { MenuKey } from '../rbac/permissions'

/**
 * 前端能力门 —— 与服务端 ADMIN_CAPABILITIES 同名同义（server/src/common/capabilities.ts）。
 * 能力集来自 GET /api/backoffice/environment 的 `capabilities` 字段：
 * 字段缺失（旧服务端）、非数组或读取失败 = 全部启用 —— 服务端仍是唯一的执行点，
 * 前端只负责菜单与路由不暴露被剪掉的模块。
 *
 * 能力标识与上游模块/路由一一对应；reporting / order 在上游只是占位菜单，没有后端路由。
 */
export const CAPABILITY_IDS = [
  'course', // 课程管理：/api/backoffice/courses
  'knowledge', // 知识库：/api/courses、/api/pages、/api/releases、/api/sync、/api/files、/api/tags
  'ai', // AI Tutor：/api/ai、学员运行时 /api/user
  'students', // 学员管理：/api/students
  'helpdesk', // 服务台：/api/helpdesk、Portal 集成 /api/integration/helpdesk
  'operations', // 运营位：/api/backoffice/operations
  'reporting', // 报表：占位菜单，没有后端路由
  'order', // 订单：占位菜单，没有后端路由
  'settings', // 设置：员工账号与学习权限
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export const ALL_CAPABILITIES: ReadonlySet<CapabilityId> = new Set(CAPABILITY_IDS)

/** 环境端点里本模块关心的字段；其余字段与旧版一致，忽略。 */
export type EnvironmentResponse = {
  capabilities?: unknown
  previewEntry?: unknown
}

/** 解析环境端点返回的能力集：缺失 / 非数组 = 全开；未知标识忽略（未来服务端新增能力不拖垮老前端）。 */
export function capabilitiesFromEnvironment(
  payload: EnvironmentResponse | null | undefined,
): ReadonlySet<CapabilityId> {
  const raw = payload?.capabilities
  if (!Array.isArray(raw)) return ALL_CAPABILITIES
  const known = raw.filter(
    (item): item is CapabilityId =>
      typeof item === 'string' &&
      (CAPABILITY_IDS as readonly string[]).includes(item),
  )
  return new Set(known)
}

/** 预览入口（PREVIEW_ENTRY）：learner = 上游「学员视角预览」；portal = 生产投影渲染草稿（Portal 风格）。 */
export type PreviewEntry = 'learner' | 'portal'

export const DEFAULT_PREVIEW_ENTRY: PreviewEntry = 'learner'

/** 解析 PREVIEW_ENTRY：只认 portal；缺失 / 未知值（旧服务端、拼写错误）= learner（上游缺省行为）。 */
export function previewEntryFromEnvironment(
  payload: EnvironmentResponse | null | undefined,
): PreviewEntry {
  const raw = payload?.previewEntry
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'portal'
    ? 'portal'
    : DEFAULT_PREVIEW_ENTRY
}

/**
 * 环境端点结果的模块级缓存：ShellRoute 拉取环境端点时用 rememberEnvironment 写入，
 * 外壳内页面（课程列表 / 编辑器 / 版本区）同步读取，不重复请求、也不各起一份解析。
 * 默认值 = 旧服务端语义：能力全开 + learner 预览。
 */
let environmentCache: {
  capabilities: ReadonlySet<CapabilityId>
  previewEntry: PreviewEntry
} = {
  capabilities: ALL_CAPABILITIES,
  previewEntry: DEFAULT_PREVIEW_ENTRY,
}

/** 记住一次环境端点结果（ShellRoute 专用）；payload 为 null（读取失败）时回退全开 + learner。 */
export function rememberEnvironment(
  payload: EnvironmentResponse | null | undefined,
): void {
  environmentCache = {
    capabilities: capabilitiesFromEnvironment(payload),
    previewEntry: previewEntryFromEnvironment(payload),
  }
}

/** ShellRoute 拉过环境端点后的能力集（与服务端 ADMIN_CAPABILITIES 同义）。 */
export function cachedCapabilities(): ReadonlySet<CapabilityId> {
  return environmentCache.capabilities
}

/** ShellRoute 拉过环境端点后的预览入口（PREVIEW_ENTRY）。 */
export function cachedPreviewEntry(): PreviewEntry {
  return environmentCache.previewEntry
}

/** 菜单 ↔ 能力：一一对应、可解释；侧栏顺序仍由 MENU_ORDER 决定。 */
export const MENU_CAPABILITY: Record<MenuKey, CapabilityId> = {
  course: 'course',
  knowledge: 'knowledge',
  aiTutor: 'ai',
  order: 'order',
  reporting: 'reporting',
  student: 'students',
  helpDesk: 'helpdesk',
  settings: 'settings',
}

/** 侧栏菜单 = 角色权限（RBAC 继续生效）∩ 已启用能力，顺序不变（PORT-NAV-002）。 */
export function filterMenusByCapabilities(
  menus: readonly MenuKey[],
  enabled: ReadonlySet<CapabilityId>,
): MenuKey[] {
  return menus.filter((menu) => enabled.has(MENU_CAPABILITY[menu]))
}

/** 路由第一段 → 能力；未登记（含 Shell 之外的页面）= null，不做能力重定向。 */
const SEGMENT_CAPABILITY: Record<string, CapabilityId> = {
  course: 'course',
  operations: 'operations',
  knowledge: 'knowledge',
  'ai-tutor': 'ai',
  order: 'order',
  reporting: 'reporting',
  student: 'students',
  'help-desk': 'helpdesk',
  settings: 'settings',
}

export function capabilityForSegments(
  segments: readonly string[] | undefined,
): CapabilityId | null {
  if (!segments || segments.length === 0) return null
  return SEGMENT_CAPABILITY[segments[0]] ?? null
}

/** 被禁用路由的落点：角色可见且能力启用的第一个菜单（通常是 course）；没有则 null（显示“无可用模块”）。 */
export function landingMenuFor(
  menus: readonly MenuKey[],
  enabled: ReadonlySet<CapabilityId>,
): MenuKey | null {
  return menus.find((menu) => enabled.has(MENU_CAPABILITY[menu])) ?? null
}
