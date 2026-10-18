import { Alert, Platform } from 'react-native';

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
};

/**
 * Confirmare Da/Nu care merge și pe web.
 * Pe web, Alert.alert din react-native-web nu face nimic (butoanele nu apar),
 * așa că folosim window.confirm. Pe telefon rămâne dialogul nativ.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${opts.title}\n\n${opts.message}`)
      : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancelText, style: 'cancel', onPress: () => resolve(false) },
        {
          text: opts.confirmText,
          style: opts.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
