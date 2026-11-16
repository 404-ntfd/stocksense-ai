import { create } from 'zustand';

export interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'error'; action?: { label: string; run: () => void } }

interface AppState {
  dbReady: boolean;
  dbError: string | null;
  /** Bumped after every data change so screens know to re-query. */
  dataVersion: number;
  online: boolean;
  toasts: Toast[];
  setDbReady: (ok: boolean, err?: string | null) => void;
  bumpData: () => void;
  setOnline: (v: boolean) => void;
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;
export const useApp = create<AppState>((set, get) => ({
  dbReady: false,
  dbError: null,
  dataVersion: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  toasts: [],
  setDbReady: (ok, err = null) => set({ dbReady: ok, dbError: err }),
  bumpData: () => set({ dataVersion: get().dataVersion + 1 }),
  setOnline: (v) => set({ online: v }),
  toast: (text, tone = 'info', action) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, action }] });
    setTimeout(() => get().dismissToast(id), action ? 8000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => useApp.getState().toast(text, tone, action);
