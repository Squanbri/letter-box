import { Select, Switch } from '@mantine/core';
import { usePreferences } from '../../../state/preferences/PreferencesProvider';

export function SyncSettingsCard() {
  const { preferences, setIntervalMinutes, setNotifications } = usePreferences();
  return (
    <section className="dashboard-card sync-card">
      <header><div><span className="eyebrow">Настройки</span><h2>Синхронизация</h2></div></header>
      <label>
        <span>Интервал обновления</span>
        <Select
          size="xs"
          value={String(preferences.intervalMinutes)}
          data={[
            { value: '5', label: 'Каждые 5 минут' },
            { value: '15', label: 'Каждые 15 минут' },
            { value: '30', label: 'Каждые 30 минут' },
          ]}
          onChange={(value) => value && setIntervalMinutes(Number(value))}
        />
      </label>
      <div className="notification-setting">
        <span><strong>Уведомления</strong><small>Сообщать о новых письмах</small></span>
        <Switch checked={preferences.notifications} onChange={(event) => void setNotifications(event.currentTarget.checked)} />
      </div>
    </section>
  );
}
