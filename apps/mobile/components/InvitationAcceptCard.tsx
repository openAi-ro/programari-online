import { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { switchAppMode } from '@/components/AppModeSwitch';
import { Button, Callout, Field, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  acceptBusinessInvitation,
  fetchMyBusinessInvitations,
  type BusinessRole,
  type MyBusinessInvitation,
} from '@/lib/businessMembers';
import { useLanguage, useT } from '@/lib/i18n';
import { setSelectedBusinessId } from '@/lib/myBusiness';
import { formatInviteDate } from '@/lib/teamAccess';
import { teamErrorKey } from '@/lib/teamErrors';

/** După acceptare: business-ul nou devine cel activ și utilizatorul ajunge direct în zona salonului. */
export async function enterAcceptedBusiness(businessId: string | null) {
  if (businessId) await setSelectedBusinessId(businessId);
  await switchAppMode('business');
}

export function useRoleLabel() {
  const tr = useT();
  return (r: BusinessRole) =>
    r === 'owner' ? tr('members.roleOwner') : r === 'admin' ? tr('members.roleAdmin') : tr('members.roleStaff');
}

/**
 * Invitațiile de echipă pentru emailul contului. `compact`: doar cardurile, nimic dacă nu există
 * (ecranul principal); altfel și câmpul pentru cod.
 */
export function InvitationAcceptCard({
  compact = false,
  onEntered,
}: {
  compact?: boolean;
  /** Ecranul rămâne montat după intrarea în business (layout-ul business): recitește zona. */
  onEntered?: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLanguage();
  const roleLabel = useRoleLabel();
  const [invitations, setInvitations] = useState<MyBusinessInvitation[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const { businessId, error: err } = await acceptBusinessInvitation(token);
    setBusy(false);
    if (err) {
      setError(tr(teamErrorKey(err)));
      return;
    }
    await enterAcceptedBusiness(businessId);
    onEntered?.();
  }

  if (compact && invitations.length === 0 && !error) return null;

  return (
    <View style={styles.wrap}>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {invitations.map((inv) => (
        <View
          key={inv.invitation_id}
          style={[
            styles.card,
            { backgroundColor: t.colors.accentSoft, borderColor: t.colors.accent },
          ]}
        >
          <View style={styles.head}>
            <Ionicons name="people-outline" size={20} color={t.colors.accentSoftText} />
            <Text style={[styles.title, { color: t.colors.accentSoftText }]}>{tr('members.acceptTitle')}</Text>
          </View>
          <Text style={[styles.body, { color: t.colors.text }]}>
            {tr('members.acceptBody', {
              salon: inv.business_name,
              role: roleLabel(inv.role).toLocaleLowerCase(lang === 'en' ? 'en-GB' : 'ro-RO'),
            })}
            {inv.staff_name ? ` ${tr('members.acceptStaff', { staff: inv.staff_name })}` : ''}
          </Text>
          <Text style={[styles.help, { color: t.colors.textMuted }]}>
            {tr(inv.role === 'admin' ? 'members.roleAdminHelp' : 'members.roleStaffHelp')}{' '}
            {tr('members.acceptExpires', { date: formatInviteDate(inv.expires_at, lang) })}
          </Text>
          <Button
            label={tr('members.accept')}
            icon="checkmark-circle-outline"
            size="md"
            loading={busy}
            onPress={() => void accept(inv.token)}
          />
        </View>
      ))}
      {compact ? null : (
        <>
          <Field
            label={tr('members.haveCode')}
            hint={tr('members.codeFromSalon')}
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
  body: { fontSize: fontSize.md, lineHeight: 21 },
  help: { fontSize: fontSize.sm, lineHeight: 18 },
});
