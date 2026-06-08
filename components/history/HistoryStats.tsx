/**
 * HistoryStats 组件
 *
 * 显示历史记录统计信息
 */

'use client';

import React from 'react';
import { Card } from '../ui';
import { HistoryStats as Stats } from '@/lib/storage';

interface HistoryStatsProps {
  stats: Stats;
}

export const HistoryStats: React.FC<HistoryStatsProps> = ({ stats }) => {
  return (
    <div className="space-y-6">
      {/* 概览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="text-center p-4">
          <div className="text-3xl font-black text-primary">
            {stats.totalRecords}
          </div>
          <div className="text-sm text-gray-600 mt-1">总记录数</div>
        </Card>

        <Card className="text-center p-4">
          <div className="text-3xl font-black text-secondary">
            {stats.totalRestaurants}
          </div>
          <div className="text-sm text-gray-600 mt-1">不同餐厅</div>
        </Card>

        <Card className="text-center p-4">
          <div className="text-3xl font-black text-[#7b4b35]">
            {stats.recentDays}
          </div>
          <div className="text-sm text-gray-600 mt-1">天数跨度</div>
        </Card>

        <Card className="text-center p-4">
          <div className="text-3xl font-black text-accent">
            {stats.averageRestaurantsPerRecord}
          </div>
          <div className="text-sm text-gray-600 mt-1">平均选项数</div>
        </Card>
      </div>

      {/* 详细统计 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 最常去的餐厅 */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            最常去的餐厅
          </h3>
          {stats.mostVisited.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              暂无数据
            </p>
          ) : (
            <div className="space-y-3">
              {stats.mostVisited.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0
                          ? 'bg-yellow-400 text-white'
                          : index === 1
                          ? 'bg-gray-300 text-white'
                          : index === 2
                          ? 'bg-orange-400 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {index + 1}
                    </div>
                    <span className="text-sm text-gray-900">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${(item.count / stats.totalRecords) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">
                      {item.count}次
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 最喜欢的菜系 */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            最喜欢的菜系
          </h3>
          {stats.favoriteCuisines.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              暂无数据
            </p>
          ) : (
            <div className="space-y-3">
              {stats.favoriteCuisines.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0
                          ? 'bg-yellow-400 text-white'
                          : index === 1
                          ? 'bg-gray-300 text-white'
                          : index === 2
                          ? 'bg-orange-400 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {index + 1}
                    </div>
                    <span className="text-sm text-gray-900">{item.cuisine}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{
                          width: `${(item.count / stats.totalRecords) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">
                      {item.count}次
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
