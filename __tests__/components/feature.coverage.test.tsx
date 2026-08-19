import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InspirationChips } from '@/components/input/InspirationChips';
import { LocationPicker } from '@/components/input/LocationPicker';
import { SearchInput } from '@/components/input/SearchInput';
import { SearchPanel } from '@/components/input/SearchPanel';
import { Header } from '@/components/layout/Header';
import { DesktopLayout } from '@/components/layout/DesktopLayout';
import { MobileLayout } from '@/components/layout/MobileLayout';
import { Layout } from '@/components/layout/Layout';
import { RestaurantCard } from '@/components/restaurant/RestaurantCard';
import { RestaurantList } from '@/components/restaurant/RestaurantList';
import { ResultPanel } from '@/components/restaurant/ResultPanel';
import { Turntable } from '@/components/turntable/Turntable';
import { TurntableControls } from '@/components/turntable/TurntableControls';
import { TurntableManager } from '@/components/turntable/TurntableManager';
import { TurntablePointer } from '@/components/turntable/TurntablePointer';
import { TurntableSegment } from '@/components/turntable/TurntableSegment';
import { HistoryDetail } from '@/components/history/HistoryDetail';
import { HistoryStats } from '@/components/history/HistoryStats';
import { useMediaQuery } from '@/hooks';
import { searchRestaurants } from '@/lib/api';
import type { CustomOption, Location, Restaurant, TurntableRecord } from '@/types';

jest.mock('@/hooks', () => ({
  ...jest.requireActual('@/hooks'),
  useMediaQuery: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  searchRestaurants: jest.fn(),
}));

const location: Location = { lat: 31.23, lng: 121.47, address: '上海市' };
const makeRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
  id: 'r1',
  name: '好吃餐厅',
  cuisineType: '川菜',
  address: '人民路 1 号',
  location,
  source: 'amap',
  ...overrides,
});
const custom: CustomOption = { id: 'c1', name: '在家吃', isCustom: true };

