import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { Loader2 } from 'lucide-react'
import { cn } from '@/core/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none ' +
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover',
        secondary: 'bg-surface text-fg border border-border shadow-xs hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
        soft: 'bg-primary-soft text-primary-soft-fg hover:brightness-95 dark:hover:brightness-110',
        danger: 'bg-danger text-danger-fg shadow-sm hover:bg-danger-hover',
        link: 'text-primary-text underline-offset-4 hover:underline px-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-11 px-5 text-sm [&_svg]:size-4',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface AppButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  /** Renderiza o filho como o elemento raiz (ex.: <Link>), mantendo o estilo. */
  asChild?: boolean
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { className, variant, size, block, loading = false, leftIcon, rightIcon, asChild = false, children, disabled, type, ...props },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size, block }), className)
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
})
