import { Alert, Platform } from 'react-native';

import { dismissAction, planDialog, type DialogAction } from './dialogActions';

export type { DialogAction } from './dialogActions';

export type DialogRequest = {
  title: string;
  message?: string;
  actions: DialogAction[];
};

/**
 * The app's only choice / confirmation dialog.
 * Native: the system dialog (Alert.alert). Web: react-native-web's Alert.alert does
 * nothing, so an in-app modal (components/DialogHost, mounted in app/_layout) shows it.
 * Never call Alert.alert directly; use showDialog or confirmDialog.
 */
type Listener = (req: DialogRequest | null) => void;
const listeners = new Set<Listener>();

export function subscribeDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function closeDialog(): void {
  listeners.forEach((l) => l(null));
}

export function showDialog(req: DialogRequest): void {
  const isWeb = Platform.OS === 'web';
  const plan = planDialog(req.actions, isWeb);
  if (plan.kind === 'none') return;
  if (plan.kind === 'run') { plan.action.onPress?.(); return; }
  if (!isWeb) {
    const cancel = dismissAction(plan.actions);
    Alert.alert(
      req.title,
      req.message,
      plan.actions.map(({ text, style, onPress }) => ({ text, style, onPress })),
      { cancelable: true, onDismiss: () => cancel?.onPress?.() }
    );
    return;
  }
  const shown = { ...req, actions: plan.actions };
  listeners.forEach((l) => l(shown));
}

/** Yes/no confirmation. Resolves false on cancel or dismiss. */
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    showDialog({
      title: opts.title,
      message: opts.message,
      actions: [
        { text: opts.cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmText, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
    });
  });
}
