/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { forwardRef, useCallback, useEffect, useImperativeHandle, useId, useRef, useState } from 'react'

declare global {
  interface Window {
    AliyunCaptchaConfig?: {
      region: string
      prefix: string
    }
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => void
  }
}

// ESA 验证码形态类型
export type CaptchaType = 'smart' | 'instant' | 'slide' | 'puzzle' | 'recovery'

interface AliyunCaptchaInstance {
  show?: () => void
  hide?: () => void
  refresh?: () => void
}

interface AliyunCaptchaOptions {
  SceneId: string
  mode: 'popup' | 'embed'
  element: string
  button: string
  success: (captchaVerifyParam: string) => void
  fail: (result: unknown) => void
  getInstance: (instance: AliyunCaptchaInstance) => void
  server: string[]
  slideStyle?: {
    width: number
    height: number
  }
  language?: string
  delayBeforeSuccess?: boolean
}

export interface AliyunCaptchaHandle {
  /** 触发验证码并等待验证结果，返回 captchaVerifyParam */
  execute: () => Promise<string>
  /** 业务请求完成后调用，重置验证码状态 */
  refresh: () => void
}

interface AliyunCaptchaProps {
  enabled: boolean
  region: string
  prefix: string
  sceneId: string
  /** 验证码形态：决定 SDK mode 和交互方式，空则默认 popup */
  captchaType: CaptchaType | ''
  /** 业务按钮 DOM id，SDK 绑定此按钮触发验证弹窗或无痕验证（必须传入） */
  targetButtonId: string
  /** 前端 i18n 语言代码，映射为 SDK language 参数 */
  language?: string
  className?: string
  onError?: (message: string) => void
}

/**
 * 根据形态决定 SDK mode（对照阿里验证码接入文档.md）：
 * - embed 不适用于无痕验证（文档明确：mode=embed 不适用于无痕验证）
 * - 滑块/一点即过 → embed（嵌入式，SDK 在 element 内渲染）
 * - 拼图/复原/无痕/未配置 → popup（弹出式，点击 button 弹窗）
 */
function getSdkMode(captchaType: CaptchaType | ''): 'popup' | 'embed' {
  return captchaType === 'slide' || captchaType === 'instant' ? 'embed' : 'popup'
}

/** 是否为无痕验证 */
function isSmartCaptcha(captchaType: CaptchaType | ''): boolean {
  return captchaType === 'smart'
}

/**
 * 将前端 i18n 语言映射为阿里验证码 SDK language 参数
 * SDK 支持值：cn/tw/en/ar/de/es/fr/in/it/ja/ko/pt/ru/ms/th/tr/vi
 */
function mapLanguage(i18nLang?: string): string {
  if (!i18nLang) return 'cn'
  // 提取主语言子标签：'en-US' → 'en', 'zh-Hans-CN' → 'zh'
  const primary = i18nLang.split(/[-_]/)[0].toLowerCase()
  const mapping: Record<string, string> = {
    zh: 'cn', en: 'en', ar: 'ar', de: 'de', es: 'es', fr: 'fr',
    id: 'in', it: 'it', ja: 'ja', ko: 'ko', pt: 'pt',
    ru: 'ru', ms: 'ms', th: 'th', tr: 'tr', vi: 'vi',
  }
  // 先尝试完整匹配（处理 zh-tw 等），再尝试主语言子标签
  const lower = i18nLang.toLowerCase()
  if (lower === 'zh-tw' || lower === 'zh-hant') return 'tw'
  return mapping[primary] ?? 'cn'
}

let aliyunCaptchaScriptPromise: Promise<void> | null = null

function loadAliyunCaptchaScript(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve()
  if (aliyunCaptchaScriptPromise) return aliyunCaptchaScriptPromise

  aliyunCaptchaScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('aliyun-captcha')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener(
        'error',
        () => reject(new Error('阿里验证码脚本加载失败')),
        { once: true }
      )
      return
    }

    const script = document.createElement('script')
    script.id = 'aliyun-captcha'
    script.src = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('阿里验证码脚本加载失败'))
    document.head.appendChild(script)
  })

  return aliyunCaptchaScriptPromise
}

