import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ClipboardList } from './Icons';

const STORAGE_KEY = 'teacher-desk:memo:v2';

const COLORS = 6;
const TILTS = ['-2.4deg', '1.8deg', '-1.3deg', '2.6deg', '-2deg', '1.2deg'];

interface MemoNote {
  id: string;
  text: string;
  color: number;
  done: boolean;
}

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(raw: unknown, index: number): MemoNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<MemoNote>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : uid(),
    text: typeof value.text === 'string' ? value.text : '',
    color: Number.isFinite(value.color) ? Math.abs(Number(value.color)) % COLORS : index % COLORS,
    done: Boolean(value.done),
  };
}

function loadNotes(storageKey: string): MemoNote[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalize).filter((note): note is MemoNote => note !== null);
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function tiltOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILTS[hash % TILTS.length];
}

export function MemoPanel({ userId }: { userId: string }) {
  const storageKey = `${STORAGE_KEY}:${encodeURIComponent(userId)}`;
  const [notes, setNotes] = useState<MemoNote[]>(() => loadNotes(storageKey));
  const [draft, setDraft] = useState('');
  const [tearing, setTearing] = useState<string[]>([]);
  const [storageError, setStorageError] = useState('');
  const tearTimers = useRef(new Map<string, number>());
  const tearingRef = useRef<string[]>([]);

  const persist = (list: MemoNote[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
      setStorageError('');
    } catch {
      setStorageError('便利贴无法保存到浏览器，请复制内容备份。');
    }
  };

  useEffect(() => {
    persist(notes.filter((note) => !tearingRef.current.includes(note.id)));
  }, [notes, storageKey]);

  useEffect(
    () => () => {
      for (const timer of tearTimers.current.values()) window.clearTimeout(timer);
      tearTimers.current.clear();
    },
    [],
  );

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes((list) => [...list, { id: uid(), text, color: list.length % COLORS, done: false }]);
    setDraft('');
  };

  const update = (id: string, patch: Partial<MemoNote>) => {
    setNotes((list) => list.map((note) => (note.id === id ? { ...note, ...patch } : note)));
  };

  const tear = (id: string) => {
    if (tearing.includes(id)) return;
    const remaining = notes.filter((note) => note.id !== id);
    persist(remaining);
    tearingRef.current = [...tearingRef.current, id];
    setTearing((list) => [...list, id]);
    const timer = window.setTimeout(() => {
      tearTimers.current.delete(id);
      tearingRef.current = tearingRef.current.filter((item) => item !== id);
      setNotes((list) => list.filter((note) => note.id !== id));
      setTearing((list) => list.filter((item) => item !== id));
    }, 340);
    tearTimers.current.set(id, timer);
  };

  return (
    <section className="memo-panel" aria-label="便利贴">
      {storageError && <p role="alert">{storageError}</p>}
      <div className="memo-board-head">
        <h2>
          <ClipboardList aria-hidden="true" />
          便利贴
        </h2>
        <form
          className="memo-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="写点待办，回车贴上去…"
            aria-label="新建便利贴"
            maxLength={200}
          />
          <button className="kbtn primary" type="submit" disabled={!draft.trim()}>
            贴上
          </button>
        </form>
      </div>

      <div className={'memo-notes' + (notes.length ? '' : ' is-empty')}>
        {notes.length === 0 ? (
          <p className="memo-empty">还没有便利贴，写一条贴到墙上吧。</p>
        ) : (
          notes.map((note, index) => (
            <article
              key={note.id}
              className={
                'sticky' + (note.done ? ' is-done' : '') + (tearing.includes(note.id) ? ' is-tearing' : '')
              }
              data-color={note.color}
              style={{ '--tilt': tiltOf(note.id), '--i': index } as CSSProperties}
            >
              <textarea
                value={note.text}
                onChange={(event) => update(note.id, { text: event.target.value })}
                aria-label="便利贴内容"
                spellCheck={false}
              />
              <div className="sticky-foot">
                <label className="sticky-done">
                  <input
                    type="checkbox"
                    checked={note.done}
                    onChange={(event) => update(note.id, { done: event.target.checked })}
                  />
                  完成
                </label>
                <button className="sticky-tear" type="button" onClick={() => tear(note.id)} title="完成后撕下">
                  撕下
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
