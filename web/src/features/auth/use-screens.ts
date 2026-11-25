import { useMemo } from 'react'
import {
  DEFAULT_SCREENS,
  shows,
  startItem,
  visibleItems,
  type ScreenGroup,
  type ScreenItem,
  type ScreenKey,
  type ScreenSettings,
  type StartGroup,
} from '@/domain/screens'
import { useSession } from './session'

export interface Screens {
  settings: ScreenSettings
  /** A parte aparece para o perfil da pessoa? */
  shows: (key: ScreenKey) => boolean
  /** Itens visíveis de um grupo, na ordem da tela (nunca vazio). */
  visible: <G extends ScreenGroup>(group: G) => ScreenItem<G>[]
  /** Onde o grupo abre ("Abre em" do perfil, se aparece e está entre os `available`; senão o primeiro). */
  start: <G extends StartGroup>(group: G, available?: readonly ScreenItem<G>[]) => ScreenItem<G> | null
}

/** O que aparece na tela para o perfil da pessoa (§48): só a tela; o que ela pode fazer continua nas permissões. */
export function screensOf(settings: ScreenSettings): Screens {
  return {
    settings,
    shows: (key) => shows(settings, key),
    visible: (group) => visibleItems(settings, group),
    start: (group, available) => startItem(settings, group, available),
  }
}

/** "O que aparece" do perfil da sessão (sem sessão ainda: tudo visível). */
export function useScreens(): Screens {
  const settings = useSession().current?.role?.screens ?? DEFAULT_SCREENS
  return useMemo(() => screensOf(settings), [settings])
}
