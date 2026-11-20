import { MENU_ORDER, type MenuKey } from '../rbac/permissions'

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
  'settings', // 设置：学习权限与其它 Settings 子项
  'accounts', // 员工账号管理：/api/admin/employees（独立于 settings，Sandbox 只开它）
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

/**
 * 账号级功能键（服务端 GET /api/session 的 features，已含环境 ∩ 角色 ∩ 账号开关）。
 * null = 旧服务端 / 尚未返回：不做账号级限制（角色 + 环境能力照常生效）。
 */
export type AccountFeatures = ReadonlySet<string> | null

/** 解析会话里的生效功能键集合：缺失 / 非数组 = 不额外限制；空数组 = 该账号没有任何生效功能。 */
export function accountFeaturesFromSession(
  payload: { features?: unknown } | null | undefined,
): AccountFeatures {
  const raw = payload?.features
  if (!Array.isArray(raw)) return null
  return new Set(raw.filter((item): item is string => typeof item === 'string'))
}

/**
 * 会话级缓存：ShellRoute 拿到 /api/session 后写入，Settings 子导航等外壳内组件同步读取。
 * 默认 null（旧服务端语义：不额外限制）。
 */
let accountFeaturesCache: AccountFeatures = null

export function rememberAccountFeatures(
  payload: { features?: unknown } | null | undefined,
): void {
  accountFeaturesCache = accountFeaturesFromSession(payload)
}

export function cachedAccountFeatures(): AccountFeatures {
  return accountFeaturesCache
}

/** 菜单 ↔ 环境能力：一一对应、可解释；settings 可由 settings 或 accounts 任一能力打开。 */
export const MENU_CAPABILITY: Record<MenuKey, readonly CapabilityId[]> = {
  course: ['course'],
  knowledge: ['knowledge'],
  aiTutor: ['ai'],
  order: ['order'],
  reporting: ['reporting'],
  student: ['students'],
  helpDesk: ['helpdesk'],
  settings: ['settings', 'accounts'],
}

/** 菜单 ↔ 账号级模块功能键；settings 的「账号管理」由 module.accounts 独立控制。 */
export const MENU_FEATURE_KEYS: Record<MenuKey, readonly string[]> = {
  course: ['module.course'],
  knowledge: ['module.knowledge'],
  aiTutor: ['module.ai'],
  order: ['module.order'],
  reporting: ['module.reporting'],
  student: ['module.students'],
  helpDesk: ['module.helpdesk'],
  settings: ['module.settings', 'module.accounts'],
}

/** 侧栏菜单 = 角色权限（RBAC 继续生效）∩ 已启用能力，顺序不变（PORT-NAV-002）。 */
export function filterMenusByCapabilities(
  menus: readonly MenuKey[],
  enabled: ReadonlySet<CapabilityId>,
): MenuKey[] {
  return menus.filter((menu) => MENU_CAPABILITY[menu].some((id) => enabled.has(id)))
}

/** 菜单是否被账号级功能键允许（null = 不额外限制）。 */
export function menuFeatureAllowed(
  menu: MenuKey,
  features: AccountFeatures,
): boolean {
  return features === null || MENU_FEATURE_KEYS[menu].some((key) => features.has(key))
}

/** 侧栏菜单再 ∩ 账号生效功能（任务口径：角色 ∩ 环境能力 ∩ 账号 module.*）。 */
export function filterMenusByFeatures(
  menus: readonly MenuKey[],
  features: AccountFeatures,
): MenuKey[] {
  return menus.filter((menu) => menuFeatureAllowed(menu, features))
}

/**
 * 菜单候选集：
 * - 旧服务端（features 缺失）= 角色可见菜单（行为不变）；
 * - features 已返回 = 以服务端 effective 为准 —— 它已包含环境 ∩ 角色 ± 账号开关，
 *   账号「允许」可以把角色 NONE 的模块加回来（owner：可加可减），「禁止」可以收紧角色权限。
 */
export function accountMenus(
  roleMenus: readonly MenuKey[],
  features: AccountFeatures,
): readonly MenuKey[] {
  return features === null
    ? roleMenus
    : MENU_ORDER.filter((menu) => menuFeatureAllowed(menu, features))
}

/** 路由第一段 → 环境能力（任一启用即放行）；settings 子项按 accounts / settings 拆分。 */
const SEGMENT_CAPABILITIES: Record<string, readonly CapabilityId[]> = {
  course: ['course'],
  operations: ['operations'],
  knowledge: ['knowledge'],
  'ai-tutor': ['ai'],
  order: ['order'],
  reporting: ['reporting'],
  student: ['students'],
  'help-desk': ['helpdesk'],
}

export function capabilitiesForSegments(
  segments: readonly string[] | undefined,
): readonly CapabilityId[] | null {
  if (!segments || segments.length === 0) return null
  const [first, second] = segments
  if (first === 'settings') {
    // /settings 与员工账号子页：accounts 能力即可；其它 Settings 子项仍要 settings
    return second === undefined || second === 'employee-account'
      ? ['settings', 'accounts']
      : ['settings']
  }
  return SEGMENT_CAPABILITIES[first] ?? null
}

/** 路由第一段 → 账号功能键（任一命中即放行）；未登记（含 Shell 之外） = null，不做账号级重定向。 */
const SEGMENT_FEATURE_KEYS: Record<string, readonly string[]> = {
  course: ['module.course'],
  operations: ['module.operations'],
  knowledge: ['module.knowledge'],
  'ai-tutor': ['module.ai'],
  order: ['module.order'],
  reporting: ['module.reporting'],
  student: ['module.students'],
  'help-desk': ['module.helpdesk'],
}

export function featureKeysForSegments(
  segments: readonly string[] | undefined,
): readonly string[] | null {
  if (!segments || segments.length === 0) return null
  const [first, second] = segments
  if (first === 'settings') {
    if (second === 'employee-account') return ['module.accounts']
    if (second === undefined) return ['module.settings', 'module.accounts']
    return ['module.settings']
  }
  return SEGMENT_FEATURE_KEYS[first] ?? null
}

/** 被禁用路由的落点：角色可见、能力启用且账号功能允许的第一个菜单；没有则 null。 */
export function landingMenuFor(
  menus: readonly MenuKey[],
  enabled: ReadonlySet<CapabilityId>,
  features: AccountFeatures = null,
): MenuKey | null {
  return (
    menus.find(
      (menu) =>
        MENU_CAPABILITY[menu].some((id) => enabled.has(id)) &&
        menuFeatureAllowed(menu, features),
    ) ?? null
  )
}
