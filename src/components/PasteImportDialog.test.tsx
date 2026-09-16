import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PasteImportDialog } from './PasteImportDialog';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});

function setup(open = true, onSave = vi.fn(() => true)) {
  const props = { onClose: vi.fn(), onSave };
  const view = render(<PasteImportDialog {...props} open={open} />);
  return { ...view, props, onSave };
}

describe('PasteImportDialog', () => {
  it('resets its local state when reopened', () => {
    const { rerender, props } = setup(true);
    const input = screen.getByRole('textbox', { name: '粘贴教务处课表' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '周二 1-2 高等数学' } });
    expect(input.value).toBe('周二 1-2 高等数学');

    rerender(<PasteImportDialog {...props} open={false} />);
    rerender(<PasteImportDialog {...props} open={true} />);

    expect((screen.getByRole('textbox', { name: '粘贴教务处课表' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the review step and reports an error when saving fails', () => {
    const onSave = vi.fn(() => false);
    setup(true, onSave);

    fireEvent.click(screen.getByRole('button', { name: '填入示例' }));
    fireEvent.click(screen.getByRole('button', { name: '解析课表' }));
    expect(screen.getByRole('button', { name: '保存并打开' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存并打开' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByText('保存失败，请检查本机存储空间后重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并打开' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument();
  });
});
