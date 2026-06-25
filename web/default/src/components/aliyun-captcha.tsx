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
  /** 业务按钮 DOM id（保留给调用方标识业务按钮；SDK 实际绑定内部隐藏按钮，避免事件时序竞争） */
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

// 模块级变量：追踪 SDK 脚本的加载状态
let sdkScriptPromise: Promise<void> | null = null
let sdkScriptLoaded = false

const SDK_SCRIPT_URL =
  'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'

/**
 * 动态加载阿里验证码 SDK 脚本。
 * 必须在设置 window.AliyunCaptchaConfig 之后调用。
 * 文档要求：必须动态引入验证码JS，不可使用静态 <script> 或本地部署。
 */
function loadSdkScript(): Promise<void> {
  if (sdkScriptLoaded) return Promise.resolve()
  if (sdkScriptPromise) return sdkScriptPromise

  sdkScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('aliyun-captcha-sdk')
    if (existingScript) {
      sdkScriptLoaded = true
      resolve()
      return
    }

    const script = document.createElement('script')
    script.id = 'aliyun-captcha-sdk'
    script.type = 'text/javascript'
    script.src = SDK_SCRIPT_URL
    script.onload = () => {
      sdkScriptLoaded = true
      resolve()
    }
    script.onerror = () => {
      sdkScriptPromise = null
      reject(new Error('阿里验证码脚本加载失败'))
    }
    document.head.appendChild(script)
  })

  return sdkScriptPromise
}

/**
 * 等待阿里验证码 SDK 就绪（动态加载后，轮询 initAliyunCaptcha 出现）。
 */
function waitForCaptchaSdk(timeoutMs = 10000): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (window.initAliyunCaptcha) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error('阿里验证码脚本加载超时'))
      }
    }, 100)
  })
}

