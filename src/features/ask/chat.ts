import { create } from 'zustand';
import type { AskAnswer } from '@/core/ask/pipeline';
import type { ActionCard } from '@/core/ask/actions';
import type { Turn } from '@/core/types';

export type Message =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'pending'; stage: string }
  | { id: number; kind: 'answer'; answer: AskAnswer }
  | { id: number; kind: 'action'; card: ActionCard; status: 'open' | 'done' | 'cancelled'; result?: string }
  | { id: number; kind: 'clarify'; question: string; options: string[] }
  | { id: number; kind: 'error'; code: string; message: string; suggestions: string[] };

type NewMessage = Message extends infer M ? (M extends Message ? Omit<M, 'id'> : never) : never;
interface Chat { messages: Message[]; history: Turn[]; push: (m: NewMessage) => number; update: (id: number, m: Partial<Message>) => void; remove: (id: number) => void; addTurn: (t: Turn) => void; clear: () => void }
let seq = 1;
export const useChat = create<Chat>((set, get) => ({
  messages: [], history: [],
  push: (m) => { const id = seq++; set({ messages: [...get().messages, { ...m, id } as Message].slice(-60) }); return id; },
  update: (id, m) => set({ messages: get().messages.map((x) => (x.id === id ? ({ ...x, ...m } as Message) : x)) }),
  remove: (id) => set({ messages: get().messages.filter((x) => x.id !== id) }),
  addTurn: (t) => set({ history: [...get().history, t].slice(-3) }),
  clear: () => set({ messages: [], history: [] }),
}));
