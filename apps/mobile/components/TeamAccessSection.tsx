import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Callout, Field, SectionTitle, Segmented, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import {
  fetchBusinessInvitations,
  fetchBusinessMembers,
  inviteBusinessMember,
  removeBusinessMember,
  revokeBusinessInvitation,
  updateBusinessMemberRole,
  type BusinessInvitation,
  type BusinessMember,
} from '@/lib/businessMembers';
import { canInviteRole, canManageTeam, type BusinessRole } from '@/lib/teamAccess';

type StaffOption = { id: string; name: string };

/**
 * Acces echipă (v89): membri cu cont propriu, roluri și invitații pe email.
 * Vizibil pentru owner/admin; angajatul vede doar rolul propriu.
 */
export function TeamAccessSection({
  businessId,
  staffList,
  myRole,
}: {
  businessId: string;
  staffList: StaffOption[];
  myRole: BusinessRole | null;
}) {
  const t = useTheme();
  const tr = useT();
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ members: m }, invited] = await Promise.all([
      fetchBusinessMembers(businessId),
      canManageTeam(myRole)
        ? fetchBusinessInvitations(businessId)
        : Promise.resolve({ invitations: [] as BusinessInvitation[], error: null }),
    ]);
    setMembers(m);
    setInvitations(invited.invitations);
  }, [businessId, myRole]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!myRole) return null;

  const roleLabel = (r: BusinessRole) =>
    r === 'owner' ? tr('members.roleOwner') : r === 'admin' ? tr('members.roleAdmin') : tr('members.roleStaff');

  async function invite() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { invitation, error: err } = await inviteBusinessMember({
      businessId,
      email,
      role,
      staffId,
    });
    setBusy(false);
    if (err || !invitation) {
      setError(err ?? 'invite_failed');
      return;
    }
    setEmail('');
    setMessage(tr('members.invited', { token: invitation.token }));
    await load();
  }

  return (
    <View style={styles.box}>
      <SectionTitle>{tr('members.title')}</SectionTitle>
      <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }}>{tr('members.hint')}</Text>
      {myRole === 'staff' ? (
        <Callout tone="info">{tr('members.staffOnly')}</Callout>
      ) : null}
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}

      {members.map((m) => (
        <View
          key={m.member_id}
          style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
        >
          <View style={styles.flex}>
            <Text style={{ color: t.colors.text, fontWeight: '700' }} numberOfLines={1}>
              {m.display_name ?? m.email ?? m.user_id}
            </Text>
            <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }} numberOfLines={1}>
              {roleLabel(m.role)}{m.staff_name ? ` · ${m.staff_name}` : ''}{m.email ? ` · ${m.email}` : ''}
            </Text>
          </View>
          {canManageTeam(myRole) && m.role !== 'owner' ? (
            <View style={styles.actions}>
              {canInviteRole(myRole, m.role === 'admin' ? 'staff' : 'admin') || myRole === 'owner' ? (
                <Button
                  label={m.role === 'admin' ? tr('members.roleStaff') : tr('members.roleAdmin')}
                  size="sm"
                  variant="secondary"
                  onPress={() => void updateBusinessMemberRole(m.member_id, m.role === 'admin' ? 'staff' : 'admin').then(() => load())}
                />
              ) : null}
              <Button
                label={tr('members.remove')}
                size="sm"
                variant="danger"
                onPress={() => void removeBusinessMember(m.member_id).then(async () => {
                  setMessage(tr('members.removed'));
                  await load();
                })}
              />
            </View>
          ) : null}
        </View>
      ))}

      {canManageTeam(myRole) ? (
        <>
          <Field
            label="Email"
            placeholder={tr('members.emailPh')}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <Segmented
            value={role}
            onChange={(v) => setRole(v as 'staff' | 'admin')}
            options={[
              { value: 'staff', label: tr('members.roleStaff') },
              { value: 'admin', label: tr('members.roleAdmin') },
            ]}
          />
          {staffList.length > 0 ? (
            <>
              <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }}>
                {tr('members.linkStaff')}
              </Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setStaffId(null)}
                  style={[styles.chip, { backgroundColor: staffId === null ? t.colors.accent : t.colors.surface, borderColor: t.colors.border }]}
                >
                  <Text style={{ color: staffId === null ? t.colors.onAccent : t.colors.text, fontWeight: '700', fontSize: fontSize.sm }}>
                    {tr('members.noStaff')}
                  </Text>
                </Pressable>
                {staffList.map((s) => {
                  const on = staffId === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setStaffId(s.id)}
                      style={[styles.chip, { backgroundColor: on ? t.colors.accent : t.colors.surface, borderColor: t.colors.border }]}
                    >
                      <Text style={{ color: on ? t.colors.onAccent : t.colors.text, fontWeight: '700', fontSize: fontSize.sm }}>
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          <Button label={tr('members.invite')} icon="mail-outline" loading={busy} onPress={() => void invite()} />

          {invitations.length > 0 ? (
            <>
              <SectionTitle>{tr('members.pending')}</SectionTitle>
              {invitations.map((inv) => (
                <View
                  key={inv.id}
                  style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
                >
                  <View style={styles.flex}>
                    <Text style={{ color: t.colors.text, fontWeight: '700' }} numberOfLines={1}>{inv.email}</Text>
                    <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }} numberOfLines={1}>
                      {roleLabel(inv.role)} · {inv.token}
                    </Text>
                  </View>
                  <Button
                    label={tr('members.revoke')}
                    size="sm"
                    variant="secondary"
                    onPress={() => void revokeBusinessInvitation(inv.id).then(() => load())}
                  />
                </View>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
