// 浏览器 E2E（真 Chromium + Vite dev server，API 在浏览器里假装）：课程页 RWD 布局契约。
// 锁住：页面本体不滚动（KPI：document / .content / 页面卡片三层都不滚）、吸顶页签、
// 面板内部滚动（版本列表、历史记录、课程列表表格）、无横向溢出、
// 版本页 Current / Versions / History 分段不纵向堆叠、1672×941 与 1280×800 两种视口。
// 运行：cd client && node --test e2e/course-layout.e2e.test.mjs（本地跑，CI 不装浏览器）。
// 截图：保存到 UIUX_SHOTS（默认 verify-takeover-20261116/uiux-rwd-shots）。
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = process.env.UIUX_SHOTS || '/Users/nihao/AI infra/verify-takeover-20261116/uiux-rwd-shots'
mkdirSync(SHOTS, { recursive: true })

let server
let browser
let base

before(async () => {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, host: '127.0.0.1' } })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  const executablePath = process.env.PW_CHROMIUM || undefined
  browser = await chromium.launch(executablePath ? { executablePath, args: ['--headless=new', '--no-sandbox'] } : {})
})

after(async () => {
  await browser?.close()
  await server?.close()
})

const ok = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data, error: null }) })
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, data: null, error: { code, message } }) })

const WHEN = '2026-11-02T08:30:00.000Z'
const SESSION = { employee: { employeeId: 'e1', loginEmail: 'olive@example.com', role: 'ADMIN', displayName: 'Olive', accountStatus: 'ACTIVE', emailVerification: 'VERIFIED', displayStatus: 'Active', isBootstrapAdmin: false }, sidebarState: 'expanded' }
const CATEGORIES = [{ id: 'cat', name: 'Science' }]
const SUMMARY = { id: 'c1', code: 'CRS-1', slug: 'modelling-life', title: 'Modelling Life', subtitle: null, category: { id: 'cat', name: 'Science' }, learningMode: 'VIDEO_AND_TEXT', learningLanguages: ['en-GB', 'zh-CN'], lessonCount: 5, lifecycleStatus: 'PUBLISHED', liveStatus: 'ONLINE', liveVersionId: 'v26', liveVersionLabel: 'V4.2', liveVersionWentLiveAt: WHEN, hasDraft: true, trialEnabled: true, published: true, updatedAt: WHEN }
const lessonLocs = (language, title) => ({ language, title, description: title, textHtml: '<h1>x</h1>', videoAssetId: 'a1', video: { id: 'a1', originalName: 'x.mp4', size: 1024, mimeType: 'video/mp4', extension: 'mp4', createdAt: WHEN }, videoDurationSeconds: 60 })
const LESSON = (n) => ({
  id: `l${n}`, code: `LS-${n}`, sortOrder: n - 1,
  localizations: [lessonLocs('en-GB', `Modelling Life ${n}`), lessonLocs('zh-CN', `生命建模 ${n}`)],
  exhibits: [], readings: [], questions: [], applicationTest: null, triggers: [],
  learningPoints: [{ id: `p${n}`, language: 'en-GB', code: 'L1', title: 'Point one', source: 'MANUAL', timeSeconds: 10 }],
})
const LESSONS = [1, 2, 3, 4, 5].map(LESSON)
const DETAIL = {
  ...SUMMARY,
  defaultContentLanguage: 'en-GB', categoryId: 'cat', cover: null,
  localizations: [
    { language: 'en-GB', title: 'Modelling Life', shortDescription: 'Modelling Life', overview: 'Modelling Life', whatYouLearn: ['Understand modelling'], provides: ['Video lessons'] },
    { language: 'zh-CN', title: '生命建模', shortDescription: '生命建模', overview: '生命建模', whatYouLearn: [], provides: [] },
  ],
  lessons: LESSONS, plans: [], trialRows: [],
  completeness: {
    steps: { courseInformation: { complete: true, missing: [] }, content: { complete: false, missing: ['Lesson LS-2: title is required (en-GB)'] }, trial: { complete: true, missing: [] } },
    completedSteps: 2, canPublish: false, publishBlockers: [],
  },
}
const TRIAL = {
  enabled: true, learningMode: 'VIDEO_AND_TEXT', learningLanguages: ['en-GB', 'zh-CN'],
  rows: LESSONS.map((lesson, index) => ({ lessonId: lesson.id, code: lesson.code, index: index + 1, title: `Modelling Life ${index + 1}`, videoDurationSeconds: 60, inTrial: index < 2, videoCutoffSeconds: 30, textCutoffLearningPointId: null, textCutoffCode: null, status: 'READY', learningPoints: [] })),
}
// 足够多的版本（>一屏）用来验证 Versions 分段在面板内部滚动。
const VERSIONS = Array.from({ length: 26 }, (_, index) => ({
  id: `v${index + 1}`, versionNo: index + 1, versionLabel: `V${(index + 1).toFixed(1)}`, versionSeries: index + 1, versionMinor: 0,
  sourceEnvironment: index === 0 ? null : 'Sandbox', sourceVersionLabel: index === 0 ? null : `V${index.toFixed(1)}`,
  wentLiveAt: WHEN, exportedAt: null, createdAt: WHEN, isLive: index === 25,
}))
// 两页历史（分页保留），20 条一页同样超过一屏。
const HISTORY = {
  items: Array.from({ length: 20 }, (_, index) => ({ id: `h${index + 1}`, time: WHEN, operator: 'Olive', action: 'PUBLISH', versionNo: index + 1, detail: { versionLabel: `V${(index + 1).toFixed(1)}` } })),
  total: 40, page: 1, pages: 2,
}
const MEDIA_LIMITS = { imageBytes: 10485760, videoBytes: 1073741824, audioBytes: 209715200, pdfBytes: 52428800, modelBytes: 104857600, chunkSize: 8388608 }
const COURSE_ROW = (n) => ({
  ...SUMMARY, id: `c${n}`, code: `CRS-${n}`, slug: `course-${n}`, title: `Course ${n}`, hasDraft: n % 3 === 0, liveVersionLabel: n % 4 === 0 ? null : `V${n}.0`, published: n % 4 !== 0, liveStatus: n % 4 === 0 ? null : 'ONLINE',
})
const COURSE_LIST = {
  courses: Array.from({ length: 12 }, (_, index) => COURSE_ROW(index + 1)),
  total: 54, page: 1, pages: 5,
  counts: { total: 54, draft: 18, published: 40, online: 36, hidden: 4, offline: 0, notPublished: 14 },
}

