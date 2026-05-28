import { render, screen } from '@testing-library/react';
import { LoadingSteps } from '@/components/LoadingSteps';

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
});