export const AliyunCaptcha = forwardRef<AliyunCaptchaHandle, AliyunCaptchaProps>(
  function AliyunCaptcha(
    { enabled, region, prefix, sceneId, captchaType, targetButtonId, language, className, onError },
    ref
  ) {
    const reactId = useId().replace(/:/g, '')
    const elementId = `aliyun-captcha-element-${reactId}`
    const buttonId = `aliyun-captcha-button-${reactId}`
    const instanceRef = useRef<AliyunCaptchaInstance | null>(null)
    const initializedFingerprintRef = useRef('')
    const initializingPromiseRef = useRef<Promise<void> | null>(null)
    const initializingFingerprintRef = useRef('')
    const pendingResolveRef = useRef<((captchaVerifyParam: string) => void) | null>(null)
    const pendingRejectRef = useRef<((error: Error) => void) | null>(null)
    const pendingVerifyRef = useRef(false)
    // smart 模式降级标记：首次 fail 不 reject，等待 SDK 自动降级到其他形态
    const smartDowngradedRef = useRef(false)

    // onError ref：避免 inline arrow function 导致 initialize useCallback 不稳定
    const onErrorRef = useRef(onError)
    onErrorRef.current = onError
    // captchaType ref：fail 回调需要判断是否为 smart 模式
    const captchaTypeRef = useRef(captchaType)
    captchaTypeRef.current = captchaType

    const sdkMode = getSdkMode(captchaType)
    const isEmbedMode = sdkMode === 'embed'

    // embed 模式下验证码组件的显隐状态
    // 初始隐藏 → execute() 时显示 → success 后隐藏 → fail 后保持可见让用户重试
    const [embedVisible, setEmbedVisible] = useState(false)

    // SDK button 选择器：使用不隐藏的内部按钮，避免真实业务按钮事件递归触发。
    // 不能用 display:none；ESA SDK 需要可交互元素来保留点击触发语义。
    const buttonSelector = `#${buttonId}`

    /** 通用：resolve 当前 pending promise；没有 pending 时忽略 SDK 迟到回调 */
    const resolvePending = useCallback((captchaVerifyParam: string) => {
      if (!pendingResolveRef.current) return

      pendingResolveRef.current(captchaVerifyParam)
      pendingResolveRef.current = null
      pendingRejectRef.current = null
    }, [])

    /** 通用：reject 当前 pending promise；没有 pending 时忽略 SDK 迟到回调 */
    const rejectPending = useCallback((error: Error) => {
      if (!pendingRejectRef.current) return

      pendingRejectRef.current(error)
      pendingResolveRef.current = null
      pendingRejectRef.current = null
    }, [])

    /** 通用：清理 pending 状态 */
    const clearPending = useCallback(() => {
      pendingVerifyRef.current = false
      pendingResolveRef.current = null
      pendingRejectRef.current = null
      smartDowngradedRef.current = false
    }, [])

    const initialize = useCallback(async () => {
      if (!enabled) return
      if (!prefix || !sceneId) {
        throw new Error('阿里验证码配置不完整')
      }
      const fingerprint = `${sceneId}:${sdkMode}:${buttonSelector}:${mapLanguage(language)}`
      if (initializedFingerprintRef.current === fingerprint) return
      if (
        initializingFingerprintRef.current === fingerprint &&
        initializingPromiseRef.current
      ) {
        return initializingPromiseRef.current
      }

      const initializePromise = (async () => {
        // 文档：initAliyunCaptcha 不支持重复调用（除非参数变化）
        if (instanceRef.current) {
          instanceRef.current.hide?.()
          instanceRef.current = null
        }

        // 文档要求：
        // 1. 先设置 window.AliyunCaptchaConfig（region + prefix）
        // 2. 再动态加载 SDK 脚本（script 标签动态创建）
        // 顺序不可颠倒——SDK 在加载时会读取 AliyunCaptchaConfig
        window.AliyunCaptchaConfig = {
          region: region || 'cn',
          prefix,
        }
        await loadSdkScript()
        await waitForCaptchaSdk()
        if (!window.initAliyunCaptcha) {
          throw new Error('阿里验证码初始化方法不可用')
        }

        let resolveReady: (() => void) | null = null
        let rejectReady: ((error: Error) => void) | null = null
        const readyPromise = new Promise<void>((resolve, reject) => {
          resolveReady = resolve
          rejectReady = reject
        })

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
            // smart 降级成功后清理标记
            smartDowngradedRef.current = false
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
              console.warn('[Captcha] SDK fail callback:', result, 'isEmbedMode:', isEmbedMode)
            }

            // smart 模式：首次 fail 是自动降级信号，不做 reject
            // 首次无感分析未通过 → SDK 自动降级到其他验证形态（拼图/滑块）
            // 此时不能 reject promise，否则消费侧会认为验证失败
            // 需要等降级后的 success/fail 回调
            if (captchaTypeRef.current === 'smart' && !smartDowngradedRef.current) {
              smartDowngradedRef.current = true
              // pendingVerifyRef 保持 true，pending refs 保持存活等待降级结果
              return
            }

            // 普通模式 / smart 降级后再次失败 → 正常 reject
            const message = extractFailMessage(result)
            pendingVerifyRef.current = false
            smartDowngradedRef.current = false
            rejectPending(new Error(message))
          },
          getInstance: (instance: AliyunCaptchaInstance) => {
            instanceRef.current = instance
            resolveReady?.()
          },
          server: ['captcha-esa-open.aliyuncs.com', 'captcha-esa-open-b.aliyuncs.com'],
          // 文档：slideStyle 只适用于滑块和一点即过，不适用于拼图和图像复原
          ...(isEmbedMode ? {
            slideStyle: { width: 360, height: 40 },
          } : {}),
          // 文档：onError — 初始化接口请求和资源加载失败、超时的错误回调
          onError: (errorInfo) => {
            const message = `验证码初始化失败: ${errorInfo.msg} (${errorInfo.code})`
            rejectReady?.(new Error(message))
            onErrorRef.current?.(message)
            pendingVerifyRef.current = false
            rejectPending(new Error(message))
          },
          // 文档：onClose — 验证码弹窗关闭时触发的回调函数
          // 只在验证尚未完成时 reject pending promise（验证成功后也会触发 onClose，不能覆盖结果）
          onClose: () => {
            if (!pendingVerifyRef.current) return
            // smart 降级期间用户关闭弹窗，清理降级标记
            smartDowngradedRef.current = false
            pendingVerifyRef.current = false
            rejectPending(new Error('用户关闭验证码'))
          },
          // 文档：delayBeforeSuccess 默认 true — 验证成功后延迟1s触发success回调
          // 设为 false 以便尽快拿到验证参数，避免1s延迟期间的状态竞争
          delayBeforeSuccess: false,
          // 文档：showErrorTip 默认 true — 显示网络质量不佳时的错误提醒
          showErrorTip: true,
        }

        window.initAliyunCaptcha(initOptions)
        const readyTimeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('阿里验证码初始化超时')), 10000)
        })
        await Promise.race([readyPromise, readyTimeout])
        initializedFingerprintRef.current = fingerprint
        if (import.meta.env.DEV) {
          console.log('[Captcha] initAliyunCaptcha called', { SceneId: sceneId, mode: sdkMode, element: `#${elementId}`, button: buttonSelector, language: mapLanguage(language) })
        }
      })()

      initializingFingerprintRef.current = fingerprint
      initializingPromiseRef.current = initializePromise

      try {
        await initializePromise
      } finally {
        initializingFingerprintRef.current = ''
        initializingPromiseRef.current = null
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

            // 设置 pending resolve/reject
            const promise = new Promise<string>((resolve, reject) => {
              pendingResolveRef.current = resolve
              pendingRejectRef.current = reject
            })

            // 确保 SDK 已初始化
            await initialize()

            // embed 模式（滑块/一点即过）：显示验证码容器，等待用户操作
            if (isEmbedMode) {
              setEmbedVisible(true)
            }

            // popup/smart 模式：SDK 绑定的是内部隐藏按钮，业务逻辑调用 execute() 后主动触发。
            // 这样 success 一定发生在本次 promise 已建立之后，拿到的 captchaVerifyParam
            // 就是当前这次验证生成的 token，再随业务请求一起发给 ESA。
            if (!isEmbedMode) {
              document.getElementById(buttonId)?.click()
            }

            // 添加超时保护：如果30秒内 SDK 回调未触发，reject promise 防止永远挂起
            let timeoutId: ReturnType<typeof setTimeout> | null = null
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                if (pendingVerifyRef.current) {
                  pendingVerifyRef.current = false
                  pendingResolveRef.current = null
                  pendingRejectRef.current = null
                  reject(new Error('验证码超时，请重试'))
                }
              }, 30000)
            })

            try {
              return await Promise.race([promise, timeoutPromise])
            } finally {
              if (timeoutId) clearTimeout(timeoutId)
            }
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
      [buttonId, buttonSelector, captchaType, enabled, initialize, isEmbedMode, sdkMode]
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
        <button
          id={buttonId}
          type='button'
          aria-hidden='true'
          tabIndex={-1}
          className='absolute size-px opacity-0 pointer-events-none'
        />
      </div>
    )
  }
)
