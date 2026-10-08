// Customer AI chatbot service — typed wrapper over POST /api/v1/chat/.
// Backend: Groq-powered dairy assistant with honest demo fallback (demo: true).
// Auth is optional server-side — guests get generic answers.
import { b2cPost } from '../../api/b2cClient';

export interface ChatReply {
  reply: string;
  demo: boolean;
}

/** Ask the dairy assistant. order_id optionally scopes answers to that order. */
export async function askAssistant(message: string, order_id?: string): Promise<ChatReply> {
  return b2cPost<ChatReply>('/api/v1/chat/', {
    message,
    order_id: order_id ?? null,
  });
}
