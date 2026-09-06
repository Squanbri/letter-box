export function BrandLogo({
  size = 28,
  className,
  title = 'Letter Box',
  variant = 'auto',
}: {
  size?: number;
  className?: string;
  title?: string;
  /** Prefer plate logo; use mark for light surfaces when needed. */
  variant?: 'auto' | 'plate' | 'small' | 'mark';
}) {
  const src = variant === 'mark'
    ? '/logo-mark.svg'
    : variant === 'small' || (variant === 'auto' && size <= 24)
      ? '/logo-small.svg'
      : '/logo.svg';

  return (
    <img
      className={className ?? 'brand-logo'}
      src={src}
      width={size}
      height={size}
      alt={title}
      draggable={false}
    />
  );
}
