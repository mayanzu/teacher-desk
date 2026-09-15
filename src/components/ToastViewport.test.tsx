import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../context/ToastContext';
import { ToastViewport } from './ToastViewport';

function Trigger() {
  const { notify } = useToast();
  return <button type="button" onClick={() => notify('已保存')}>触发</button>;
}

describe('ToastViewport', () => {
  it('applies the visible class only while a message is present', () => {
    const { container } = render(
      <ToastProvider>
        <Trigger />
        <ToastViewport />
      </ToastProvider>,
    );
    const toast = container.querySelector('.toast');
    if (!toast) throw new Error('toast element missing');
    expect(toast.classList.contains('is-visible')).toBe(false);

    fireEvent.click(screen.getByRole('button'));
    expect(toast.textContent).toBe('已保存');
    expect(toast.classList.contains('is-visible')).toBe(true);
    expect(toast.classList.contains('show')).toBe(false);
  });
});
