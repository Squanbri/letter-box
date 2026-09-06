import { Alert, Loader, Stack, Text } from '@mantine/core';

export function LoadingState({ text }: { text: string }) {
  return (
    <div className="async-fill">
      <Stack align="center" gap="sm">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">{text}</Text>
      </Stack>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="async-fill">
      <Text size="sm" c="dimmed">{text}</Text>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <Alert color="red" radius={0} py="xs">{message}</Alert>;
}
