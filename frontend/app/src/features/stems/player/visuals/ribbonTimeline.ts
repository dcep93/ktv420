import { AMPLITUDE_WINDOW_SECONDS, PAST_WINDOW_SECONDS, FUTURE_WINDOW_SECONDS } from '../types';
export const RIBBON_WINDOW = PAST_WINDOW_SECONDS + FUTURE_WINDOW_SECONDS;
export function ribbonX(index: number, time: number, width: number) {
  return (index * AMPLITUDE_WINDOW_SECONDS - time + PAST_WINDOW_SECONDS) / RIBBON_WINDOW * width;
}
export function ribbonRange(time: number) {
  return { first: Math.floor((time - PAST_WINDOW_SECONDS) / AMPLITUDE_WINDOW_SECONDS) - 1,
    last: Math.ceil((time + FUTURE_WINDOW_SECONDS) / AMPLITUDE_WINDOW_SECONDS) + 1 };
}
