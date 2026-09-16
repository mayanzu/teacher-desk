import { Clock3, MapPin, Users } from 'lucide-react';
import { countdownParts, joinMeta } from '../lib/format';
import { DAY_NAMES } from '../data/defaults';
import type { CourseInstance } from '../types/schedule';

interface NextClassPanelProps {
  next: CourseInstance | null;
  now: Date;
  todayCount: number;
  weekCount: number;
  weekRange: string;
}

export function NextClassPanel({ next, now, todayCount, weekCount, weekRange }: NextClassPanelProps) {
  const remaining = next ? countdownParts(next.start.getTime() - now.getTime()) : null;
  return (
    <div className="stage reveal is-in" aria-label="下一节课概览">
      <div className="stage-inner">
        <div className="next-card">
          <span className="nb-icon" aria-hidden="true"><Clock3 /></span>
          <div className="nb-body">
            <p className="nb-label">下一节课</p>
            <p className="nb-name">{next?.course.name || '暂无待上课程'}</p>
            <p className="nb-meta">
              {next && (
                <>
                  <span className="meta-item"><Clock3 />{DAY_NAMES[next.course.day]} 第 {next.course.slot} 节</span>
                  <span className="meta-item"><MapPin />{next.course.room}</span>
                  <span className="meta-item"><Users />{next.course.clazz}</span>
                </>
              )}
            </p>
          </div>
          <div className="nb-count">
            <p className="cd-label">距离开课</p>
            <p className="cd-value">
              {remaining ? (
                <>
                  {remaining.days > 0 && <>{remaining.days}<small className="cd-word">天</small></>}
                  {remaining.hours}:{remaining.minutes}:{remaining.seconds}
                </>
              ) : '—'}
            </p>
          </div>
        </div>
        <div className="mini-stack">
          <div className="mini-card">
            <p className="mini-k">今日</p>
            <p className="mini-v">{todayCount} 门</p>
            <p className="mini-s">{joinMeta([DAY_NAMES[now.getDay() || 7], todayCount ? '好好上课' : '轻松一天'])}</p>
          </div>
          <div className="mini-card">
            <p className="mini-k">所选周</p>
            <p className="mini-v">{weekCount} 门次</p>
            <p className="mini-s">{weekRange}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
