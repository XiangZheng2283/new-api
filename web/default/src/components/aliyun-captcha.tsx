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
  timeout?: number
  delayBeforeSuccess?: boolean
  onError?: (errorInfo: { code: string; msg: string }) => void
  onClose?: () => void
  showErrorTip?: boolean
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

/**
 * 将前端 i18n 语言映射为阿里验证码 SDK language 参数
 * SDK 支持值：cn/tw/en/ar/de/es/fr/in/it/ja/ko/pt/ru/ms/th/tr/vi
 */
function mapLanguage(i18nLang?: string): string {
  if (!i18nLang) return 'cn'
  const primary = i18nLang.split(/[-_]/)[0].toLowerCase()
  const mapping: Record<string, string> = {
    zh: 'cn', en: 'en', ar: 'ar', de: 'de', es: 'es', fr: 'fr',
    id: 'in', it: 'it', ja: 'ja', ko: 'ko', pt: 'pt',
    ru: 'ru', ms: 'ms', th: 'th', tr: 'tr', vi: 'vi',
  }
  const lower = i18nLang.toLowerCase()
  if (lower === 'zh-tw' || lower === 'zh-hant') return 'tw'
  return mapping[primary] ?? 'cn'
}

/** 从 SDK fail 回调的 unknown 结果中提取错误信息 */
function extractFailMessage(result: unknown): string {
  if (result instanceof Error) return result.message
  if (typeof result === 'object' && result !== null && 'msg' in result) {
    return String((result as { msg: unknown }).msg) || '人机验证未通过，请重试'
  }
  if (typeof result === 'string') return result
  return '人机验证未通过，请重试'
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

/** SDK 回调缓存：当 SDK button 绑定先于 React onClick 触发回调时，缓存结果供 execute() 取用 */
type CachedResult =
  | { type: 'success'; param: string }
  | { type: 'fail'; error: Error }

export const AliyunCaptcha = forwardRef<AliyunCaptchaHandle, AliyunCaptchaProps>(
  function AliyunCaptcha(
    { enabled, region, prefix, sceneId, captchaType, targetButtonId, language, className, onError },
    ref
  ) {
    const reactId = useId().replace(/:/g, '')
    const elementId = `aliyun-captcha-element-${reactId}`
    const instanceRef = useRef<AliyunCaptchaInstance | null>(null)
    const initializedFingerprintRef = useRef('')
    const pendingResolveRef = useRef<((captchaVerifyParam: string) => void) | null>(null)
    const pendingRejectRef = useRef<((error: Error) => void) | null>(null)
    const pendingVerifyRef = useRef(false)
    // SDK 回调缓存：smart 模式下 SDK button 绑定先于 React onClick 触发时使用
    const cachedResultRef = useRef<CachedResult | null>(null)

    // onError ref：避免 inline arrow function 导致 initialize useCallback 不稳定
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError

    const sdkMode = getSdkMode(captchaType)
    const isEmbedMode = sdkMode === 'embed'

    // embed 模式下验证码组件的显隐状态
    // 初始隐藏 → execute() 时显示 → success 后隐藏 → fail 后保持可见让用户重试
    const [embedVisible, setEmbedVisible] = useState(false)

    // SDK button 选择器：指向真实业务按钮
    // 文档：button — 触发验证码弹窗或无痕验证的元素，点击后弹出验证码或触发无痕验证
    const buttonSelector = `#${targetButtonId}`

    /** 通用：resolve pending promise 或缓存结果 */
    const resolvePending = useCallback((captchaVerifyParam: string) => {
      if (pendingResolveRef.current) {
        pendingResolveRef.current(captchaVerifyParam)
        pendingResolveRef.current = null
        pendingRejectRef.current = null
      } else {
        // execute() 还没执行（SDK button 绑定先于 React onClick 触发），缓存结果
        cachedResultRef.current = { type: 'success', param: captchaVerifyParam }
      }
    }, [])

    /** 通用：reject pending promise 或缓存结果 */
    const rejectPending = useCallback((error: Error) => {
      if (pendingRejectRef.current) {
        pendingRejectRef.current(error)
        pendingResolveRef.current = null
        pendingRejectRef.current = null
      } else {
        cachedResultRef.current = { type: 'fail', error }
      }
    }, [])

    /** 通用：清理 pending 状态 */
    const clearPending = useCallback(() => {
      pendingVerifyRef.current = false
      pendingResolveRef.current = null
      pendingRejectRef.current = null
      cachedResultRef.current = null
    }, [])

    const initialize = useCallback(async () => {
      if (!enabled) return
      if (!prefix || !sceneId) {
        throw new Error('阿里验证码配置不完整')
      }
      const fingerprint = `${sceneId}:${sdkMode}:${buttonSelector}:${mapLanguage(language)}`
      if (initializedFingerprintRef.current === fingerprint) return

      // 文档：initAliyunCaptcha 不支持重复调用（除非参数变化）
      if (instanceRef.current) {
        instanceRef.current.hide?.()
        instanceRef.current = null
      }

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
        button: buttonSelector,
        language: mapLanguage(language),
        // 文档：timeout — 验证码初始化请求单次请求超时时间，默认5000ms
        // 设为 10000 增加网络慢时的容错
        timeout: 10000,
        success: (captchaVerifyParam: string) => {
          // success 回调：只传递验证参数，不做 refresh
          // 按文档验签示例，refresh 在业务请求完成后调用
          if (import.meta.env.DEV) {
            console.log('[Captcha] SDK success callback, param length:', captchaVerifyParam.length, 'pendingResolve:', !!pendingResolveRef.current)
          }
          if (isEmbedMode) {
            setEmbedVisible(false)
          }
          pendingVerifyRef.current = false
          resolvePending(captchaVerifyParam)
        },
        fail: (result: unknown) => {
          // 文档：SDK 自动刷新验证码，不需要手动操作
          // embed 模式下不隐藏验证码，保持可见让用户重试
          if (import.meta.env.DEV) {
            console.warn('[Captcha] SDK fail callback:', result)
          }
          const message = extractFailMessage(result)
          pendingVerifyRef.current = false
          rejectPending(new Error(message))
        },
        getInstance: (instance: AliyunCaptchaInstance) => {
          instanceRef.current = instance
        },
        server: ['captcha-esa-open.aliyuncs.com', 'captcha-esa-open-b.aliyuncs.com'],
        // 文档：slideStyle 只适用于滑块和一点即过，不适用于拼图和图像复原
        ...(isEmbedMode ? {
          slideStyle: { width: 360, height: 40 },
        } : {}),
        // 文档：onError — 初始化接口请求和资源加载失败、超时的错误回调
        onError: (errorInfo) => {
          const message = `验证码初始化失败: ${errorInfo.msg} (${errorInfo.code})`
          onErrorRef.current?.(message)
          pendingVerifyRef.current = false
          rejectPending(new Error(message))
        },
        // 文档：onClose — 验证码弹窗关闭时触发的回调函数
        // 用户关闭弹窗时 reject pending promise，防止 Promise 永远挂起
        onClose: () => {
          pendingVerifyRef.current = false
          rejectPending(new Error('用户关闭验证码'))
        },
        // 文档：delayBeforeSuccess 默认 true — 验证成功后延迟1s触发success回调
        // 使用默认值 true，让 embed 模式下 SDK 动画完成后再隐藏验证码
        delayBeforeSuccess: true,
        // 文档：showErrorTip 默认 true — 显示网络质量不佳时的错误提醒
        showErrorTip: true,
      }

      window.initAliyunCaptcha(initOptions)
      initializedFingerprintRef.current = fingerprint
      if (import.meta.env.DEV) {
        console.log('[Captcha] initAliyunCaptcha called', { SceneId: sceneId, mode: sdkMode, element: `#${elementId}`, button: buttonSelector, language: mapLanguage(language) })
      }
    }, [sdkMode, buttonSelector, elementId, enabled, prefix, region, sceneId, language, isEmbedMode, resolvePending, rejectPending])

    // 组件挂载时立即加载 SDK 并初始化
    // 文档：验证码JS加载尽量前置，初始化和验证请求间隔大于2s
    useEffect(() => {
      if (enabled && prefix && sceneId && targetButtonId) {
        initialize()
      }
    }, [initialize, enabled, prefix, sceneId, targetButtonId])

    // 组件卸载时清理 SDK 实例，防止内存泄漏
    useEffect(() => {
      return () => {
        if (instanceRef.current) {
          instanceRef.current.hide?.()
          instanceRef.current = null
        }
        initializedFingerprintRef.current = ''
        if (pendingVerifyRef.current) {
          pendingRejectRef.current?.(new Error('组件卸载'))
          clearPending()
        }
      }
    }, [clearPending])

    useImperativeHandle(
      ref,
      () => ({
        execute: async () => {
          if (!enabled) return ''
          if (import.meta.env.DEV) {
            console.log('[Captcha] execute() called', { captchaType, sdkMode, isEmbedMode, buttonSelector, instanceReady: !!instanceRef.current, fingerprint: initializedFingerprintRef.current })
          }
          try {
            // 防止重复触发：如果已有等待中的验证，直接返回空
            if (pendingVerifyRef.current) {
              if (import.meta.env.DEV) {
                console.warn('[Captcha] execute() blocked: pendingVerifyRef is true (previous verification still in progress)')
              }
              return ''
            }
            pendingVerifyRef.current = true

            // 先设置 pending resolve/reject
            const promise = new Promise<string>((resolve, reject) => {
              pendingResolveRef.current = resolve
              pendingRejectRef.current = reject
            })

            // 检查是否有缓存的结果：
            // smart 模式下 SDK button 绑定先于 React onClick 触发，
            // SDK 的 success/fail 回调在 execute() 之前就已经执行，
            // 此时 pending refs 为 null，回调会将结果缓存到 cachedResultRef
            const cached = cachedResultRef.current
            if (cached) {
              cachedResultRef.current = null
              pendingVerifyRef.current = false
              if (import.meta.env.DEV) {
                console.log('[Captcha] execute() using cached result:', cached.type, cached.type === 'success' ? cached.param.substring(0, 20) + '...' : cached.error.message)
              }
              if (cached.type === 'success') {
                pendingResolveRef.current = null
                pendingRejectRef.current = null
                return cached.param
              }
              pendingResolveRef.current = null
              pendingRejectRef.current = null
              throw cached.error
            }

            // 确保 SDK 已初始化
            await initialize()

            // embed 模式（滑块/一点即过）：显示验证码容器，等待用户操作
            if (isEmbedMode) {
              setEmbedVisible(true)
            }

            // popup/smart 模式：
            // SDK 已绑定 button（真实业务按钮），用户点击该按钮时 SDK 自动触发验证
            // React onClick 也同时触发，走到这里设置 pending refs 并等待 SDK 回调

            // 添加超时保护：如果30秒内 SDK 回调未触发，reject promise 防止永远挂起
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                if (pendingVerifyRef.current) {
                  pendingVerifyRef.current = false
                  pendingResolveRef.current = null
                  pendingRejectRef.current = null
                  reject(new Error('验证码超时，请重试'))
                }
              }, 30000)
            })

            return await Promise.race([promise, timeoutPromise])
          } catch (error) {
            pendingVerifyRef.current = false
            const message = error instanceof Error ? error.message : '人机验证初始化失败'
            onErrorRef.current?.(message)
            throw new Error(message)
          }
        },
        refresh: () => {
          // 供外部在业务请求完成后调用，对齐文档验签示例中的 captcha.refresh()
          instanceRef.current?.refresh?.()
        },
      }),
      [enabled, initialize, isEmbedMode]
    )

    if (!enabled) return null

    return (
      <div className={className}>
        {/*
          element div 始终存在于 DOM（文档：预留验证码页面元素）
          - embed 模式：由 embedVisible 状态控制显隐
          - popup 模式：始终隐藏，SDK 在弹窗时自行管理渲染
          - smart 模式：始终隐藏，无痕验证无 UI
        */}
        <div
          id={elementId}
          className={isEmbedMode ? (embedVisible ? '' : 'hidden') : 'hidden'}
        />
      </div>
    )
  }
)
