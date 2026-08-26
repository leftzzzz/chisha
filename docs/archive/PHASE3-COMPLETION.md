> 状态：历史归档。仅用于追溯，不是当前实现依据。

# Phase 3: 前端状态管理 - 实现完成

## 概述

Phase 3 已完成,实现了完整的前端状态管理系统。包含 Context API、Reducer、5个自定义 Hooks、API 封装和 Storage 工具。

## 文件结构

```
j:\project\chisha\
├── context/
│   ├── AppContext.tsx        # React Context Provider
│   ├── AppReducer.ts         # State Reducer
│   └── index.ts              # 统一导出
├── hooks/
│   ├── useAppState.ts        # 应用状态 Hook
│   ├── useLocation.ts        # 位置获取 Hook
│   ├── useRestaurantSearch.ts # 餐厅搜索 Hook
│   ├── useTurntable.ts       # 转盘逻辑 Hook
│   ├── useMediaQuery.ts      # 响应式设计 Hook
│   └── index.ts              # 统一导出
├── lib/
│   ├── api.ts                # API 调用封装
│   └── storage.ts            # localStorage 操作
└── types/
    └── index.ts              # 类型定义(已更新)
```

## 核心功能

### 1. Context & Reducer

#### AppContext
- 全局状态管理
- 提供 `useAppContext` Hook
- 支持自定义初始状态(用于测试)

#### AppReducer
- 状态流转: `INPUT → UNDERSTANDING → SEARCHING → READY → SPINNING → RESULT`
- 错误状态: 任何状态都可以转移到 `ERROR`
- Actions:
  - `SET_QUERY` - 设置查询
  - `SET_LOCATION` - 设置位置
  - `SET_STEP` - 转移状态
  - `SET_PARSED_REQUIREMENT` - 保存解析结果
  - `SET_RESTAURANTS` - 保存搜索结果
  - `SET_SELECTED_INDEX` - 设置选中索引
  - `SET_ERROR` - 设置错误
  - `DELETE_RESTAURANT` - 删除餐厅并补位
  - `RESET_STATE` - 重置状态

### 2. 自定义 Hooks

#### useAppState
提供便捷的状态管理方法:
```tsx
const {
  state,
  setQuery,
  setLocation,
  setStep,
  setRestaurants,
  setSelectedIndex,
  setError,
  deleteRestaurant,
  reset,
} = useAppState();
```

#### useLocation
位置获取和地址解析:
```tsx
const {
  location,
  isLocating,
  error,
  getAutoLocation,     // 自动定位
  geocodeAddress,      // 地址转坐标
  clearLocation,
} = useLocation();
```

特性:
- 使用浏览器 Geolocation API
- 支持手动输入地址
- 自动缓存(sessionStorage, 30分钟)
- 完整的错误处理

#### useRestaurantSearch
执行完整搜索流程:
```tsx
const { isSearching, search } = useRestaurantSearch();

await search(query, location);
```

流程:
1. 调用 `/api/understand` 理解需求
2. 调用 `/api/search` 搜索餐厅
3. 自动更新状态 (UNDERSTANDING → SEARCHING → READY)
4. 错误处理和恢复

#### useTurntable
转盘旋转逻辑:
```tsx
const {
  isSpinning,
  selectedIndex,
  rotation,
  spinDuration,
  startSpin,
  reset,
} = useTurntable(restaurants.length);
```

特性:
- 随机选择餐厅
- 3-5秒旋转时间
- 3-5圈旋转
- 自动状态转移 (READY → SPINNING → RESULT)

#### useMediaQuery
响应式设计:
```tsx
// 基础用法
const isMobile = useMediaQuery('(max-width: 768px)');

// 预定义 Hooks
const isMobile = useIsMobile();      // <= 768px
const isTablet = useIsTablet();      // <= 1024px
const isDesktop = useIsDesktop();    // >= 1025px
const isLandscape = useIsLandscape();
const breakpoint = useBreakpoint();  // 'mobile' | 'tablet' | 'desktop'
```

### 3. API 封装 (lib/api.ts)

统一的 API 调用接口:
```tsx
import { understand, searchRestaurants, geocode, reverseGeocode } from '@/lib/api';

// 理解需求
const parsed = await understand(query, location);

// 搜索餐厅
const restaurants = await searchRestaurants({
  keywords: ['火锅'],
  location,
  distance: 2000,
  count: 8,
});

// 地理编码
const location = await geocode('天安门', '北京市');

// 逆向地理编码
const address = await reverseGeocode({ lat: 39.9, lng: 116.4 });
```

特性:
- 自动超时控制(30秒)
- 自动重试(2次)
- 统一错误处理
- 友好的错误信息

### 4. Storage 工具 (lib/storage.ts)

历史记录持久化:
```tsx
import { getHistory, saveRecord, deleteRecord, clearHistory, createRecord } from '@/lib/storage';

// 获取历史
const history = await getHistory();

// 保存记录
const record = createRecord(query, location, selectedRestaurant, allRestaurants);
await saveRecord(record);

// 删除记录
await deleteRecord(recordId);

// 清空历史
await clearHistory();
```

特性:
- localStorage 存储
- 最多保存 100 条记录
- 自动删除最早记录
- 完整的异常处理
- SSR 支持

## 使用示例

### 1. 设置应用

```tsx
// app/layout.tsx
import { AppProvider } from '@/context';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

### 2. 输入页面

```tsx
// app/page.tsx
'use client';

import { useAppState, useLocation, useRestaurantSearch } from '@/hooks';

