/** Pure rules for the app's choice dialogs, shared by lib/dialog.ts and its test. */

export type DialogActionStyle = 'default' | 'cancel' | 'destructive';

export type DialogAction = {
  text: string;
  style?: DialogActionStyle;
  onPress?: () => void;
  /** Hidden on web (e.g. camera / record: the browser file dialog already covers it). */
  nativeOnly?: boolean;
};

export type DialogPlan =
  | { kind: 'none' }
  | { kind: 'run'; action: DialogAction }
  | { kind: 'show'; actions: DialogAction[] };

/**
 * What a dialog should do on a platform: drop native-only actions on web, and when a
 * single real choice is left run it at once (still inside the user's tap, so a file
 * picker can open) instead of showing a one-button menu.
 */
export function planDialog(actions: DialogAction[], isWeb: boolean): DialogPlan {
  const visible = actions.filter((a) => !(isWeb && a.nativeOnly));
  const choices = visible.filter((a) => a.style !== 'cancel');
  if (choices.length === 0) return { kind: 'none' };
  if (choices.length === 1 && visible.length - choices.length <= 1 && actions.length !== visible.length) {
    return { kind: 'run', action: choices[0] };
  }
  return { kind: 'show', actions: visible };
}

/** The action a backdrop tap / Escape / back button means: the cancel action, if any. */
export function dismissAction(actions: DialogAction[]): DialogAction | undefined {
  return actions.find((a) => a.style === 'cancel');
}
