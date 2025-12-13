/**
 * Header 组件
 *
 * 页面头部组件
 */

import React from 'react';
import Link from 'next/link';

export interface HeaderProps {
  onHistoryClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onHistoryClick }) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo 和标题 */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center shadow-md">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
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