export default function HomePage() {
  const { state, setQuery } = useAppState();
  const { location, isLocating, getAutoLocation } = useLocation();
  const { isSearching, search } = useRestaurantSearch();

  const handleSearch = async () => {
    if (!state.userQuery || !location) {
      alert('请输入需求和位置');
      return;
    }

    await search(state.userQuery, location);
  };

  return (
    <div>
      <input
        value={state.userQuery}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="今天想吃什么?"
      />

      <button onClick={getAutoLocation} disabled={isLocating}>
        {isLocating ? '定位中...' : '自动定位'}
      </button>

      {location && <p>位置: {location.address}</p>}

      <button onClick={handleSearch} disabled={isSearching}>
        {isSearching ? '搜索中...' : '开始搜索'}
      </button>
    </div>
  );
}
```

### 3. 转盘页面

```tsx
// components/Turntable.tsx
'use client';

import { useAppState, useTurntable } from '@/hooks';

export function Turntable() {
  const { state } = useAppState();
  const { isSpinning, rotation, spinDuration, startSpin } = useTurntable(
    state.restaurants.length
  );

  if (state.step !== 'READY' && state.step !== 'SPINNING') {
    return null;
  }

  return (
    <div>
      <div
        className="turntable"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: `transform ${spinDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
        }}
      >
        {state.restaurants.map((restaurant, index) => (
          <div key={index} className="item">
            {restaurant.name}
          </div>
        ))}
      </div>

      <button onClick={startSpin} disabled={isSpinning}>
        {isSpinning ? '转盘旋转中...' : '开始'}
      </button>
    </div>
  );
}
```

### 4. 结果页面

```tsx
// components/Result.tsx
'use client';

import { useAppState } from '@/hooks';
import { saveRecord, createRecord } from '@/lib/storage';

export function Result() {
  const { state, reset } = useAppState();

  if (state.step !== 'RESULT' || state.selectedIndex < 0) {
    return null;
  }

  const selected = state.restaurants[state.selectedIndex];

  const handleSave = async () => {
    if (!state.userLocation) return;

    const record = createRecord(
      state.userQuery,
      state.userLocation,
      selected,
      state.restaurants
    );

    await saveRecord(record);
    alert('已保存到历史记录');
  };

  return (
    <div>
      <h2>今天就吃这个!</h2>
      <div>
        <h3>{selected.name}</h3>
        <p>{selected.cuisineType}</p>
        <p>{selected.address}</p>
        <p>距离: {selected.distance}m</p>
        {selected.rating && <p>评分: {selected.rating}</p>}
      </div>

      <button onClick={handleSave}>保存记录</button>
      <button onClick={reset}>再来一次</button>
    </div>
  );
}
```

### 5. 响应式布局

```tsx
// components/Layout.tsx
'use client';

import { useIsMobile, useBreakpoint } from '@/hooks';

export function Layout({ children }) {
  const isMobile = useIsMobile();
  const breakpoint = useBreakpoint();

  return (
    <div className={`layout layout--${breakpoint}`}>
      {isMobile ? <MobileHeader /> : <DesktopHeader />}
      <main>{children}</main>
    </div>
  );
}
```

## 状态流转图

```
┌─────────┐
│  INPUT  │ (初始状态 - 用户输入需求和位置)
└────┬────┘
     │ 用户点击"搜索"
     ↓
┌────────────────┐
│ UNDERSTANDING  │ (调用 /api/understand)
└────────┬───────┘
         │ 理解完成
         ↓
┌─────────────┐
│  SEARCHING  │ (调用 /api/search)
└──────┬──────┘
       │ 搜索完成
       ↓
┌──────────┐
│  READY   │ (转盘就绪 - 等待用户开始)
└─────┬────┘
      │ 用户点击"开始转盘"
      ↓
┌──────────┐
│ SPINNING │ (转盘旋转中 - 3-5秒)
└─────┬────┘
      │ 转盘停止
      ↓
┌──────────┐
│  RESULT  │ (显示结果)
└─────┬────┘
      │ 用户点击"再来一次"或"删除餐厅"
      ↓
  READY 或 INPUT

    任何状态
      ↓ 出现错误
┌──────────┐
│  ERROR   │ (错误状态)
└─────┬────┘
      │ 用户重试
      ↓
  之前的状态
```

## 错误处理

所有 Hooks 和 API 都有完整的错误处理:

1. **网络错误**: 自动重试 2 次
2. **超时错误**: 30秒超时,提示重试
3. **API 错误**: 转换为友好的错误信息
4. **定位错误**: 根据不同的错误码提供具体建议
5. **存储错误**: 自动降级,不影响主流程

## 性能优化

1. **useCallback**: 所有回调函数都使用 useCallback 避免重新渲染
2. **位置缓存**: sessionStorage 缓存 30 分钟
3. **SSR 支持**: 所有 Hooks 都支持服务端渲染
4. **懒加载**: 组件按需加载
5. **清理副作用**: 所有 useEffect 都有清理函数

## 类型安全

- 完整的 TypeScript 类型定义
- 所有 Hooks 都有清晰的返回类型
- 使用 `AppAction` union type 确保 reducer 类型安全
- API 请求和响应都有类型定义

## 下一步

Phase 3 已完成,可以开始:
- **Phase 4**: UI 组件开发
- **Phase 5**: 交互动画和转盘实现
- **Phase 6**: 测试和优化

## 测试建议

1. 测试状态转移逻辑
2. 测试 API 调用和错误处理
3. 测试位置服务(需要模拟 Geolocation API)
4. 测试转盘逻辑和动画
5. 测试响应式设计在不同设备上的表现
6. 测试 localStorage 存储和限制

## 注意事项

1. 所有组件需要标记 `'use client'`(因为使用了 hooks)
2. AppProvider 必须在根组件设置
3. 位置服务需要 HTTPS 或 localhost
4. localStorage 可能在隐私模式下不可用
5. 转盘动画需要 CSS transition 支持