async function open(viewport, locale = 'en-GB') {
  const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => console.error('pageerror', error.message))
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/session') return route.fulfill(ok(SESSION))
    if (path === '/api/backoffice/environment') return route.fulfill(ok({ label: 'Sandbox', publicSiteUrl: 'https://sandbox.example.com', versionNumberingMode: 'sandbox', stripeConfigured: false }))
    if (path === '/api/backoffice/courses/categories') return route.fulfill(ok(CATEGORIES))
    if (path === '/api/backoffice/courses/media-limits') return route.fulfill(ok(MEDIA_LIMITS))
    if (path === '/api/backoffice/courses') return route.fulfill(ok(COURSE_LIST))
    if (path === '/api/backoffice/courses/c1') return route.fulfill(ok(DETAIL))
    if (path === '/api/backoffice/courses/c1/trial') return route.fulfill(ok(TRIAL))
    if (path === '/api/backoffice/courses/c1/versions') return route.fulfill(ok(VERSIONS))
    if (path === '/api/backoffice/courses/c1/history') return route.fulfill(ok(HISTORY))
    return route.fulfill(fail(404, 'NOT_FOUND', '请求的资源不存在'))
  })
  return { context, page }
}

async function shot(page, name) {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** 三层滚动容器：文档、壳层内容区、页面卡片本体。 */
async function scrollState(page, pageTestId) {
  return page.evaluate((testId) => {
    const measure = (el) => el && ({ scrollY: el.scrollHeight, clientY: el.clientHeight, scrollX: el.scrollWidth, clientX: el.clientWidth })
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: measure(document.scrollingElement),
      content: measure(document.querySelector('.content')),
      page: measure(document.querySelector(`[data-testid="${testId}"]`)),
    }
  }, pageTestId)
}

