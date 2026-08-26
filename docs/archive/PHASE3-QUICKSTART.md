> 状态：历史归档。仅用于追溯，不是当前实现依据。

# Phase 3 快速开始指南

## 5分钟快速上手

### 1. 设置 Provider (1分钟)

在根 layout 中包装 AppProvider:

```tsx
// app/layout.tsx
import { AppProvider } from '@/context';

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
```

### 2. 创建输入页面 (2分钟)

```tsx
// app/page.tsx
'use client';

import { useAppState, useLocation, useRestaurantSearch } from '@/hooks';

export default function HomePage() {
  const { state, setQuery, setLocation } = useAppState();
  const { location, getAutoLocation } = useLocation();
  const { search } = useRestaurantSearch();

  // 同步位置
  React.useEffect(() => {
    if (location) setLocation(location);
  }, [location, setLocation]);

  const handleSearch = () => {
    if (state.userQuery && location) {
      search(state.userQuery, location);
    }
  };

  return (
    <div>
      <input
        value={state.userQuery}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button onClick={getAutoLocation}>定位</button>
      <button onClick={handleSearch}>搜索</button>
    </div>
  );
}
```

### 3. 创建转盘组件 (2分钟)

```tsx
// components/Turntable.tsx
'use client';

import { useAppState, useTurntable } from '@/hooks';

export function Turntable() {
  const { state } = useAppState();
  const { rotation, spinDuration, startSpin } = useTurntable(
    state.restaurants.length
  );

  if (state.step !== 'READY' && state.step !== 'SPINNING') return null;

  return (
    <div>
      <div
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: `transform ${spinDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1)`,
        }}
      >
        {state.restaurants.map((r) => (
          <div key={r.id}>{r.name}</div>
        ))}
      </div>
      <button onClick={startSpin}>开始</button>
    </div>
  );
}
```

完成! 现在你有一个可用的应用了。

## 常用模式

### 获取全局状态

```tsx
const { state } = useAppState();
console.log(state.step);           // 当前步骤
console.log(state.userQuery);      // 用户查询
console.log(state.restaurants);    // 餐厅列表
console.log(state.selectedIndex);  // 选中索引
```

### 更新状态

```tsx
const { setQuery, setLocation, setStep, reset } = useAppState();

setQuery('川菜');
setLocation({ lat: 39.9, lng: 116.4 });
setStep('READY');
reset(); // 重置所有状态
```

### 处理位置

```tsx
const { location, isLocating, error, getAutoLocation, geocodeAddress } = useLocation();

// 自动定位
await getAutoLocation();

// 地址转坐标
await geocodeAddress('北京市朝阳区');

// 显示位置
if (location) {
  console.log(location.lat, location.lng, location.address);
}
```

### 搜索餐厅

```tsx
const { isSearching, search } = useRestaurantSearch();

await search('我想吃火锅', { lat: 39.9, lng: 116.4 });

// 搜索会自动:
// 1. 调用 /api/understand
// 2. 调用 /api/search
// 3. 更新状态到 READY
```

### 转盘控制

```tsx
const { isSpinning, selectedIndex, rotation, startSpin } = useTurntable(8);

// 开始旋转
startSpin();

// 旋转会自动:
// 1. 设置状态为 SPINNING
// 2. 3-5秒后停止
// 3. 设置 selectedIndex
// 4. 转移到 RESULT 状态
```

### 响应式设计

```tsx
const isMobile = useIsMobile();
const breakpoint = useBreakpoint(); // 'mobile' | 'tablet' | 'desktop'

return (
  <div className={isMobile ? 'mobile' : 'desktop'}>
    {breakpoint === 'mobile' ? <MobileView /> : <DesktopView />}
  </div>
);
```

### 保存历史

```tsx
import { saveRecord, createRecord, getHistory } from '@/lib/storage';

// 创建记录
const record = createRecord(
  state.userQuery,
  state.userLocation!,
  state.restaurants[state.selectedIndex],
  state.restaurants
);

// 保存
await saveRecord(record);

// 获取历史
const history = await getHistory();
```

## 状态检查

```tsx
const { state } = useAppState();

// 检查是否可以搜索
const canSearch = state.userQuery && state.userLocation;

// 检查是否有结果
const hasResults = state.restaurants.length > 0;

// 检查是否选中了餐厅
const hasSelection = state.selectedIndex >= 0;

// 检查是否有错误
const hasError = state.step === 'ERROR' || state.error !== null;
```

## 错误处理

```tsx
const { state, setError, setStep } = useAppState();

// 显示错误
if (state.error) {
  return <div className="error">{state.error}</div>;
}

// 手动设置错误
setError('自定义错误信息');

// 清除错误并恢复
setError(null);
setStep('INPUT');
```

## API 调用

```tsx
import { understand, searchRestaurants, geocode } from '@/lib/api';

// 理解需求
const parsed = await understand('川菜', location);

// 搜索餐厅
const restaurants = await searchRestaurants({
  keywords: parsed.keywords,
  location,
  distance: 2000,
  count: 8,
});

// 地理编码
const loc = await geocode('天安门', '北京市');
```

## 调试技巧

### 1. 查看当前状态

```tsx
const { state } = useAppState();

useEffect(() => {
  console.log('State changed:', state);
}, [state]);
```

### 2. 监听步骤变化

```tsx
const { state } = useAppState();

useEffect(() => {
  console.log('Step changed to:', state.step);
}, [state.step]);
```

### 3. 查看存储

```tsx
import { getHistory } from '@/lib/storage';

const history = await getHistory();
console.log('History:', history);
```

## 性能优化

### 1. 避免不必要的渲染

```tsx
// ✅ 只订阅需要的状态
const { state: { step, restaurants } } = useAppState();

// ❌ 订阅整个 state
const { state } = useAppState();
```

### 2. 使用 useMemo

```tsx
const sortedRestaurants = useMemo(() => {
  return state.restaurants.sort((a, b) => a.distance - b.distance);
}, [state.restaurants]);
```

### 3. 防抖输入

```tsx
import { useState, useEffect } from 'react';

const [query, setQuery] = useState('');
const { setQuery: setGlobalQuery } = useAppState();

useEffect(() => {
  const timer = setTimeout(() => {
    setGlobalQuery(query);
  }, 300);

  return () => clearTimeout(timer);
}, [query, setGlobalQuery]);
```

## 常见问题

### Q: Context 不可用?
A: 确保在 AppProvider 内部使用 hooks。

### Q: 位置获取失败?
A: 确保使用 HTTPS 或 localhost,并授予位置权限。

### Q: 状态没有更新?
A: 检查是否正确使用了 dispatch 或便利方法。

### Q: API 调用失败?
A: 检查 .env 配置和 API 端点是否正确。

### Q: 转盘不旋转?
A: 确保状态为 READY 且餐厅数量 >= 3。

## 下一步

- 查看 [PHASE3-COMPLETION.md](./PHASE3-COMPLETION.md) 了解完整文档
- 查看 [PHASE3-EXAMPLE.tsx](./PHASE3-EXAMPLE.tsx) 了解完整示例
- 开始实现 UI 组件(Phase 4)
