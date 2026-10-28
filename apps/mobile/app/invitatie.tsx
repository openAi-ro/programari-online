import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { enterAcceptedBusiness, InvitationAcceptCard, useRoleLabel } from '@/components/InvitationAcceptCard';
import { Body, Button, Callout, LoadingScreen, Screen } from '@/components/ui';
import { signOut } from '@/lib/auth';
import { setPendingAuthRedirect } from '@/lib/auth-redirect';
import {
  acceptBusinessInvitation,
  fetchInvitationByToken,
  type InvitationByToken,
} from '@/lib/businessMembers';
import { useLanguage, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { formatInviteDate } from '@/lib/teamAccess';
import { teamErrorKey } from '@/lib/teamErrors';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; invitation: InvitationByToken; email: string | null };

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim() || null;
  return null;
}

/**
 * Linkul din emailul de invitație: /invitatie?token=…
 * Fără sesiune: ține minte linkul și trimite la login (garda rădăcinii lasă ruta publică).
 */
export default function InvitationScreen() {
  const tr = useT();
  const { lang } = useLanguage();
  const roleLabel = useRoleLabel();
  const token = firstParam(useLocalSearchParams<{ token?: string }>().token);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const selfPath = token ? `/invitatie?token=${encodeURIComponent(token)}` : '/invitatie';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setPendingAuthRedirect(selfPath);
        router.replace('/(auth)/login');
        return;
      }
      if (!token) {
        setState({ kind: 'missing' });
        return;
      }
      const { invitation, error } = await fetchInvitationByToken(token);
      if (cancelled) return;
      if (error || !invitation) {
        setState({ kind: 'error', message: tr(teamErrorKey(error ?? 'invitation_not_found')) });
        return;
      }
      setState({ kind: 'ready', invitation, email: data.session.user.email ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selfPath, tr]);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setAcceptError(null);
    const { businessId, error } = await acceptBusinessInvitation(token);
    setBusy(false);
    if (error) {
      setAcceptError(tr(teamErrorKey(error)));
      return;
    }
    await enterAcceptedBusiness(businessId);
  }

  async function switchAccount() {
    setPendingAuthRedirect(selfPath);
    await signOut();
    router.replace('/(auth)/login');
  }

  const goHome = () => router.replace('/(app)/home');

  if (state.kind === 'loading') return <LoadingScreen />;

  return (
    <Screen title={tr('invite.title')} onBack={goHome}>
      {state.kind === 'missing' ? (
        <>
          <Callout tone="warning">{tr('invite.missingToken')}</Callout>
          <InvitationAcceptCard />
        </>
      ) : null}

      {state.kind === 'error' ? (
        <>
          <Callout tone="danger">{state.message}</Callout>
          <Button label={tr('invite.goHome')} variant="secondary" onPress={goHome} />
        </>
      ) : null}

      {state.kind === 'ready' && state.invitation.status !== 'pending' ? (
        <>
          <Callout tone="warning">{tr('invite.notPending')}</Callout>
          <Button label={tr('invite.goHome')} variant="secondary" onPress={goHome} />
        </>
      ) : null}

      {state.kind === 'ready' && state.invitation.status === 'pending' && !state.invitation.email_matches ? (
        <>
          <Callout tone="warning" title={tr('invite.wrongEmail')}>
            {state.email ? tr('invite.signedInAs', { email: state.email }) : undefined}
          </Callout>
          <Button label={tr('invite.logout')} icon="log-out-outline" onPress={() => void switchAccount()} />
          <Button label={tr('invite.goHome')} variant="secondary" onPress={goHome} />
        </>
      ) : null}

      {state.kind === 'ready' && state.invitation.status === 'pending' && state.invitation.email_matches ? (
        <>
          <Callout tone="accent" icon="people-outline" title={tr('members.acceptTitle')}>
            {tr('members.acceptBody', {
              salon: state.invitation.business_name,
              role: roleLabel(state.invitation.role).toLocaleLowerCase(lang === 'en' ? 'en-GB' : 'ro-RO'),
            })}
            {state.invitation.staff_name ? ` ${tr('members.acceptStaff', { staff: state.invitation.staff_name })}` : ''}
          </Callout>
          <Body muted>
            {tr(state.invitation.role === 'admin' ? 'members.roleAdminHelp' : 'members.roleStaffHelp')}{' '}
            {tr('members.acceptExpires', { date: formatInviteDate(state.invitation.expires_at, lang) })}
          </Body>
          {acceptError ? <Callout tone="danger">{acceptError}</Callout> : null}
          <Button
            label={tr('members.accept')}
            icon="checkmark-circle-outline"
            loading={busy}
            onPress={() => void accept()}
          />
        </>
      ) : null}
    </Screen>
  );
}