async function assertPageDoesNotScroll(page, pageTestId, label) {
  const m = await scrollState(page, pageTestId)
  const { width, height } = m.viewport
  assert.ok(m.document.scrollY <= height + 1, `${label}: 文档不应纵向滚动（scrollHeight ${m.document.scrollY} > innerHeight ${height}）`)
  assert.ok(m.document.scrollX <= width + 1, `${label}: 文档不应横向滚动（scrollWidth ${m.document.scrollX} > innerWidth ${width}）`)
  if (m.content) {
    assert.ok(m.content.scrollY <= m.content.clientY + 1, `${label}: 页面容器 .content 不应纵向滚动（scrollHeight ${m.content.scrollY} > clientHeight ${m.content.clientY}）`)
    assert.ok(m.content.scrollX <= m.content.clientX + 1, `${label}: 页面容器 .content 不应横向溢出（scrollWidth ${m.content.scrollX} > clientWidth ${m.content.clientX}）`)
  }
  if (m.page) {
    assert.ok(m.page.scrollY <= m.page.clientY + 1, `${label}: 页面卡片本体不应滚动（scrollHeight ${m.page.scrollY} > clientHeight ${m.page.clientY}）`)
    assert.ok(m.page.scrollX <= m.page.clientX + 1, `${label}: 页面卡片本体不应横向溢出（scrollWidth ${m.page.scrollX} > clientWidth ${m.page.clientX}）`)
  }
}

async function assertTabsStickyAndPanelBounded(page, label) {
  const tabs = page.getByTestId('course-tabs')
  await tabs.waitFor()
  const tabsBox = await tabs.boundingBox()
  assert.ok(tabsBox && tabsBox.height > 20, `${label}: 页签栏应可见`)
  const position = await tabs.evaluate((el) => getComputedStyle(el).position)
  assert.equal(position, 'sticky', `${label}: 页签栏应吸顶（position: sticky），当前 ${position}`)
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  assert.ok(tabsBox.y >= 0 && tabsBox.y + tabsBox.height <= viewport.height + 1, `${label}: 页签栏应在视口内`)

  const panel = page.locator('[data-course-tab-panel]')
  assert.equal(await panel.count(), 1, `${label}: 应恰有一个页签内容面板`)
  const panelBox = await panel.boundingBox()
  assert.ok(panelBox && panelBox.height > 150, `${label}: 面板应有确定高度，实际 ${panelBox?.height}`)
  assert.ok(panelBox.y >= tabsBox.y + tabsBox.height - 1, `${label}: 面板应在页签栏下方`)
  assert.ok(panelBox.y + panelBox.height <= viewport.height + 1, `${label}: 面板不应超出视口底边`)
  const overflow = await panel.evaluate((el) => getComputedStyle(el).overflow)
  assert.equal(overflow, 'hidden', `${label}: 面板容器应裁切内容（overflow: hidden），滚动交给内部面板`)
}

/** 可滚动断言：内容确实超出，且能通过 scrollTop 滚动。 */
async function assertScrollable(page, testId, label) {
  const el = page.getByTestId(testId)
  await el.waitFor()
  const metrics = await el.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }))
  assert.ok(metrics.scrollHeight > metrics.clientHeight + 1, `${label}: 内容应超出面板（scrollHeight ${metrics.scrollHeight} vs clientHeight ${metrics.clientHeight}）`)
  assert.ok(['auto', 'scroll'].includes(metrics.overflowY), `${label}: 面板应内部滚动（overflow-y ${metrics.overflowY}）`)
  const scrolled = await el.evaluate((node) => {
    node.scrollTop = 120
    return node.scrollTop
  })
  assert.ok(scrolled > 0, `${label}: 面板应能实际滚动`)
  await el.evaluate((node) => {
    node.scrollTop = 0
  })
}

const EDITOR_TABS = [
  ['info', 'Course Information'],
  ['content', 'Course Content'],
  ['trial', 'Trial'],
  ['versions', 'Versions & publishing'],
]

