import { describe, expect, it } from 'vitest'

import { en } from './en'
import { createTranslator, DEFAULT_LOCALE, isLocale, LOCALES, translate } from './index'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'

const placeholders = (template: string): string[] => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('i18n dictionaries', () => {
  it('defaults to English so first launch and the test suites stay deterministic', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })

  it('offers exactly the three shipped languages, each labelled in its own language', () => {
    expect(LOCALES).toEqual([
      { value: 'en', label: 'English' },
      { value: 'zh-CN', label: '简体中文' },
      { value: 'zh-TW', label: '繁體中文' }
    ])
  })

  // The dictionaries are type-checked to be complete, but nothing at the type level keeps
  // their placeholders in step: a locale that drops {version} silently renders a sentence
  // with a hole in it.
  it.each([
    ['Simplified Chinese', zhCN],
    ['Traditional Chinese', zhTW]
  ])('translates every English key with matching placeholders in %s', (_name, dictionary) => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const source = en[key]
      const translated = dictionary[key]
      expect(translated, `missing translation for ${key}`).toBeTruthy()
      expect(placeholders(translated), `placeholder mismatch for ${key}`).toEqual(placeholders(source))
    }
  })

  // zh-TW is its own translation rather than a character-level conversion of zh-CN, and the
  // realistic way it decays is a zh-CN string pasted in and left untranslated. Short labels
  // ("取消", "版本") are legitimately identical in both, so instead of comparing the two
  // dictionaries this scans for simplified-only forms of the characters this UI actually
  // uses — every one of them has a different traditional codepoint.
  it('writes Traditional Chinese without simplified-only characters', () => {
    const simplifiedOnly = [...'设话会项开关闭击单说语编择报务应该级别确认删发动启后检运这电脑间时围终内许顶态选结条资复径库将个并称续读输无侧边栏历择记标与请类错误权过执档词顺变显况试弃现让独题浅号败载装备页进']
    const offenders = (Object.keys(en) as Array<keyof typeof en>)
      .map((key) => ({ key, hits: simplifiedOnly.filter((char) => zhTW[key].includes(char)) }))
      .filter((entry) => entry.hits.length > 0)
    expect(offenders).toEqual([])
  })

  it('translates shared UI vocabulary differently in the two Chinese dictionaries', () => {
    expect([zhCN['settings.title'], zhTW['settings.title']]).toEqual(['设置', '設定'])
    expect([zhCN['sidebar.newSession'], zhTW['sidebar.newSession']]).toEqual(['新建会话', '新增工作階段'])
    expect([zhCN['sidebar.openProjectFolder'], zhTW['sidebar.openProjectFolder']]).toEqual([
      '打开项目文件夹',
      '開啟專案資料夾'
    ])
  })
})

describe('translate', () => {
  it('returns the locale string for a known key', () => {
    expect(translate('en', 'settings.title')).toBe('Settings')
    expect(translate('zh-CN', 'settings.title')).toBe('设置')
    expect(translate('zh-CN', 'settings.launchAtLogin')).toBe('开机自动启动')
    expect(translate('zh-TW', 'settings.title')).toBe('設定')
    expect(translate('zh-TW', 'settings.launchAtLogin')).toBe('開機時自動啟動')
  })

  it('substitutes named placeholders', () => {
    expect(translate('en', 'settings.updateAvailable', { version: '1.2.3' })).toBe('Version 1.2.3 is available.')
    expect(translate('zh-CN', 'notice.dirtyWorktree', { count: 3 })).toContain('3')
  })

  it('translates the project options label with its project-name placeholder', () => {
    expect(translate('en', 'sidebar.projectOptions', { project: 'demo-project' })).toBe('Project options for demo-project')
    expect(translate('zh-CN', 'sidebar.projectOptions', { project: 'demo-project' })).toBe('demo-project 的项目选项')
  })

  it('leaves an unmatched placeholder visible rather than blanking it', () => {
    expect(translate('en', 'settings.updateAvailable', {})).toBe('Version {version} is available.')
  })

  it('falls back to English when a locale is not one of the shipped dictionaries', () => {
    expect(translate('de' as never, 'settings.title')).toBe('Settings')
  })

  it('binds a locale with createTranslator', () => {
    const t = createTranslator('zh-CN')
    expect(t('common.cancel')).toBe('取消')
  })
})

describe('isLocale', () => {
  it('accepts shipped locales and rejects anything else', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('zh-TW')).toBe(true)
    expect(isLocale('zh')).toBe(false)
    expect(isLocale('zh-Hant')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
})
