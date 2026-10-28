import { describe, expect, it } from 'vitest'
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, avatarFileIssue } from './user-avatar'

const file = (name: string, size: number) => new File([new Uint8Array(size)], name)

describe('avatarFileIssue', () => {
  it('aceita PNG, JPG e WebP até 2 MB', () => {
    expect(avatarFileIssue(file('eu.png', 10))).toBeNull()
    expect(avatarFileIssue(file('eu.JPEG', 10))).toBeNull()
    expect(avatarFileIssue(file('eu.webp', AVATAR_MAX_BYTES))).toBeNull()
    expect(AVATAR_ACCEPT).toBe('.png,.jpg,.jpeg,.webp')
  })

  it('recusa outros tipos e arquivos grandes', () => {
    expect(avatarFileIssue(file('eu.gif', 10))).toBe('unsupported_type')
    expect(avatarFileIssue(file('eu.svg', 10))).toBe('unsupported_type')
    expect(avatarFileIssue(file('semextensao', 10))).toBe('unsupported_type')
    expect(avatarFileIssue(file('eu.png', AVATAR_MAX_BYTES + 1))).toBe('file_too_large')
  })
})
