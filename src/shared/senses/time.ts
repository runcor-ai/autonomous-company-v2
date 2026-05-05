// Sense: time/clock — present moment + relative-time reasoning.

export interface TimeSnapshot {
  isoNow: string;
  unixMs: number;
  dayOfWeek: string;
  utcDay: string;       // YYYY-MM-DD
  utcHour: number;
  utcMinute: number;
}

export interface Clock {
  now(): TimeSnapshot;
  cyclesSince(iso: string, cycleSeconds: number): number;
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

export function createClock(nowFn: () => Date = () => new Date()): Clock {
  return {
    now() {
      const d = nowFn();
      return {
        isoNow: d.toISOString(),
        unixMs: d.getTime(),
        dayOfWeek: DAYS[d.getUTCDay()] ?? 'Unknown',
        utcDay: d.toISOString().slice(0, 10),
        utcHour: d.getUTCHours(),
        utcMinute: d.getUTCMinutes(),
      };
    },
    cyclesSince(iso, cycleSeconds) {
      const past = new Date(iso).getTime();
      const elapsedMs = nowFn().getTime() - past;
      return Math.floor(elapsedMs / 1000 / cycleSeconds);
    },
  };
}
