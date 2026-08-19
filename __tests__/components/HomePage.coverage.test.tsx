import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HomePage } from '@/components/HomePage';
import { initialState } from '@/context/AppReducer';
import type { AppState, CustomOption, Restaurant } from '@/types';

const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockRouterPush }) }));

jest.mock('@/hooks', () => ({
  useAppState: jest.fn(),
  useLocation: jest.fn(),
  useRestaurantSearch: jest.fn(),
  useTurntable: jest.fn(),
  useMediaQuery: jest.fn(),
  useErrorAlert: jest.fn(),
}));

jest.mock('@/components/layout', () => ({
  Layout: ({ children, leftPanel, rightPanel, onHistoryClick }: { children?: React.ReactNode; leftPanel?: React.ReactNode; rightPanel?: React.ReactNode; onHistoryClick?: () => void }) => (
    <div data-testid="layout"><button data-testid="history-link" onClick={onHistoryClick}>history</button>{children}{leftPanel}{rightPanel}</div>
  ),
}));

jest.mock('@/components/input', () => ({
  SearchPanel: (props: Record<string, (...args: never[]) => unknown>) => (
    <div data-testid="search-panel">
      <button data-testid="query-change" onClick={() => props.onQueryChange('火锅')}>query</button>
      <button data-testid="location-change" onClick={() => props.onLocationChange({ lat: 1, lng: 2, address: '上海' })}>location</button>
      <button data-testid="location-clear" onClick={() => props.onLocationChange(null)}>clear location</button>
      <button data-testid="auto-locate" onClick={() => props.onAutoLocate()}>auto</button>
      <button data-testid="manual-address" onClick={() => props.onManualAddressSubmit('南京路')}>manual</button>
      <button data-testid="search-submit" onClick={() => props.onSearch()}>search</button>
    </div>
  ),
}));

jest.mock('@/components/turntable', () => ({
  Turntable: (props: { onSegmentClick: (index: number) => void }) => (
    <div data-testid="turntable"><button data-testid="segment-restaurant" onClick={() => props.onSegmentClick(0)}>segment restaurant</button><button data-testid="segment-custom" onClick={() => props.onSegmentClick(3)}>segment custom</button></div>
  ),
  TurntableControls: (props: { onSpin: () => void; onRemove: () => void; onRetry: () => void; onShare: () => void }) => (
    <div data-testid="turntable-controls"><button data-testid="spin" onClick={props.onSpin}>spin</button><button data-testid="remove" onClick={props.onRemove}>remove</button><button data-testid="retry" onClick={props.onRetry}>retry</button><button data-testid="share" onClick={props.onShare}>share</button></div>
  ),
  TurntableManager: (props: { isOpen: boolean; onClose: () => void; onRestoreRestaurant: (i: number) => void; onAddFromCandidates: (i: number) => void; onRemoveToCandidates: (i: number) => void; onAddCustomOption: (o: CustomOption) => void; onRemoveCustomOption: (id: string) => void; onAddRestaurant: (r: Restaurant) => void }) => (
    <div data-testid="manager" data-open={props.isOpen ? 'true' : 'false'}><button data-testid="manager-close" onClick={props.onClose}>manager close</button><button data-testid="restore" onClick={() => props.onRestoreRestaurant(0)}>restore</button><button data-testid="candidate-add" onClick={() => props.onAddFromCandidates(0)}>candidate</button><button data-testid="candidate-remove" onClick={() => props.onRemoveToCandidates(0)}>candidate remove</button><button data-testid="custom-add" onClick={() => props.onAddCustomOption({ id: 'new', name: 'new', isCustom: true })}>custom add</button><button data-testid="custom-remove" onClick={() => props.onRemoveCustomOption('new')}>custom remove</button><button data-testid="restaurant-add" onClick={() => props.onAddRestaurant({ id: 'new-r', name: 'new', cuisineType: '菜', address: '', location: { lat: 0, lng: 0 }, source: 'amap' })}>restaurant add</button></div>
  ),
}));

jest.mock('@/components/restaurant', () => ({
  RestaurantCard: (props: { onRemove: () => void; onShare: () => void; onClose: () => void }) => <div data-testid="restaurant-card"><button data-testid="card-remove" onClick={props.onRemove}>card remove</button><button data-testid="card-share" onClick={props.onShare}>card share</button><button data-testid="card-close" onClick={props.onClose}>card close</button></div>,
}));

