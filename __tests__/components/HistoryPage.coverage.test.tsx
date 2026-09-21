import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HistoryPage } from '@/components/HistoryPage';
import type { CustomOption, Restaurant, TurntableRecord } from '@/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/components/layout', () => ({ Layout: ({ children, onHistoryClick }: { children: React.ReactNode; onHistoryClick: () => void }) => <div data-testid="layout"><button data-testid="back-home" onClick={onHistoryClick}>back</button>{children}</div> }));
jest.mock('@/components/ui', () => ({
  Card: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <div data-testid="history-card" onClick={onClick}>{children}</div>,
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Input: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <input data-testid="history-search" value={value} onChange={(e) => onChange(e.target.value)} />,
  Modal: ({ isOpen, onClose, title, children, footer }: { isOpen: boolean; onClose: () => void; title: string; children?: React.ReactNode; footer?: React.ReactNode }) => isOpen ? <div data-testid={`modal-${title}`}><h2>{title}</h2><button data-testid={`modal-close-${title}`} onClick={onClose}>modal close</button>{children}{footer}</div> : null,
}));
jest.mock('@/components/history', () => ({
  HistoryStats: ({ stats }: { stats: { totalRecords: number } }) => <div data-testid="stats">stats:{stats.totalRecords}</div>,
  HistoryDetail: ({ onReuse }: { onReuse: (record: TurntableRecord) => void; record: TurntableRecord }) => <button data-testid="reuse" onClick={() => onReuse({} as TurntableRecord)}>reuse</button>,
}));

jest.mock('@/lib/storage', () => ({
  getRecordsByDate: jest.fn(),
  searchHistory: jest.fn(),
  clearRecords: jest.fn(),
  deleteRecord: jest.fn(),
  getStats: jest.fn(),
  exportHistory: jest.fn(),
  importHistory: jest.fn(),
  setReuseRecord: jest.fn(),
}));

const storage = jest.requireMock('@/lib/storage') as Record<string, jest.Mock>;
const restaurant = (id: string, name = `餐厅${id}`): Restaurant => ({ id, name, cuisineType: id === 'custom' ? '菜' : '川菜', distance: id === 'near' ? 500 : 1500, address: '地址', location: { lat: 1, lng: 2 }, source: 'amap' });
const custom: CustomOption = { id: 'custom', name: '自定义晚餐', isCustom: true };

function record(id: string, timestamp: number, selected: Restaurant | CustomOption = restaurant(id)): TurntableRecord {
  return { id, timestamp, query: `查询${id}`, location: { lat: 1, lng: 2 }, restaurants: [restaurant(id), restaurant('near')], customOptions: selected === custom ? [custom] : [], selected };
}

describe('HistoryPage', () => {
  let grouped: Array<{ date: string; timestamp: number; records: TurntableRecord[] }>;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    const now = Date.now();
    const records = Array.from({ length: 25 }, (_, i) => record(`r${i}`, now - i * 24 * 60 * 60 * 1000));
    records[0] = record('near', now, restaurant('near'));
    records[1] = record('custom', now - 24 * 60 * 60 * 1000, custom);
    records[2] = record('week', now - 3 * 24 * 60 * 60 * 1000);
    records[3] = record('old', now - 10 * 24 * 60 * 60 * 1000);
    grouped = [
      { date: '今天', timestamp: now, records: records.slice(0, 10) },
      { date: '更早', timestamp: now - 10 * 24 * 60 * 60 * 1000, records: records.slice(10) },
    ];
    storage.getRecordsByDate.mockReturnValue(grouped);
    storage.searchHistory.mockImplementation((_keyword: string) => records.slice(0, 3));
    storage.getStats.mockReturnValue({ totalRecords: records.length, totalRestaurants: 3, mostVisited: [], favoriteCuisines: [], recentDays: 10, averageRestaurantsPerRecord: 2 });
    storage.exportHistory.mockReturnValue('{"records":[]}');
    storage.importHistory.mockReturnValue(undefined);
    URL.createObjectURL = jest.fn(() => 'blob:test');
    URL.revokeObjectURL = jest.fn();
    Object.defineProperty(window, 'confirm', { configurable: true, value: jest.fn(() => true) });
    Object.defineProperty(window, 'alert', { configurable: true, value: jest.fn() });
  });

  it('renders records, filters, pagination, stats, detail reuse and delete', async () => {
    render(<HistoryPage />);
    expect(screen.getByText('历史记录')).toBeInTheDocument();
    expect(screen.getAllByTestId('history-card')).toHaveLength(10);
    fireEvent.click(screen.getByText('查看统计'));
    expect(screen.getByTestId('stats')).toBeInTheDocument();
    fireEvent.click(screen.getByText('隐藏统计'));
    fireEvent.change(screen.getByTestId('history-search'), { target: { value: '查询1' } });
    await waitFor(() => expect(storage.searchHistory).toHaveBeenCalledWith('查询1'));
    fireEvent.change(screen.getByTestId('history-search'), { target: { value: '' } });
    fireEvent.click(screen.getByText('下一页'));
    expect(screen.getAllByTestId('history-card').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('上一页'));
    fireEvent.click(screen.getAllByTestId('history-card')[0]);
    expect(screen.getByTestId('modal-历史记录详情')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reuse'));
    expect(storage.setReuseRecord).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/');

    fireEvent.click(screen.getAllByTestId('history-card')[0]);
    const deleteButtons = screen.getAllByRole('button', { name: '删除记录' });
    fireEvent.click(deleteButtons[0]);
    expect(storage.deleteRecord).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('back-home'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('exports/imports data and confirms clearing history', async () => {
    let createdInput: HTMLInputElement | null = null;
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'input') createdInput = element as HTMLInputElement;
      return element;
    }) as typeof document.createElement);
    render(<HistoryPage />);
    fireEvent.click(screen.getByText('导出'));
    expect(URL.createObjectURL).toHaveBeenCalled();
    fireEvent.click(screen.getByText('导入'));
    const file = { text: jest.fn(async () => '{"records":[]}') };
    await createdInput!.onchange!({ target: { files: [file] } } as unknown as Event);
    expect(storage.importHistory).toHaveBeenCalledWith('{"records":[]}');
    expect(window.alert).toHaveBeenCalledWith('导入成功');

    fireEvent.click(screen.getByText('清空历史'));
    expect(screen.getByTestId('modal-确认清空')).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    fireEvent.click(screen.getByText('清空历史'));
    fireEvent.click(screen.getAllByText('确认清空').find((node) => node.tagName === 'BUTTON')!);
    expect(storage.clearRecords).toHaveBeenCalled();
  });

  it('covers empty and failed import/export states', async () => {
    storage.exportHistory.mockImplementation(() => { throw new Error('export'); });
    const view = render(<HistoryPage />);
    fireEvent.click(screen.getByText('导出'));
    expect(window.alert).toHaveBeenCalledWith('导出失败');
    view.unmount();
    storage.getRecordsByDate.mockReturnValue([]);
    storage.getStats.mockReturnValue({ totalRecords: 0, totalRestaurants: 0, mostVisited: [], favoriteCuisines: [], recentDays: 0, averageRestaurantsPerRecord: 0 });
    const emptyView = render(<HistoryPage />);
    expect(screen.getByText('暂无历史记录')).toBeInTheDocument();
    fireEvent.click(screen.getByText('开始选择'));
    expect(mockPush).toHaveBeenCalledWith('/');
    fireEvent.click(screen.getByText('导入'));
    expect(emptyView.container).toBeTruthy();
  });
});
