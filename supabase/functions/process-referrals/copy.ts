import type { NotifyLang } from '../_shared/notify.ts';

/** Textul push-ului de recompensă, în limba celui care a invitat. */
export function referralRewardPush(
  lang: NotifyLang,
  businessName: string,
  reward: string
): { title: string; body: string } {
  if (lang === 'en') {
    return {
      title: 'You earned a reward!',
      body: reward
        ? `Your invited friend visited ${businessName}. Your reward: ${reward}.`
        : `Your invited friend visited ${businessName}. Ask the salon for your reward!`,
    };
  }
  return {
    title: 'Ai primit o recompensă!',
    body: reward
      ? `Prietenul invitat a fost la ${businessName}. Recompensa ta: ${reward}.`
      : `Prietenul invitat a fost la ${businessName}. Cere recompensa la salon!`,
  };
}