export const AliyunCaptcha = forwardRef<AliyunCaptchaHandle, AliyunCaptchaProps>(
  function AliyunCaptcha(
    { enabled, region, prefix, sceneId, captchaType, targetButtonId, language, className, onError },
    ref
  ) {
    const reactId = useId().replace(/:/g, '')
    const elementId = `aliyun-captcha-element-${reactId}`
    const instanceRef = useRef<AliyunCaptchaInstance | null>(null)
    // 记录已初始化的配置指纹（sceneId + mode + button），任一变化都需要重新初始化
    const initializedFingerprintRef = useRef('')
    // Promise resolve/reject — success/fail 回调通过此机制传递验证结果给 execute() 调用者
    const pendingResolveRef = useRef<((captchaVerifyParam: string) => void) | null>(null)
    const pendingRejectRef = useRef<((error: Error) => void) | null>(null)

    const sdkMode = getSdkMode(captchaType)
    const smart = isSmartCaptcha(captchaType)
    const isEmbedMode = sdkMode === 'embed'

    // embed 模式下验证码组件的显隐状态
    // 初始隐藏 → execute() 时显示 → success 后隐藏 → fail 后保持可见让用户重试
    const [embedVisible, setEmbedVisible] = useState(false)

    // button 指向业务按钮（文档：触发验证码弹窗或无痕验证的元素）
    const sdkButtonSelector = `#${targetButtonId}`

    const initialize = useCallback(async () => {
      if (!enabled) return
      if (!prefix || !sceneId) {
        throw new Error('阿里验证码配置不完整')
      }
      // 配置指纹：sceneId + mode + button + language，任一变化都需要重新初始化 SDK
      const fingerprint = `${sceneId}:${sdkMode}:${sdkButtonSelector}:${mapLanguage(language)}`
      if (initializedFingerprintRef.current === fingerprint) return

      window.AliyunCaptchaConfig = {
        region: region || 'cn',
        prefix,
      }
      await loadAliyunCaptchaScript()
      if (!window.initAliyunCaptcha) {
        throw new Error('阿里验证码初始化方法不可用')
      }

      const initOptions: AliyunCaptchaOptions = {
        SceneId: sceneId,
        mode: sdkMode,
        element: `#${elementId}`,
        button: sdkButtonSelector,
        language: mapLanguage(language),
        success: (captchaVerifyParam: string) => {
          // success 回调：只传递验证参数，不做 refresh
          // 按文档验签示例，refresh 在业务请求完成后调用
          if (isEmbedMode) {
            setEmbedVisible(false)
          }
          pendingResolveRef.current?.(captchaVerifyParam)
          pendingResolveRef.current = null
          pendingRejectRef.current = null
        },
        fail: (result: unknown) => {
          // 文档：SDK 自动刷新验证码，不需要手动操作
          // embed 模式下不隐藏验证码，保持可见让用户重试 SDK 自动刷新后的验证码
          const message = result instanceof Error ? result.message : '人机验证未通过，请重试'
          pendingRejectRef.current?.(new Error(message))
          pendingResolveRef.current = null
          pendingRejectRef.current = null
        },
        getInstance: (instance: AliyunCaptchaInstance) => {
          instanceRef.current = instance
        },
        server: ['captcha-esa-open.aliyuncs.com', 'captcha-esa-open-b.aliyuncs.com'],
        // slideStyle 只适用于滑块和一点即过，不适用于拼图和图像复原
        ...(isEmbedMode ? {
          slideStyle: { width: 360, height: 40 },
        } : {}),
        delayBeforeSuccess: false,
      }

      window.initAliyunCaptcha(initOptions)
      initializedFingerprintRef.current = fingerprint
    }, [sdkMode, sdkButtonSelector, elementId, enabled, prefix, region, sceneId, language, isEmbedMode])

    // 组件挂载时立即加载 SDK 并初始化
    // 文档：验证码JS加载尽量前置，初始化和验证请求间隔大于2s
    useEffect(() => {
      if (enabled && prefix && sceneId && targetButtonId) {
        initialize()
      }
    }, [initialize, enabled, prefix, sceneId, targetButtonId])

    useImperativeHandle(
      ref,
      () => ({
        execute: async () => {
          if (!enabled) return ''
          try {
            // 先设置 pending resolve/reject，防止 SDK 的 success/fail 回调
            // 在 execute() 设置 pending 之前触发（特别是 smart 模式下验证可能很快完成）
            // 返回一个新的 Promise，resolve/reject 由 SDK 回调触发
            const promise = new Promise<string>((resolve, reject) => {
              pendingResolveRef.current = resolve
              pendingRejectRef.current = reject
            })

            await initialize()

            // embed 模式（滑块/一点即过）：显示验证码容器，等待用户操作
            // 注意：不在 execute() 中调用 refresh()，因为 SDK button 绑定也同时触发验证，
            // refresh() 会重置正在进行的验证。refresh 由业务代码在请求完成后调用。
            if (isEmbedMode) {
              setEmbedVisible(true)
            }

            // popup/smart/embed 模式：
            // SDK 绑定了 button，用户点击按钮时 SDK 自动触发验证
            // 不需要调 show()，因为 SDK 的 button 绑定已经触发了验证/弹窗
            // 只需等待 promise 被 SDK 的 success/fail 回调 resolve/reject
            return await promise
          } catch (error) {
            const message = error instanceof Error ? error.message : '人机验证初始化失败'
            onError?.(message)
            throw new Error(message)
          }
        },
        refresh: () => {
          // 供外部在业务请求完成后调用，对齐文档验签示例中的 captcha.refresh()
          instanceRef.current?.refresh?.()
        },
      }),
      [enabled, initialize, onError, isEmbedMode, smart]
    )

    if (!enabled) return null

    return (
      <div className={className}>
        {/*
          element div 始终存在于 DOM（文档：预留验证码页面元素）
          - embed 模式：由 embedVisible 状态控制显隐
          - popup 模式：始终隐藏，SDK 在弹窗时自行管理渲染
        */}
        <div
          id={elementId}
          className={isEmbedMode ? (embedVisible ? '' : 'hidden') : 'hidden'}
        />
      </div>
    )
  }
)
