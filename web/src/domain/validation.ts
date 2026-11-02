import { z } from 'zod'
import { SUPPORTED_LANGUAGES } from '@/core/i18n'
import { PROJECT_COVERS, PROJECT_ICONS, PROJECT_PRIORITIES, PROJECT_STATUSES } from './projects'
import { SPACE_ICONS, SPACE_VISIBILITIES } from './docs'
import { OPTION_COLORS } from './task-config'
import { TASK_URGENCIES } from './tasks'
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from './platform'

/**
 * Schemas de validação de formulários. As mensagens são chaves de i18n (validation.*),
 * com os mesmos códigos devolvidos pela API — o backend continua validando tudo.
 */

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 72

const email = z.string().trim().min(1, 'required').max(254, 'too_long').email('invalid_email')

/** Senha pela política vigente do Configurador geral (mesmos códigos da API). */
export function passwordSchemaFor(policy: PasswordPolicy) {
  return z
    .string()
    .min(policy.minLength, 'too_short')
    .max(policy.maxLength, 'too_long')
    .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), 'weak_password')
    .refine((value) => !policy.requireMixedCase || (/[a-z]/.test(value) && /[A-Z]/.test(value)), 'needs_mixed_case')
    .refine((value) => !policy.requireSymbol || /[^A-Za-z0-9]/.test(value), 'needs_symbol')
}

export const passwordSchema = passwordSchemaFor({ ...DEFAULT_PASSWORD_POLICY, minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'required').max(200, 'too_long'),
  remember: z.boolean(),
})
export type LoginInput = z.infer<typeof loginSchema>

const name = z.string().trim().min(1, 'required').max(120, 'too_long')
const locale = z.enum(SUPPORTED_LANGUAGES)

/** Com `invite`, a senha não é pedida: a pessoa cria a dela pelo link do e-mail. */
export function createUserSchemaFor(policy: PasswordPolicy, invite = false) {
  return z.object({
    name,
    email,
    password: invite ? z.string() : passwordSchemaFor(policy),
    roleId: z.string().min(1, 'required'),
    locale,
    sendInvite: z.boolean(),
  })
}
export const createUserSchema = createUserSchemaFor(DEFAULT_PASSWORD_POLICY)
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z.object({
  name,
  email,
  roleId: z.string().min(1, 'required'),
  locale,
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export function changePasswordSchemaFor(policy: PasswordPolicy) {
  return z
    .object({
      currentPassword: z.string().min(1, 'required'),
      newPassword: passwordSchemaFor(policy),
      confirmPassword: z.string().min(1, 'required'),
    })
    .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'passwords_dont_match' })
    .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'same_as_current' })
}
export const changePasswordSchema = changePasswordSchemaFor(DEFAULT_PASSWORD_POLICY)
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export function resetPasswordSchemaFor(policy: PasswordPolicy) {
  return z
    .object({ password: passwordSchemaFor(policy), confirmPassword: z.string().min(1, 'required') })
    .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'passwords_dont_match' })
}
export const resetPasswordSchema = resetPasswordSchemaFor(DEFAULT_PASSWORD_POLICY)
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const roleSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'invalid_format')),
  name: z.string().trim().min(1, 'required').max(60, 'too_long'),
  description: z.string().trim().max(255, 'too_long'),
})
export type RoleInput = z.input<typeof roleSchema>

export const projectSchema = z
  .object({
    name: z.string().trim().min(1, 'required').max(120, 'too_long'),
    key: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'invalid_format')),
    description: z.string().max(10000, 'too_long'),
    icon: z.enum(PROJECT_ICONS),
    cover: z.enum(PROJECT_COVERS),
    status: z.enum(PROJECT_STATUSES),
    priority: z.enum(PROJECT_PRIORITIES),
    /** 'none' = sem urgência */
    urgency: z.enum([...TASK_URGENCIES, 'none']),
    /** id da área ou '' (sem área) */
    areaId: z.string(),
    /** AAAA-MM-DD ou '' */
    startDate: z.string(),
    dueDate: z.string(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, { path: ['dueDate'], message: 'due_before_start' })
export type ProjectInput = z.input<typeof projectSchema>

/** Espaço de documentação (chave só na criação; espaço de projeto exige o projeto). */
export const docSpaceSchema = z
  .object({
    name: z.string().trim().min(1, 'required').max(80, 'too_long'),
    key: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'invalid_format')),
    description: z.string().max(500, 'too_long'),
    icon: z.enum(SPACE_ICONS),
    color: z.enum(OPTION_COLORS),
    visibility: z.enum(SPACE_VISIBILITIES),
    projectId: z.string(),
  })
  .refine((v) => v.visibility !== 'project' || !!v.projectId, { path: ['projectId'], message: 'project_required' })
export type DocSpaceFormInput = z.input<typeof docSpaceSchema>
