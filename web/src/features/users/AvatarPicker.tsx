import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Trash2 } from 'lucide-react'
import { AVATAR_ACCEPT, avatarFileIssue, type AvatarChoice } from '@/domain/user-avatar'
import { AppAvatar, AppButton, notify } from '@/presentation/components'

interface AvatarPickerProps {
  name: string
  /** Foto atual (edição); ausente = sem foto. */
  currentUrl?: string | null
  value: AvatarChoice
  onChange: (value: AvatarChoice) => void
  disabled?: boolean
}

/** Foto opcional do usuário no cadastro: pré-visualiza a escolhida; sem foto, ficam as iniciais. */
export function AvatarPicker({ name, currentUrl, value, onChange, disabled }: AvatarPickerProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const shown = preview ?? (value.removed ? null : (currentUrl ?? null))

  function pick(list: FileList | null) {
    const file = list?.[0]
    if (!file) return
    const issue = avatarFileIssue(file)
    if (issue) {
      notify.error(t(`users.photo.${issue}`))
      return
    }
    onChange({ file, removed: false })
  }

  return (
    <div className="flex items-center gap-4 sm:col-span-2">
      <AppAvatar name={name || '?'} src={shown} size="lg" className="size-16 text-base" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">{t('users.photo.label')}</span>
        <div className="flex flex-wrap gap-2">
          <AppButton variant="secondary" size="sm" leftIcon={<ImagePlus />} onClick={() => input.current?.click()} disabled={disabled}>
            {shown ? t('users.photo.change') : t('users.photo.choose')}
          </AppButton>
          {shown && (
            <AppButton variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => onChange({ file: null, removed: !!currentUrl })} disabled={disabled}>
              {t('users.photo.remove')}
            </AppButton>
          )}
        </div>
        <p className="text-xs text-muted">{t('users.photo.hint')}</p>
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={AVATAR_ACCEPT}
        onChange={(event) => {
          pick(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
