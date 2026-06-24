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
import { useEffect } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const captchaTypeOptions = [
  { value: '', label: '未配置' },
  { value: 'smart', label: '无痕验证' },
  { value: 'instant', label: '一点即过' },
  { value: 'slide', label: '滑块验证' },
  { value: 'puzzle', label: '拼图验证' },
  { value: 'recovery', label: '图像复原' },
] as const

const botProtectionSchema = z.object({
  ESACaptchaEnabled: z.boolean(),
  ESAStrictModeEnabled: z.boolean(),
  ESARegion: z.string().optional(),
  ESAPrefix: z.string().optional(),
  ESACaptchaLoginSceneId: z.string().optional(),
  ESACaptchaResetPasswordSceneId: z.string().optional(),
  ESACaptchaDeleteAccountSceneId: z.string().optional(),
  ESACaptchaCheckinSceneId: z.string().optional(),
  ESACaptchaVerificationSceneId: z.string().optional(),
  ESACaptchaLoginCaptchaType: z.string().optional(),
  ESACaptchaResetPasswordCaptchaType: z.string().optional(),
  ESACaptchaDeleteAccountCaptchaType: z.string().optional(),
  ESACaptchaCheckinCaptchaType: z.string().optional(),
  ESACaptchaVerificationCaptchaType: z.string().optional(),
})

type BotProtectionFormValues = z.infer<typeof botProtectionSchema>

type BotProtectionSectionProps = {
  defaultValues: BotProtectionFormValues
}

const sceneFields = [
  { sceneIdKey: 'ESACaptchaLoginSceneId', captchaTypeKey: 'ESACaptchaLoginCaptchaType', label: 'Login' },
  { sceneIdKey: 'ESACaptchaVerificationSceneId', captchaTypeKey: 'ESACaptchaVerificationCaptchaType', label: 'Email verification' },
  { sceneIdKey: 'ESACaptchaResetPasswordSceneId', captchaTypeKey: 'ESACaptchaResetPasswordCaptchaType', label: 'Password reset email' },
  { sceneIdKey: 'ESACaptchaDeleteAccountSceneId', captchaTypeKey: 'ESACaptchaDeleteAccountCaptchaType', label: 'Delete account' },
  { sceneIdKey: 'ESACaptchaCheckinSceneId', captchaTypeKey: 'ESACaptchaCheckinCaptchaType', label: 'Check-in' },
] as const

function getCaptchaTypeHint(captchaType: string): string | null {
  switch (captchaType) {
    case 'smart':
      return '验证码将绑定到业务按钮（如登录按钮），用户点击按钮时触发无痕验证。'
    case 'instant':
    case 'slide':
      return '验证码将嵌入到表单中按钮上方显示。'
    case 'puzzle':
    case 'recovery':
      return '用户点击按钮时弹出验证码弹窗。'
    default:
      return null
  }
}

export function BotProtectionSection({
  defaultValues,
}: BotProtectionSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<BotProtectionFormValues>({
    resolver: zodResolver(botProtectionSchema),
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const onSubmit = async (data: BotProtectionFormValues) => {
    const updates = Object.entries(data).filter(
      ([key, value]) =>
        value !== defaultValues[key as keyof BotProtectionFormValues]
    )

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const [key, value] of updates) {
      await updateOption.mutateAsync({ key, value: value ?? '' })
    }

    form.reset(data)
  }

  return (
    <SettingsSection title={t('Bot Protection')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <FormField
            control={form.control}
            name='ESACaptchaEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable Aliyun ESA captcha')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Protect sign-in, email verification, password reset email, and check-in with Aliyun ESA captcha.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='ESAStrictModeEnabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('拦截空 Token 请求（严格模式）')}</FormLabel>
                  <FormDescription>
                    {t(
                      '开启后 ESA 边缘节点会拦截未携带 captchaVerifyParam 的请求，大幅提高安全性。需要在 ESA 控制台同步开启「拦截空Token请求」，并确保所有客户端已完成前端 HTML 集成与全网发布后再启用。否则旧客户端（未集成验证码JS）的请求也会被拦截。'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='ESARegion'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Region')}</FormLabel>
                <FormControl>
                  <Input placeholder='cn / sgp' autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='ESAPrefix'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('ESA identity prefix')}</FormLabel>
                <FormControl>
                  <Input placeholder='esa-********' autoComplete='off' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Scene rows: each with SceneId input + CaptchaType select */}
          {sceneFields.map(({ sceneIdKey, captchaTypeKey, label }) => (
            <div key={sceneIdKey} className='space-y-3 rounded-lg border p-4'>
              <h4 className='text-sm font-medium'>{t(label)}</h4>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name={sceneIdKey}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Scene ID')}</FormLabel>
                      <FormControl>
                        <Input autoComplete='off' placeholder={t('Scene ID')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={captchaTypeKey}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Captcha type')}</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === '_none' ? '' : value)}
                        value={field.value || '_none'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('Select captcha type')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {captchaTypeOptions.map((option) => (
                            <SelectItem key={option.value || '_none'} value={option.value || '_none'}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {getCaptchaTypeHint(field.value ?? '') && (
                        <FormDescription>
                          {t(getCaptchaTypeHint(field.value ?? '')!)}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          ))}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
