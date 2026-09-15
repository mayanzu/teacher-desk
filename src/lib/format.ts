export interface CountdownParts {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
}

export function countdownParts(milliseconds: number): CountdownParts {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(total / 86_400);
  const hours = String(Math.floor((total % 86_400) / 3_600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3_600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return { days, hours, minutes, seconds };
}

export function initials(name: string): string {
  return name.trim().slice(0, 1) || '师';
}

export function joinMeta(parts: Array<string | number | undefined | null>): string {
  return parts.filter(Boolean).join(' · ');
}
