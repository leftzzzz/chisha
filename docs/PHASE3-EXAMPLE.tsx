/**
 * Phase 3 实现示例
 *
 * 展示如何使用所有的 Context、Hooks 和工具
 *
 * 这是一个完整的示例应用,演示了:
 * 1. Context Provider 设置
 * 2. 所有 Hooks 的使用
 * 3. 完整的状态流转
 * 4. 错误处理
 * 5. 响应式设计
 */

'use client';

import React from 'react';
import { AppProvider } from '@/context';
import {
  useAppState,
  useLocation,
  useRestaurantSearch,
  useTurntable,
  useIsMobile,
} from '@/hooks';
import { saveRecord, createRecord } from '@/lib/storage';

/**
 * 主应用组件
 */
function App() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}

/**
 * 主内容组件
 */
function MainContent() {
  const { state } = useAppState();
  const isMobile = useIsMobile();

  return (
    <div className={isMobile ? 'mobile' : 'desktop'}>
      <header>
        <h1>今天吃啥</h1>
        <p>当前状态: {state.step}</p>
      </header>

      <main>
        {/* 根据状态显示不同的组件 */}
        {state.step === 'INPUT' && <InputStep />}
        {state.step === 'UNDERSTANDING' && <LoadingStep message="理解需求中..." />}
        {state.step === 'SEARCHING' && <LoadingStep message="搜索餐厅中..." />}
        {state.step === 'READY' && <TurntableStep />}
        {state.step === 'SPINNING' && <TurntableStep />}
        {state.step === 'RESULT' && <ResultStep />}
        {state.step === 'ERROR' && <ErrorStep />}
      </main>
    </div>
  );
}

/**
 * 输入步骤
 */
function InputStep() {
  const { state, setQuery, setLocation } = useAppState();
  const {
    location,
    isLocating,
    error: locationError,
    getAutoLocation,
    geocodeAddress,
  } = useLocation();
  const { isSearching, search } = useRestaurantSearch();

  const [addressInput, setAddressInput] = React.useState('');

  // 同步位置到全局状态
  React.useEffect(() => {
    if (location) {
      setLocation(location);
    }
  }, [location, setLocation]);

  const handleAutoLocation = async () => {
    await getAutoLocation();
  };

  const handleGeocode = async () => {
    await geocodeAddress(addressInput);
  };

  const handleSearch = async () => {
    if (!state.userQuery.trim()) {
      alert('请输入您想吃什么');
      return;
    }

    if (!location) {
      alert('请提供位置信息');
      return;
    }

    await search(state.userQuery, location);
  };

  return (
    <div className="input-step">
      <section>
        <h2>您想吃什么?</h2>
        <input
          type="text"
          value={state.userQuery}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如: 川菜、火锅、便宜的快餐..."
        />
      </section>

      <section>
        <h2>您的位置</h2>

        {/* 自动定位 */}
        <button onClick={handleAutoLocation} disabled={isLocating}>
          {isLocating ? '定位中...' : '自动定位'}
        </button>

        {/* 手动输入地址 */}
        <div>
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="或输入地址..."
          />
          <button onClick={handleGeocode} disabled={isLocating}>
            确认地址
          </button>
        </div>

        {/* 显示当前位置 */}
        {location && (
          <p>
            当前位置: {location.address || `${location.lat}, ${location.lng}`}
          </p>
        )}

        {/* 位置错误 */}
        {locationError && <p className="error">{locationError}</p>}
      </section>

      {/* 开始搜索 */}
      <button
        onClick={handleSearch}
        disabled={isSearching || !state.userQuery || !location}
        className="primary"
      >
        {isSearching ? '搜索中...' : '开始搜索'}
      </button>
    </div>
  );
}

/**
 * 加载步骤
 */
function LoadingStep({ message }: { message: string }) {
  return (
    <div className="loading-step">
      <div className="spinner" />
      <p>{message}</p>
    </div>
  );
}

/**
 * 转盘步骤
 */
function TurntableStep() {
  const { state, deleteRestaurant } = useAppState();
  const { isSpinning, rotation, spinDuration, startSpin } = useTurntable(
    state.restaurants.length
  );

  const handleDelete = (index: number) => {
    if (confirm('确定要删除这个餐厅吗?')) {
      deleteRestaurant(index);
    }
  };

  return (
    <div className="turntable-step">
      <h2>找到 {state.restaurants.length} 家餐厅</h2>

      {/* 转盘 */}
      <div className="turntable-container">
        <div
          className="turntable"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isSpinning
              ? `transform ${spinDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`
              : 'none',
          }}
        >
          {state.restaurants.map((restaurant, index) => (
            <div
              key={restaurant.id}
              className="turntable-item"
              data-index={index}
            >
              <div className="restaurant-card">
                <h3>{restaurant.name}</h3>
                <p>{restaurant.cuisineType}</p>
                <p>{restaurant.distance}m</p>
                {!isSpinning && (
                  <button onClick={() => handleDelete(index)}>删除</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 指针 */}
        <div className="pointer" />
      </div>

      {/* 开始按钮 */}
      <button
        onClick={startSpin}
        disabled={isSpinning}
        className="primary large"
      >
        {isSpinning ? '转盘旋转中...' : '开始转盘!'}
      </button>
    </div>
  );
}

/**
 * 结果步骤
 */
function ResultStep() {
  const { state, reset, setStep } = useAppState();

  if (state.selectedIndex < 0 || !state.restaurants[state.selectedIndex]) {
    return <div>没有选中的餐厅</div>;
  }

  const selected = state.restaurants[state.selectedIndex];

  const handleSave = async () => {
    if (!state.userLocation) return;

    try {
      const record = createRecord(
        state.userQuery,
        state.userLocation,
        selected,
        state.restaurants
      );

      await saveRecord(record);
      alert('已保存到历史记录!');
    } catch (error) {
      alert('保存失败: ' + (error as Error).message);
    }
  };

  const handleAgain = () => {
    setStep('READY');
  };

  return (
    <div className="result-step">
      <h2>今天就吃这个!</h2>

      <div className="selected-restaurant">
        <h3>{selected.name}</h3>
        <p className="cuisine">{selected.cuisineType}</p>
        <p className="address">{selected.address}</p>
        <p className="distance">距离: {selected.distance}m</p>

        {selected.rating && (
          <p className="rating">评分: {selected.rating} ⭐</p>
        )}

        {selected.averagePrice && (
          <p className="price">人均: ¥{selected.averagePrice}</p>
        )}

        {selected.phone && <p className="phone">电话: {selected.phone}</p>}

        {selected.openingHours && (
          <p className="hours">营业时间: {selected.openingHours}</p>
        )}
      </div>

      <div className="actions">
        <button onClick={handleSave} className="secondary">
          保存记录
        </button>
        <button onClick={handleAgain} className="primary">
          再转一次
        </button>
        <button onClick={reset}>重新搜索</button>
      </div>
    </div>
  );
}

/**
 * 错误步骤
 */
function ErrorStep() {
  const { state, setStep, reset } = useAppState();

  const handleRetry = () => {
    // 根据错误类型决定返回哪个步骤
    if (state.restaurants.length > 0) {
      setStep('READY');
    } else {
      setStep('INPUT');
    }
  };

  return (
    <div className="error-step">
      <h2>出错了</h2>
      <p className="error-message">{state.error}</p>

      <div className="actions">
        <button onClick={handleRetry} className="primary">
          重试
        </button>
        <button onClick={reset} className="secondary">
          重新开始
        </button>
      </div>
    </div>
  );
}

export default App;
