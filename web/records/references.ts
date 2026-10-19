import type { Route } from '../model/projection';

export function referencedCall(route: Route, ref: string) {
  const slash = ref.indexOf('/');
  if (slash < 0) return null;
  const round = route.rounds.find((round) => round.id === ref.slice(0, slash));
  if (!round) return null;
  const index = round.calls.findIndex((call) => call.id === ref.slice(slash + 1));
  return index < 0 ? null : { round, call: round.calls[index], index };
}
