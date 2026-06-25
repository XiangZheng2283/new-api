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
package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// ESACaptchaCheck 验证阿里云 ESA AI 验证码。
//
// 根据「阿里验证码接入文档.md」的说明，ESA 验证码的工作流程为：
//
//  1. 前端 SDK 弹出验证码 → 用户完成验证 → success 回调返回 captchaVerifyParam
//  2. 前端将 captchaVerifyParam 随业务请求发送（统一使用 URL 查询参数）
//  3. ESA 边缘节点拦截请求，验签 captchaVerifyParam
//  4. 验签通过后 ESA 将请求转发到后端，并在**响应头**中注入 X-Captcha-Verify-Code: T001
//  5. 前端从响应头读取 X-Captcha-Verify-Code 判断验签结果
//
// 两种验证模式：
//
//  严格模式（ESAStrictModeEnabled=true）：
//   - ESA 边缘节点在请求到达后端之前完成拦截和验签
//   - 请求能到达后端 = 已通过 ESA 验签，后端直接放行
//   - 如果 captchaVerifyParam 缺失或无效，ESA 边缘节点直接拦截返回错误，
//     请求不会到达后端
//   - 注意：X-Captcha-Verify-Code 是 ESA 注入到**响应头**中的（文档示例：
//     result.headers.get('X-Captcha-Verify-Code')），不是请求头，后端无法
//     从 c.GetHeader 中读取
//
//  普通模式（ESAStrictModeEnabled=false，ESACaptchaEnabled=true）：
//   - 生产环境：ESA 边缘节点透明验签，请求到达后端时 captcha_verify_param 已被验证
//   - 本地/无 ESA 边缘：仅校验 captcha_verify_param 非空（前端 SDK 弹出验证码已确保真人操作）
//   - captcha_verify_param 统一通过 URL 查询参数传递
func ESACaptchaCheck(scene string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.ESACaptchaEnabled {
			c.Next()
			return
		}

		sceneId := getESACaptchaSceneId(scene)
		if sceneId == "" {
			c.Next()
			return
		}

		// --- 严格模式：ESA 边缘节点已验签，请求能到达后端即说明通过 ---
		// ESA 在请求到达后端之前完成拦截和验签：
		//   - captchaVerifyParam 有效 → ESA 放行到后端
		//   - captchaVerifyParam 缺失或无效 → ESA 直接拦截返回错误，请求不到达后端
		// 因此后端无需做任何检查，直接放行。
		//
		// 注意：X-Captcha-Verify-Code 是 ESA 注入到响应头中的验签结果码
		// （文档示例：const verify_code = result.headers.get('X-Captcha-Verify-Code')），
		// 不是请求头，后端无法通过 c.GetHeader 读取。
		if common.ESAStrictModeEnabled {
			c.Next()
			return
		}

		// --- 普通模式：前端 ESA SDK 已完成人机验证 ---
		// 验证通过后前端获得 captcha_verify_param，作为 URL 查询参数发送到后端。
		// 生产环境中 ESA 边缘节点透明验签并在响应头中注入 X-Captcha-Verify-Code: T001。
		// 本地/无 ESA 边缘时，仅校验参数非空（前端 SDK 弹出验证码已确保真人操作）。
		// captcha_verify_param 统一通过 URL 查询参数传递，不再从请求头读取。
		captchaVerifyParam := c.Query("captcha_verify_param")
		if captchaVerifyParam == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "人机验证未通过",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// getESACaptchaSceneId returns the configured Aliyun ESA scene ID for a
// protected business action. Empty scene IDs mean the action is not protected.
func getESACaptchaSceneId(scene string) string {
	switch scene {
	case "login":
		return common.ESACaptchaLoginSceneId
	case "verification":
		return common.ESACaptchaVerificationSceneId
	case "reset_password":
		return common.ESACaptchaResetPasswordSceneId
	case "delete_account":
		return common.ESACaptchaDeleteAccountSceneId
	case "checkin":
		return common.ESACaptchaCheckinSceneId
	default:
		return ""
	}
}
