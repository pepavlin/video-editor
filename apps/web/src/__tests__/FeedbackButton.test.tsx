import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedbackButton from '../components/FeedbackButton';

const WEBHOOK_URL = 'https://n8n.pavlin.dev/webhook/c6169b15-e4d2-4515-a059-4f6306819e1c';

function mockFetchWithTasks(tasks: object[] = []) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ tasks }), { status: 200 }) as Response,
  );
}

describe('FeedbackButton', () => {
  beforeEach(() => {
    mockFetchWithTasks();
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
    // First call is the initial fetchStats GET on mount — let it succeed.
    // Second call is the POST submit — make it fail.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [] }), { status: 200 }) as Response)
      .mockRejectedValueOnce(new Error('Network error'));
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

  describe('tabs', () => {
    it('shows Návrh and Poslední tasky tabs when panel is open', () => {
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      expect(screen.getByRole('tab', { name: /návrh/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /poslední tasky/i })).toBeDefined();
    });

    it('Návrh tab is active by default', () => {
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      const proposalTab = screen.getByRole('tab', { name: /návrh/i });
      expect(proposalTab.getAttribute('aria-selected')).toBe('true');
    });

    it('switches to tasks tab on click', () => {
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      fireEvent.click(screen.getByRole('tab', { name: /poslední tasky/i }));
      expect(screen.getByRole('tab', { name: /poslední tasky/i }).getAttribute('aria-selected')).toBe('true');
      // proposal textarea should be hidden
      expect(screen.queryByPlaceholderText(/jak bychom mohli/i)).toBeNull();
    });

    it('shows empty state when no tasks', async () => {
      mockFetchWithTasks([]);
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      fireEvent.click(screen.getByRole('tab', { name: /poslední tasky/i }));
      await waitFor(() => {
        expect(screen.getByText(/žádné tasky/i)).toBeDefined();
      });
    });

    it('renders task list with status badges', async () => {
      mockFetchWithTasks([
        { status: 'running', name: 'Zpracování videa', id: '1' },
        { status: 'queued', name: 'Export projektu', id: '2' },
        { status: 'done', name: 'Beat detection', id: '3' },
      ]);
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      fireEvent.click(screen.getByRole('tab', { name: /poslední tasky/i }));

      await waitFor(() => {
        expect(screen.getByText('Zpracování videa')).toBeDefined();
        expect(screen.getByText('Export projektu')).toBeDefined();
        expect(screen.getByText('Beat detection')).toBeDefined();
        expect(screen.getByText('Běží')).toBeDefined();
        expect(screen.getByText('Čeká')).toBeDefined();
        expect(screen.getByText('Hotovo')).toBeDefined();
      });
    });

    it('shows task with fallback label when name is missing', async () => {
      mockFetchWithTasks([{ status: 'running', id: '99' }]);
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      fireEvent.click(screen.getByRole('tab', { name: /poslední tasky/i }));

      await waitFor(() => {
        expect(screen.getByText('Bez názvu')).toBeDefined();
      });
    });

    it('Obnovit button triggers fetch', async () => {
      mockFetchWithTasks([]);
      render(<FeedbackButton />);
      fireEvent.click(screen.getByRole('button', { name: /napsat návrh/i }));
      fireEvent.click(screen.getByRole('tab', { name: /poslední tasky/i }));

      await waitFor(() => screen.getByText(/obnovit/i));
      const fetchCallsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(screen.getByText(/obnovit/i));
      await waitFor(() => {
        expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
      });
    });
  });
});
