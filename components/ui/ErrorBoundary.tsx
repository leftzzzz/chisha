/**
 * ErrorBoundary 组件
 * 捕获 React 组件树中的错误，防止白屏
 */

'use client';

import React, { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 可以在这里记录错误日志
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-red-100">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-center text-xl font-semibold text-gray-900 mb-2">
                出错了
              </h1>
              <p className="text-center text-gray-600 text-sm mb-6">
                应用程序遇到了一个错误。请尝试刷新页面。
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mb-4 p-3 bg-red-50 rounded text-xs text-red-700 border border-red-200 max-h-32 overflow-y-auto">
                  <summary className="cursor-pointer font-semibold mb-2">错误详情</summary>
                  <pre className="whitespace-pre-wrap break-words">{this.state.error.toString()}</pre>
                </details>
              )}
              <div className="flex gap-3">
                <button
                  onClick={this.handleReset}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  重试
                </button>
                <button
                  onClick={() => {
                    window.location.href = '/';
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  回到首页
                </button>
              </div>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
