import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Appointment, AppointmentStatus } from '@/lib/types';

const STATUS_RO: Record<AppointmentStatus, string> = {
  pending: 'În așteptare',
  approved: 'Confirmată',
  rejected: 'Respinsă',
  cancelled: 'Anulată',
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  pending: '#b45309',
  approved: '#166534',
  rejected: '#b91c1c',
  cancelled: '#64748b',
};

type Props = {
  appointment: Appointment;
  businessName?: string;
  localLabel?: string;
  showActions?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
};

export function AppointmentCard({
  appointment,
  businessName,
  localLabel,
  showActions,
  onApprove,
  onReject,
}: Props) {
  const status = appointment.status;
  return (
    <View style={styles.card}>
      {businessName ? <Text style={styles.title}>{businessName}</Text> : null}
      <Text style={styles.time}>
        {localLabel ??
          `${new Date(appointment.start_at).toLocaleString('ro-RO')} – ${new Date(
            appointment.end_at
          ).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}`}
      </Text>
      {(appointment.client_email || appointment.client_phone) && (
        <Text style={styles.contact}>
          {[appointment.client_email, appointment.client_phone].filter(Boolean).join(' · ')}
        </Text>
      )}
      <Text style={[styles.status, { color: STATUS_COLOR[status] }]}>
        {STATUS_RO[status]}
      </Text>
      {showActions && status === 'pending' ? (
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.approve]} onPress={onApprove}>
            <Text style={styles.btnText}>Aprobă</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.reject]} onPress={onReject}>
            <Text style={styles.btnText}>Respinge</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  time: { fontSize: 14, color: '#334155', marginBottom: 4 },
  contact: { fontSize: 13, color: '#64748b', marginBottom: 4 },
  status: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  approve: { backgroundColor: '#16a34a' },
  reject: { backgroundColor: '#dc2626' },
  btnText: { color: '#fff', fontWeight: '600' },
});
