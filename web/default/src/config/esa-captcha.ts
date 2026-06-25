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

/**
 * ============================================================================
 * ESA AI Captcha 配置
 * ============================================================================
 *
 * 这些值来自阿里云 ESA 控制台 → 验证码管理。
 * prefix 是身份标，sceneId 是各场景的场景 ID，captchaType 是验证码形态。
 *
 * 如需更新：
 *   1. 登录阿里云 ESA 控制台
 *   2. 导航至 Edge Security Acceleration → 验证码
 *   3. 找到对应的场景规则，复制场景 ID
 *   4. 更新下方 scenes 对象中对应场景的值
 *
 * 后端仅提供 esa_captcha_enabled 全局开关，其他配置全部硬编码在前端。
 * ============================================================================
 */
export const ESA_CAPTCHA_CONFIG = {
  /** 身份标（ESA 控制台 → 配置页面右上角） */
  prefix: 'esa-na3m7wdgxn',
  /** 实例所属地域 */
  region: 'cn' as const,
  /** 各场景配置 */
  scenes: {
    login: {
      sceneId: 'q0pjo0z7',
      captchaType: 'smart' as const,
    },
    checkin: {
      sceneId: 'kohug0pz',
      captchaType: 'smart' as const,
    },
    verification: {
      sceneId: '1l55qx1s',
      captchaType: 'slide' as const,
    },
    reset_password: {
      sceneId: '1f9phx4n',
      captchaType: 'instant' as const,
    },
    delete_account: {
      sceneId: 'xhhr9b7w',
      captchaType: 'recovery' as const,
    },
  },
}

/** 场景名称类型 */
export type AliyunCaptchaScene = keyof typeof ESA_CAPTCHA_CONFIG.scenes

/** 场景对应的 CaptchaType 类型 */
export type AliyunCaptchaSceneType =
  (typeof ESA_CAPTCHA_CONFIG.scenes)[AliyunCaptchaScene]['captchaType']
