import { fireEvent, render, screen } from '@testing-library/react';
import { LegacyLoadingSteps, LoadingSteps } from '@/components/LoadingSteps';
import type { SearchProgress } from '@/hooks/useRestaurantSearch';

describe('LoadingSteps', () => {
  it('renders a clarification question only once', () => {
    const question = '你具体想吃什么菜、菜系或餐厅类型？';

    render(
      <LoadingSteps
        progress={{
          status: 'question',
          message: question,
          question: {
            sessionId: 'session-1',
            question,
            allowFreeText: true,
          },
        }}
      />
    );

    expect(screen.getByText('补充需求')).toBeInTheDocument();
    expect(screen.getAllByText(question)).toHaveLength(1);
  });

  it('submits option ids and trimmed free text while guarding invalid/replying input', async () => {
    const onQuestionReply = jest.fn(async () => undefined);
    const progress: SearchProgress = {
      status: 'question',
      message: '请补充',
      questionRound: 3,
      question: {
        sessionId: 's1',
        question: '选一种',
        options: [
          { id: 'a', label: '选项 A' },
          { id: 'b', label: '选项 B' },
          { id: 'c', label: '选项 C' },
        ],
        allowFreeText: true,
      },
    };
    const view = render(<LoadingSteps progress={progress} onQuestionReply={onQuestionReply} />);
    fireEvent.click(screen.getByText('选项 B'));
    expect(onQuestionReply).toHaveBeenCalledWith({ optionId: 'b' });
    const input = screen.getByPlaceholderText(/直接说菜品/);
    fireEvent.change(input, { target: { value: '  粤菜  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onQuestionReply).toHaveBeenCalledWith({ text: '粤菜' });
    expect(screen.getByText(/已经问了 3 轮/)).toBeInTheDocument();

    view.rerender(<LoadingSteps progress={progress} onQuestionReply={onQuestionReply} isReplying />);
    fireEvent.click(screen.getByText('选项 A'));
    expect(onQuestionReply).toHaveBeenCalledTimes(2);
    fireEvent.submit(screen.getByPlaceholderText(/直接说菜品/).closest('form')!);
    expect(onQuestionReply).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['idle', '准备中'],
    ['thinking', '分析需求'],
    ['searching', '搜索中'],
    ['filtering', '筛选结果'],
    ['done', '完成'],
    ['error', '出错'],
  ] as const)('renders %s status labels', (status, label) => {
    render(<LoadingSteps progress={{ status, message: `${status} message`, total: status === 'done' ? 2 : undefined }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(`${status} message`)).toBeInTheDocument();
  });

  it('renders search rounds, stages, target progress and capped live results', () => {
    const restaurants = Array.from({ length: 10 }, (_, index) => ({
      id: `r${index}`,
      name: `餐厅 ${index}`,
      cuisineType: '川菜',
      distance: index === 0 ? 500 : index === 1 ? 1500 : undefined,
      address: '地址',
      location: { lat: 1, lng: 2 },
      source: 'amap' as const,
    }));
    const view = render(<LoadingSteps progress={{
      status: 'searching', message: '搜索', currentKeywords: ['火锅', '串串'], round: 2,
      maxRounds: 4, total: 6, targetCount: 8, currentStage: 'synonym', foundRestaurants: restaurants,
    }} />);
    expect(screen.getByText('第 2/4 轮搜索')).toBeInTheDocument();
    expect(screen.getByText(/已找到 6 家/)).toHaveTextContent('目标 8 家');
    expect(screen.getByText('近似搜索')).toBeInTheDocument();
    expect(screen.getByText('500m')).toBeInTheDocument();
    expect(screen.getByText('1.5km')).toBeInTheDocument();
    expect(screen.getByText('还有 2 家…')).toBeInTheDocument();

    view.rerender(<LoadingSteps progress={{ status: 'filtering', message: '筛选', round: 1, total: 0, currentStage: 'fallback', foundRestaurants: [] }} />);
    expect(screen.getByText('第 1 轮搜索')).toBeInTheDocument();
    expect(screen.getByText('通用搜索')).toBeInTheDocument();
    expect(screen.queryByText(/已找到/)).not.toBeInTheDocument();
  });

  it('supports question option grid sizes and hides result list after completion', () => {
    const baseQuestion = { sessionId: 's', question: '选择', allowFreeText: false };
    const view = render(<LoadingSteps progress={{ status: 'question', message: 'different', question: { ...baseQuestion, options: [{ id: '1', label: '一' }, { id: '2', label: '二' }] } }} />);
    expect(screen.getByText('different')).toBeInTheDocument();
    expect(screen.getByText('一').closest('.grid')).toHaveClass('grid-cols-2');
    view.rerender(<LoadingSteps progress={{ status: 'question', message: 'q', question: { ...baseQuestion, options: [{ id: '1', label: '一' }, { id: '2', label: '二' }, { id: '3', label: '三' }, { id: '4', label: '四' }] } }} />);
    expect(screen.getByText('四').closest('.grid')).toHaveClass('grid-cols-2');
    view.rerender(<LoadingSteps progress={{ status: 'done', message: '完成', total: 0, foundRestaurants: [{ id: 'x', name: '不显示', cuisineType: '菜', address: '', location: { lat: 0, lng: 0 }, source: 'amap' }] }} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('不显示')).not.toBeInTheDocument();
  });

  it('maps legacy steps and default/custom messages', () => {
    const view = render(<LegacyLoadingSteps step={1} />);
    expect(screen.getByText('分析您的口味偏好…')).toBeInTheDocument();
    view.rerender(<LegacyLoadingSteps step={2} />);
    expect(screen.getByText('查找符合条件的餐厅…')).toBeInTheDocument();
    view.rerender(<LegacyLoadingSteps step={2} message="自定义消息" />);
    expect(screen.getByText('自定义消息')).toBeInTheDocument();
  });
});
