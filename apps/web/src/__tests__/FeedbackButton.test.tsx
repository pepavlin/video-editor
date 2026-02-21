import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedbackButton from '../components/FeedbackButton';

const WEBHOOK_URL = 'https://n8n.pavlin.dev/webhook/c6169b15-e4d2-4515-a059-4f6306819e1c';

describe('FeedbackButton', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }) as Response,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the trigger button', () => {
    render(<FeedbackButton />);
    expect(screen.getByRole('button', { name: /napsat návrh/i })).toBeDefined();
  });

  it('panel is hidden initially', () => {
    render(<FeedbackButton />);
    expect(screen.queryByPlaceholderText(/jak bychom mohli/i)).toBeNull();
  });

  it('opens panel on trigger button click', async () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    expect(screen.getByPlaceholderText(/jak bychom mohli/i)).toBeDefined();
  });

  it('closes panel on second trigger click', () => {
    render(<FeedbackButton />);
    const btn = screen.getByRole('button', { name: /napsat návrh/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByPlaceholderText(/jak bychom mohli/i)).toBeNull();
  });

  it('submit button is disabled when textarea is empty', () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    const submitBtn = screen.getByRole('button', { name: /odeslat návrh/i });
    expect(submitBtn).toHaveProperty('disabled', true);
  });

  it('submit button enables when user types a message', () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    const textarea = screen.getByPlaceholderText(/jak bychom mohli/i);
    fireEvent.change(textarea, { target: { value: 'Přidat tmavý režim' } });
    const submitBtn = screen.getByRole('button', { name: /odeslat návrh/i });
    expect(submitBtn).toHaveProperty('disabled', false);
  });

  it('sends POST request to webhook on submit', async () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    const textarea = screen.getByPlaceholderText(/jak bychom mohli/i);
    fireEvent.change(textarea, { target: { value: 'Lepší export' } });
    fireEvent.click(screen.getByRole('button', { name: /odeslat návrh/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Lepší export' }),
        }),
      );
    });
  });

  it('shows success message after sending', async () => {
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    fireEvent.change(screen.getByPlaceholderText(/jak bychom mohli/i), {
      target: { value: 'Test návrh' },
    });
    fireEvent.click(screen.getByRole('button', { name: /odeslat návrh/i }));

    await waitFor(() => {
      expect(screen.getByText(/návrh byl poslán k implementaci/i)).toBeDefined();
    });
  });

  it('shows error message on failed request', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
    fireEvent.change(screen.getByPlaceholderText(/jak bychom mohli/i), {
      target: { value: 'Failing test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /odeslat návrh/i }));

    await waitFor(() => {
      expect(screen.getByText(/nepodařilo se odeslat/i)).toBeDefined();
    });
  });
});
