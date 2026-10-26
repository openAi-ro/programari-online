import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Callout, Field } from '@/components/ui';
import { useT } from '@/lib/i18n';
import {
  acceptBusinessInvitation,
  fetchMyBusinessInvitations,
  type MyBusinessInvitation,
} from '@/lib/businessMembers';

/** Acceptarea invitației de echipă: automat după email, sau manual cu codul primit de la salon. */
export function InvitationAcceptCard({ onAccepted }: { onAccepted?: () => void }) {
  const tr = useT();
  const [invitations, setInvitations] = useState<MyBusinessInvitation[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { invitations: rows } = await fetchMyBusinessInvitations();
    setInvitations(rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(token: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await acceptBusinessInvitation(token);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setMessage(tr('members.accepted'));
    onAccepted?.();
    await load();
  }

  return (
    <View style={{ gap: 12 }}>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {message ? <Callout tone="success">{message}</Callout> : null}
      {invitations.map((inv) => (
        <Callout key={inv.invitation_id} tone="info" title={tr('members.acceptTitle')}>
          {inv.business_name} · {inv.role}
          {'\n'}
          <Button
            label={tr('members.accept')}
            size="sm"
            loading={busy}
            onPress={() => void accept(inv.token)}
          />
        </Callout>
      ))}
      <Field
        label={tr('members.haveCode')}
        placeholder={tr('members.codePh')}
        autoCapitalize="none"
        value={code}
        onChangeText={setCode}
      />
      <Button
        label={tr('members.accept')}
        variant="secondary"
        loading={busy}
        disabled={!code.trim()}
        onPress={() => void accept(code)}
      />
    </View>
  );
}
