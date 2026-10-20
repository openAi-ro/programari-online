/**
 * Tracks overlapping async loads so only the newest one may set state.
 * Typing a date digit by digit fires a load per intermediate date; an older
 * answer that arrives last must not overwrite the newest one.
 */
export type RequestTracker = {
  /** Start a new request; returns its id. Every earlier id stops being current. */
  start(): number;
  /** True only for the id of the most recently started request. */
  isCurrent(id: number): boolean;
};

export function createRequestTracker(): RequestTracker {
  let latest = 0;
  return {
    start() {
      latest += 1;
      return latest;
    },
    isCurrent(id: number) {
      return id === latest;
    },
  };
}
