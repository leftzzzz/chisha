/**
 * Card 组件
 *
 * 卡片容器组件，带标题和副标题
 */

import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  className = '',
  onClick,
}) => {
  return (
    <div
      className={`surface-panel rounded-2xl transition-[box-shadow,transform,background-color] duration-300 ${className} ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_28px_80px_rgba(77,42,28,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {(title || subtitle) && (
        <div className="px-6 py-4 border-b border-black/10">
          {title && (
            <h3 className="text-lg font-bold tracking-tight text-dark">{title}</h3>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-[#76695e]">{subtitle}</p>
          )}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
};
