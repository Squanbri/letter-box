import { Alert, Center, Loader, Stack, Text } from '@mantine/core';

export function LoadingState({ text }: { text: string }) {
  return <Center h="100%"><Stack align="center" gap="sm"><Loader size="sm" /><Text size="sm" c="dimmed">{text}</Text></Stack></Center>;
}

export function EmptyState({ text }: { text: string }) {
  return <Center h="100%"><Text size="sm" c="dimmed">{text}</Text></Center>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <Alert color="red" radius={0} py="xs">{message}</Alert>;
}