describe('input and layout components', () => {
  it('selects inspiration chips and respects disabled state', () => {
    const onSelect = jest.fn();
    const { rerender } = render(<InspirationChips onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('button', { name: /选择建议/ })[0]);
    expect(onSelect).toHaveBeenCalled();
    rerender(<InspirationChips onSelect={onSelect} disabled />);
    fireEvent.click(screen.getAllByRole('button', { name: /选择建议/ })[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('validates search input, submits on enter and displays count/error thresholds', () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();
    const { rerender } = render(<SearchInput value="hello" onChange={onChange} onSubmit={onSubmit} maxLength={10} minLength={2} />);
    const input = screen.getByRole('textbox', { name: '搜索输入框' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: 'a' } });
    expect(onChange).toHaveBeenCalledWith('a');
    rerender(<SearchInput value="a" onChange={onChange} onSubmit={onSubmit} maxLength={10} minLength={2} />);
    expect(screen.getByRole('alert')).toHaveTextContent('至少输入 2 个字符');
    rerender(<SearchInput value="12345678901" onChange={onChange} onSubmit={onSubmit} maxLength={10} minLength={2} error="自定义错误" />);
    expect(screen.getAllByRole('alert').some((node) => node.textContent?.includes('自定义错误'))).toBe(true);
    rerender(<SearchInput value="123456789" onChange={onChange} onSubmit={onSubmit} maxLength={10} />);
    expect(screen.getByText('9/10')).toHaveClass('text-primary');
  });

  it('switches location picker between auto and manual modes', () => {
    const onLocationChange = jest.fn();
    const onAutoLocate = jest.fn();
    const onManualAddressSubmit = jest.fn();
    const { rerender } = render(
      <LocationPicker
        location={location}
        onLocationChange={onLocationChange}
        onAutoLocate={onAutoLocate}
        onManualAddressSubmit={onManualAddressSubmit}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '手动输入地址' }));
    const addressInput = screen.getByRole('textbox', { name: '手动输入地址' });
    fireEvent.change(addressInput, { target: { value: '  新地址  ' } });
    fireEvent.click(screen.getByRole('button', { name: '确认地址' }));
    expect(onManualAddressSubmit).toHaveBeenCalledWith('新地址');
    fireEvent.click(screen.getByRole('button', { name: '手动输入地址' }));
    fireEvent.click(screen.getByRole('button', { name: '使用自动定位' }));
    fireEvent.click(screen.getByRole('button', { name: '清除位置' }));
    expect(onLocationChange).toHaveBeenCalledWith(null);
    rerender(<LocationPicker location={null} onLocationChange={onLocationChange} onAutoLocate={onAutoLocate} error="定位失败" isLoading />);
    expect(screen.getByText('定位失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自动定位' }));
    expect(onAutoLocate).not.toHaveBeenCalled();
  });

  it('renders search panel states and wires child callbacks', () => {
    const props = {
      query: '',
      onQueryChange: jest.fn(),
      location: null,
      onLocationChange: jest.fn(),
      onSearch: jest.fn(),
      onAutoLocate: jest.fn(),
    };
    const { rerender } = render(<SearchPanel {...props} />);
    expect(screen.getByText('先设置位置，才能推荐附近可以直接去的餐厅。')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /选择建议/ })[0]);
    expect(props.onQueryChange).toHaveBeenCalled();
    rerender(<SearchPanel {...props} query="火锅" location={location} />);
    expect(screen.getByRole('button', { name: '开始选择' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '开始选择' }));
    expect(props.onSearch).toHaveBeenCalled();
    rerender(<SearchPanel {...props} query="火锅" location={location} isLoading />);
    expect(screen.getByRole('button', { name: '正在寻找' })).toBeDisabled();
  });

  it('renders header and both layout modes', () => {
    const onHistory = jest.fn();
    const { rerender } = render(<Header onHistoryClick={onHistory} />);
    fireEvent.click(screen.getByRole('button', { name: '查看历史记录' }));
    expect(onHistory).toHaveBeenCalled();
    rerender(<Header />);
    expect(screen.getByRole('link', { name: '查看历史记录' })).toHaveAttribute('href', '/history');
    render(<DesktopLayout leftPanel={<span>left</span>} rightPanel={<span>right</span>} />);
    expect(screen.getByText('left')).toBeInTheDocument();
    render(<MobileLayout><span>mobile</span></MobileLayout>);
    expect(screen.getByText('mobile')).toBeInTheDocument();

    (useMediaQuery as jest.Mock).mockReturnValue(true);
    const { unmount } = render(<Layout leftPanel={<span>desk-left</span>} rightPanel={<span>desk-right</span>}><span>child</span></Layout>);
    expect(screen.getByText('desk-left')).toBeInTheDocument();
    unmount();
    (useMediaQuery as jest.Mock).mockReturnValue(false);
    render(<Layout leftPanel={<span>desk-left</span>} rightPanel={<span>desk-right</span>}><span>mobile-child</span></Layout>);
    expect(screen.getByText('mobile-child')).toBeInTheDocument();
  });
});

