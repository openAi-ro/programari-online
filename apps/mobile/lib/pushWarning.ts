/** Mesaj pentru client când popup-urile push nu pot ajunge. Pur — testabil în node. */

export type PushWarning = {
  title: string;
  description: string;
  /** 'settings' = poate repara din setările telefonului; 'install' = trebuie APK real. */
  action: 'settings' | 'install' | null;
};

export function pushWarningForResult(input: {
  token: string | null;
  reason?: string;
}): PushWarning | null {
  if (input.token) return null;
  const reason = input.reason ?? '';
  if (reason === 'simulator') return null;
  if (reason === 'permission_denied') {
    return {
      title: 'Activează notificările',
      description:
        'Ai oprit notificările, deci răspunsul business-ului (aprobat/respins) nu-ți apare ca popup. Activează-le din setările telefonului.',
      action: 'settings',
    };
  }
  if (reason === 'web_unsupported' || reason.includes('Expo Go')) {
    return {
      title: 'Instalează aplicația pentru popup-uri',
      description:
        'Pe web / Expo Go nu ajung notificări push. Instalează APK-ul ca răspunsurile business-ului să-ți apară pe ecran.',
      action: 'install',
    };
  }
  return {
    title: 'Notificările nu sunt active',
    description:
      'Nu am putut înregistra acest telefon pentru popup-uri. Verifică notificările din Setări.',
    action: null,
  };
}