async function editorTabState(page, viewportName, tabId) {
  await page.getByTestId(`course-tab-${tabId}`).click()
  await page.waitForTimeout(200)
  const label = `${viewportName} 课程编辑/${tabId}`
  await assertPageDoesNotScroll(page, 'course-editor-page', label)
  await assertTabsStickyAndPanelBounded(page, label)
  await shot(page, `editor-${tabId}-${viewportName}`)
}

test('1672×941：课程编辑每个页签页面本体不滚动、吸顶页签、面板内滚动', async () => {
  const { context, page } = await open({ width: 1672, height: 941 })
  try {
    await page.goto(`${base}/en-GB/course/c1`)
    await page.waitForLoadState('networkidle')

    // 状态只在头部摘要出现一次；页签不重复线上/草稿状态。
    const summary = page.getByTestId('course-status-summary')
    assert.equal(await summary.count(), 1, '头部应恰有一行状态摘要')
    const summaryText = await summary.innerText()
    assert.match(summaryText, /Draft/i, '状态摘要应包含 Draft 完成度')
    assert.match(summaryText, /Live/i, '状态摘要应包含 Live 版本')
    const tabsText = await page.getByTestId('course-tabs').innerText()
    assert.doesNotMatch(tabsText, /Online|Hidden|Offline/, '页签不应重复线上状态')

    for (const [tabId] of EDITOR_TABS) {
      await editorTabState(page, '1672', tabId)
    }

    // 版本与发布：Current / Versions / History 分段，不纵向堆叠。
    await page.getByTestId('course-tab-versions').click()
    await page.waitForTimeout(200)
    const segments = ['current', 'versions', 'history']
    for (const segment of segments) {
      assert.equal(await page.getByTestId(`versions-segment-${segment}`).count(), 1, `应有 ${segment} 分段`)
    }

    // Current：Draft / Live 两卡并排（同一行）且都在一屏内。
    await page.getByTestId('versions-segment-current').click()
    await page.waitForTimeout(150)
    const draftBox = await page.getByTestId('versions-current-draft').boundingBox()
    const liveBox = await page.getByTestId('versions-current-live').boundingBox()
    assert.ok(draftBox && liveBox, 'Current 应同时显示 Draft 和 Live 卡')
    assert.ok(Math.abs(draftBox.y - liveBox.y) <= 2, `Draft/Live 卡应并排（y ${draftBox.y} vs ${liveBox.y}）`)
    assert.ok(draftBox.x < liveBox.x, 'Draft 卡应在 Live 卡左侧')
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    assert.ok(liveBox.x + liveBox.width <= viewport.width + 1, 'Live 卡不应超出视口右边')
    assert.ok(draftBox.y + draftBox.height <= viewport.height + 1, 'Current 卡不应超出视口底边')
    await shot(page, 'editor-versions-current-1672')

    // Versions：表格在面板内滚动。
    await page.getByTestId('versions-segment-versions').click()
    await page.waitForTimeout(150)
    await assertScrollable(page, 'versions-list-scroll', '1672 版本列表')
    await assertPageDoesNotScroll(page, 'course-editor-page', '1672 版本列表')
    assert.ok(await page.getByTestId('versions-current-draft').count() === 0, 'Versions 分段不应再渲染 Current 卡片（不纵向堆叠）')
    await shot(page, 'editor-versions-list-1672')

    // History：独立分段，表格内滚动，分页固定在面板底部不动。
    await page.getByTestId('versions-segment-history').click()
    await page.waitForTimeout(150)
    await assertScrollable(page, 'versions-history-scroll', '1672 历史记录')
    const pagination = page.getByTestId('versions-history-pagination')
    await pagination.waitFor()
    const before = await pagination.boundingBox()
    await page.getByTestId('versions-history-scroll').evaluate((node) => {
      node.scrollTop = 160
    })
    const after = await pagination.boundingBox()
    assert.ok(Math.abs(before.y - after.y) <= 1, '历史记录分页应固定在面板底部，不随表格滚动')
    await assertPageDoesNotScroll(page, 'course-editor-page', '1672 历史记录')
    await shot(page, 'editor-versions-history-1672')
  } finally {
    await context.close()
  }
})