jest.mock('@/components/map', () => ({ Map: () => <div data-testid="map" /> }));
jest.mock('@/components/LoadingSteps', () => ({ LoadingSteps: (props: { onQuestionReply: (value: string) => void }) => <button data-testid="question-reply" onClick={() => props.onQuestionReply('answer')}>loading</button> }));
jest.mock('@/components/share', () => ({ ShareModal: (props: { onClose: () => void }) => <div data-testid="share-modal"><button data-testid="share-close" onClick={props.onClose}>share close</button></div> }));
jest.mock('@/components/ui', () => ({
  ErrorMessage: (props: { onAction: () => void }) => <button data-testid="error-back" onClick={props.onAction}>error back</button>,
  ErrorAlert: (props: { onClose: () => void; onAction?: () => void }) => <div data-testid="error-alert"><button data-testid="alert-close" onClick={props.onClose}>alert close</button>{props.onAction && <button data-testid="alert-action" onClick={props.onAction}>alert action</button>}</div>,
  BottomSheet: ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => isOpen ? <div data-testid="bottom-sheet"><button data-testid="sheet-close" onClick={onClose}>sheet close</button>{children}</div> : null,
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/lib/storage', () => ({ saveRecordAndReplaceSameSession: jest.fn(), getReuseRecord: jest.fn(() => null) }));
jest.mock('@/lib/share', () => ({ getShareParamFromUrl: jest.fn(() => null), parseShareData: jest.fn(), clearShareParamFromUrl: jest.fn() }));

const hooks = jest.requireMock('@/hooks') as Record<string, jest.Mock>;
const storage = jest.requireMock('@/lib/storage') as Record<string, jest.Mock>;
const share = jest.requireMock('@/lib/share') as Record<string, jest.Mock>;

const restaurant = (id: string, name = `餐厅${id}`): Restaurant => ({ id, name, cuisineType: '川菜', address: '地址', distance: 500, rating: 4.5, location: { lat: 1, lng: 2 }, source: 'amap' });
const custom: CustomOption = { id: 'custom', name: '在家做饭', isCustom: true };

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...initialState, userQuery: '晚餐', userLocation: { lat: 1, lng: 2, address: '上海' }, restaurants: [restaurant('1'), restaurant('2'), restaurant('3')], ...overrides };
}

function configure(overrides: Partial<AppState> = {}, desktop = false) {
  const appState = state(overrides);
  const dispatch = jest.fn();
  const setLocation = jest.fn();
  const setStep = jest.fn();
  hooks.useAppState.mockReturnValue({ state: appState, setQuery: jest.fn(), setLocation, setStep, deleteRestaurant: jest.fn(), restoreRestaurant: jest.fn(), addFromCandidates: jest.fn(), removeToCandidates: jest.fn(), addRestaurant: jest.fn(), addCustomOption: jest.fn(), removeCustomOption: jest.fn(), reset: jest.fn(), dispatch });
  hooks.useLocation.mockReturnValue({ location: null, getAutoLocation: jest.fn(async () => ({ lat: 9, lng: 9 })), isLocating: false, error: null, geocodeAddress: jest.fn(async () => ({ lat: 8, lng: 8 })), clearLocation: jest.fn() });
  hooks.useRestaurantSearch.mockReturnValue({ search: jest.fn(async (_q: string, _l: unknown, onError: (code: string) => void) => onError('NETWORK_ERROR')), answerQuestion: jest.fn(), isSearching: false, progress: 42 });
  hooks.useTurntable.mockReturnValue({ rotation: 0, selectedIndex: appState.selectedIndex, isSpinning: false, spinDuration: 3000, startSpin: jest.fn(), reset: jest.fn() });
  hooks.useMediaQuery.mockReturnValue(desktop);
  hooks.useErrorAlert.mockReturnValue({ isOpen: false, errorInfo: null, show: jest.fn(), close: jest.fn(), onAction: undefined });
  return { appState, dispatch };
}

describe('HomePage orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.getReuseRecord.mockReturnValue(null);
    share.getShareParamFromUrl.mockReturnValue(null);
    share.parseShareData.mockReset();
  });

  it('renders input/loading/error states and wires location/search actions', async () => {
    configure({ step: 'INPUT', userQuery: '', userLocation: null });
    const view = render(<HomePage />);
    expect(screen.getByTestId('search-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('search-submit')); // guarded without query/location
    fireEvent.click(screen.getByTestId('query-change'));
    fireEvent.click(screen.getByTestId('location-change'));
    fireEvent.click(screen.getByTestId('location-clear'));
    fireEvent.click(screen.getByTestId('auto-locate'));
    fireEvent.click(screen.getByTestId('manual-address'));
    await waitFor(() => expect(hooks.useLocation().getAutoLocation).toHaveBeenCalled());

    hooks.useAppState.mockReturnValue({ ...hooks.useAppState.mock.results[0].value, state: state({ step: 'SEARCHING' }) });
    view.rerender(<HomePage />);
    fireEvent.click(screen.getByTestId('question-reply'));
    hooks.useAppState.mockReturnValue({ ...hooks.useAppState.mock.results[0].value, state: state({ step: 'ERROR', error: '失败' }) });
    view.rerender(<HomePage />);
    fireEvent.click(screen.getByTestId('error-back'));
    expect(hooks.useAppState.mock.results.at(-1)?.value.setStep).toHaveBeenCalledWith('INPUT');
  });

  it('handles share/reuse effects and mobile result interactions', async () => {
    const reused = { query: '旧查询', location: { lat: 3, lng: 4 }, restaurants: [restaurant('old')], customOptions: [custom] };
    storage.getReuseRecord.mockReturnValue(reused);
    share.getShareParamFromUrl.mockReturnValue('bad');
    share.parseShareData.mockReturnValue(null);
    configure({ step: 'READY', agentExplanation: '说明', agentUnmetConstraints: ['约束'], agentTrace: [{ type: 'search', message: '查找', createdAt: 1 }] });
    const view = render(<HomePage />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(storage.getReuseRecord).toHaveBeenCalled();
    const clickFirst = (id: string) => fireEvent.click(screen.getAllByTestId(id)[0]);
    clickFirst('segment-restaurant');
    fireEvent.click(screen.getByTestId('card-share'));
    fireEvent.click(screen.getByTestId('share-close'));
    clickFirst('segment-custom');
    fireEvent.click(screen.getAllByText('查看搜索过程')[0]);
    fireEvent.click(screen.getByTestId('history-link'));
    expect(mockRouterPush).toHaveBeenCalledWith('/history');
    fireEvent.click(screen.getByTestId('manager-close'));
    fireEvent.click(screen.getByTestId('restore'));
    fireEvent.click(screen.getByTestId('candidate-add'));
    fireEvent.click(screen.getByTestId('candidate-remove'));
    fireEvent.click(screen.getByTestId('custom-add'));
    fireEvent.click(screen.getByTestId('custom-remove'));
    fireEvent.click(screen.getByTestId('restaurant-add'));
    clickFirst('retry');
    clickFirst('remove');
    clickFirst('spin');
    fireEvent.click(screen.getAllByRole('button', { name: '返回搜索页' })[0]);

    share.getShareParamFromUrl.mockReturnValue('good');
    share.parseShareData.mockReturnValue({ query: '分享', restaurants: [restaurant('s')], customOptions: [] });
    view.rerender(<HomePage />);
    await waitFor(() => expect(share.clearShareParamFromUrl).toHaveBeenCalled());
  });

  it('covers desktop focus, result persistence and custom-option removal paths', async () => {
    configure({ step: 'RESULT', selectedIndex: 3, customOptions: [custom], agentTrace: [{ type: 'done', createdAt: 1 }] }, true);
    const view = render(<HomePage />);
    fireEvent.click(screen.getByTestId('segment-restaurant'));
    fireEvent.click(screen.getByTestId('segment-custom'));
    fireEvent.click(screen.getByTestId('share'));
    fireEvent.click(screen.getByTestId('share-close'));
    fireEvent.click(screen.getByTestId('remove'));
    fireEvent.click(screen.getByTestId('retry'));
    fireEvent.click(screen.getByRole('button', { name: '管理选项' }));
    fireEvent.click(screen.getByTestId('manager-close'));

    hooks.useAppState.mockReturnValue({ ...hooks.useAppState.mock.results[0].value, state: state({ step: 'SPINNING', selectedIndex: -1 }) });
    view.rerender(<HomePage />);
    hooks.useAppState.mockReturnValue({ ...hooks.useAppState.mock.results[0].value, state: state({ step: 'RESULT', selectedIndex: 0 }) });
    hooks.useTurntable.mockReturnValue({ rotation: 10, selectedIndex: 0, isSpinning: false, spinDuration: 3000, startSpin: jest.fn(), reset: jest.fn() });
    view.rerender(<HomePage />);
    await waitFor(() => expect(storage.saveRecordAndReplaceSameSession).toHaveBeenCalled());
  });
});
