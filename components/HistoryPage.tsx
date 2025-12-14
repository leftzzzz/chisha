/**
 * HistoryPage 组件
 *
 * 历史记录页面 - 增强版
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TurntableRecord, isCustomOption } from '@/types';
import {
  getRecordsByDate,
  searchHistory,
  clearRecords,
  deleteRecord,
  getStats,
  exportHistory,
  importHistory,
  setReuseRecord,
  GroupedRecords,
} from '@/lib/storage';
import { Layout } from './layout';
import { Card, Button, Modal, Input } from './ui';
import { HistoryStats, HistoryDetail } from './history';

export const HistoryPage: React.FC = () => {
  const router = useRouter();
  const [groupedRecords, setGroupedRecords] = useState<GroupedRecords[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<TurntableRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  // 加载历史记录
  useEffect(() => {
    loadRecords();
  }, []);

  const loadRecords = () => {
    const records = getRecordsByDate();
    setGroupedRecords(records);
    setCurrentPage(1);
  };

  // 搜索和过滤
  const filteredRecords = useMemo(() => {
    if (!searchKeyword.trim()) {
      return groupedRecords;
    }

    const searchResults = searchHistory(searchKeyword);

    // 重新分组
    const groups = new Map<string, TurntableRecord[]>();
    searchResults.forEach((record) => {
      // 从原始分组中找到对应的日期
      const group = groupedRecords.find((g) =>
        g.records.some((r) => r.id === record.id)
      );
      if (group) {
        if (!groups.has(group.date)) {
          groups.set(group.date, []);
        }
        groups.get(group.date)!.push(record);
      }
    });

    return Array.from(groups.entries())
      .map(([date, records]) => ({
        date,
        timestamp: records[0].timestamp,
        records,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [groupedRecords, searchKeyword]);

  // 分页
  const allRecords = useMemo(() => {
    return filteredRecords.flatMap((group) => group.records);
  }, [filteredRecords]);

  const totalPages = Math.ceil(allRecords.length / recordsPerPage);
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * recordsPerPage;
    const end = start + recordsPerPage;
    return allRecords.slice(start, end);
  }, [allRecords, currentPage]);

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return `今天 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else if (days === 1) {
      return `昨天 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
  };

  // 删除单条记录
  const handleDelete = (id: string) => {
    if (confirm('确定要删除这条记录吗？')) {
      deleteRecord(id);
      loadRecords();
      if (selectedRecord?.id === id) {
        setSelectedRecord(null);
      }
    }
  };

  // 清空所有记录
  const handleClearAll = () => {
    clearRecords();
    loadRecords();
    setSelectedRecord(null);
    setShowClearConfirm(false);
  };

  // 导出历史
  const handleExport = () => {
    try {
      const data = exportHistory();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chisha-history-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert('导出失败');
      console.error(error);
    }
  };

  // 导入历史
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        importHistory(text);
        loadRecords();
        alert('导入成功');
      } catch (error) {
        alert('导入失败: 数据格式无效');
        console.error(error);
      }
    };
    input.click();
  };

  // 格式化距离
  const formatDistance = (distance?: number) => {
    if (!distance) return '';
    if (distance < 1000) return `${Math.round(distance)}m`;
    return `${(distance / 1000).toFixed(1)}km`;
  };

  // 获取统计信息
  const stats = useMemo(() => getStats(), []);

  return (
    <Layout onHistoryClick={() => router.push('/')}>
      <div className="container mx-auto px-4 py-6 md:py-8 max-w-7xl">
        {/* 头部 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">历史记录</h1>
            <p className="text-sm text-gray-500 mt-1">
              共 {allRecords.length} 条记录
              {searchKeyword && ` (搜索: "${searchKeyword}")`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:gap-3">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setShowStats(!showStats)}
            >
              {showStats ? '隐藏' : '查看'}统计
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={handleExport}
              disabled={allRecords.length === 0}
            >
              导出
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={handleImport}
            >
              导入
            </Button>
            {allRecords.length > 0 && (
              <Button
                variant="danger"
                size="md"
                onClick={() => setShowClearConfirm(true)}
              >
                清空历史
              </Button>
            )}
          </div>
        </div>

        {/* 统计信息 */}
        {showStats && allRecords.length > 0 && (
          <div className="mb-6">
            <HistoryStats stats={stats} />
          </div>
        )}

        {/* 搜索框 */}
        {allRecords.length > 0 && (
          <div className="mb-6">
            <Input
              type="text"
              placeholder="搜索餐厅名称、菜系或查询内容..."
              value={searchKeyword}
              onChange={(value) => {
                setSearchKeyword(value);
                setCurrentPage(1);
              }}
              className="max-w-md"
            />
          </div>
        )}

        {/* 内容 */}
        {allRecords.length === 0 ? (
          // 空状态
          <Card className="text-center py-12 md:py-16">
            <svg
              className="w-16 h-16 md:w-20 md:h-20 mx-auto text-gray-300 mb-4"
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
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchKeyword ? '没有找到匹配的记录' : '暂无历史记录'}
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {searchKeyword
                ? '尝试使用其他关键词搜索'
                : '开始使用转盘选择餐厅，记录会自动保存在这里'}
            </p>
            {searchKeyword ? (
              <Button variant="secondary" onClick={() => setSearchKeyword('')}>
                清除搜索
              </Button>
            ) : (
              <Button variant="primary" onClick={() => router.push('/')}>
                开始选择
              </Button>
            )}
          </Card>
        ) : (
          <>
            {/* 记录列表 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
              {paginatedRecords.map((record) => (
                <Card
                  key={record.id}
                  className="cursor-pointer hover:shadow-xl transition-shadow"
                  onClick={() => setSelectedRecord(record)}
                >
                  {/* 时间 */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-500">
                      {formatDate(record.timestamp)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(record.id);
                      }}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      aria-label="删除记录"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* 需求 */}
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {record.query}
                  </p>

                  {/* 选中的餐厅/选项 */}
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs text-gray-500">选择了</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-1 line-clamp-1">
                      {record.selected.name}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
                      <span className="px-2 py-0.5 bg-gray-100 rounded">
                        {isCustomOption(record.selected) ? '自定义' : record.selected.cuisineType}
                      </span>
                      {!isCustomOption(record.selected) && record.selected.distance && (
                        <span>{formatDistance(record.selected.distance)}</span>
                      )}
                    </div>
                  </div>

                  {/* 参与选项数 */}
                  <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                    从 {record.restaurants.length + (record.customOptions?.length || 0)} 个选项中选择
                  </div>
                </Card>
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  上一页
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                    // 只显示当前页前后各2页
                    if (
                      page === 1 ||
                      page === totalPages ||
                      Math.abs(page - currentPage) <= 2
                    ) {
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 rounded flex items-center justify-center text-sm transition-colors ${
                            page === currentPage
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {page}
                        </button>
                      );
                    } else if (
                      page === currentPage - 3 ||
                      page === currentPage + 3
                    ) {
                      return (
                        <span key={page} className="text-gray-400 px-1">
                          ...
                        </span>
                      );
                    }
                    return null;
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  下一页
                </Button>
              </div>
            )}
          </>
        )}

        {/* 详情模态框 */}
        {selectedRecord && (
          <Modal
            isOpen={!!selectedRecord}
            onClose={() => setSelectedRecord(null)}
            title="历史记录详情"
            size="lg"
          >
            <HistoryDetail
              record={selectedRecord}
              onReuse={(record) => {
                // 保存记录到临时存储
                setReuseRecord(record);
                // 关闭模态框
                setSelectedRecord(null);
                // 导航到首页
                router.push('/');
              }}
            />
          </Modal>
        )}

        {/* 清空确认模态框 */}
        <Modal
          isOpen={showClearConfirm}
          onClose={() => setShowClearConfirm(false)}
          title="确认清空"
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowClearConfirm(false)}>
                取消
              </Button>
              <Button variant="danger" onClick={handleClearAll}>
                确认清空
              </Button>
            </div>
          }
        >
          <p>确定要清空所有历史记录吗？此操作不可恢复。</p>
        </Modal>
      </div>
    </Layout>
  );
};
