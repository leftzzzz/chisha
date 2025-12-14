/**
 * 全局布局
 *
 * 集成 AppProvider 和全局样式
 */

import type { Metadata, Viewport } from 'next';
import { AppProvider } from '@/context';
import { ErrorBoundary } from '@/components/ui';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: '今天吃啥 - 让选择变得简单',
  description: '使用转盘帮你选择今天吃什么，基于 LLM 理解需求，搜索附近餐厅',
  keywords: '餐厅推荐, 转盘选择, 美食, 今天吃什么',
  icons: {
    icon: '/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#FF6B6B',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <ErrorBoundary>
          <AppProvider>
            {children}
          </AppProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
