import { useLocalSearchParams } from 'expo-router';
import ChatThread from '@/components/ChatThread';
import { managerOnly } from '@/components/ManagerOnly';

function BusinessChatThreadScreen() {
  const p = useLocalSearchParams<{ conversationId: string }>();
  const id = typeof p.conversationId === 'string' ? p.conversationId : '';
  return <ChatThread conversationId={id} isClient={false} />;
}

export default managerOnly(BusinessChatThreadScreen);
