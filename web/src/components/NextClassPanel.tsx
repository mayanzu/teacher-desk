import { memo } from 'react';
import { CalendarDays, Clock3, MapPin, Users } from './Icons';
import {
  DAY_LABELS,
  countdownParts,
  formatHourMinute,
  formatMonthDay,
} from '../lib/schedule';
import type { CourseInstance } from '../types';

interface NextClassPanelProps {
  next: CourseInstance | null;
  now: Date;
  todayLabel: string;
  todayCount: number;
  viewWeek: number;
  viewWeekCount: number;
  weekRange: string;
  current: number | null;
  totalWeeks: number;
}

export const NextClassPanel = memo(function NextClassPanel({
  next,
  now,
  todayLabel,
  todayCount,
  viewWeek,
  viewWeekCount,
  weekRange,
  current,
  totalWeeks,
}: NextClassPanelProps) {
  const live = next ? now.getTime() >= next.start.getTime() && now.getTime() <= next.end.getTime() : false;
  const delta = next ? (live ? next.end.getTime() - now.getTime() : next.start.getTime() - now.getTime()) : 0;
  const remaining = next ? countdownParts(delta) : null;
  const progress = current && totalWeeks > 0 ? Math.min(100, Math.round((current / totalWeeks) * 100)) : 0;

  return (
    <div className="stage" aria-label="下一节课与本周概览">
      <div className="stage-inner">
        <div className={'next-card' + (live ? ' is-live' : '')}>
          <span className="nb-icon" aria-hidden="true">
            <Clock3 />
          </span>
          <div className="nb-body">
            <p className="nb-label">下一节课</p>
            <p className="nb-name">{next?.course.name || '暂无待上课程'}</p>
            <p className="nb-meta">
              {next ? (
                <>
                  <span className="meta-item">
                    <Clock3 aria-hidden="true" />
                    {formatMonthDay(next.start)} {DAY_LABELS[next.course.day]} · {formatHourMinute(next.start)}–{formatHourMinute(next.end)}
                  </span>
                  <span className="meta-item">
                    <MapPin aria-hidden="true" />
                    {next.course.room || '教室待定'}
                  </span>
                  <span className="meta-item">
                    <Users aria-hidden="true" />
                    {next.course.clazz || '班级待定'}
                    {next.course.count ? ` · ${next.course.count} 人` : ''}
                  </span>
                  <span className="meta-item is-muted">
                    <CalendarDays aria-hidden="true" />
                    第 {next.week} 周
                  </span>
                </>
              ) : (
                <span className="meta-item is-muted">本学期暂无后续课程安排</span>
              )}
            </p>
          </div>
          {next && remaining && (
            <div className="nb-count">
              <p className="cd-label">{live ? '进行中' : '距离开课'}</p>
              <p className="cd-value">
                {live ? (
                  <>
                    剩余 {remaining.hours === '00' ? '' : `${remaining.hours}:`}
                    {remaining.minutes}:{remaining.seconds}
                  </>
                ) : (
                  <>
                    {remaining.days > 0 && (
                      <>
                        {remaining.days}
                        <small className="cd-word">天</small>
                      </>
                    )}
                    {remaining.hours}:{remaining.minutes}:{remaining.seconds}
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="mini-stack">
          <div className="mini-card is-today">
            <p className="mini-k">今日</p>
            <p className="mini-v">{todayCount} 门</p>
            <p className="mini-s">{todayLabel}{todayCount > 0 ? ' · 好好上课' : ' · 轻松一天'}</p>
          </div>
          <div className="mini-card is-week">
            <p className="mini-k">所选周</p>
            <p className="mini-v">{viewWeekCount} 门次</p>
            <p className="mini-s">{weekRange || `第 ${viewWeek} 周`}</p>
          </div>
          <div className="mini-card is-progress">
            <p className="mini-k">学期进度</p>
            <p className="mini-v">
              {current ?? '—'}
              <small className="mini-unit"> / {totalWeeks} 周</small>
            </p>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalWeeks}
              aria-valuenow={current ?? 0}
              aria-label="学期进度"
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
