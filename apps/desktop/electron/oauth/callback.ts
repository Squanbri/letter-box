export function interpretOAuthCallback(
  requestUrl: string,
  expectedState: string,
): { code: string } | { error: string } {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const providerError = url.searchParams.get('error');
  const description = url.searchParams.get('error_description');
  if (providerError) {
    return {
      error: description?.trim() || `Провайдер вернул ошибку: ${providerError}`,
    };
  }
  const state = url.searchParams.get('state');
  if (!state || state !== expectedState) {
    return { error: 'Не совпал state — авторизацию прервали. Попробуйте ещё раз.' };
  }
  const code = url.searchParams.get('code');
  if (!code) {
    return { error: 'Провайдер не вернул authorization code' };
  }
  return { code };
}
