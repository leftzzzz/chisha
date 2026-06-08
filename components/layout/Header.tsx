/**
 * Header 组件
 *
 * 页面头部组件
 */

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

export interface HeaderProps {
  onHistoryClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onHistoryClick }) => {
  return (
    <header className="flex-shrink-0 z-40 w-full border-b border-black/10 bg-[#fffaf1]/78 backdrop-blur-xl">
      <div className="mx-auto h-16 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-full">
          {/* Logo 和标题 */}
          <Link href="/" className="group flex items-center gap-3 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1] rounded-2xl">
            <div className="w-10 h-10 rounded-2xl overflow-hidden shadow-[0_12px_30px_rgba(232,74,50,0.24)] ring-1 ring-white/70 transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
              <Image
                src="/logo.png"
                alt="今天吃啥"
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-dark">今天吃啥</h1>
              <p className="text-xs font-medium text-[#6f6257]">让选择变得简单</p>
            </div>
          </Link>

          {/* 导航链接 */}
          <nav className="flex items-center gap-4">
            {onHistoryClick ? (
              <button
                onClick={onHistoryClick}
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white/58 px-4 py-2 text-sm font-semibold text-[#342c27] shadow-sm transition-[background-color,color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]"
                aria-label="查看历史记录"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="hidden sm:inline">历史记录</span>
              </button>
            ) : (
              <Link
                href="/history"
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white/58 px-4 py-2 text-sm font-semibold text-[#342c27] shadow-sm transition-[background-color,color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]"
                aria-label="查看历史记录"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="hidden sm:inline">历史记录</span>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};