test('1672×941：课程列表页页面本体不滚动、表格内滚动、分页固定底部', async () => {
  const { context, page } = await open({ width: 1672, height: 941 })
  try {
    await page.goto(`${base}/en-GB/course`)
    await page.waitForLoadState('networkidle')
    await page.getByTestId('course-overview-table-wrap').waitFor()

    await assertPageDoesNotScroll(page, 'course-overview-page', '1672 课程列表')
    assert.equal(await page.getByRole('heading', { name: 'Course Overview' }).count(), 1, '页头标题应为 Course Overview')
    for (const name of ['Operations', 'Create course', 'Import']) {
      assert.ok(await page.getByRole('button', { name }).first().isVisible(), `页头应有 ${name} 动作`)
    }
    await assertScrollable(page, 'course-overview-table-wrap', '1672 课程表格')
    const pagination = page.getByTestId('course-overview-pagination')
    await pagination.waitFor()
    const before = await pagination.boundingBox()
    await page.getByTestId('course-overview-table-wrap').evaluate((node) => {
      node.scrollTop = 160
    })
    const after = await pagination.boundingBox()
    assert.ok(Math.abs(before.y - after.y) <= 1, '分页条应固定在卡片底部，不随表格滚动')
    const viewport = await page.evaluate(() => ({ height: window.innerHeight }))
    assert.ok(after.y + after.height <= viewport.height + 1, '分页条应在视口内')
    await assertPageDoesNotScroll(page, 'course-overview-page', '1672 课程列表（表格滚动后）')
    await shot(page, 'course-overview-1672')
  } finally {
    await context.close()
  }
})

test('1280×800：同样的布局契约仍然成立', async () => {
  const { context, page } = await open({ width: 1280, height: 800 })
  try {
    await page.goto(`${base}/en-GB/course/c1`)
    await page.waitForLoadState('networkidle')
    for (const [tabId] of EDITOR_TABS) {
      await editorTabState(page, '1280', tabId)
    }
    await page.getByTestId('versions-segment-versions').click()
    await page.waitForTimeout(150)
    await assertScrollable(page, 'versions-list-scroll', '1280 版本列表')

    await page.goto(`${base}/en-GB/course`)
    await page.waitForLoadState('networkidle')
    await page.getByTestId('course-overview-table-wrap').waitFor()
    await assertPageDoesNotScroll(page, 'course-overview-page', '1280 课程列表')
    await assertScrollable(page, 'course-overview-table-wrap', '1280 课程表格')
    await shot(page, 'course-overview-1280')
  } finally {
    await context.close()
  }
})

test('1000×800（<1100）：分栏纵向折叠，仍无横向溢出且页面不滚动', async () => {
  const { context, page } = await open({ width: 1000, height: 800 })
  try {
    await page.goto(`${base}/en-GB/course/c1`)
    await page.waitForLoadState('networkidle')
    await page.getByTestId('course-tab-versions').click()
    await page.waitForTimeout(200)
    await assertPageDoesNotScroll(page, 'course-editor-page', '1000 课程编辑')
    await assertTabsStickyAndPanelBounded(page, '1000 课程编辑')

    // Current 的两张卡在 <1100 折叠为单列（上下排列）。
    await page.getByTestId('versions-segment-current').click()
    await page.waitForTimeout(150)
    const draftBox = await page.getByTestId('versions-current-draft').boundingBox()
    const liveBox = await page.getByTestId('versions-current-live').boundingBox()
    assert.ok(liveBox.y >= draftBox.y + draftBox.height - 1, `<1100 时 Draft/Live 卡应纵向折叠（draft 底 ${draftBox.y + draftBox.height}，live 顶 ${liveBox.y}）`)

    await page.goto(`${base}/en-GB/course`)
    await page.waitForLoadState('networkidle')
    await page.getByTestId('course-overview-table-wrap').waitFor()
    const state = await scrollState(page, 'course-overview-page')
    assert.ok(state.document.scrollX <= state.viewport.width + 1, '1000 课程列表不应横向滚动')
    assert.ok(state.content.scrollX <= state.content.clientX + 1, '1000 课程列表 .content 不应横向溢出')
    await shot(page, 'course-overview-1000')
  } finally {
    await context.close()
  }
})
