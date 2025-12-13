/**
 * HomePage 组件
 *
 * 主页容器，集成所有组件和业务逻辑
 */

'use client';

import React, { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState, useLocation, useRestaurantSearch, useTurntable, useMediaQuery } from '@/hooks';
import { Layout } from './layout';
import { SearchPanel } from './input';
import { Turntable, TurntableControls } from './turntable';
import { RestaurantList, ResultPanel } from './restaurant';
import { Map } from './map';
import { LoadingSteps } from './LoadingSteps';
import { ErrorMessage } from './ui';
import { saveRecord } from '@/lib/storage';

export const HomePage: React.FC = () => {
  const router = useRouter();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // 使用 hooks
  const { state, setQuery, setLocation, setStep, deleteRestaurant, reset } = useAppState();
  const { location: detectedLocation, getAutoLocation, isLocating, error: locationError } = useLocation();
  const { search, isSearching } = useRestaurantSearch();
  const { rotation, selectedIndex, isSpinning, startSpin } = useTurntable(state.restaurants.length);

  // 获取搜索错误
  const searchError = state.error;

  // 同步检测到的位置到应用状态
  useEffect(() => {
    if (detectedLocation && !state.userLocation) {
      setLocation(detectedLocation);
    }
  }, [detectedLocation, state.userLocation, setLocation]);

  // 处理自动定位
  const handleAutoLocate = useCallback(async () => {
    await getAutoLocation();
  }, [getAutoLocation]);

  // 处理搜索
  const handleSearch = useCallback(async () => {
    if (!state.userQuery.trim() || !state.userLocation) return;

    await search(state.userQuery, state.userLocation);
  }, [state.userQuery, state.userLocation, search]);

  // 处理转盘
  const handleSpin = useCallback(() => {
    if (state.restaurants.length === 0) return;
    setStep('SPINNING');
    startSpin();
    // startSpin 不接受回调，改用 useEffect 监听状态变化
  }, [state.restaurants.length, startSpin, setStep]);

  // 监听旋转完成
  useEffect(() => {
    if (state.step === 'SPINNING' && !isSpinning && selectedIndex >= 0) {
      setStep('RESULT');
    }
  }, [isSpinning, selectedIndex, state.step, setStep]);

  // 处理删除餐厅
  const handleRemove = useCallback(() => {
    if (selectedIndex >= 0) {
      deleteRestaurant(selectedIndex);

      if (state.restaurants.length <= 1) {
        // 没有餐厅了，返回输入
        reset();
      } else {
        // 重新转盘
        setStep('READY');
      }
    }
  }, [selectedIndex, deleteRestaurant, state.restaurants.length, reset, setStep]);

  // 处理保存
  const handleSave = useCallback(() => {
    if (selectedIndex >= 0 && state.restaurants[selectedIndex]) {
      const record = {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        query: state.userQuery,
        location: state.userLocation!,
        restaurants: state.restaurants,
        selected: state.restaurants[selectedIndex],
      };

      saveRecord(record);
      alert('已保存到历史记录！');
    }
  }, [selectedIndex, state]);

  // 处理重试
  const handleRetry = useCallback(() => {
    setStep('READY');
  }, [setStep]);

  // 处理关闭/返回
  const handleClose = useCallback(() => {
    reset();
  }, [reset]);

  // 选中的餐厅
  const selectedRestaurant = selectedIndex >= 0 ? state.restaurants[selectedIndex] : null;

  // 渲染加载状态
  if (state.step === 'UNDERSTANDING' || state.step === 'SEARCHING') {
    return (
      <Layout>
        <LoadingSteps
          step={state.step === 'UNDERSTANDING' ? 1 : 2}
          message={state.step === 'UNDERSTANDING' ? '理解您的需求...' : '搜索附近餐厅...'}
        />
      </Layout>
    );
  }

  // 渲染错误状态
  if (state.step === 'ERROR') {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-12">
          <ErrorMessage
            error={searchError || '搜索失败，请重试'}
            onAction={handleClose}
            actionLabel="返回"
          />
        </div>
      </Layout>
    );
  }

  // 输入状态
  if (state.step === 'INPUT') {
    return (
      <Layout>
        <SearchPanel
          query={state.userQuery}
          onQueryChange={setQuery}
          location={state.userLocation}
          onLocationChange={setLocation}
          onSearch={handleSearch}
          isLoading={isSearching}
          error={searchError || undefined}
          locationError={locationError || undefined}
          onAutoLocate={handleAutoLocate}
          isLocating={isLocating}
        />
      </Layout>
    );
  }

  // 转盘和结果状态
  const leftPanel = (
    <div className="space-y-6">
      {/* 转盘 */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <Turntable
          restaurants={state.restaurants}
          selectedIndex={selectedIndex}
          isSpinning={isSpinning}
          rotation={rotation}
        />
        <div className="mt-6">
          <TurntableControls
            isSpinning={isSpinning}
            selectedRestaurant={selectedRestaurant}
            onSpin={handleSpin}
            onRemove={handleRemove}
            onSave={handleSave}
            onRetry={handleRetry}
            onClose={handleClose}
          />
        </div>
      </div>

      {/* 餐厅列表（仅移动端） */}
      {!isDesktop && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <RestaurantList
            restaurants={state.restaurants}
            selectedIndex={selectedIndex}
            onSelect={() => {}}
            onDelete={(index) => deleteRestaurant(index)}
          />
        </div>
      )}

      {/* 结果面板（仅移动端） */}
      {!isDesktop && selectedRestaurant && (
        <ResultPanel
          restaurant={selectedRestaurant}
          onRemove={handleRemove}
          onSave={handleSave}
          onRetry={handleRetry}
          onClose={handleClose}
        />
      )}
    </div>
  );

  const rightPanel = (
    <div className="relative h-full">
      {/* 地图 */}
      <Map
        restaurants={state.restaurants}
        selectedRestaurant={selectedRestaurant}
        center={state.userLocation || undefined}
        className="absolute inset-0"
      />

      {/* 结果卡片（桌面端浮动） */}
      {selectedRestaurant && (
        <div className="absolute bottom-6 left-6 right-6 z-10">
          <ResultPanel
            restaurant={selectedRestaurant}
            onRemove={handleRemove}
            onSave={handleSave}
            onRetry={handleRetry}
            onClose={handleClose}
          />
        </div>
      )}
    </div>
  );

  return (
    <Layout
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      onHistoryClick={() => router.push('/history')}
    >
      {leftPanel}
    </Layout>
  );
};