describe('restaurant components', () => {
  it('renders restaurant details and all optional actions', () => {
    const restaurant = makeRestaurant({
      rating: 4.5,
      distance: 1200,
      averagePrice: 88,
      phone: '123456',
      openingHours: '10:00-22:00',
      businessStatus: 'open',
      recommendationReason: '离你很近',
      recommendationWarnings: ['可能排队'],
    });
    const callbacks = { onNavigate: jest.fn(), onRemove: jest.fn(), onClose: jest.fn(), onShare: jest.fn() };
    const { rerender } = render(<RestaurantCard restaurant={restaurant} {...callbacks} />);
    expect(screen.getByText('1.2公里')).toBeInTheDocument();
    expect(screen.getByText('¥88/人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导航到餐厅' }));
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('button', { name: '不想去' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(callbacks.onNavigate).toHaveBeenCalled();
    expect(callbacks.onShare).toHaveBeenCalled();
    expect(callbacks.onRemove).toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalled();

    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    rerender(<RestaurantCard restaurant={makeRestaurant({ distance: 0, rating: undefined, averagePrice: undefined, businessStatus: 'closed' })} />);
    fireEvent.click(screen.getByRole('button', { name: '导航到餐厅' }));
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('renders list empty/selected branches and keyboard/delete handlers', () => {
    const onSelect = jest.fn();
    const onDelete = jest.fn();
    const { rerender } = render(<RestaurantList restaurants={[]} selectedIndex={-1} onSelect={onSelect} />);
    expect(screen.getByText('暂无餐厅数据')).toBeInTheDocument();
    const restaurants = [makeRestaurant({ id: 'a', distance: 500, rating: 4 }), makeRestaurant({ id: 'b', name: '第二家', distance: 1500, rating: 0 })];
    rerender(<RestaurantList restaurants={restaurants} selectedIndex={0} onSelect={onSelect} onDelete={onDelete} />);
    const item = screen.getByRole('button', { name: '选择餐厅: 好吃餐厅' });
    fireEvent.click(item);
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyDown(item, { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: '删除 好吃餐厅' }));
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onDelete).toHaveBeenCalledWith(0);
  });

  it('shows result panel loading, error, empty and populated states', () => {
    const callbacks = { onNavigate: jest.fn(), onRemove: jest.fn(), onRetry: jest.fn(), onClose: jest.fn() };
    const { rerender } = render(<ResultPanel restaurant={null} isLoading />);
    expect(screen.getByText('正在加载餐厅信息…')).toBeInTheDocument();
    rerender(<ResultPanel restaurant={null} error="错误" {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(callbacks.onRetry).toHaveBeenCalled();
    rerender(<ResultPanel restaurant={null} />);
    expect(screen.getByText('暂无结果')).toBeInTheDocument();
    rerender(<ResultPanel restaurant={makeRestaurant()} {...callbacks} />);
    expect(screen.getByText('好吃餐厅')).toBeInTheDocument();
  });
});

describe('turntable components', () => {
  it('renders empty and populated wheels, selection and animation cleanup', () => {
    const onSegmentClick = jest.fn();
    const { rerender } = render(<Turntable restaurants={[]} selectedIndex={-1} isSpinning={false} rotation={0} spinDuration={3000} />);
    expect(screen.getByText('暂无选项')).toBeInTheDocument();
    const animate = jest.fn(() => ({ cancel: jest.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    rerender(<Turntable restaurants={[makeRestaurant(), makeRestaurant({ id: 'r2', name: '第二家' })]} customOptions={[custom]} selectedIndex={1} isSpinning={false} rotation={90} spinDuration={4000} onSegmentClick={onSegmentClick} />);
    expect(screen.getByRole('img', { name: '餐厅转盘' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/第二家/));
    expect(onSegmentClick).toHaveBeenCalledWith(1);
    rerender(<Turntable restaurants={[makeRestaurant()]} selectedIndex={-1} isSpinning rotation={180} spinDuration={3000} />);
    expect(animate).toHaveBeenCalled();
  });

  it('handles segment click and keyboard activation in selected/unselected forms', () => {
    const onClick = jest.fn();
    const { rerender } = render(<svg><TurntableSegment index={0} name="长餐厅名称" cuisineType="川菜" color="#fff" isSelected={false} hasSelection={false} totalSegments={2} onClick={onClick} /></svg>);
    const segment = screen.getByRole('button');
    fireEvent.click(segment);
    fireEvent.keyDown(segment, { key: 'Enter' });
    fireEvent.keyDown(segment, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(3);
    rerender(<svg><TurntableSegment index={1} name="短" cuisineType="自定义" color="#000" isSelected hasSelection totalSegments={1} /></svg>);
    expect(document.querySelector('g[aria-label*="已选中"]')).toBeInTheDocument();
    render(<TurntablePointer />);
  });

  it('shows spin and result controls with optional callbacks', () => {
    const callbacks = { onSpin: jest.fn(), onRemove: jest.fn(), onRetry: jest.fn(), onShare: jest.fn() };
    const { rerender } = render(<TurntableControls isSpinning={false} selectedOption={null} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '开始转动' }));
    expect(callbacks.onSpin).toHaveBeenCalled();
    rerender(<TurntableControls isSpinning selectedOption={null} {...callbacks} />);
    expect(screen.getByRole('button', { name: '转动中' })).toBeDisabled();
    rerender(<TurntableControls isSpinning={false} selectedOption={makeRestaurant()} {...callbacks} />);
    for (const name of ['再来一次', '分享转盘', '不想去这家']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.getByText(/就决定是/)).toBeInTheDocument();
  });
});

describe('history and manager components', () => {
  it('renders history stats for empty and populated lists', () => {
    const empty = { totalRecords: 0, totalRestaurants: 0, mostVisited: [], favoriteCuisines: [], recentDays: 0, averageRestaurantsPerRecord: 0 };
    const { rerender } = render(<HistoryStats stats={empty} />);
    expect(screen.getAllByText('暂无数据')).toHaveLength(2);
    rerender(<HistoryStats stats={{ ...empty, totalRecords: 3, totalRestaurants: 2, recentDays: 4, averageRestaurantsPerRecord: 2, mostVisited: [{ name: 'A', count: 3 }, { name: 'B', count: 2 }, { name: 'C', count: 1 }, { name: 'D', count: 1 }], favoriteCuisines: [{ cuisine: '川菜', count: 3 }, { cuisine: '粤菜', count: 2 }, { cuisine: '日料', count: 1 }, { cuisine: '火锅', count: 1 }] }} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('火锅')).toBeInTheDocument();
  });

  it('renders restaurant and custom history details and reuse callback', () => {
    const onReuse = jest.fn();
    const selected = makeRestaurant({ distance: 500, rating: 4.5, averagePrice: 80, phone: '10086', openingHours: '全天' });
    const record: TurntableRecord = { id: 'record', timestamp: Date.now(), query: '晚餐', location, restaurants: [selected, makeRestaurant({ id: 'other', name: '其他' })], customOptions: [custom], selected };
    const { rerender } = render(<HistoryDetail record={record} onReuse={onReuse} />);
    fireEvent.click(screen.getByRole('button', { name: '重新使用' }));
    expect(onReuse).toHaveBeenCalledWith(record);
    expect(screen.getAllByText('500m').length).toBeGreaterThan(0);
    const customRecord = { ...record, selected: custom };
    rerender(<HistoryDetail record={customRecord} />);
    expect(screen.getAllByText('自定义选项').length).toBeGreaterThan(0);
  });

  it('manages candidates, removed items, custom text and search results', async () => {
    (searchRestaurants as jest.Mock).mockResolvedValueOnce([makeRestaurant({ id: 'found', name: '搜索到' })]);
    const callbacks = {
      onClose: jest.fn(), onRestoreRestaurant: jest.fn(), onAddFromCandidates: jest.fn(), onRemoveToCandidates: jest.fn(),
      onAddCustomOption: jest.fn(), onRemoveCustomOption: jest.fn(), onAddRestaurant: jest.fn(),
    };
    render(<TurntableManager isOpen restaurants={[makeRestaurant()]} customOptions={[custom]} candidateRestaurants={[makeRestaurant({ id: 'candidate', name: '候补' })]} removedRestaurants={[makeRestaurant({ id: 'removed', name: '已移除' })]} userLocation={location} {...callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    expect(callbacks.onRemoveToCandidates).toHaveBeenCalled();
    expect(callbacks.onRemoveCustomOption).toHaveBeenCalledWith('c1');
    expect(callbacks.onAddFromCandidates).toHaveBeenCalled();
    expect(callbacks.onRestoreRestaurant).toHaveBeenCalled();

    const input = screen.getByPlaceholderText('输入餐厅名称…');
    fireEvent.change(input, { target: { value: '新选项' } });
    fireEvent.click(screen.getByRole('button', { name: '直接添加「新选项」为选项' }));
    expect(callbacks.onAddCustomOption).toHaveBeenCalledWith(expect.objectContaining({ name: '新选项', isCustom: true }));
    fireEvent.change(input, { target: { value: '搜索到' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(screen.getByText('搜索到')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /搜索到/ })[0]);
    expect(callbacks.onAddRestaurant).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(callbacks.onClose).toHaveBeenCalled();
  });
});
