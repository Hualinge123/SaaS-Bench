import { type ComponentPropsWithoutRef } from 'react';

type TagSize = 'sm' | 'md' | 'lg';

interface TagProps extends ComponentPropsWithoutRef<'span'> {
  children: React.ReactNode;
  size?: TagSize;
}

export function Tag({ children, className, size = 'md', ...props }: TagProps) {
  const sizeClasses = {
    sm: 'h-[16px] px-[4px] text-[10px] leading-[16px]',
    md: 'h-[18px] px-[6px] text-[11px] leading-[18px]',
    lg: 'h-[20px] px-[8px] text-[12px] leading-[20px]',
  };

  const baseClasses = `inline-flex items-center ${sizeClasses[size]} text-[var(--text-secondary)] bg-[var(--color-bg-tag-gray)] rounded-[4px]`;
  const combinedClassName = className ? `${baseClasses} ${className}` : baseClasses;

  return (
    <span className={combinedClassName} {...props}>
      {children}
    </span>
  );
}