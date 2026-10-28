import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRoleLabel } from '@/components/InvitationAcceptCard';
import { Button, Callout, Field, SectionTitle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useLanguage, useT } from '@/lib/i18n';
import {
  fetchBusinessInvitations,
  fetchBusinessMembers,
  invitationLink,
  inviteBusinessMember,
  removeBusinessMember,
  revokeBusinessInvitation,
  sendBusinessInviteEmail,
  updateBusinessMemberRole,
  type BusinessInvitation,
  type BusinessMember,
} from '@/lib/businessMembers';
import { shareText } from '@/lib/shareBusiness';
import {
  canInviteRole,
  canManageTeam,
  formatInviteDate,
  isInviteExpired,
  type BusinessRole,
} from '@/lib/teamAccess';
import { teamErrorKey } from '@/lib/teamErrors';
import { useBusinessRole } from '@/lib/useBusinessRole';

type StaffOption = { id: string; name: string };
type InviteRole = 'staff' | 'admin';

/**
 * Acces echipă: membri cu cont propriu și invitații pe email (v97: email Brevo, retrimitere, expirare).
 * Ecranul e accesibil doar owner/admin (ghidajul din business/_layout).
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
  const { lang } = useLanguage();
  const roleLabel = useRoleLabel();
  const { businessName } = useBusinessRole();
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [invitations, setInvitations] = useState<BusinessInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('staff');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManageTeam(myRole)) return;
    const [{ members: m }, { invitations: inv }] = await Promise.all([
      fetchBusinessMembers(businessId),
      fetchBusinessInvitations(businessId),
    ]);
    setMembers(m);
    setInvitations(inv);
  }, [businessId, myRole]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManageTeam(myRole)) return null;

  const showError = (raw: string) => {
    setMessage(null);
    setError(tr(teamErrorKey(raw)));
  };
  const showMessage = (text: string) => {
    setError(null);
    setMessage(text);
  };

  // Specialiștii care au deja cont nu pot fi legați a doua oară (server: staff_already_linked).
  const takenStaff = new Set(members.map((m) => m.staff_id).filter((id): id is string => Boolean(id)));
  const canPickAdmin = canInviteRole(myRole, 'admin');
  const needsStaff = role === 'staff' && !staffId;
  const canSend = email.trim().length > 3 && !needsStaff;

  function pickRole(next: InviteRole) {
    setRole(next);
    if (next === 'staff' && staffId && takenStaff.has(staffId)) setStaffId(null);
  }

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
    if (err || !invitation) {
      setBusy(false);
      showError(err ?? 'generic');
      return;
    }
    const { error: mailErr } = await sendBusinessInviteEmail(invitation.id);
    setBusy(false);
    setEmail('');
    setStaffId(null);
    if (mailErr) setError(tr('members.invitedNoEmail'));
    else showMessage(tr('members.invitedSent', { email: invitation.email }));
    await load();
  }

  async function resend(inv: BusinessInvitation) {
    setRowBusy(inv.id);
    const { error: err } = await sendBusinessInviteEmail(inv.id);
    setRowBusy(null);
    if (err) showError(err);
    else showMessage(tr('members.resent', { email: inv.email }));
    await load();
  }

  async function runRow(id: string, action: () => Promise<{ error: string | null }>, ok?: string) {
    setRowBusy(id);
    const { error: err } = await action();
    setRowBusy(null);
    if (err) showError(err);
    else if (ok) showMessage(ok);
    await load();
  }

  async function copyCode(token: string) {
    await Clipboard.setStringAsync(token);
    showMessage(tr('members.copied'));
  }

  async function shareInvite(inv: BusinessInvitation) {
    const outcome = await shareText(
      tr('members.shareText', {
        salon: businessName ?? '',
        email: inv.email,
        link: invitationLink(inv.token),
        token: inv.token,
      })
    );
    if (outcome === 'copied') showMessage(tr('members.copied'));
  }

  const roleOption = (value: InviteRole, help: string) => {
    const on = role === value;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => pickRole(value)}
        style={[
          styles.roleCard,
          {
            backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
            borderColor: on ? t.colors.accent : t.colors.border,
          },
        ]}
      >
        <Ionicons
          name={on ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={on ? t.colors.accent : t.colors.textMuted}
        />
        <View style={styles.flex}>
          <Text style={[styles.strong, { color: on ? t.colors.accentSoftText : t.colors.text }]}>
            {roleLabel(value)}
          </Text>
          <Text style={[styles.small, { color: on ? t.colors.accentSoftText : t.colors.textMuted }]}>
            {help}
          </Text>
        </View>
      </Pressable>
    );
  };

  const chip = (id: string | null, label: string, disabled = false) => {
    const on = staffId === id;
    return (
      <Pressable
        key={id ?? 'none'}
        disabled={disabled}
        accessibilityState={{ selected: on, disabled }}
        onPress={() => setStaffId(id)}
        style={[
          styles.chip,
          {
            backgroundColor: on ? t.colors.accent : t.colors.surface,
            borderColor: on ? t.colors.accent : t.colors.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Text style={[styles.chipText, { color: on ? t.colors.onAccent : t.colors.text }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.box}>
      <SectionTitle>{tr('members.title')}</SectionTitle>
      <Text style={[styles.small, { color: t.colors.textMuted }]}>{tr('members.hint')}</Text>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}

      {members.map((m) => {
        const canEditRole = myRole === 'owner' && m.role !== 'owner';
        const canRemove = m.role === 'staff' || (myRole === 'owner' && m.role === 'admin');
        return (
          <View
            key={m.member_id}
            style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
          >
            <View style={styles.flex}>
              <Text style={[styles.strong, { color: t.colors.text }]} numberOfLines={1}>
                {m.display_name ?? m.email ?? m.user_id}
              </Text>
              <Text style={[styles.small, { color: t.colors.textMuted }]} numberOfLines={2}>
                {roleLabel(m.role)}{m.staff_name ? ` · ${m.staff_name}` : ''}{m.email ? ` · ${m.email}` : ''}
              </Text>
            </View>
            {canEditRole || canRemove ? (
              <View style={styles.actions}>
                {canEditRole ? (
                  <Button
                    label={m.role === 'admin' ? tr('members.makeStaff') : tr('members.makeAdmin')}
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={rowBusy === m.member_id}
                    onPress={() =>
                      void runRow(m.member_id, () =>
                        updateBusinessMemberRole(m.member_id, m.role === 'admin' ? 'staff' : 'admin')
                      )
                    }
                  />
                ) : null}
                {canRemove ? (
                  <Button
                    label={tr('members.remove')}
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    loading={rowBusy === m.member_id}
                    onPress={() =>
                      void runRow(m.member_id, () => removeBusinessMember(m.member_id), tr('members.removed'))
                    }
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={[styles.form, { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border }]}>
        <Text style={[styles.formTitle, { color: t.colors.text }]}>{tr('members.formTitle')}</Text>
        <Text style={[styles.small, { color: t.colors.textMuted }]}>{tr('members.formHint')}</Text>

        <Field
          label={tr('members.emailLabel')}
          placeholder={tr('members.emailPh')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <Text style={[styles.label, { color: t.colors.text }]}>{tr('members.roleLabel')}</Text>
        <View accessibilityRole="radiogroup" style={styles.roles}>
          {roleOption('staff', tr('members.roleStaffHelp'))}
          {canPickAdmin ? roleOption('admin', tr('members.roleAdminHelp')) : null}
        </View>
        {canPickAdmin ? null : (
          <Text style={[styles.small, { color: t.colors.textMuted }]}>{tr('members.adminOwnerOnly')}</Text>
        )}

        <Text style={[styles.label, { color: t.colors.text }]}>
          {role === 'staff' ? tr('members.linkStaff') : tr('members.linkStaffAdmin')}
        </Text>
        {staffList.length > 0 ? (
          <View style={styles.chips}>
            {role === 'admin' ? chip(null, tr('members.noStaff')) : null}
            {staffList.map((s) => {
              const taken = takenStaff.has(s.id);
              return chip(s.id, taken ? `${s.name} (${tr('members.staffTaken')})` : s.name, taken);
            })}
          </View>
        ) : null}
        {role === 'staff' && staffList.length === 0 ? (
          <Callout tone="warning">{tr('members.noStaffYet')}</Callout>
        ) : needsStaff ? (
          <Text style={[styles.small, { color: t.colors.textMuted }]}>{tr('members.staffRequired')}</Text>
        ) : null}

        <Button
          label={tr('members.invite')}
          icon="mail-outline"
          loading={busy}
          disabled={!canSend}
          onPress={() => void invite()}
        />
      </View>

      <SectionTitle>{tr('members.pending')}</SectionTitle>
      {invitations.length === 0 ? (
        <Text style={[styles.small, { color: t.colors.textMuted }]}>{tr('members.pendingEmpty')}</Text>
      ) : (
        invitations.map((inv) => {
          const expired = isInviteExpired(inv.expires_at);
          const staffName = staffList.find((s) => s.id === inv.staff_id)?.name;
          return (
            <View
              key={inv.id}
              style={[styles.pending, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
            >
              <Text style={[styles.strong, { color: t.colors.text }]} numberOfLines={1}>{inv.email}</Text>
              <Text style={[styles.small, { color: t.colors.textMuted }]}>
                {roleLabel(inv.role)}{staffName ? ` · ${staffName}` : ''}
              </Text>
              <Text style={[styles.small, { color: expired ? t.colors.danger : t.colors.textMuted }]}>
                {expired
                  ? tr('members.expired')
                  : tr('members.expires', { date: formatInviteDate(inv.expires_at, lang) })}
              </Text>
              <Text style={[styles.code, { color: t.colors.text }]} selectable>
                {tr('members.codeLine', { token: inv.token })}
              </Text>
              <Text style={[styles.small, { color: t.colors.textMuted }]}>
                {tr('members.codeHelp', { email: inv.email })}
              </Text>
              <View style={styles.actions}>
                <Button
                  label={tr('members.resend')}
                  icon="mail-outline"
                  size="sm"
                  fullWidth={false}
                  loading={rowBusy === inv.id}
                  onPress={() => void resend(inv)}
                />
                <Button
                  label={tr('members.copy')}
                  icon="copy-outline"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => void copyCode(inv.token)}
                />
                <Button
                  label={tr('members.share')}
                  icon="share-outline"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => void shareInvite(inv)}
                />
                <Button
                  label={tr('members.revoke')}
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => void runRow(inv.id, () => revokeBusinessInvitation(inv.id))}
                />
              </View>
            </View>
          );
        })
      )}
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
    flexWrap: 'wrap',
  },
  pending: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  form: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, marginTop: spacing.sm },
  formTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  label: { fontSize: fontSize.sm, fontWeight: '700' },
  roles: { gap: spacing.sm },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  flex: { flex: 1, gap: 2, minWidth: 160 },
  strong: { fontWeight: '700', fontSize: fontSize.md },
  small: { fontSize: fontSize.sm, lineHeight: 18 },
  code: { fontSize: fontSize.sm, fontWeight: '700', fontFamily: 'monospace' },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontWeight: '700', fontSize: fontSize.sm },
});
