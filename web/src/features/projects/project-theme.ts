import type { CSSProperties } from 'react'
import {
  BarChart3,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Code2,
  Cpu,
  Database,
  Folder,
  Globe,
  Headphones,
  Layers,
  Rocket,
  Settings,
  Shield,
  Star,
  Target,
  Truck,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { hexTone, isHexColor } from '@/domain/colors'
import type { BuiltinProjectIcon, PaletteCover, ProjectCover } from '@/domain/projects'

/** Identidade visual dos projetos: ícones e capas (gradientes) disponíveis. */
export const PROJECT_ICON_COMPONENTS: Record<BuiltinProjectIcon, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  briefcase: Briefcase,
  code: Code2,
  database: Database,
  globe: Globe,
  shield: Shield,
  users: Users,
  chart: BarChart3,
  settings: Settings,
  layers: Layers,
  zap: Zap,
  star: Star,
  box: Box,
  truck: Truck,
  building: Building2,
  cpu: Cpu,
  headphones: Headphones,
  book: BookOpen,
  target: Target,
}

/** Matiz (OKLCH) de cada capa. "slate" usa baixa saturação. */
const COVER_HUE: Record<PaletteCover, number> = {
  violet: 295,
  indigo: 272,
  blue: 250,
  cyan: 215,
  teal: 185,
  green: 150,
  amber: 80,
  orange: 55,
  red: 25,
  pink: 350,
  slate: 260,
}

/** Matiz e croma da capa: os da paleta ou o tom da cor livre. */
function coverTone(cover: ProjectCover, paletteChroma: number): { hue: number; chroma: number } {
  if (isHexColor(cover)) {
    const { hue, chroma } = hexTone(cover)
    return { hue, chroma: chroma <= 0.02 ? 0.03 : Math.min(chroma, paletteChroma) }
  }
  return { hue: COVER_HUE[cover] ?? COVER_HUE.violet, chroma: cover === 'slate' ? 0.03 : paletteChroma }
}

export function coverGradient(cover: ProjectCover): string {
  const { hue, chroma } = coverTone(cover, 0.16)
  return `linear-gradient(135deg, oklch(0.6 ${chroma} ${hue}), oklch(0.5 ${chroma} ${hue + 25}))`
}

export function coverStyle(cover: ProjectCover): CSSProperties {
  return { backgroundImage: coverGradient(cover) }
}

/**
 * Capa do cabeçalho do projeto: o mesmo matiz, mais escuro (texto claro com contraste AA em todas as
 * capas), com um brilho no canto para dar profundidade.
 */
export function coverHeroStyle(cover: ProjectCover): CSSProperties {
  const { hue, chroma } = coverTone(cover, 0.15)
  return {
    backgroundImage: [
      `radial-gradient(circle at 88% -30%, oklch(1 0 0 / 0.22), transparent 45%)`,
      `radial-gradient(circle at 0% 120%, oklch(0 0 0 / 0.25), transparent 50%)`,
      `linear-gradient(120deg, oklch(0.45 ${chroma} ${hue}), oklch(0.36 ${chroma} ${hue + 30}))`,
    ].join(', '),
  }
}
