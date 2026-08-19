import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { Modal } from '@/components/ui/Modal';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Toast, ToastProvider, useToast } from '@/components/ui/Toast';

describe('basic UI primitives', () => {
  it('renders button variants, sizes, loading and click behavior', () => {
    const onClick = jest.fn();
    const { rerender } = render(<Button onClick={onClick}>Primary</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Primary' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    for (const variant of ['secondary', 'danger', 'success'] as const) {
      for (const size of ['sm', 'md', 'lg'] as const) {
        rerender(<Button variant={variant} size={size} ariaLabel={`${variant}-${size}`}>x</Button>);
        expect(screen.getByRole('button', { name: `${variant}-${size}` })).toBeEnabled();
      }
    }

    rerender(<Button loading onClick={onClick}>Loading</Button>);
    expect(screen.getByRole('button', { name: 'Loading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    rerender(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  });

  it('supports card headers, click keyboard activation and chip variants', () => {
    const onCardClick = jest.fn();
    const { rerender } = render(
      <Card title="Title" subtitle="Subtitle" onClick={onCardClick}>Body</Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Subtitle')).toBeInTheDocument();
    const card = screen.getByRole('button');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onCardClick).toHaveBeenCalledTimes(3);

    const onClose = jest.fn();
    for (const variant of ['default', 'success', 'error', 'warning'] as const) {
      rerender(<Chip label={variant} variant={variant} size="sm" onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: `删除 ${variant}` }));
    }
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('renders input states and emits changed values', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <Input value="abc" onChange={onChange} label="名称" maxLength={10} showCount id="name" />
    );
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith('abcd');
    expect(screen.getByText('3/10')).toBeInTheDocument();

    rerender(<Input value="abc" onChange={onChange} error="无效" maxLength={10} showCount id="name" />);
    expect(screen.getByRole('alert')).toHaveTextContent('无效');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    rerender(<Input value="abc" onChange={onChange} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('renders every loading variant and size', () => {
    const { rerender } = render(<Loading message="加载" />);
    expect(screen.getByRole('status')).toHaveTextContent('加载');
    rerender(<Loading variant="dots" size="sm" />);
    expect(screen.getByRole('status').querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    rerender(<Loading variant="pulse" size="lg" className="extra" />);
    expect(screen.getByRole('status')).toHaveClass('extra');
  });
});

describe('modal, sheet and error surfaces', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('handles modal open/close, escape, overlay policy and focus', () => {
    const onClose = jest.fn();
    const { rerender } = render(<Modal isOpen={false} onClose={onClose}>Hidden</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Modal isOpen onClose={onClose} title="标题" size="xl" footer={<button>保存</button>}>内容</Modal>);
    expect(screen.getByRole('dialog')).toHaveTextContent('内容');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog').querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<Modal isOpen onClose={onClose} closeOnOverlayClick={false}>No overlay close</Modal>);
    fireEvent.click(screen.getByRole('dialog').querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes bottom sheets by overlay, escape and touch/mouse gestures', () => {
    const onClose = jest.fn();
    const { rerender } = render(<BottomSheet isOpen={false} onClose={onClose}>Hidden</BottomSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<BottomSheet isOpen onClose={onClose} maxHeightPercent={70}>Body</BottomSheet>);
    expect(screen.getByRole('dialog')).toHaveTextContent('Body');
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => jest.advanceTimersByTime(300));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<BottomSheet isOpen onClose={onClose} closeOnOverlayClick={false} showHandle={false}>Body</BottomSheet>);
    fireEvent.touchStart(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!, { touches: [{ clientY: 50 }] });
    fireEvent.touchEnd(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!);
    fireEvent.touchStart(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!, { touches: [{ clientY: 10 }] });
    fireEvent.touchMove(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!, { touches: [{ clientY: 150 }] });
    fireEvent.touchEnd(screen.getByRole('dialog').querySelector('div.absolute.bottom-0')!);
    act(() => jest.advanceTimersByTime(300));

    rerender(<BottomSheet isOpen onClose={onClose}>Body</BottomSheet>);
    const handle = screen.getByRole('dialog').querySelector('.cursor-grab')!;
    fireEvent.mouseDown(handle, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 40 });
    fireEvent.mouseUp(window);
    fireEvent.mouseDown(handle, { clientY: 0 });
    fireEvent.mouseMove(window, { clientY: 140 });
    fireEvent.mouseUp(window);
    act(() => jest.advanceTimersByTime(300));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('renders error messages and alert severities with actions', () => {
    const action = jest.fn();
    const dismiss = jest.fn();
    const { rerender } = render(<ErrorMessage error="bad" onAction={action} onDismiss={dismiss} actionLabel="再试" />);
    fireEvent.click(screen.getByRole('button', { name: '再试' }));
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[1]);
    expect(action).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
    rerender(<ErrorMessage error={new Error('exception')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('exception');

    for (const severity of ['error', 'warning', 'info'] as const) {
      rerender(<ErrorAlert isOpen onClose={dismiss} onAction={action} title="标题" message={severity} description="说明" severity={severity} actionLabel="执行" />);
      expect(screen.getByRole('alert')).toHaveTextContent(severity);
      fireEvent.click(screen.getByRole('button', { name: '执行' }));
      fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]);
    }
    rerender(<ErrorAlert isOpen={false} onClose={dismiss} message="hidden" />);
    expect(screen.queryByText('hidden')).toBeNull();
  });
});

describe('toast and error boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });
  afterEach(() => jest.useRealTimers());

  it('shows each toast icon and dismisses automatically', () => {
    const onClose = jest.fn();
    const { rerender } = render(<Toast message="ok" onClose={onClose} duration={100} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ok');
    act(() => jest.advanceTimersByTime(100));
    act(() => jest.advanceTimersByTime(200));
    expect(onClose).toHaveBeenCalled();
    for (const type of ['error', 'info'] as const) {
      rerender(<Toast message={type} type={type} onClose={onClose} />);
      expect(screen.getByRole('alert')).toHaveTextContent(type);
    }
  });

  it('exposes toast context and rejects use outside provider', () => {
    const Consumer = () => {
      const { showToast } = useToast();
      return <button onClick={() => showToast('hello', 'info')}>show</button>;
    };
    render(<ToastProvider><Consumer /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    expect(screen.getByRole('alert')).toHaveTextContent('hello');
    expect(() => render(<Consumer />)).toThrow('useToast must be used within a ToastProvider');
  });

  it('renders the boundary fallback and can reset after an error', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = () => { throw new Error('boom'); };
    render(
      <ErrorBoundary fallback={<div>fallback</div>}><Broken /></ErrorBoundary>
    );
    expect(screen.getByText('fallback')).toBeInTheDocument();
    errorSpy.mockRestore();

    expect(ErrorBoundary.getDerivedStateFromError(new Error('x'))).toEqual({ hasError: true, error: expect.any(Error) });
    const boundary = new ErrorBoundary({ children: <span /> });
    (boundary as unknown as { state: { hasError: boolean; error: Error | null } }).state = {
      hasError: true,
      error: new Error('boom'),
    };
    const setState = jest.spyOn(boundary, 'setState');
    boundary.handleReset();
    expect(setState).toHaveBeenCalledWith({ hasError: false, error: null });
  });
});
