import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ClipboardList } from './Icons';

const STORAGE_KEY = 'teacher-desk:memo:v2';
const LEGACY_KEY = 'teacher-desk:memo';
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

function loadNotes(): MemoNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(normalize).filter((note): note is MemoNote => note !== null);
      }
    }
    // 旧版单条备忘录迁移成一张便利贴
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && legacy.trim()) return [{ id: uid(), text: legacy, color: 0, done: false }];
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

export function MemoPanel() {
  const [notes, setNotes] = useState<MemoNote[]>(loadNotes);
  const [draft, setDraft] = useState('');
  const [tearing, setTearing] = useState<string[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* 本地存储不可用时忽略 */
      }
    }, 400);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [notes]);

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
    setTearing((list) => [...list, id]);
    window.setTimeout(() => {
      setNotes((list) => list.filter((note) => note.id !== id));
      setTearing((list) => list.filter((item) => item !== id));
    }, 340);
  };

  return (
    <section className="memo-panel" aria-label="便利贴">
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
          <button type="submit" disabled={!draft.trim()}>
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
