/**
 * HomePage 组件
 *
 * 主页容器，集成所有组件和业务逻辑
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Location, TurntableOption } from '@/types';
import { useAppState, useLocation, useRestaurantSearch, useTurntable, useMediaQuery, useErrorAlert } from '@/hooks';
import { Layout } from './layout';
import { SearchPanel } from './input';
import { Turntable, TurntableControls, TurntableManager } from './turntable';
import { RestaurantCard } from './restaurant';
import { Map } from './map';
import { LoadingSteps } from './LoadingSteps';
import { ErrorMessage, ErrorAlert, BottomSheet, useToast } from './ui';
import { ShareModal } from './share';
import { saveRecordAndReplaceSameSession, getReuseRecord } from '@/lib/storage';
import { parseShareData, getShareParamFromUrl, clearShareParamFromUrl } from '@/lib/share';

export const HomePage: React.FC = () => {
  const router = useRouter();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { showToast } = useToast();

  // 使用 hooks
  const {
    state,
    setQuery,
    setLocation,
    setStep,
    deleteRestaurant,
    restoreRestaurant,
    addFromCandidates,
    removeToCandidates,
    addRestaurant,
    addCustomOption,
    removeCustomOption,
    reset,
    dispatch,
  } = useAppState();
  const { location: detectedLocation, getAutoLocation, isLocating, error: locationError, geocodeAddress, clearLocation } = useLocation();
  const { search, answerQuestion, isSearching, progress } = useRestaurantSearch();
  const { rotation, selectedIndex, isSpinning, startSpin, reset: resetTurntable } = useTurntable(state.restaurants.length + state.customOptions.length);
  const errorAlert = useErrorAlert();

  // 底部弹出卡片状态
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [previewRestaurantIndex, setPreviewRestaurantIndex] = useState<number | null>(null);
  const [focusedRestaurantIndex, setFocusedRestaurantIndex] = useState<number | null>(null);

  // 管理面板状态
  const [managerOpen, setManagerOpen] = useState(false);

  // 分享弹窗状态
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareSelectedOption, setShareSelectedOption] = useState<TurntableOption | null>(null);

  // 获取搜索错误
  const searchError = state.error;

  // 检测并恢复重新使用的记录
  useEffect(() => {
    const reuseRecord = getReuseRecord();
    if (reuseRecord) {
      // 从历史记录恢复状态
      dispatch({
        type: 'RESTORE_FROM_HISTORY',
        payload: {
          query: reuseRecord.query,
          location: reuseRecord.location,
          restaurants: reuseRecord.restaurants,
          customOptions: reuseRecord.customOptions,
        },
      });
    }
  }, [dispatch]);

  // 检测并解析分享链接
  useEffect(() => {
    const shareParam = getShareParamFromUrl();
    if (shareParam) {
      const shareData = parseShareData(shareParam);
      if (shareData && shareData.restaurants.length > 0) {
        // 从分享链接恢复状态（不设置位置，因为分享链接不包含位置）
        dispatch({
          type: 'RESTORE_FROM_HISTORY',
          payload: {
            query: shareData.query,
            location: { lat: 0, lng: 0, address: '来自分享' }, // 占位位置
            restaurants: shareData.restaurants,
            customOptions: shareData.customOptions,
          },
        });
        // 清除 URL 中的分享参数
        clearShareParamFromUrl();
        showToast('已加载分享的转盘', 'success');
      } else {
        showToast('分享链接无效', 'error');
        clearShareParamFromUrl();
      }
    }
  }, [dispatch, showToast]);

  // 同步检测到的位置到应用状态（仅用于初始加载缓存位置）
  useEffect(() => {
    if (detectedLocation && !state.userLocation) {
      setLocation(detectedLocation);
    }
  }, [detectedLocation, state.userLocation, setLocation]);

  // 处理自动定位 - 直接使用返回值同步位置
  const handleAutoLocate = useCallback(async () => {
    const location = await getAutoLocation();
    if (location) {
      setLocation(location);
    }
  }, [getAutoLocation, setLocation]);

  // 处理位置变更（包括清除）
  const handleLocationChange = useCallback((location: Location | null) => {
    if (location === null) {
      // 同时清除 useLocation 和 appState 的位置
      clearLocation();
    }
    setLocation(location);
  }, [clearLocation, setLocation]);

  // 处理手动地址输入 - 直接使用返回值同步位置
  const handleManualAddressSubmit = useCallback(async (address: string) => {
    const location = await geocodeAddress(address);
    if (location) {
      setLocation(location);
    }
  }, [geocodeAddress, setLocation]);

  // 处理搜索 - 传入错误回调用于触发弹窗
  const handleSearch = useCallback(async () => {
    if (!state.userQuery.trim() || !state.userLocation) return;

    await search(state.userQuery, state.userLocation, (errorCode) => {
      // 获取错误信息并显示弹窗
      const isRetryable = errorCode === 'SEARCH_NO_RESULTS' ||
                         errorCode === 'NO_RESULTS' ||
                         errorCode === 'NETWORK_ERROR' ||
                         errorCode === 'SEARCH_TIMEOUT' ||
                         errorCode === 'AGENT_ERROR' ||
                         errorCode === 'SERVICE_BUSY' ||
                         errorCode === 'INSUFFICIENT_RESULTS' ||
                         errorCode === 'API_CALL_FAILED' ||
                         errorCode === 'UNKNOWN_ERROR';

      errorAlert.show(errorCode, isRetryable ? () => {
        // 重试：重新执行搜索
        handleSearch();
      } : undefined);
    });
  }, [state.userQuery, state.userLocation, search, errorAlert]);

  // 处理转盘
  const handleSpin = useCallback(() => {
    if (state.restaurants.length === 0) return;
    startSpin();
  }, [state.restaurants.length, startSpin]);

  // 监听旋转完成 - 当进入 RESULT 状态时自动保存并弹出卡片
  const prevStepRef = React.useRef(state.step);
  const hasSavedRef = React.useRef(false);

  // 当进入 SPINNING 状态时重置保存标志
  useEffect(() => {
    if (state.step === 'SPINNING') {
      hasSavedRef.current = false;
    }
  }, [state.step]);

  useEffect(() => {
    // 检测从 SPINNING 变为 RESULT，且尚未保存
    if (prevStepRef.current === 'SPINNING' && state.step === 'RESULT' && selectedIndex >= 0 && !hasSavedRef.current) {
      // 标记已保存，防止重复
      hasSavedRef.current = true;

      // 获取选中的选项（可能是餐厅或自定义选项）
      const allOptions = [...state.restaurants, ...state.customOptions];
      const selectedOption = allOptions[selectedIndex];

      // 自动保存到历史记录（使用会话替换逻辑，同一搜索会话只保留最后一条）
      if (selectedOption && state.userLocation) {
        saveRecordAndReplaceSameSession({
          query: state.userQuery,
          location: state.userLocation,
          restaurants: state.restaurants,
          rejectedRestaurants: state.removedRestaurants,
          customOptions: state.customOptions.length > 0 ? state.customOptions : undefined,
          selected: selectedOption,
        });
      }

      // 自动弹出结果卡片（仅移动端，且选中的是餐厅）
      if (!isDesktop && selectedIndex < state.restaurants.length) {
        setPreviewRestaurantIndex(selectedIndex);
        setBottomSheetOpen(true);
      }
    }
    prevStepRef.current = state.step;
  }, [state.step, selectedIndex, isDesktop, state.restaurants, state.removedRestaurants, state.customOptions, state.userQuery, state.userLocation]);

  // 处理扇区点击
  const handleSegmentClick = useCallback((index: number) => {
    if (isSpinning) return;

    if (isDesktop) {
      // 桌面端：聚焦地图到对应餐厅
      setFocusedRestaurantIndex(index);
    } else {
      // 移动端：打开底部弹窗
      setPreviewRestaurantIndex(index);
      setBottomSheetOpen(true);
    }
  }, [isSpinning, isDesktop]);

  // 关闭底部弹出卡片
  const handleCloseBottomSheet = useCallback(() => {
    setBottomSheetOpen(false);
    setPreviewRestaurantIndex(null);
  }, []);

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

  // 处理重试（再来一次）
  const handleRetry = useCallback(() => {
    resetTurntable();
    setStep('READY');
  }, [resetTurntable, setStep]);

  // 处理分享（打开分享弹窗）
  const handleShare = useCallback((option?: TurntableOption) => {
    // 确定要分享的选项
    const allOptions: TurntableOption[] = [...state.restaurants, ...state.customOptions];
    const optionToShare = option || (selectedIndex >= 0 ? allOptions[selectedIndex] : null);

    if (optionToShare) {
      setShareSelectedOption(optionToShare);
      setShareModalOpen(true);
    }
  }, [state.restaurants, state.customOptions, selectedIndex]);

  // 关闭分享弹窗
  const handleCloseShareModal = useCallback(() => {
    setShareModalOpen(false);
    setShareSelectedOption(null);
  }, []);

  // 处理关闭/返回
  const handleClose = useCallback(() => {
    reset();
  }, [reset]);

  const handleErrorBack = useCallback(() => {
    setStep('INPUT');
  }, [setStep]);

  // 选中的餐厅
  const selectedRestaurant = selectedIndex >= 0 ? state.restaurants[selectedIndex] : null;

  // 预览的餐厅（点击扇区时）
  const previewRestaurant = previewRestaurantIndex !== null
    ? state.restaurants[previewRestaurantIndex]
    : null;

  // 渲染加载状态
  if (
    state.step === 'UNDERSTANDING'
    || state.step === 'SEARCHING'
    || state.step === 'AGENT_QUESTION'
  ) {
    return (
      <Layout>
        <LoadingSteps
          progress={progress}
          onQuestionReply={answerQuestion}
          isReplying={isSearching}
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
            onAction={handleErrorBack}
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
          onLocationChange={handleLocationChange}
          onSearch={handleSearch}
          isLoading={isSearching}
          error={searchError || undefined}
          locationError={locationError || undefined}
          onAutoLocate={handleAutoLocate}
          isLocating={isLocating}
          onManualAddressSubmit={handleManualAddressSubmit}
        />
        {/* 错误弹窗 */}
        {errorAlert.isOpen && errorAlert.errorInfo && (
          <ErrorAlert
            isOpen={errorAlert.isOpen}
            onClose={errorAlert.close}
            onAction={errorAlert.onAction}
            title={errorAlert.errorInfo.message}
            message={errorAlert.errorInfo.description || ''}
            severity={errorAlert.errorInfo.severity}
            actionLabel={errorAlert.errorInfo.actionLabel}
          />
        )}
      </Layout>
    );
  }

  // 聚焦的餐厅（点击扇区时）
  const focusedRestaurant = focusedRestaurantIndex !== null
    ? state.restaurants[focusedRestaurantIndex]
    : null;

  // 转盘和结果状态
  const leftPanel = (
    <div className="space-y-6">
      {/* 转盘 */}
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg px-2 py-6 sm:px-4 md:px-6">
        {/* 顶部导航栏 */}
        <div className="flex items-center justify-between mb-4">
          {/* iOS 风格返回导航 */}
          <button
            onClick={handleClose}
            className="flex items-center gap-1 text-primary hover:opacity-70 transition-opacity"
            aria-label="返回搜索页"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span className="text-[17px]">重新搜索</span>
          </button>

          {/* 管理按钮 */}
          <button
            onClick={() => setManagerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="管理选项"
            disabled={isSpinning}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              viewBox="0 0 24 24"
            >
              <circle cx="6" cy="6" r="2"/>
              <line x1="10" y1="6" x2="20" y2="6"/>
              <circle cx="18" cy="12" r="2"/>
              <line x1="4" y1="12" x2="14" y2="12"/>
              <circle cx="10" cy="18" r="2"/>
              <line x1="14" y1="18" x2="20" y2="18"/>
              <line x1="4" y1="18" x2="6" y2="18"/>
            </svg>
            <span className="text-sm hidden sm:inline">管理</span>
          </button>
        </div>
        <Turntable
          restaurants={state.restaurants}
          customOptions={state.customOptions}
          selectedIndex={selectedIndex}
          isSpinning={isSpinning}
          rotation={rotation}
          onSegmentClick={handleSegmentClick}
        />
        <div className="mt-6">
          <TurntableControls
            isSpinning={isSpinning}
            selectedRestaurant={selectedRestaurant}
            onSpin={handleSpin}
            onRemove={handleRemove}
            onRetry={handleRetry}
            onShare={() => handleShare()}
          />
        </div>
        {(state.agentExplanation || state.agentUnmetConstraints.length > 0) && (
          <div className="mt-4 mx-2 sm:mx-0 rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-600">
            {state.agentExplanation && (
              <p>{state.agentExplanation}</p>
            )}
            {state.agentUnmetConstraints.length > 0 && (
              <div className="mt-2 space-y-1 text-xs text-gray-500">
                {state.agentUnmetConstraints.slice(0, 3).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const rightPanel = (
    <Map
      restaurants={state.restaurants}
      selectedRestaurant={selectedRestaurant}
      focusedRestaurant={focusedRestaurant}
      center={state.userLocation || undefined}
      userLocation={state.userLocation || undefined}
      className="w-full h-full"
    />
  );

  // 模态框内容（PC 端和移动端共用）
  const modals = (
    <>
      {/* 错误弹窗 */}
      {errorAlert.isOpen && errorAlert.errorInfo && (
        <ErrorAlert
          isOpen={errorAlert.isOpen}
          onClose={errorAlert.close}
          onAction={errorAlert.onAction}
          title={errorAlert.errorInfo.message}
          message={errorAlert.errorInfo.description || ''}
          severity={errorAlert.errorInfo.severity}
          actionLabel={errorAlert.errorInfo.actionLabel}
        />
      )}

      {/* 底部弹出卡片（移动端） */}
      {!isDesktop && (
        <BottomSheet
          isOpen={bottomSheetOpen}
          onClose={handleCloseBottomSheet}
          maxHeightPercent={70}
        >
          {previewRestaurant && (
            <div className="px-4 pb-4">
              <RestaurantCard
                restaurant={previewRestaurant}
                onRemove={() => {
                  if (previewRestaurantIndex !== null) {
                    deleteRestaurant(previewRestaurantIndex);
                    handleCloseBottomSheet();
                    if (state.restaurants.length <= 1) {
                      reset();
                    }
                  }
                }}
                onShare={() => {
                  handleCloseBottomSheet();
                  if (previewRestaurant) {
                    handleShare(previewRestaurant);
                  }
                }}
                onClose={handleCloseBottomSheet}
              />
            </div>
          )}
        </BottomSheet>
      )}

      {/* 转盘管理面板 */}
      <TurntableManager
        isOpen={managerOpen}
        onClose={() => setManagerOpen(false)}
        restaurants={state.restaurants}
        customOptions={state.customOptions}
        candidateRestaurants={state.candidateRestaurants}
        removedRestaurants={state.removedRestaurants}
        userLocation={state.userLocation}
        onRestoreRestaurant={restoreRestaurant}
        onAddFromCandidates={addFromCandidates}
        onRemoveToCandidates={removeToCandidates}
        onAddCustomOption={addCustomOption}
        onRemoveCustomOption={removeCustomOption}
        onAddRestaurant={addRestaurant}
      />

      {/* 分享弹窗 */}
      {shareSelectedOption && (
        <ShareModal
          isOpen={shareModalOpen}
          onClose={handleCloseShareModal}
          query={state.userQuery}
          restaurants={state.restaurants}
          customOptions={state.customOptions}
          selectedOption={shareSelectedOption}
          isDesktop={isDesktop}
        />
      )}
    </>
  );

  return (
    <Layout
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      onHistoryClick={() => router.push('/history')}
    >
      {/* 移动端：渲染主内容 + 模态框；PC 端：只渲染模态框（主内容通过 leftPanel/rightPanel 传入） */}
      {!isDesktop && leftPanel}
      {modals}
    </Layout>
  );
};
