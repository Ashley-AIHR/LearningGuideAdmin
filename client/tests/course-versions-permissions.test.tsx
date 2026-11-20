// H1 / MEDIUM-1：版本区按钮按账号级 course.* 判定；导出只有线上版本；
// 版本表显示 Exported、来源与发布人。
import './support/dom'

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { EmployeeContext } from '../src/backoffice/employeeSession'
import { rememberAccountFeatures } from '../src/backoffice/lib/capabilities'
import { CourseVersionsSection } from '../src/backoffice/pages/course-editor/CourseVersionsSection'
import { employee } from './support/helpdesk-fake'

afterEach(() => {
  cleanup()
  rememberAccountFeatures({})
})

const COURSE = {
  id: 'c1',
  code: 'C1',
  hasDraft: true,
  liveStatus: 'ONLINE',
  learningLanguages: ['en-GB'],
  defaultContentLanguage: 'en-GB',
  localizations: [],
  lessons: [],
  completeness: {
    completedSteps: 3,
    canPublish: true,
    publishBlockerCodes: [],
    incompleteLessons: [],
    steps: {
      courseInformation: { complete: true, missing: [] },
      content: { complete: true, missing: [] },
      trial: { complete: true, missing: [] },
    },
  },
} as never

const VERSIONS = [
  {
    id: 'v2',
    versionNo: 2,
    versionLabel: '1.2',
    versionSeries: 1,
    versionMinor: 2,
    sourceEnvironment: 'Sandbox',
    sourceVersionLabel: '1.1',
    wentLiveAt: '2026-11-20T10:00:00.000Z',
    publishedBy: 'olive',
    exportedAt: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    isLive: true,
  },
  {
    id: 'v1',
    versionNo: 1,
    versionLabel: '1.1',
    versionSeries: 1,
    versionMinor: 1,
    sourceEnvironment: null,
    sourceVersionLabel: '1.0',
    wentLiveAt: '2026-11-19T10:00:00.000Z',
    publishedBy: 'System',
    exportedAt: '2026-11-20T11:00:00.000Z',
    createdAt: '2026-11-19T10:00:00.000Z',
    isLive: false,
  },
] as never

function renderVersions(role: Parameters<typeof employee>[0]) {
  return render(
    <MemoryRouter>
      <EmployeeContext.Provider value={employee(role)}>
        <CourseVersionsSection
          locale="en-GB"
          course={COURSE}
          versions={VERSIONS}
          history={null}
          historyPage={1}
          setHistoryPage={() => {}}
          busy={false}
          setBusy={() => {}}
          onReload={async () => {}}
          onNotice={() => {}}
        />
      </EmployeeContext.Provider>
    </MemoryRouter>,
  )
}

test('GRAPHIC_DESIGNER 被授予 course.publish：发布按钮出现（账号开关可越过角色基线）', () => {
  rememberAccountFeatures({ features: ['module.course', 'course.view', 'course.publish'] })
  renderVersions('GRAPHIC_DESIGNER')
  assert.ok(screen.getByTestId('publish-open'))
  // 未授予 import/export：对应按钮不渲染
  assert.equal(screen.queryByText('Import package'), null)
  assert.equal(screen.queryByTestId('export-open'), null)
})

test('Admin 被收回 course.publish：发布/删草稿隐藏；有 course.export 时才显示导出', () => {
  rememberAccountFeatures({ features: ['module.course', 'course.view', 'course.export'] })
  renderVersions('ADMIN')
  assert.equal(screen.queryByTestId('publish-open'), null)
  assert.equal(screen.queryByText('Delete draft'), null)
  assert.ok(screen.getByTestId('export-open'))
})

test('导出只有线上版本：没有 Working 选项，确认弹窗写明文件名', () => {
  rememberAccountFeatures({ features: ['module.course', 'course.view', 'course.export'] })
  renderVersions('ADMIN')
  fireEvent.click(screen.getByTestId('export-open'))
  assert.equal(screen.queryByText('Working'), null)
  assert.ok(screen.getByText(/Export live version 1\.2\?/))
  assert.ok(screen.getByText(/C1_1\.2\.zip/))
  assert.ok(screen.getByTestId('export-confirm'))
})

test('版本表按 PRD §15.5 显示 Exported、Sandbox 来源与发布人', () => {
  rememberAccountFeatures({ features: ['module.course', 'course.view'] })
  renderVersions('ADMIN')
  fireEvent.click(screen.getByTestId('versions-segment-versions'))
  assert.ok(screen.getByText('Sandbox 1.1'))
  assert.ok(screen.getByText('Restored from Version 1.0'))
  assert.ok(screen.getByText('olive'))
  // 导出过的版本有日期，未导出的显示 —
  assert.notEqual(screen.getByTestId('version-exported-v1').textContent, '—')
  assert.equal(screen.getByTestId('version-exported-v2').textContent, '—')
})
