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
    <header className="flex-shrink-0 z-40 w-full h-16 bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Logo 和标题 */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 rounded-lg overflow-hidden shadow-md">
              <Image
                src="/logo.png"
                alt="今天吃啥"
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">今天吃啥</h1>
              <p className="text-xs text-gray-500">让选择变得简单</p>
            </div>
          </Link>

          {/* 导航链接 */}
          <nav className="flex items-center gap-4">
            {onHistoryClick ? (
              <button
                onClick={onHistoryClick}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors"
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
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-primary hover:bg-gray-50 rounded-lg transition-colors"
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
