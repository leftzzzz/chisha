import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareModal } from '@/components/share/ShareModal';
import type { CustomOption, Restaurant } from '@/types';

jest.mock('@/components/ui', () => {
  const showToast = jest.fn();
  return {
  BottomSheet: ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => (
    isOpen ? <div data-testid="bottom-sheet"><button aria-label="sheet-close" onClick={onClose} />{children}</div> : null
  ),
  Button: ({ children, onClick, disabled, loading }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; loading?: boolean }) => (
    <button onClick={onClick} disabled={disabled} data-loading={loading ? 'true' : 'false'}>{children}</button>
  ),
  useToast: () => ({ showToast }),
  __showToast: showToast,
  };
});

jest.mock('@/lib/share', () => ({
  generateShareUrl: jest.fn(() => 'https://example.test/share?s=abc'),
  generateQRCode: jest.fn(async () => 'data:image/png;base64,qr'),
  copyToClipboard: jest.fn(async () => true),
  downloadImage: jest.fn(),
}));

jest.mock('@/lib/posterCanvas', () => ({
  generatePosterCanvas: jest.fn(async () => 'data:image/png;base64,poster'),
}));

const {
  __showToast: mockShowToast,
} = jest.requireMock('@/components/ui') as { __showToast: jest.Mock };
const {
  generateShareUrl: mockGenerateShareUrl,
  generateQRCode: mockGenerateQRCode,
  copyToClipboard: mockCopyToClipboard,
  downloadImage: mockDownloadImage,
} = jest.requireMock('@/lib/share') as Record<string, jest.Mock>;
const { generatePosterCanvas: mockGeneratePosterCanvas } = jest.requireMock('@/lib/posterCanvas') as { generatePosterCanvas: jest.Mock };

const restaurant: Restaurant = {
  id: 'r1', name: '测试餐厅', cuisineType: '川菜', address: '地址',
  location: { lat: 1, lng: 2 }, source: 'amap',
};
const custom: CustomOption = { id: 'c1', name: '在家做饭', isCustom: true };

function renderModal(overrides: Partial<React.ComponentProps<typeof ShareModal>> = {}) {
  const props: React.ComponentProps<typeof ShareModal> = {
    isOpen: true,
    onClose: jest.fn(),
    query: '晚餐',
    restaurants: [restaurant],
    customOptions: [custom],
    selectedOption: restaurant,
    ...overrides,
  };
  return { ...render(<ShareModal {...props} />), props };
}

describe('ShareModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateQRCode.mockResolvedValue('data:image/png;base64,qr');
    mockGeneratePosterCanvas.mockResolvedValue('data:image/png;base64,poster');
    mockCopyToClipboard.mockResolvedValue(true);
  });

  it('renders mobile loading, generated poster actions and fullscreen preview', async () => {
    const { props } = renderModal();
    expect(screen.getByText('正在生成海报…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText('分享海报')).toBeInTheDocument());
    expect(mockGenerateShareUrl).toHaveBeenCalledWith('晚餐', [restaurant], [custom]);
    expect(mockGenerateQRCode).toHaveBeenCalledWith('https://example.test/share?s=abc', 600);
    expect(mockGeneratePosterCanvas).toHaveBeenCalledWith(expect.objectContaining({ allOptions: [restaurant, custom] }));

    fireEvent.click(screen.getByText('保存海报'));
    expect(mockDownloadImage).toHaveBeenCalledWith('data:image/png;base64,poster', '今天吃啥-测试餐厅.png');
    expect(mockShowToast).toHaveBeenCalledWith('海报已保存', 'success');
    fireEvent.click(screen.getByText('复制链接'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('链接已复制', 'success'));
    const posterImages = screen.getAllByAltText('分享海报');
    fireEvent.click(posterImages[0].parentElement!);
    expect(screen.getAllByAltText('分享海报')[0]).toHaveAttribute('src', 'data:image/png;base64,poster');
    expect(document.querySelector('.fixed.inset-0.z-\\[200\\]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('button', { name: '关闭预览' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows generation failures and copy failures, and supports desktop overlay closing', async () => {
    mockGeneratePosterCanvas.mockRejectedValueOnce(new Error('canvas failed'));
    mockCopyToClipboard.mockResolvedValueOnce(false);
    const onClose = jest.fn();
    renderModal({ isDesktop: true, onClose });
    await waitFor(() => expect(screen.getByText('海报生成失败')).toBeInTheDocument());
    expect(mockShowToast).toHaveBeenCalledWith('生成分享数据失败', 'error');

    fireEvent.click(screen.getByText('保存海报'));
    expect(mockShowToast).toHaveBeenCalledWith('海报生成中，请稍候', 'info');
    fireEvent.click(screen.getByText('复制链接'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('复制失败', 'error'));
    fireEvent.click(document.querySelector('.fixed.inset-0.z-\\[100\\]')!);
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('resets state while closed and handles QR generation failures', async () => {
    mockGenerateQRCode.mockRejectedValueOnce(new Error('qr failed'));
    const { rerender } = renderModal({ isDesktop: false });
    await waitFor(() => expect(screen.getByText('海报生成失败')).toBeInTheDocument());
    rerender(<ShareModal isOpen={false} onClose={jest.fn()} query="" restaurants={[]} customOptions={[]} selectedOption={custom} />);
    expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith('生成分享数据失败', 'error');
  });
});
