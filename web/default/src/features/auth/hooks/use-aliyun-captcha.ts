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
import type { CaptchaType } from '@/components/aliyun-captcha'

export type AliyunCaptchaScene =
  | 'login'
  | 'reset_password'
  | 'delete_account'
  | 'checkin'
  | 'verification'

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
    const statusData = status?.data as Record<string, unknown> | undefined
    const esaCaptchaEnabled = Boolean(
      status?.esa_captcha_enabled ?? statusData?.esa_captcha_enabled
    )
    const prefix = String(status?.esa_prefix ?? statusData?.esa_prefix ?? '')
    const scenes = (status?.esa_captcha_scenes ??
      statusData?.esa_captcha_scenes ??
      {}) as Record<string, string>
    const sceneId = scenes[scene] ?? ''

    // 读取该场景对应的验证码形态
    const captchaTypes = (status?.esa_captcha_types ??
      statusData?.esa_captcha_types ??
      {}) as Record<string, string>
    const rawCaptchaType = captchaTypes[scene] ?? ''

    // 确保 captchaType 是合法值，否则为空字符串
    const validTypes: CaptchaType[] = ['smart', 'instant', 'slide', 'puzzle', 'recovery']
    const captchaType: CaptchaType | '' = validTypes.includes(rawCaptchaType)
      ? (rawCaptchaType as CaptchaType)
      : ''

    return {
      enabled: esaCaptchaEnabled && Boolean(prefix) && Boolean(sceneId),
      region: String(status?.esa_region ?? statusData?.esa_region ?? 'cn'),
      prefix,
      sceneId,
      captchaType,
      language: i18n.language,
    }
  }, [scene, status, i18n.language])
}
