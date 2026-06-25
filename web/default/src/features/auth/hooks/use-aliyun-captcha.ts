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
import { useMemo } from 'react'
import { useStatus } from '@/hooks/use-status'
import { useTranslation } from 'react-i18next'
import { ESA_CAPTCHA_CONFIG, type AliyunCaptchaScene } from '@/config/esa-captcha'
import type { CaptchaType } from '@/components/aliyun-captcha'

export type { AliyunCaptchaScene }

interface AliyunCaptchaConfig {
  enabled: boolean
  region: string
  prefix: string
  sceneId: string
  captchaType: CaptchaType | ''
  language: string
}

export function useAliyunCaptcha(scene: AliyunCaptchaScene): AliyunCaptchaConfig {
  const { status } = useStatus()
  const { i18n } = useTranslation()

  return useMemo(() => {
    // 后端仅提供全局开关
    const esaCaptchaEnabled = Boolean(
      (status as Record<string, unknown>)?.esa_captcha_enabled ??
      ((status as Record<string, unknown>)?.data as Record<string, unknown>)?.esa_captcha_enabled
    )

    // 其他配置全部来自硬编码配置文件
    const sceneConfig = ESA_CAPTCHA_CONFIG.scenes[scene]
    const enabled = esaCaptchaEnabled && Boolean(sceneConfig.sceneId)

    return {
      enabled,
      region: ESA_CAPTCHA_CONFIG.region,
      prefix: ESA_CAPTCHA_CONFIG.prefix,
      sceneId: sceneConfig.sceneId,
      captchaType: sceneConfig.captchaType as CaptchaType,
      language: i18n.language,
    }
  }, [scene, status, i18n.language])
}
